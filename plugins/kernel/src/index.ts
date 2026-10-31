import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { atomicBytes, atomicJson, confined, digest, now, readJson, requireThat, stateDirectory } from '@rho-workspace/plugin-contracts';
import { checkCommand, copyCommand, listCommand, readCheck, readCopy, readList, sessionCommand, signalCommand, Ssh, type Copy, type Place, type PlaceCheck } from './places.js';
import { operationContracts } from './operations.js';
import { operationPresentation, presentation } from './presentation.js';
import type { cellStates, languages, sessionStates } from './contract.js';

export type Language = typeof languages[number];
export interface Variable { name: string; type: string; size: string; bytes: number; summary: string }
export interface SessionRecord {
  sessionId: string; language: Language; state: typeof sessionStates[number]; version: string | null; pid: number | null;
  startedAt: string; startedBy: string; endedAt: string | null;
  ending: 'stopped' | 'exited' | 'disconnected' | 'rho-closed' | 'not-started' | null; stop: Asked | null; problem: string | null;
  variables: Variable[]; variablesOmitted: number; variablesAt: string | null; cells: number;
  // Where it ran, as the place was named when it started (null: this machine), and the machine's
  // own name as the session reported it. Sessions recorded before have neither.
  place?: SessionPlace | null; host?: string | null;
}
export interface SessionPlace { placeId: string; label: string; destination: string; folder: string }
export type { Copy, Place, PlaceCheck, RemoteEntry } from './places.js';
export interface Places { places: Place[]; use: Record<Language, string>; copies: Copy[] }
export interface Asked { by: string; at: string }
export type Output = { kind: 'stdout' | 'stderr' | 'warning' | 'error'; text: string } | { kind: 'plot'; plot: number; width: number; height: number };
export interface CellRecord {
  cellId: string; changeId: string; by: string; sessionId: string; language: Language; code: string; purpose: string | null;
  queuedAt: string; startedAt: string | null; endedAt: string | null; state: typeof cellStates[number]; number: number;
  outputs: Output[]; bytes: number; kept: number; cut: boolean; interrupt: Asked | null; problem: string | null;
  defined?: string[]; removed?: string[];
  // The session's values the code read, and the project files its strings name, read or written.
  used?: string[]; files?: Array<{ path: string; how: 'read' | 'wrote' }>;
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
// A cell names at most this many project files it read or wrote.
export const lineageLimits = { files: 32 };
// Places: at most maxPlaces are named. A session on a server that is not ready within
// remoteStartTimeoutMs is ended; checking a place, listing a folder there and sending a signal
// end after their times. A listing names at most remoteEntries entries from at most
// remoteListBytes; a file larger than remoteCopyBytes is not copied, and a copy ends after
// remoteCopyTimeoutMs. The newest maxCopies copies are recorded.
export const kernelLimits = { maxCells: 500, maxQueued: 16, maxCodeBytes: 65536, maxOutputBytes: 256 * 1024, maxPlots: 8, maxPlotBytes: 4 * 1024 * 1024, maxVariables: 200, maxWaitMs: 600000, startTimeoutMs: 30000, stopGraceMs: 3000, maxEndedSessions: 20,
  inspectRows: 50, inspectColumns: 50, inspectChildren: 200, inspectCellChars: 120, inspectTextBytes: 16 * 1024, inspectSortRows: 1000000, inspectTimeoutMs: 10000, inspectGiveUpMs: 5000,
  maxPlaces: 16, remoteStartTimeoutMs: 90000, remoteCheckTimeoutMs: 60000, remoteListTimeoutMs: 30000, remoteSignalTimeoutMs: 15000, remoteEntries: 500, remoteListBytes: 1024 * 1024, remoteCopyBytes: 64 * 1024 * 1024, remoteCopyTimeoutMs: 600000, maxCopies: 500 };
export type KernelLimits = typeof kernelLimits;

interface Live {
  // A session on a server runs under ssh: its process there has the id it reported.
  record: SessionRecord; child: ChildProcess; place: Place | null; remotePid: number | null; answers: string; early: string; order: Promise<void>; queue: CellRecord[]; current: CellRecord | null; stopping: boolean; timer?: NodeJS.Timeout;
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
// A path within a place's folder: relative, without parent steps (an empty one is the folder).
const within = (relative: string, folder: boolean) => typeof relative === 'string' && relative.length <= 1024 && (folder || relative.length > 0) && !relative.startsWith('/') && !/[\0\n]/.test(relative) && !relative.split('/').includes('..');
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
  private placesRead?: Promise<Places>;
  private placesWriting: Promise<void> = Promise.resolve();
  private ssh: Ssh;
  constructor(private root: string, private options: { limits?: Partial<KernelLimits>; rscript?: string; python?: string; ssh?: string; onChange?: () => void } = {}) {
    this.ssh = new Ssh(options.ssh ?? 'ssh');
  }
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

  async run(input: { language: Language; code: string; purpose?: string; changeId: string; by: string; waitMs?: number; place?: string }) {
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

  private async queue(input: { language: Language; code: string; purpose?: string; changeId: string; by: string; place?: string }) {
    const known = this.cells.find(c => c.changeId === input.changeId && c.by === input.by);
    if (known) {
      requireThat(known.code === input.code && known.language === input.language, 'conflict', 'This change identity already names a different cell.');
    } else {
      requireThat(input.code.trim().length > 0 && Buffer.byteLength(input.code) <= this.limits.maxCodeBytes, 'invalid', `Write code of at most ${this.limits.maxCodeBytes} bytes.`, { limit: 'maxCodeBytes' });
      const live = await this.ensure(input.language, input.by, input.place);
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
        queuedAt: now(), startedAt: null, endedAt: null, state: 'queued', number: live.record.cells, outputs: [], bytes: 0, kept: 0, cut: false, interrupt: null, problem: null, defined: [], removed: [], used: [], files: [] };
      this.cells.push(cell); live.queue.push(cell);
      this.changed();
      await this.pump(live);
    }
    return this.cells.find(c => c.changeId === input.changeId && c.by === input.by)!;
  }

  // The language's live session, started for this caller when there is none: where the cell
  // names, else where the project runs that language (this machine unless chosen). A cell that
  // names another place than where the live session runs is refused; its values stay there.
  private async ensure(language: Language, by: string, placeId?: string) {
    const running = this.live.get(language), name = language === 'r' ? 'R' : 'Python';
    const where = (live: Live) => live.place ? `on ${live.place.label}` : 'on this machine';
    if (running && !running.stopping) {
      requireThat(!placeId || placeId === (running.place?.placeId ?? 'local'), 'conflict', `The ${name} session runs ${where(running)}. Run the cell there, or stop that session first; its values stay until then.`, { place: running.place?.placeId ?? 'local' });
      return running;
    }
    requireThat(!running, 'conflict', 'The session is stopping. Run the cell again when it has ended.');
    const chosen = placeId ?? (await this.placeState()).use[language] ?? 'local';
    const place = chosen === 'local' ? null : (await this.placeState()).places.find(p => p.placeId === chosen) ?? null;
    requireThat(chosen === 'local' || place, 'not_found', `No place is named ${chosen}. Read kernel.places for the places there are.`);
    const record: SessionRecord = { sessionId: id('s-'), language, state: 'starting', version: null, pid: null, startedAt: now(), startedBy: by, endedAt: null, ending: null, stop: null, problem: null, variables: [], variablesOmitted: 0, variablesAt: null, cells: 0,
      place: place ? { placeId: place.placeId, label: place.label, destination: place.destination, folder: place.folder } : null, host: null };
    this.sessions!.push(record);
    const old = this.sessions!.filter(s => s.state === 'ended');
    if (old.length > this.limits.maxEndedSessions) this.sessions!.splice(this.sessions!.indexOf(old[0]!), 1);
    const program = place ? 'ssh' : language === 'r' ? this.options.rscript ?? 'Rscript' : this.options.python ?? 'python3';
    const root = await fs.realpath(this.root);
    // On a server the runner is sent first on the session's own input, named by its digest, so
    // the session needs nothing installed there but R or Python.
    const source = place ? await fs.readFile(runners[language]) : null;
    const runner = source && `.cache/rho/kernel/runner-${digest(source).slice(0, 16)}${language === 'r' ? '.R' : '.py'}`;
    const child = place ? await this.ssh.spawn(place, sessionCommand(place, language === 'r' ? 'Rscript' : 'python3', runner!, source!.length), root)
      : spawn(program, [runners[language], root], { cwd: root, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], env: { ...process.env, MPLBACKEND: 'Agg', PYTHONUNBUFFERED: '1' } });
    const live: Live = { record, child, place, remotePid: null, answers: '', early: '', order: Promise.resolve(), queue: [], current: null, stopping: false, printed: '', mark: 0, held: [], looking: null, lookups: Promise.resolve() };
    this.live.set(language, live);
    record.pid = place ? null : child.pid ?? null;
    const startMs = place ? this.limits.remoteStartTimeoutMs : this.limits.startTimeoutMs;
    live.timer = setTimeout(() => { if (record.state === 'starting') { record.problem = `The session did not start within ${Math.round(startMs / 1000)} s.`; this.signal(live, 'SIGKILL'); } }, startMs);
    // ssh carries two streams: the answers come on its standard output and what the session
    // prints on its standard error, standard output and error together.
    const answers = (place ? child.stdout : child.stdio[3]) as NodeJS.ReadableStream, printed = (place ? child.stderr : child.stdout) as NodeJS.ReadableStream;
    answers.setEncoding('utf8');
    answers.on('data', (chunk: string) => {
      live.answers += chunk;
      for (let at = live.answers.indexOf('\n'); at >= 0; at = live.answers.indexOf('\n')) {
        const line = live.answers.slice(0, at); live.answers = live.answers.slice(at + 1);
        // Answers are taken in the order they came: a cell ends only after its plots are kept.
        // What a server's login shell printed first is not an answer.
        let msg: any;
        try { msg = JSON.parse(line); } catch { continue; }
        if (!msg || typeof msg !== 'object') continue;
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
    printed.setEncoding('utf8'); printed.on('data', (chunk: string) => this.printed(live, chunk, raw('stdout')));
    if (!place) { child.stderr!.setEncoding('utf8'); child.stderr!.on('data', raw('stderr')); }
    child.stdin!.on('error', () => {});
    if (source) child.stdin!.write(source);
    child.on('error', error => {
      record.problem = (error as NodeJS.ErrnoException).code === 'ENOENT' ? `${place ? this.options.ssh ?? 'ssh' : program} was not found. Install ${place ? 'OpenSSH' : language === 'r' ? 'R' : 'Python'}, or name the program where the application is started.` : error.message;
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
  // A session on a server is signalled there, through the shared connection; until it has said
  // which process it is, and when it is killed, its ssh ends here too. Once its ssh has ended
  // nothing is sent there: the id may since name another process.
  private signal(live: Live, name: NodeJS.Signals) {
    if (!live.place) { try { if (live.record.pid) process.kill(-live.record.pid, name); } catch { /* it has ended */ } return; }
    if (live.child.exitCode !== null || live.child.signalCode !== null) return;
    if (live.remotePid) void this.ssh.run(live.place, signalCommand(live.remotePid, name), { timeoutMs: this.limits.remoteSignalTimeoutMs, maxBytes: 4096 });
    if (!live.remotePid || name === 'SIGKILL') { try { if (live.child.pid) process.kill(-live.child.pid, 'SIGKILL'); } catch { /* it has ended */ } }
  }

  private async pump(live: Live) {
    if (live.current || live.looking || live.record.state !== 'idle' || !live.queue.length) return;
    const cell = live.queue.shift()!;
    live.current = cell; cell.state = 'running'; cell.startedAt = now(); live.record.state = 'busy';
    // A session on a server draws in its own temporary folder and sends each plot with its answer.
    live.child.stdin!.write(JSON.stringify({ op: 'run', id: cell.cellId, number: cell.number, code: cell.code, plots: live.place ? null : await this.plots(), inline: !!live.place, maxPlots: this.limits.maxPlots, maxVariables: this.limits.maxVariables }) + '\n');
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
      Object.assign(record, { state: 'idle', version: String(msg.version ?? ''), variables: msg.variables?.items ?? [], variablesOmitted: msg.variables?.omitted ?? 0, variablesAt: now(), host: typeof msg.host === 'string' ? msg.host.slice(0, 256) : null });
      if (live.place) {
        live.remotePid = Number.isInteger(msg.pid) && msg.pid > 1 ? msg.pid : null; record.pid = live.remotePid;
        if (typeof msg.folder === 'string' && record.place) record.place.folder = msg.folder.slice(0, 1024);
      }
      this.changed(); await this.pump(live); return;
    }
    if (msg.kind === 'inspected') { const looking = live.looking; if (looking && looking.id === msg.id) looking.done(msg); return; }
    if (!cell || msg.id !== cell.cellId) return;
    if (['stdout', 'stderr', 'warning', 'error'].includes(msg.kind)) { this.append(cell, msg.kind, String(msg.text ?? '')); this.soon(); return; }
    if (msg.kind === 'plot') {
      const plots = await this.plots(), file = path.resolve(String(msg.file ?? ''));
      const number = Number(/-(\d+)\.png$/.exec(file)?.[1]);
      if (!number || (!live.place && path.dirname(file) !== plots)) return;
      const data = live.place && typeof msg.data === 'string' ? Buffer.from(msg.data, 'base64') : null;
      const size = live.place ? data?.length ?? -1 : await fs.stat(file).then(s => s.size, () => -1);
      if (size < 0) return;
      if (size > this.limits.maxPlotBytes) { if (!live.place) await fs.rm(file, { force: true }); this.append(cell, 'stderr', `A plot of ${size} bytes was larger than maxPlotBytes and was not kept.\n`); }
      else {
        if (data) await atomicBytes(path.join(plots, `${cell.cellId}-${number}.png`), data);
        cell.outputs.push({ kind: 'plot', plot: number, width: Number(msg.width) || 0, height: Number(msg.height) || 0 });
      }
      this.soon(); return;
    }
    if (msg.kind === 'done') {
      cell.state = msg.interrupted ? 'interrupted' : msg.ok ? 'done' : 'error'; cell.endedAt = now();
      // What the cell made or changed, as the session lists its variables before and after it. A
      // name past the listed ones may still be there, so removals are said only of a whole list.
      const after: Variable[] = msg.variables?.items ?? record.variables, mark = (v: Variable) => [v.type, v.size, v.bytes, v.summary].join('\u0000');
      const before = new Map(record.variables.map(v => [v.name, mark(v)]));
      // A name the code assigns to is defined even where its listing reads the same (df$a <- df$a * 2).
      const listed = new Set(after.map(v => v.name)), names = (value: unknown) => Array.isArray(value) ? value.filter((n): n is string => typeof n === 'string' && n.length <= 256).slice(0, this.limits.maxVariables) : [];
      cell.defined = [...new Set([...after.filter(v => before.get(v.name) !== mark(v)).map(v => v.name), ...names(msg.assigned).filter(n => listed.has(n))])];
      cell.used = names(msg.used);
      cell.files = (Array.isArray(msg.files) ? msg.files : []).filter((f: any) => typeof f?.path === 'string' && f.path.length <= 512 && !f.path.startsWith('/') && !f.path.split('/').includes('..') && (f.how === 'read' || f.how === 'wrote'))
        .slice(0, lineageLimits.files).map((f: any) => ({ path: f.path, how: f.how }));
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
    // ssh ends with 255 when the connection, not the session, ended: the process on the server
    // was not seen to end, and what the running cell did there was not observed.
    const lost = !!live.place && code === 255 && !live.stopping && record.version !== null;
    Object.assign(record, { state: 'ended', endedAt: now(), ending: live.stopping ? 'stopped' : record.version === null ? 'not-started' : lost ? 'disconnected' : 'exited', variables: [], variablesOmitted: 0 });
    if (record.version === null && !live.stopping) record.problem ??= `The session did not start${live.early.trim() ? ': ' + live.early.trim().slice(0, 600) : ` (exit ${code ?? 'by a signal'}).`}`;
    if (lost) record.problem ??= `The connection to ${live.place!.label} was lost. The session's process there${live.remotePid ? ` (${live.remotePid})` : ''} was not seen to end; its variables are out of reach.`;
    if (!live.stopping && record.version !== null) record.problem ??= `The session's process ended (exit ${code ?? 'by a signal'}); its variables are gone.`;
    if (live.current) {
      Object.assign(live.current, lost ? { state: 'unknown', endedAt: now(), problem: `The connection to ${live.place!.label} was lost while this cell ran; whether it finished there was not observed.` }
        : { state: 'error', endedAt: now(), problem: live.stopping ? 'The session was stopped while this cell ran.' : 'The session ended while this cell ran.' });
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

  // The places a session can run in, where each language's next session starts (this machine
  // unless chosen), and the files copied from them.
  private placeState() {
    return this.placesRead ??= this.folder().then(async folder => {
      const state = await readJson<Partial<Places>>(path.join(folder, 'places.json'), {});
      return { places: state.places ?? [], use: { r: state.use?.r ?? 'local', python: state.use?.python ?? 'local' }, copies: state.copies ?? [] };
    });
  }
  private savePlaces(state: Places) {
    this.placesWriting = this.placesWriting.catch(() => {}).then(async () => atomicJson(path.join(await this.folder(), 'places.json'), state));
    return this.placesWriting.then(() => this.options.onChange?.());
  }
  private async placeOf(placeId: string) {
    const place = (await this.placeState()).places.find(p => p.placeId === placeId);
    requireThat(place, 'not_found', `No place is named ${placeId}. Read kernel.places for the places there are.`);
    return structuredClone(place);
  }
  async places() { return structuredClone(await this.placeState()); }

  // Naming a place, removing one, and choosing where each language's next session starts. A
  // place a live session runs in is not removed; changing where it is leaves that session there.
  async setPlace(input: { place?: { placeId: string; label?: string; destination: string; folder: string; setup?: string }; remove?: string; use?: Partial<Record<Language, string>> }, by: string) {
    await this.load();
    return this.exclusive(async () => {
      const state = await this.placeState();
      if (input.place) {
        const p = input.place, known = state.places.find(x => x.placeId === p.placeId), setup = (p.setup ?? '').replace(/\r\n?/g, '\n').trim();
        requireThat(known || state.places.length < this.limits.maxPlaces, 'limit', `At most ${this.limits.maxPlaces} places are named. Remove one first.`, { limit: 'maxPlaces', maximum: this.limits.maxPlaces });
        const same = known && known.destination === p.destination && known.folder === p.folder && known.setup === setup;
        const next: Place = { placeId: p.placeId, label: p.label?.trim() || p.placeId, destination: p.destination, folder: p.folder, setup, by, at: now(), check: same ? known.check : null };
        state.places = known ? state.places.map(x => x === known ? next : x) : [...state.places, next];
      }
      if (input.remove) {
        requireThat(![...this.live.values()].some(l => l.place?.placeId === input.remove), 'conflict', 'A live session runs there. Stop it before removing the place.');
        state.places = state.places.filter(p => p.placeId !== input.remove);
        for (const language of Object.keys(state.use) as Language[]) if (state.use[language] === input.remove) state.use[language] = 'local';
      }
      for (const [language, placeId] of Object.entries(input.use ?? {}) as Array<[Language, string]>) {
        requireThat(placeId === 'local' || state.places.some(p => p.placeId === placeId), 'not_found', `No place is named ${placeId}.`);
        state.use[language] = placeId;
      }
      await this.savePlaces(state);
      return structuredClone(state);
    });
  }

  // Connecting to a place and looking: the system, the folder, R and Python. What it observed is
  // kept with the place while the place stays as it was checked.
  async check(placeId: string, by: string) {
    const place = await this.placeOf(placeId), started = Date.now();
    const run = await this.ssh.run(place, checkCommand(place), { timeoutMs: this.limits.remoteCheckTimeoutMs, maxBytes: 65536 });
    const check: PlaceCheck = { at: now(), by, ms: Date.now() - started, ...readCheck(run) };
    const state = await this.placeState(), current = state.places.find(p => p.placeId === placeId);
    if (current && current.destination === place.destination && current.folder === place.folder && current.setup === place.setup) { current.check = check; await this.savePlaces(state); }
    return { placeId, check };
  }

  // A folder within a place's folder, as the server lists it now.
  async list(placeId: string, sub = '') {
    requireThat(within(sub, true), 'scope', 'Name a folder within the place\'s folder, without parent steps.');
    const place = await this.placeOf(placeId);
    const run = await this.ssh.run(place, listCommand(place, sub), { timeoutMs: this.limits.remoteListTimeoutMs, maxBytes: this.limits.remoteListBytes });
    return { placeId, path: sub, readAt: now(), ...readList(run, this.limits.remoteEntries) };
  }

  // A copy of one file of a place in the project, at remote/<place>/<path>, with the size, time
  // and digest it had. A copy changed here since it was made is not replaced.
  async copy(placeId: string, file: string, by: string) {
    requireThat(within(file, false), 'scope', 'Name a file within the place\'s folder, without parent steps.');
    const place = await this.placeOf(placeId), to = `remote/${placeId}/${file}`, max = this.limits.remoteCopyBytes;
    const state = await this.placeState(), last = [...state.copies].reverse().find(c => c.to === to);
    const present = await fs.readFile(await confined(this.root, to, true)).then(data => digest(data), () => null);
    requireThat(present === null || present === last?.sha256, 'conflict', `${to} was changed here since it was copied. Move it or rename it to keep it, then copy again.`, { path: to });
    const run = await this.ssh.run(place, copyCommand(place, file, max), { timeoutMs: this.limits.remoteCopyTimeoutMs, maxBytes: max + 4096 });
    const { data, modifiedAt } = readCopy(run, max);
    await fs.mkdir(path.dirname(await confined(this.root, to, true)), { recursive: true });
    await atomicBytes(await confined(this.root, to, true), data);
    const copy: Copy = { placeId, path: file, to, bytes: data.length, modifiedAt, sha256: digest(data), copiedAt: now(), by };
    state.copies = [...state.copies.filter(c => c.to !== to), copy].slice(-this.limits.maxCopies);
    await this.savePlaces(state);
    return { copy };
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
  'Sessions can also run on a server the person reaches with ssh. kernel.places lists the places and where each language runs; kernel.place.set names one (its ssh destination, its folder there and setup lines such as module load) or chooses it for R or Python; kernel.place.check connects and reports R and Python there.',
  'Pass place to kernel.run to start a session there. Paths in a session on a server are its folder\'s; kernel.place.list lists them and kernel.place.copy copies a file into the project under remote/<place>/.',
].join('\n');
export const plugin = { entryVersion: '1.0' as const, id: 'kernel', package: '@rho-workspace/plugin-kernel', version: '0.2.0', requires: [] as string[], capabilities: ['kernel'], presentation,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })),
  skills: [{ id: 'kernel.session', version: '1.0', content, digest: digest(content), presentation: { displayName: 'Live session', description: 'Explains how to run code in the project\'s live R and Python sessions.' },
    intent: 'Run code in the live session and read what it printed.', requires: ['kernel.run', 'kernel.read'],
    example: { method: 'kernel.run', input: { language: 'r', code: 'summary(cars)', purpose: 'Summarise the cars data', changeId: 'cell-1', waitMs: 30000 } },
    failureRecipes: [{ kind: 'limit', message: 'Too many cells are waiting.', next: 'Wait for the running cell, or interrupt it, then run again with a new changeId.' }],
    verify: { command: 'npm run test:notebook', description: 'Runs R and Python cells, keeps their output, plots and variables, interrupts and stops sessions, and keeps identity across a restart.' } }],
};
