import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { atomicJson, digest, now, readJson, requireThat, stateDirectory } from '@rho-workspace/plugin-contracts';
import { operationContracts } from './operations.js';
import { operationPresentation, presentation } from './presentation.js';
import type { cellStates, languages, sessionStates } from './contract.js';

export type Language = typeof languages[number];
export interface Variable { name: string; type: string; size: string; bytes: number; summary: string }
export interface SessionRecord {
  sessionId: string; language: Language; state: typeof sessionStates[number]; version: string | null; pid: number | null;
  startedAt: string; startedBy: string; endedAt: string | null;
  ending: 'stopped' | 'exited' | 'rho-closed' | 'not-started' | null; stop: Asked | null; problem: string | null;
  variables: Variable[]; variablesOmitted: number; variablesAt: string | null; cells: number;
}
export interface Asked { by: string; at: string }
export type Output = { kind: 'stdout' | 'stderr' | 'warning' | 'error'; text: string } | { kind: 'plot'; plot: number; width: number; height: number };
export interface CellRecord {
  cellId: string; changeId: string; by: string; sessionId: string; language: Language; code: string; purpose: string | null;
  queuedAt: string; startedAt: string | null; endedAt: string | null; state: typeof cellStates[number]; number: number;
  outputs: Output[]; bytes: number; kept: number; cut: boolean; interrupt: Asked | null; problem: string | null;
  defined?: string[]; removed?: string[];
}
export type InspectInput = { language: Language; name: string; path?: number[]; offset?: number; limit?: number; sort?: { column: number; descending: boolean } };
// The protected resources are this machine's processes and memory, and the project's state
// folder. At most one session runs per language, and at most maxQueued cells wait in each. A
// cell keeps its first maxOutputBytes of output (the rest is counted) and at most maxPlots
// plots of at most maxPlotBytes each; at most maxCells cells are kept, the oldest going first
// with their plots. The session lists at most maxVariables variables. A run waits at most
// maxWaitMs for its cell. What a session's own code allocates is not bounded here.
// Reading a value shows at most inspectColumns columns, a page of at most 200 rows, elements or
// parts (inspectRows unless asked), cells of inspectCellChars characters and a printed form of
// inspectTextBytes; a table sorts only up to inspectSortRows rows. A reading that takes longer
// than inspectTimeoutMs is interrupted, and the session waits for it no longer than
// inspectGiveUpMs more before the caller is told.
export const kernelLimits = { maxCells: 500, maxQueued: 16, maxCodeBytes: 65536, maxOutputBytes: 256 * 1024, maxPlots: 8, maxPlotBytes: 4 * 1024 * 1024, maxVariables: 200, maxWaitMs: 600000, startTimeoutMs: 30000, stopGraceMs: 3000, maxEndedSessions: 20,
  inspectRows: 50, inspectColumns: 50, inspectChildren: 200, inspectCellChars: 120, inspectTextBytes: 16 * 1024, inspectSortRows: 1000000, inspectTimeoutMs: 10000, inspectGiveUpMs: 5000 };
export type KernelLimits = typeof kernelLimits;

interface Live {
  record: SessionRecord; child: ChildProcess; answers: string; early: string; order: Promise<void>; queue: CellRecord[]; current: CellRecord | null; stopping: boolean; timer?: NodeJS.Timeout;
  // Printed text not yet placed, the highest mark seen on standard output, and answers waiting for theirs.
  printed: string; mark: number; held: Array<{ seq: number; msg: unknown }>; release?: NodeJS.Timeout;
  // The value being read now, and the readings waiting their turn.
  looking: { id: string; done: (msg: any) => void } | null; lookups: Promise<unknown>;
}
const markStart = '\x1eRHO:';
const runners: Record<Language, string> = {
  r: fileURLToPath(new URL('../runners/runner.R', import.meta.url)),
  python: fileURLToPath(new URL('../runners/runner.py', import.meta.url)),
};
const id = (prefix: string) => prefix + randomBytes(8).toString('hex');
const ended = (state: CellRecord['state']) => !['queued', 'running'].includes(state);

// The live R and Python sessions of one project, and the cells run in them. A cell keeps its
// identity: the same changeId from the same caller returns the same cell and never runs it
// twice. Cells run one at a time in their session, in the order they came. Reading never
// starts a session. When Rho closes, its sessions end with it: a later start records each as
// ended and a cell that was running as unknown, and runs nothing again.
export class KernelHost {
  private sessions: SessionRecord[] | null = null;
  private cells: CellRecord[] = [];
  private live = new Map<Language, Live>();
  private waiters = new Map<string, Array<() => void>>();
  private writing: Promise<void> = Promise.resolve();
  private saveTimer?: NodeJS.Timeout;
  // Requests arrive together (a person and an Agent, a repeated request): the record is read
  // once, and what changes it (queueing, interrupting, stopping) is done one at a time.
  private loading?: Promise<SessionRecord[]>;
  private turn: Promise<unknown> = Promise.resolve();
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.turn.then(work, work);
    this.turn = next.catch(() => {});
    return next;
  }
  constructor(private root: string, private options: { limits?: Partial<KernelLimits>; rscript?: string; python?: string; onChange?: () => void } = {}) {}
  private get limits(): KernelLimits { return { ...kernelLimits, ...this.options.limits }; }
  private async folder() { return stateDirectory(this.root, '.rho/plugins/kernel'); }
  private async plots() { const folder = path.join(await this.folder(), 'plots'); await fs.mkdir(folder, { recursive: true, mode: 0o700 }); return folder; }
  private load() { return this.loading ??= this.readRecord(); }
  private async readRecord() {
    const state = await readJson<{ sessions: SessionRecord[]; cells: CellRecord[] }>(path.join(await this.folder(), 'state.json'), { sessions: [], cells: [] });
    let changed = false;
    for (const s of state.sessions) if (s.state !== 'ended') {
      Object.assign(s, { state: 'ended', endedAt: s.endedAt ?? now(), ending: 'rho-closed', problem: 'Rho closed while this session ran; its variables are gone.' });
      changed = true;
    }
    for (const c of state.cells) if (!ended(c.state)) {
      Object.assign(c, c.state === 'running' ? { state: 'unknown', problem: 'Rho closed while this cell ran; how it ended was not observed.' } : { state: 'not-run', problem: 'Rho closed before this cell ran.' });
      changed = true;
    }
    this.sessions = state.sessions; this.cells = state.cells;
    if (changed) await this.save();
    return this.sessions;
  }
  private save() {
    clearTimeout(this.saveTimer); this.saveTimer = undefined;
    this.writing = this.writing.then(async () => atomicJson(path.join(await this.folder(), 'state.json'), { sessions: this.sessions ?? [], cells: this.cells }));
    return this.writing;
  }
  // Output arrives in many small pieces; it is written at most twice a second.
  private soon() { this.options.onChange?.(); this.saveTimer ??= setTimeout(() => void this.save(), 500); }
  private changed() { void this.save().then(() => this.options.onChange?.()); }

  async read(limit = 200, cellId?: string) {
    const sessions = await this.load();
    const cells = cellId ? this.cells.filter(c => c.cellId === cellId) : this.cells.slice(-limit);
    return { sessions: structuredClone([...sessions].reverse()), cells: structuredClone(cells), omitted: cellId ? 0 : Math.max(0, this.cells.length - limit) };
  }

  async run(input: { language: Language; code: string; purpose?: string; changeId: string; by: string; waitMs?: number }) {
    await this.load();
    const cell = await this.exclusive(() => this.queue(input));
    // Waiting for the cell holds nothing: other requests, an interrupt among them, go on.
    const wait = Math.min(input.waitMs ?? 0, this.limits.maxWaitMs);
    if (wait > 0 && !ended(cell.state)) await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, wait);
      const list = this.waiters.get(cell.cellId) ?? []; list.push(() => { clearTimeout(timer); resolve(); }); this.waiters.set(cell.cellId, list);
    });
    return { cell: structuredClone(cell), session: structuredClone(this.sessions!.find(s => s.sessionId === cell.sessionId)!) };
  }

  private async queue(input: { language: Language; code: string; purpose?: string; changeId: string; by: string }) {
    const known = this.cells.find(c => c.changeId === input.changeId && c.by === input.by);
    if (known) {
      requireThat(known.code === input.code && known.language === input.language, 'conflict', 'This change identity already names a different cell.');
    } else {
      requireThat(input.code.trim().length > 0 && Buffer.byteLength(input.code) <= this.limits.maxCodeBytes, 'invalid', `Write code of at most ${this.limits.maxCodeBytes} bytes.`, { limit: 'maxCodeBytes' });
      const live = await this.ensure(input.language, input.by);
      requireThat(live.queue.length < this.limits.maxQueued, 'limit', `At most ${this.limits.maxQueued} cells wait in a session. Wait for some to run or interrupt the one running.`, { limit: 'maxQueued', maximum: this.limits.maxQueued });
      // The oldest finished cells make room, with their plots.
      while (this.cells.length >= this.limits.maxCells) {
        const index = this.cells.findIndex(c => ended(c.state));
        requireThat(index >= 0, 'limit', 'The session record is full of cells that have not ended.', { limit: 'maxCells' });
        const [old] = this.cells.splice(index, 1);
        for (const output of old!.outputs) if (output.kind === 'plot') await fs.rm(path.join(await this.plots(), `${old!.cellId}-${output.plot}.png`), { force: true });
      }
      live.record.cells++;
      const cell: CellRecord = { cellId: id('k-'), changeId: input.changeId, by: input.by, sessionId: live.record.sessionId, language: input.language, code: input.code, purpose: input.purpose?.trim().slice(0, 200) || null,
        queuedAt: now(), startedAt: null, endedAt: null, state: 'queued', number: live.record.cells, outputs: [], bytes: 0, kept: 0, cut: false, interrupt: null, problem: null, defined: [], removed: [] };
      this.cells.push(cell); live.queue.push(cell);
      this.changed();
      await this.pump(live);
    }
    return this.cells.find(c => c.changeId === input.changeId && c.by === input.by)!;
  }

  // The language's live session, started for this caller when there is none.
  private async ensure(language: Language, by: string) {
    const running = this.live.get(language);
    if (running && !running.stopping) return running;
    requireThat(!running, 'conflict', 'The session is stopping. Run the cell again when it has ended.');
    const record: SessionRecord = { sessionId: id('s-'), language, state: 'starting', version: null, pid: null, startedAt: now(), startedBy: by, endedAt: null, ending: null, stop: null, problem: null, variables: [], variablesOmitted: 0, variablesAt: null, cells: 0 };
    this.sessions!.push(record);
    const old = this.sessions!.filter(s => s.state === 'ended');
    if (old.length > this.limits.maxEndedSessions) this.sessions!.splice(this.sessions!.indexOf(old[0]!), 1);
    const program = language === 'r' ? this.options.rscript ?? 'Rscript' : this.options.python ?? 'python3';
    const root = await fs.realpath(this.root);
    const child = spawn(program, [runners[language], root], { cwd: root, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], env: { ...process.env, MPLBACKEND: 'Agg', PYTHONUNBUFFERED: '1' } });
    const live: Live = { record, child, answers: '', early: '', order: Promise.resolve(), queue: [], current: null, stopping: false, printed: '', mark: 0, held: [], looking: null, lookups: Promise.resolve() };
    this.live.set(language, live);
    record.pid = child.pid ?? null;
    live.timer = setTimeout(() => { if (record.state === 'starting') { record.problem = `The session did not start within ${Math.round(this.limits.startTimeoutMs / 1000)} s.`; this.signal(live, 'SIGKILL'); } }, this.limits.startTimeoutMs);
    (child.stdio[3] as NodeJS.ReadableStream).setEncoding('utf8');
    (child.stdio[3] as NodeJS.ReadableStream).on('data', (chunk: string) => {
      live.answers += chunk;
      for (let at = live.answers.indexOf('\n'); at >= 0; at = live.answers.indexOf('\n')) {
        const line = live.answers.slice(0, at); live.answers = live.answers.slice(at + 1);
        // Answers are taken in the order they came: a cell ends only after its plots are kept.
        let msg: any;
        try { msg = JSON.parse(line); } catch { continue; }
        // An answer that follows printed text waits for its mark, so it lands after that text.
        if (Number.isInteger(msg?.seq) && msg.seq > live.mark) this.hold(live, msg.seq, msg);
        else this.take(live, msg);
      }
    });
    // What the session's process writes itself, past the code's own output (a program it ran,
    // a library's C code), belongs to the cell running then.
    // Before the session is ready, what it writes says why it could not start.
    const raw = (kind: 'stdout' | 'stderr') => (text: string) => {
      if (!text) return;
      if (live.current) { this.append(live.current, kind, text); this.soon(); }
      else if (record.version === null && live.early.length < 2048) live.early += text;
    };
    child.stdout!.setEncoding('utf8'); child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => this.printed(live, chunk, raw('stdout'))); child.stderr!.on('data', raw('stderr'));
    child.stdin!.on('error', () => {});
    child.on('error', error => {
      record.problem = (error as NodeJS.ErrnoException).code === 'ENOENT' ? `${program} was not found. Install ${language === 'r' ? 'R' : 'Python'}, or name the program where the application is started.` : error.message;
    });
    // All it printed has been read by now; answers still waiting go first.
    child.on('close', code => { this.marked(live, Number.MAX_SAFE_INTEGER); live.order = live.order.then(() => this.end(live, code)); });
    this.changed();
    return live;
  }
  private take(live: Live, msg: unknown) { live.order = live.order.then(() => this.answer(live, msg)).catch(() => {}); }
  private hold(live: Live, seq: number, msg: unknown) {
    live.held.push({ seq, msg });
    // A mark that never comes (the code redirected its output) lets the answers through after a second.
    live.release ??= setTimeout(() => { live.release = undefined; this.marked(live, Math.max(...live.held.map(h => h.seq))); }, 1000);
  }
  private marked(live: Live, mark: number) {
    live.mark = Math.max(live.mark, mark);
    const ready = live.held.filter(h => h.seq <= live.mark).sort((a, b) => a.seq - b.seq);
    live.held = live.held.filter(h => h.seq > live.mark);
    for (const h of ready) this.take(live, h.msg);
    if (!live.held.length) { clearTimeout(live.release); live.release = undefined; }
  }
  // Standard output in order: text before a mark belongs before the answer that mark names.
  private printed(live: Live, chunk: string, place: (text: string) => void) {
    live.printed += chunk;
    for (;;) {
      const at = live.printed.indexOf(markStart);
      if (at < 0) {
        // Keep a tail that may be the start of a mark split across reads.
        let keep = 0;
        for (let k = Math.min(markStart.length - 1, live.printed.length); k > 0; k--) if (live.printed.endsWith(markStart.slice(0, k))) { keep = k; break; }
        place(live.printed.slice(0, live.printed.length - keep)); live.printed = live.printed.slice(live.printed.length - keep);
        return;
      }
      place(live.printed.slice(0, at));
      const end = live.printed.indexOf('\x1e', at + markStart.length);
      if (end < 0) { live.printed = live.printed.slice(at); return; }
      const mark = Number(live.printed.slice(at + markStart.length, end));
      live.printed = live.printed.slice(end + 1);
      if (Number.isInteger(mark)) this.marked(live, mark);
    }
  }
  private signal(live: Live, name: NodeJS.Signals) { try { if (live.record.pid) process.kill(-live.record.pid, name); } catch { /* it has ended */ } }

  private async pump(live: Live) {
    if (live.current || live.looking || live.record.state !== 'idle' || !live.queue.length) return;
    const cell = live.queue.shift()!;
    live.current = cell; cell.state = 'running'; cell.startedAt = now(); live.record.state = 'busy';
    live.child.stdin!.write(JSON.stringify({ op: 'run', id: cell.cellId, number: cell.number, code: cell.code, plots: await this.plots(), maxPlots: this.limits.maxPlots, maxVariables: this.limits.maxVariables }) + '\n');
    this.changed();
  }

  private append(cell: CellRecord, kind: 'stdout' | 'stderr' | 'warning' | 'error', text: string) {
    const bytes = Buffer.byteLength(text);
    cell.bytes += bytes;
    const room = this.limits.maxOutputBytes - cell.kept;
    if (room <= 0) { cell.cut = true; return; }
    const kept = bytes <= room ? text : Buffer.from(text).subarray(0, room).toString('utf8').replace(/�+$/, '');
    if (kept.length < text.length) cell.cut = true;
    cell.kept += Buffer.byteLength(kept);
    const last = cell.outputs.at(-1);
    if (last && last.kind === kind) last.text += kept; else cell.outputs.push({ kind, text: kept });
  }

  private async answer(live: Live, msg: any) {
    const record = live.record, cell = live.current;
    if (msg.kind === 'ready') {
      clearTimeout(live.timer);
      Object.assign(record, { state: 'idle', version: String(msg.version ?? ''), variables: msg.variables?.items ?? [], variablesOmitted: msg.variables?.omitted ?? 0, variablesAt: now() });
      this.changed(); await this.pump(live); return;
    }
    if (msg.kind === 'inspected') { const looking = live.looking; if (looking && looking.id === msg.id) looking.done(msg); return; }
    if (!cell || msg.id !== cell.cellId) return;
    if (['stdout', 'stderr', 'warning', 'error'].includes(msg.kind)) { this.append(cell, msg.kind, String(msg.text ?? '')); this.soon(); return; }
    if (msg.kind === 'plot') {
      const plots = await this.plots(), file = path.resolve(String(msg.file ?? ''));
      const number = Number(/-(\d+)\.png$/.exec(file)?.[1]);
      if (path.dirname(file) !== plots || !number) return;
      const size = await fs.stat(file).then(s => s.size, () => -1);
      if (size < 0) return;
      if (size > this.limits.maxPlotBytes) { await fs.rm(file, { force: true }); this.append(cell, 'stderr', `A plot of ${size} bytes was larger than maxPlotBytes and was not kept.\n`); }
      else cell.outputs.push({ kind: 'plot', plot: number, width: Number(msg.width) || 0, height: Number(msg.height) || 0 });
      this.soon(); return;
    }
    if (msg.kind === 'done') {
      cell.state = msg.interrupted ? 'interrupted' : msg.ok ? 'done' : 'error'; cell.endedAt = now();
      // What the cell made or changed, as the session lists its variables before and after it. A
      // name past the listed ones may still be there, so removals are said only of a whole list.
      const after: Variable[] = msg.variables?.items ?? record.variables, mark = (v: Variable) => [v.type, v.size, v.bytes, v.summary].join('\u0000');
      const before = new Map(record.variables.map(v => [v.name, mark(v)]));
      cell.defined = after.filter(v => before.get(v.name) !== mark(v)).map(v => v.name);
      cell.removed = record.variablesOmitted || msg.variables?.omitted ? [] : [...before.keys()].filter(name => !after.some(v => v.name === name));
      Object.assign(record, { state: 'idle', variables: after, variablesOmitted: msg.variables?.omitted ?? 0, variablesAt: now() });
      live.current = null;
      this.finish(cell);
      this.changed(); await this.pump(live);
    }
  }
  private finish(cell: CellRecord) { for (const resolve of this.waiters.get(cell.cellId) ?? []) resolve(); this.waiters.delete(cell.cellId); }

  private end(live: Live, code: number | null) {
    clearTimeout(live.timer);
    live.looking?.done({ state: 'ended', problem: 'The session ended while the value was read.' });
    const record = live.record;
    Object.assign(record, { state: 'ended', endedAt: now(), ending: live.stopping ? 'stopped' : record.version === null ? 'not-started' : 'exited', variables: [], variablesOmitted: 0 });
    if (record.version === null && !live.stopping) record.problem ??= `The session did not start${live.early.trim() ? ': ' + live.early.trim().slice(0, 600) : ` (exit ${code ?? 'by a signal'}).`}`;
    if (!live.stopping && record.version !== null) record.problem ??= `The session's process ended (exit ${code ?? 'by a signal'}); its variables are gone.`;
    if (live.current) {
      Object.assign(live.current, { state: 'error', endedAt: now(), problem: live.stopping ? 'The session was stopped while this cell ran.' : 'The session ended while this cell ran.' });
      this.finish(live.current);
    }
    for (const cell of live.queue) { Object.assign(cell, { state: 'not-run', endedAt: now(), problem: record.version === null ? record.problem ?? 'The session did not start.' : 'The session ended before this cell ran.' }); this.finish(cell); }
    if (this.live.get(record.language) === live) this.live.delete(record.language);
    this.changed();
  }

  // Interrupting a running cell stops it and leaves its session; a waiting cell is not run. A
  // cell that has ended is returned as it is, so a repeated request changes nothing.
  async interrupt(cellId: string, by: string) {
    await this.load();
    return this.exclusive(async () => this.interrupting(cellId, by));
  }
  private interrupting(cellId: string, by: string) {
    const cell = this.cells.find(c => c.cellId === cellId);
    requireThat(cell, 'not_found', 'This cell is not in the session record.');
    const live = [...this.live.values()].find(l => l.record.sessionId === cell.sessionId);
    if (live && cell.state === 'running' && live.current === cell && !cell.interrupt) { cell.interrupt = { by, at: now() }; this.signal(live, 'SIGINT'); this.changed(); }
    else if (live && cell.state === 'queued') {
      live.queue.splice(live.queue.indexOf(cell), 1);
      Object.assign(cell, { state: 'not-run', endedAt: now(), interrupt: { by, at: now() } });
      this.finish(cell); this.changed();
    }
    return { cell: structuredClone(cell) };
  }

  // Stopping names its session: a session that has ended is returned as it is.
  async stop(sessionId: string, by: string) {
    const sessions = await this.load();
    return this.exclusive(async () => this.stopping(sessions, sessionId, by));
  }
  private stopping(sessions: SessionRecord[], sessionId: string, by: string) {
    const record = sessions.find(s => s.sessionId === sessionId);
    requireThat(record, 'not_found', 'This session is not in the session record.');
    const live = [...this.live.values()].find(l => l.record === record);
    if (!live) return { session: structuredClone(record) };
    if (!live.stopping) {
      live.stopping = true; live.record.stop = { by, at: now() };
      live.child.stdin!.end(); this.signal(live, 'SIGTERM');
      setTimeout(() => this.signal(live, 'SIGKILL'), this.limits.stopGraceMs).unref();
      this.changed();
    }
    return { session: structuredClone(live.record) };
  }

  // Reading a value never starts a session and never waits for a cell: while one runs or waits
  // the answer is busy. Readings of one session go one at a time, and a cell queued meanwhile
  // starts when the reading ends. The value is read as the session holds it now.
  async inspect(input: InspectInput) {
    await this.load();
    const live = this.live.get(input.language);
    const answer = (state: string, extra: { problem?: string | null; object?: unknown } = {}) => ({ state, sessionId: live?.record.sessionId ?? null, afterCell: live?.record.cells ?? 0, readAt: now(), problem: extra.problem ?? null, object: extra.object ?? null });
    if (!live || live.stopping) return answer('none', { problem: `There is no live ${input.language === 'r' ? 'R' : 'Python'} session.` });
    const busy = () => live.record.state === 'starting' ? 'The session is starting.' : live.current || live.queue.length ? 'A cell is running in the session; the value can be read when it ends.' : null;
    if (busy()) return answer('busy', { problem: busy() });
    const reading = live.lookups.then(() => {
      if (busy() || live.stopping || live.record.state === 'ended') return answer(live.record.state === 'ended' ? 'ended' : 'busy', { problem: busy() ?? 'The session ended.' });
      return new Promise<ReturnType<typeof answer>>(resolve => {
        const lookId = id('i-'), limits = this.limits;
        let told = false;
        const tell = (msg: any) => { if (!told) { told = true; resolve(answer(msg.state, { problem: msg.problem, object: msg.object })); } };
        const slow = setTimeout(() => this.signal(live, 'SIGINT'), limits.inspectTimeoutMs);
        const giveUp = setTimeout(() => tell({ state: 'timeout', problem: 'Reading the value took too long; the session has not answered yet.' }), limits.inspectTimeoutMs + limits.inspectGiveUpMs);
        // The session stays held until it answers, whatever the caller was told.
        live.looking = { id: lookId, done: msg => { clearTimeout(slow); clearTimeout(giveUp); if (live.looking?.id === lookId) live.looking = null; tell(msg); void this.pump(live); } };
        live.child.stdin!.write(JSON.stringify({ op: 'inspect', id: lookId, name: input.name, path: input.path ?? [], offset: input.offset ?? 0, limit: Math.min(input.limit ?? limits.inspectRows, 200), sort: input.sort ?? null,
          limits: { maxColumns: limits.inspectColumns, maxChildren: limits.inspectChildren, maxCellChars: limits.inspectCellChars, maxText: limits.inspectTextBytes, maxSortRows: limits.inspectSortRows } }) + '\n');
      });
    });
    live.lookups = reading.catch(() => {});
    return reading;
  }

  async plot(cellId: string, plot: number) {
    await this.load();
    const cell = this.cells.find(c => c.cellId === cellId);
    requireThat(cell, 'not_found', 'This cell is not in the session record.');
    const output = cell.outputs.find(o => o.kind === 'plot' && o.plot === plot) as Extract<Output, { kind: 'plot' }> | undefined;
    requireThat(output, 'not_found', 'This cell kept no such plot.');
    const data = await fs.readFile(path.join(await this.plots(), `${cellId}-${plot}.png`));
    return { mediaType: 'image/png' as const, data: data.toString('base64'), width: output.width, height: output.height };
  }

  // Closing ends the sessions: their variables live only in their processes.
  async close() {
    const exits = [...this.live.values()].map(live => new Promise<void>(resolve => {
      live.stopping = true;
      if (live.child.exitCode !== null || live.child.signalCode !== null) return resolve();
      const timer = setTimeout(() => { this.signal(live, 'SIGKILL'); resolve(); }, this.limits.stopGraceMs);
      live.child.once('exit', () => { clearTimeout(timer); resolve(); });
      live.child.stdin!.end(); this.signal(live, 'SIGTERM');
    }));
    for (const live of [...this.live.values()]) {
      live.looking?.done({ state: 'ended', problem: 'Rho closed while the value was read.' });
      Object.assign(live.record, { state: 'ended', endedAt: now(), ending: 'rho-closed', variables: [] });
      if (live.current) Object.assign(live.current, { state: 'unknown', endedAt: now(), problem: 'Rho closed while this cell ran.' });
      for (const cell of live.queue) Object.assign(cell, { state: 'not-run', endedAt: now(), problem: 'Rho closed before this cell ran.' });
      clearTimeout(live.timer); clearTimeout(live.release);
      for (const stream of live.child.stdio) { stream?.removeAllListeners('data'); }
      live.child.removeAllListeners('close');
    }
    this.live.clear();
    await Promise.all(exits);
    clearTimeout(this.saveTimer); this.saveTimer = undefined;
    await this.save();
  }
}

const content = [
  'Each project has a live R session and a live Python session that you and the person share.',
  'To look at data, check a value or try a model, run code with kernel.run (language "r" or "python") instead of a one-off Rscript -e or python3 -c: what you define stays in the session for the next cell, and the person sees each cell, its output, its plots and the variables.',
  'Give each cell a short purpose. Pass waitMs to wait for it to finish; kernel.read reads it later.',
  'A session starts with the first cell of its language. Interrupt a cell that runs too long with kernel.interrupt; only the person stops a session.',
  'Results meant to last still go to files from a script, so they can be run again without the session.',
].join('\n');
export const plugin = { entryVersion: '1.0' as const, id: 'kernel', package: '@rho-workspace/plugin-kernel', version: '0.1.0', requires: [] as string[], capabilities: ['kernel'], presentation,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })),
  skills: [{ id: 'kernel.session', version: '1.0', content, digest: digest(content), presentation: { displayName: 'Live session', description: 'Explains how to run code in the project\'s live R and Python sessions.' },
    intent: 'Run code in the live session and read what it printed.', requires: ['kernel.run', 'kernel.read'],
    example: { method: 'kernel.run', input: { language: 'r', code: 'summary(cars)', purpose: 'Summarise the cars data', changeId: 'cell-1', waitMs: 30000 } },
    failureRecipes: [{ kind: 'limit', message: 'Too many cells are waiting.', next: 'Wait for the running cell, or interrupt it, then run again with a new changeId.' }],
    verify: { command: 'npm run test:notebook', description: 'Runs R and Python cells, keeps their output, plots and variables, interrupts and stops sessions, and keeps identity across a restart.' } }],
};
