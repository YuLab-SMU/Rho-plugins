import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicJson, confined, digest, now, readJson, requireThat, stateDirectory } from '@rho-workspace/plugin-contracts';
import { operationContracts } from './operations.js';
import { operationPresentation, presentation } from './presentation.js';
import type { commandStates } from './contract.js';

export type CommandState = typeof commandStates[number];
export interface ConsoleRecord {
  commandId: string; changeId: string; command: string; cwd: string; by: string;
  startedAt: string; endedAt: string | null; state: CommandState;
  exit: { code: number | null; signal: string | null } | null; pid: number | null;
  bytes: number; kept: number; cut: boolean;
  stop: { requestedAt: string; by: string } | null; problem: string | null;
}
// The protected resources are the project's state folder and this machine's processes: at most
// this many records are kept (the oldest finished ones go first), this many commands run at
// once, and each keeps its first maxOutputBytes of output and its last tailBytes; a page read
// returns at most maxReadBytes. Past a limit the command is refused or its middle output is
// counted, never silently dropped.
export const consoleLimits = { maxRecords: 200, maxRunning: 4, maxOutputBytes: 1024 * 1024, tailBytes: 64 * 1024, maxReadBytes: 64 * 1024, stopGraceMs: 3000 };
export type ConsoleLimits = typeof consoleLimits;

interface Running { child: ChildProcess; out: WriteStream; record: ConsoleRecord; tail: Buffer[]; tailSize: number; stopTimer?: NodeJS.Timeout }

// Runs the commands a person types for one project, in its folder, with their shell. A command
// keeps its identity: the same changeId returns the same record and never starts it twice. It
// runs in its own process group so Stop reaches what it started. When Rho closes, commands keep
// running; the next start records each as continuing outside Rho or, if it is gone, unknown.
export class ConsoleRunner {
  private records: ConsoleRecord[] | null = null;
  private running = new Map<string, Running>();
  private writing: Promise<void> = Promise.resolve();
  constructor(private root: string, private options: { limits?: Partial<ConsoleLimits>; shell?: string; onChange?: () => void } = {}) {}
  private get limits(): ConsoleLimits { return { ...consoleLimits, ...this.options.limits }; }
  private async folder() { return stateDirectory(this.root, '.rho/plugins/console'); }
  private async load() {
    if (this.records) return this.records;
    const records = await readJson<ConsoleRecord[]>(path.join(await this.folder(), 'commands.json'), []);
    let changed = false;
    for (const r of records) if (r.state === 'running' && !this.running.has(r.commandId)) {
      // Rho was not here when it ended, or it is still going on without Rho reading its output.
      const alive = r.pid !== null && (() => { try { process.kill(r.pid!, 0); return true; } catch { return false; } })();
      r.state = alive ? 'continuing' : 'unknown';
      r.problem = alive ? 'It was running when Rho closed and is still running; its later output is not kept.' : 'Rho closed while it ran; how it ended was not observed.';
      changed = true;
    }
    this.records = records;
    if (changed) await this.save();
    return records;
  }
  private save() {
    this.writing = this.writing.then(async () => atomicJson(path.join(await this.folder(), 'commands.json'), this.records ?? []));
    return this.writing;
  }
  private changed() { this.options.onChange?.(); }
  private shell() {
    const chosen = this.options.shell ?? process.env.SHELL ?? '/bin/sh';
    return path.isAbsolute(chosen) ? chosen : '/bin/sh';
  }

  async list(limit = 50) {
    const records = await this.load();
    const live = (r: ConsoleRecord) => { const run = this.running.get(r.commandId); return run ? { ...r, bytes: run.record.bytes, kept: run.record.kept, cut: run.record.cut } : r; };
    const ordered = [...records].reverse();
    return { commands: ordered.slice(0, limit).map(live), omitted: Math.max(0, ordered.length - limit) };
  }

  async run(input: { command: string; cwd?: string; changeId: string; by: string }) {
    const records = await this.load();
    const known = records.find(r => r.changeId === input.changeId && r.by === input.by);
    if (known) {
      requireThat(known.command === input.command && known.cwd === (input.cwd ?? ''), 'conflict', 'This change identity already names a different command.');
      return { ...known };
    }
    requireThat(input.command.trim().length > 0 && input.command.length <= 4096, 'invalid', 'Type a command of at most 4096 characters.');
    requireThat(this.running.size < this.limits.maxRunning, 'limit', `At most ${this.limits.maxRunning === 1 ? 'one command runs' : this.limits.maxRunning + ' commands run'} at once. Stop one or wait for it to end.`, { limit: 'maxRunning', maximum: this.limits.maxRunning });
    const cwd = input.cwd ?? '';
    const folder = cwd ? await confined(this.root, cwd) : await fs.realpath(this.root);
    requireThat((await fs.stat(folder)).isDirectory(), 'invalid', 'Run a command in a folder of this project.');
    // The oldest finished records make room; a running one is never forgotten.
    while (records.length >= this.limits.maxRecords) {
      const index = records.findIndex(r => r.state !== 'running' && r.state !== 'continuing');
      requireThat(index >= 0, 'limit', 'The console record is full of running commands.', { limit: 'maxRecords' });
      const [old] = records.splice(index, 1);
      await fs.rm(path.join(await this.folder(), old!.commandId + '.log'), { force: true });
    }
    const record: ConsoleRecord = { commandId: 'c-' + randomBytes(8).toString('hex'), changeId: input.changeId, command: input.command, cwd, by: input.by, startedAt: now(), endedAt: null, state: 'running', exit: null, pid: null, bytes: 0, kept: 0, cut: false, stop: null, problem: null };
    records.push(record);
    const log = path.join(await this.folder(), record.commandId + '.log');
    const out = createWriteStream(log, { flags: 'wx', mode: 0o600 });
    const shell = this.shell(), login = /\/(?:zsh|bash)$/.test(shell);
    let child: ChildProcess;
    try {
      child = spawn(shell, [login ? '-lc' : '-c', input.command], { cwd: folder, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    } catch (error) {
      record.state = 'not-started'; record.endedAt = now(); record.problem = error instanceof Error ? error.message : 'The command could not be started.';
      out.end(); await this.save(); this.changed(); return { ...record };
    }
    record.pid = child.pid ?? null;
    const running: Running = { child, out, record, tail: [], tailSize: 0 };
    this.running.set(record.commandId, running);
    const take = (chunk: Buffer) => {
      record.bytes += chunk.length;
      const room = this.limits.maxOutputBytes - record.kept;
      if (room > 0) { const part = chunk.subarray(0, room); out.write(part); record.kept += part.length; }
      if (chunk.length > Math.max(0, room)) {
        record.cut = true;
        const rest = room > 0 ? chunk.subarray(room) : chunk;
        running.tail.push(rest); running.tailSize += rest.length;
        while (running.tailSize - (running.tail[0]?.length ?? 0) >= this.limits.tailBytes) running.tailSize -= running.tail.shift()!.length;
      }
    };
    child.stdout?.on('data', take); child.stderr?.on('data', take);
    child.on('error', error => { record.problem = error.message; });
    child.on('close', (code, signal) => {
      clearTimeout(running.stopTimer);
      if (record.cut) {
        const tail = Buffer.concat(running.tail), shown = tail.subarray(Math.max(0, tail.length - this.limits.tailBytes));
        const note = Buffer.from(`\n… ${(record.bytes - record.kept - shown.length).toLocaleString('en-US')} bytes not kept …\n`);
        out.write(note); out.write(shown); record.kept += note.length + shown.length;
      }
      out.end();
      record.endedAt = now(); record.exit = { code, signal };
      record.state = record.stop ? 'stopped' : record.pid === null ? 'not-started' : 'exited';
      this.running.delete(record.commandId);
      void this.save().then(() => this.changed());
    });
    const started = { ...record };
    await this.save(); this.changed();
    return started;
  }

  async output(commandId: string, offset = 0, maxBytes = this.limits.maxReadBytes) {
    const records = await this.load();
    const record = records.find(r => r.commandId === commandId);
    requireThat(record, 'not_found', 'This command is not in the console record.');
    requireThat(maxBytes > 0 && maxBytes <= this.limits.maxReadBytes, 'limit', `Read at most ${this.limits.maxReadBytes} bytes of output at a time.`, { limit: 'maxReadBytes', maximum: this.limits.maxReadBytes });
    const file = path.join(await this.folder(), commandId + '.log');
    const handle = await fs.open(file, 'r').catch(() => null);
    if (!handle) return { text: '', offset, nextOffset: offset, more: false, kept: 0, running: this.running.has(commandId) };
    try {
      const size = (await handle.stat()).size;
      const start = Math.min(offset, size), length = Math.min(maxBytes, size - start);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      // A page ends on a whole character; the next one starts where this one stopped.
      let end = length;
      if (start + length < size) {
        let lead = end - 1;
        while (lead >= 0 && end - lead < 4 && (buffer[lead]! & 0xc0) === 0x80) lead--;
        const byte = lead >= 0 ? buffer[lead]! : 0, need = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
        if (lead >= 0 && end - lead < need) end = lead;
      }
      return { text: buffer.subarray(0, end).toString('utf8'), offset: start, nextOffset: start + end, more: start + end < size, kept: size, running: this.running.has(commandId) };
    } finally { await handle.close(); }
  }

  async stop(commandId: string, by: string) {
    const records = await this.load();
    const record = records.find(r => r.commandId === commandId);
    requireThat(record, 'not_found', 'This command is not in the console record.');
    const running = this.running.get(commandId);
    if (!running || record.stop) return { ...record };
    record.stop = { requestedAt: now(), by };
    const signal = (name: NodeJS.Signals) => { try { if (record.pid) process.kill(-record.pid, name); } catch { /* it has ended */ } };
    signal('SIGTERM');
    running.stopTimer = setTimeout(() => signal('SIGKILL'), this.limits.stopGraceMs);
    await this.save(); this.changed();
    return { ...record };
  }

  // Closing stops reading output; the commands themselves are left running (see above).
  async close() {
    for (const run of this.running.values()) { clearTimeout(run.stopTimer); run.child.stdout?.removeAllListeners(); run.child.stderr?.removeAllListeners(); run.child.removeAllListeners(); run.out.end(); }
    this.running.clear();
    await this.writing;
  }
}

const content = [
  'The Console records commands the person at this machine runs in the project folder.',
  'Agents run their own commands with their own tools; an Agent may read this record with console.list and console.output.',
  'Use capability.list to see whether those reads are enabled for you.',
  'A command keeps its changeId: repeating it returns the same record and never runs it twice.',
  'How a command ended is what Rho observed: an exit code or signal, a requested stop, or unknown.',
].join('\n');
export const plugin = { entryVersion: '1.0' as const, id: 'console', package: '@rho-workspace/plugin-console', version: '0.1.0', requires: [] as string[], capabilities: ['console'], presentation,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })),
  skills: [{ id: 'console.workspace', version: '1.0', content, digest: digest(content), presentation: { displayName: 'Console', description: 'Explains what the console records and that it runs commands only for the person.' },
    intent: 'Read the commands the person ran and how they ended.', requires: ['console.list', 'console.output'],
    example: { method: 'console.list', input: { limit: 20 } },
    failureRecipes: [{ kind: 'limit', message: 'Too many commands are running.', next: 'Stop one or wait for it to end, then run again with a new changeId.' }],
    verify: { command: 'npm run test:console', description: 'Runs, reads and stops commands and keeps their identity across a lost response and a restart.' } }],
};
