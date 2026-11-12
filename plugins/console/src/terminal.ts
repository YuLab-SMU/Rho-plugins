import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Writable } from 'node:stream';
import { confined, now, requireThat, stateDirectory } from '@rho-workspace/plugin-contracts';
import headless from '@xterm/headless';
import { markedShell, shellMarks } from './shell-marks.js';
import { CommandLog, commandLimits, type Tracking } from './terminal-commands.js';
export { commandLimits, type CommandScreen, type TerminalCommand, type TerminalCommandState } from './terminal-commands.js';

// A terminal is a shell on a pseudo-terminal, in the project folder: what a terminal window gives
// the person, drawn by the page. The person and an Agent may both use it; who opened it and who
// last typed there besides them are kept with it. It lives while Rho runs. Closing it, or Rho
// closing, hangs up the shell the way closing a terminal window does.
//
// The protected resources are this machine's processes and Rho's memory. A project keeps at most
// maxTerminals at once (ended ones make room; with all of them live a new one is refused). Each
// keeps its last scrollbackBytes of output; older output is counted in `dropped` when a reader
// asks for it, never returned as if it were whole. One read returns at most maxReadBytes and waits
// at most maxWaitMs; one write takes at most maxWriteBytes. What a terminal shows is also kept as
// text by a terminal emulator (xterm.js without a page), with screenScrollback lines above the
// screen; a reading of it returns at most maxScreenLines lines, and one that waits for output
// returns once the output has been quiet for quietMs, or at maxWaitMs.
//
// The commands run in a terminal whose shell marks them are recorded in the project's state
// folder, with what they printed, within the limits of terminal-commands.ts (commandLimits).
export const terminalLimits = { maxTerminals: 4, scrollbackBytes: 1024 * 1024, maxReadBytes: 256 * 1024, maxWriteBytes: 64 * 1024, maxWaitMs: 25000, maxCols: 500, maxRows: 300, closeGraceMs: 2000,
  screenScrollback: 2000, screenLines: 60, maxScreenLines: 500, quietMs: 400, ...commandLimits };
export type TerminalLimits = typeof terminalLimits;

export interface TerminalRecord {
  terminalId: string; by: string; shell: string; cwd: string; cols: number; rows: number;
  startedAt: string; endedAt: string | null; exit: { code: number | null; signal: string | null } | null;
  // Bytes printed so far, and the offset of the oldest byte still kept.
  bytes: number; kept: number; problem: string | null;
  // The latest input from anyone other than whoever opened it (an Agent in the person's terminal).
  typedBy?: { by: string; at: string } | null;
  // Whether its shell marks its commands, so Rho records them; known once its first prompt shows.
  recording?: boolean;
}
type Screen = InstanceType<typeof headless.Terminal>;
interface Live {
  child: ChildProcess; control: Writable | null; record: TerminalRecord; chunks: Buffer[]; waiters: Set<() => void>; errors: string; killTimer?: NodeJS.Timeout; screen: Screen;
  // Who has typed since the last prompt, and the command running.
  tracking: Tracking;
}

// The pseudo-terminal is opened by a few lines of Python, which macOS and Linux have and which
// needs no compiled module in Rho: it starts the shell on a new terminal, copies bytes both
// ways, and sets the size from "cols rows" lines on descriptor 3. When Rho's end closes it
// closes the terminal, which hangs up the shell.
const bridge = `
import os, sys, pty, select, fcntl, termios, struct, signal
cols, rows, argv = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
pid, fd = pty.fork()
if pid == 0:
    try:
        os.execvp(argv[0], argv)
    except Exception as error:
        os.write(2, str(error).encode())
        os._exit(127)
def size(c, r):
    try: fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
    except OSError: pass
size(cols, rows)
watch, pending = [fd, 0, 3], b''
while True:
    try: ready, _, _ = select.select(watch, [], [])
    except InterruptedError: continue
    if fd in ready:
        try: data = os.read(fd, 65536)
        except OSError: data = b''
        if not data: break
        os.write(1, data)
    if 0 in ready:
        data = os.read(0, 65536)
        if not data: break
        while data:
            try: data = data[os.write(fd, data):]
            except OSError: data = b''
    if 3 in ready:
        data = os.read(3, 4096)
        if not data: watch.remove(3)
        pending += data
        while b'\\n' in pending:
            line, pending = pending.split(b'\\n', 1)
            parts = line.split()
            if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit(): size(int(parts[0]), int(parts[1]))
try: os.close(fd)
except OSError: pass
try:
    _, status = os.waitpid(pid, 0)
    sys.exit(128 + os.WTERMSIG(status) if os.WIFSIGNALED(status) else os.WEXITSTATUS(status))
except ChildProcessError:
    sys.exit(0)
`;

const whole = (n: unknown, low: number, high: number) => typeof n === 'number' && Number.isInteger(n) && n >= low && n <= high;

export class TerminalHost {
  private live = new Map<string, Live>();
  private log: CommandLog;
  constructor(private root: string, private options: { limits?: Partial<TerminalLimits>; shell?: string; python?: string; env?: NodeJS.ProcessEnv; onChange?: () => void } = {}) {
    this.log = new CommandLog(root, () => this.folder(), () => this.limits, () => this.changed());
  }
  private get limits(): TerminalLimits { return { ...terminalLimits, ...this.options.limits }; }
  private changed() { this.options.onChange?.(); }
  private folder() { return stateDirectory(this.root, '.rho/plugins/console'); }
  private shell() {
    const chosen = this.options.shell ?? process.env.SHELL ?? '/bin/sh';
    return path.isAbsolute(chosen) ? chosen : '/bin/sh';
  }
  private need(terminalId: string) {
    const live = this.live.get(terminalId);
    requireThat(live, 'not_found', 'This terminal is closed. Open a new one.');
    return live;
  }

  list() { return { terminals: [...this.live.values()].map(l => ({ ...l.record })) }; }

  async open(input: { cols: number; rows: number; cwd?: string; by: string }) {
    requireThat(process.platform !== 'win32', 'unavailable', 'A terminal needs a pseudo-terminal, which Rho does not open on Windows yet. Run single commands from the command line instead.');
    requireThat(whole(input.cols, 2, this.limits.maxCols) && whole(input.rows, 1, this.limits.maxRows), 'invalid', `Size the terminal between 2 × 1 and ${this.limits.maxCols} × ${this.limits.maxRows}.`);
    // An ended terminal makes room; a live one is never closed for another.
    while (this.live.size >= this.limits.maxTerminals) {
      const ended = [...this.live.values()].find(l => l.record.endedAt !== null);
      requireThat(ended, 'limit', `At most ${this.limits.maxTerminals} terminals are open in a project at once. Close one first.`, { limit: 'maxTerminals', maximum: this.limits.maxTerminals });
      this.live.delete(ended.record.terminalId); ended.screen.dispose();
    }
    const cwd = input.cwd ?? '', folder = cwd ? await confined(this.root, cwd) : await fs.realpath(this.root);
    requireThat((await fs.stat(folder)).isDirectory(), 'invalid', 'Open a terminal in a folder of this project.');
    const shell = this.shell(), name = path.basename(shell), login = ['zsh', 'bash', 'fish', 'sh', 'ksh', 'dash', 'ash', 'mksh'].includes(name);
    const record: TerminalRecord = { terminalId: 't-' + randomBytes(8).toString('hex'), by: input.by, shell, cwd, cols: input.cols, rows: input.rows, startedAt: now(), endedAt: null, exit: null, bytes: 0, kept: 0, problem: null, recording: false };
    // A shell that marks its commands starts with Rho's startup files around the person's own.
    await this.log.load();
    const kind = markedShell(shell), nonce = randomBytes(12).toString('hex'), base: NodeJS.ProcessEnv = { ...process.env, ...this.options.env };
    for (const [key, value] of Object.entries(base)) if (value === undefined) delete base[key];
    const marks = kind ? await shellMarks(kind, await this.folder(), nonce, base, this.root).catch(() => null) : null;
    const env: NodeJS.ProcessEnv = { ...base, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Rho', ...marks?.env };
    let child: ChildProcess;
    try {
      // Its own process group: a signal to Rho's group does not reach the shell through it.
      child = spawn(this.options.python ?? 'python3', ['-u', '-c', bridge, String(input.cols), String(input.rows), shell, ...(marks ? marks.args : login ? ['-l'] : [])], { cwd: folder, env, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    } catch (error) {
      requireThat(false, 'unavailable', 'The terminal could not be started: ' + (error instanceof Error ? error.message : 'python3 did not start.'));
      throw error;
    }
    const screen = new headless.Terminal({ cols: input.cols, rows: input.rows, scrollback: this.limits.screenScrollback, allowProposedApi: true });
    const live: Live = { child, control: child.stdio[3] as Writable, record, chunks: [], waiters: new Set(), errors: '', screen, tracking: { typers: [], lastTyper: null, running: null, prompt: null } };
    if (marks) this.log.watch(screen, record.terminalId, nonce, live.tracking, record.by, () => { if (!record.recording) { record.recording = true; this.changed(); } });
    this.live.set(record.terminalId, live);
    const wake = () => { for (const done of [...live.waiters]) done(); };
    child.stdout!.on('data', (chunk: Buffer) => {
      live.chunks.push(chunk); record.bytes += chunk.length; screen.write(chunk);
      // The oldest output goes once more than the scrollback is kept.
      let held = record.bytes - record.kept;
      while (live.chunks.length > 1 && held - live.chunks[0]!.length >= this.limits.scrollbackBytes) { const old = live.chunks.shift()!; held -= old.length; record.kept += old.length; }
      wake();
    });
    child.stderr!.on('data', (chunk: Buffer) => { if (live.errors.length < 2000) live.errors += chunk.toString('utf8'); });
    for (const stream of [child.stdin, live.control]) stream?.on('error', () => {});
    const ended = (code: number | null, signal: string | null, problem?: string) => {
      if (record.endedAt) return;
      clearTimeout(live.killTimer);
      record.endedAt = now(); record.exit = { code, signal };
      // A command running when its shell ended: `exit` ends with the shell; any other was not seen to end.
      const last = live.tracking.running?.command;
      if (last) void this.log.end(live.tracking, /^\s*(exit|logout)\b/.test(last.command) ? code : null, 'Its terminal ended while it ran.', live.screen);
      record.problem = problem ?? (code === 127 && !record.bytes ? (live.errors.trim() || 'The shell could not be started.') : code !== null && code > 1 && !record.bytes && live.errors.trim() ? live.errors.trim().split('\n').at(-1)! : null);
      wake(); this.changed();
    };
    child.on('error', error => ended(null, null, /ENOENT/.test(error.message) ? 'A terminal needs python3 on this machine to open a pseudo-terminal, and it was not found.' : error.message));
    child.on('close', (code, signal) => ended(code, signal));
    this.changed();
    return { terminal: { ...record } };
  }

  // Typed input, as `by` sends it; input from anyone but the opener is kept as the latest such.
  write(terminalId: string, data: string, by?: string) {
    const live = this.need(terminalId);
    requireThat(Buffer.byteLength(data) <= this.limits.maxWriteBytes, 'limit', `Send at most ${this.limits.maxWriteBytes} bytes at a time.`, { limit: 'maxWriteBytes', maximum: this.limits.maxWriteBytes });
    requireThat(live.record.endedAt === null, 'condition', 'This terminal\'s shell has ended. Open a new one.');
    live.child.stdin!.write(data);
    this.log.typed(live.tracking, by, data);
    if (by && by !== live.record.by) { live.record.typedBy = { by, at: now() }; this.changed(); }
    return { terminalId, bytes: Buffer.byteLength(data), offset: live.record.bytes };
  }

  resize(terminalId: string, cols: number, rows: number) {
    const live = this.need(terminalId);
    requireThat(whole(cols, 2, this.limits.maxCols) && whole(rows, 1, this.limits.maxRows), 'invalid', `Size the terminal between 2 × 1 and ${this.limits.maxCols} × ${this.limits.maxRows}.`);
    if (live.record.endedAt === null && (live.record.cols !== cols || live.record.rows !== rows)) { live.record.cols = cols; live.record.rows = rows; live.control?.write(`${cols} ${rows}\n`); live.screen.resize(cols, rows); }
    return { terminal: { ...live.record } };
  }

  // What the terminal printed after `after`, as bytes in base64: a character may be split
  // between two reads, and the page joins them. With nothing new it waits up to waitMs for
  // output or for the shell to end.
  async read(terminalId: string, after = 0, waitMs = 0, maxBytes = this.limits.maxReadBytes) {
    const live = this.need(terminalId), record = live.record;
    requireThat(maxBytes > 0 && maxBytes <= this.limits.maxReadBytes, 'limit', `Read at most ${this.limits.maxReadBytes} bytes at a time.`, { limit: 'maxReadBytes', maximum: this.limits.maxReadBytes });
    if (record.bytes <= after && record.endedAt === null && waitMs > 0) await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); live.waiters.delete(done); resolve(); };
      const timer = setTimeout(done, Math.min(waitMs, this.limits.maxWaitMs));
      live.waiters.add(done);
    });
    const from = Math.min(Math.max(after, record.kept), record.bytes);
    const parts: Buffer[] = []; let at = record.kept, taken = 0;
    for (const chunk of live.chunks) {
      const start = Math.max(0, from - at), room = maxBytes - taken;
      if (room <= 0) break;
      if (start < chunk.length) { const part = chunk.subarray(start, start + room); parts.push(part); taken += part.length; }
      at += chunk.length;
    }
    return { data: Buffer.concat(parts).toString('base64'), offset: from, nextOffset: from + taken, dropped: Math.max(0, from - after), more: from + taken < record.bytes, terminal: { ...record } };
  }

  // What the terminal shows now, as text: its lines up to the bottom of the screen, a line the
  // screen wrapped joined again, at most `lines` of them (the screen's own rows and those above
  // it), where the cursor is on the screen, and whether a full-screen program (an editor, top,
  // less) has the screen. Given `after`, the offset of bytes a writer or reader was at, it first
  // waits up to waitMs for output past it and for that output to stop for quietMs, so a command
  // just typed has printed what it prints at once. `offset` is the bytes printed by then.
  async screen(terminalId: string, input: { after?: number; waitMs?: number; lines?: number } = {}) {
    const live = this.need(terminalId), record = live.record, limits = this.limits;
    const lines = input.lines ?? limits.screenLines;
    requireThat(whole(lines, 1, limits.maxScreenLines), 'limit', `Read at most ${limits.maxScreenLines} lines at a time.`, { limit: 'maxScreenLines', maximum: limits.maxScreenLines });
    const wait = (ms: number) => new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); live.waiters.delete(done); resolve(); };
      const timer = setTimeout(done, Math.max(0, ms));
      live.waiters.add(done);
    });
    // quiet: the output had stopped (or the shell ended) when the reading was taken.
    let quiet = true;
    if (input.after !== undefined && (input.waitMs ?? 0) > 0) {
      const until = Date.now() + Math.min(input.waitMs!, limits.maxWaitMs);
      while (record.bytes <= input.after && record.endedAt === null && Date.now() < until) await wait(until - Date.now());
      let seen = -1;
      while (record.endedAt === null && record.bytes !== seen && Date.now() < until) { seen = record.bytes; await wait(Math.min(limits.quietMs, until - Date.now())); }
      quiet = record.endedAt !== null || (record.bytes === seen && record.bytes > input.after);
    }
    await new Promise<void>(resolve => live.screen.write('', resolve));
    const buffer = live.screen.buffer.active, text: string[] = [], cursorRow = buffer.baseY + buffer.cursorY;
    let cursorLine = 0;
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (!line) continue;
      if (line.isWrapped && text.length) text[text.length - 1] += line.translateToString(true); else text.push(line.translateToString(true));
      if (i === cursorRow) cursorLine = text.length - 1;
    }
    // Blank rows below the cursor are the screen's empty rest.
    while (text.length - 1 > cursorLine && !text.at(-1)!.trim()) text.pop();
    return { lines: text.slice(-lines), omitted: Math.max(0, text.length - lines), cursor: { row: buffer.cursorY, col: buffer.cursorX }, fullScreen: buffer.type === 'alternate', offset: record.bytes, quiet, terminal: { ...record } };
  }

  // The commands run in the project's terminals, the newest first, from every terminal and every
  // run of Rho that kept them; and what one printed.
  commandList(limit = 50, offset = 0) { return this.log.list(limit, offset); }
  commandOutput(commandId: string, offset?: number, maxChars?: number) { return this.log.output(commandId, offset, maxChars); }

  // Closing hangs up the shell, as closing a terminal window does, and forgets the terminal.
  close(terminalId: string) {
    const live = this.need(terminalId);
    this.end(live);
    this.live.delete(terminalId); live.screen.dispose();
    for (const done of [...live.waiters]) done();
    this.changed();
    return { terminal: { ...live.record } };
  }
  private end(live: Live) {
    if (live.record.endedAt !== null) return;
    const pid = live.child.pid;
    const signal = (name: NodeJS.Signals) => { try { if (pid) process.kill(pid, name); } catch { /* It has ended. */ } };
    signal('SIGTERM');
    live.killTimer = setTimeout(() => signal('SIGKILL'), this.limits.closeGraceMs);
    live.killTimer.unref?.();
  }
  // Rho closing: every shell is hung up, and a command still running is recorded as not seen to
  // end. The returned promise settles once the record is written.
  async shutdown() {
    const ending: Promise<void>[] = [];
    for (const live of this.live.values()) {
      this.end(live); clearTimeout(live.killTimer);
      if (live.tracking.running) ending.push(this.log.end(live.tracking, null, 'Rho closed while it ran; how it ended was not seen.', live.screen));
      live.screen.dispose();
    }
    this.live.clear();
    await Promise.all(ending);
    await this.log.save();
  }
}
