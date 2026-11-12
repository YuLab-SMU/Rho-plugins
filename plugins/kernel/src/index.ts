import { execFile, spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { atomicBytes, atomicJson, confined, digest, now, readJson, requireThat, stateDirectory, timelineLabel, type TimelineEvent } from '@rho-workspace/plugin-contracts';
import { ownGroup, signalGroup, type GroupSignal } from './process-group.js';
import { checkCommand, copyCommand, listCommand, readCheck, readCopy, readList, sessionCommand, signalCommand, Ssh, type Copy, type Place, type PlaceCheck, type Transport } from './places.js';
import { Serverctl } from './servers.js';
import { operationContracts } from './operations.js';
import { operationPresentation, presentation, viewPresentations } from './presentation.js';
import type { cellStates, languages, sessionStates } from './contract.js';
import { completionTypes, notebookPattern } from './contract.js';

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
  // The program the session ran, as the session reported it (a Python's sys.executable, so a
  // virtual environment's own python), relative to the project when it is in it. Sessions
  // recorded before have none.
  program?: string | null;
  // The notebook whose session it is, by that notebook's identity; none for the project's own
  // notebook and every session recorded before notebooks had sessions of their own.
  notebook?: string;
}
export interface SessionPlace { placeId: string; label: string; destination: string; folder: string }
export type { Copy, Place, PlaceCheck, RemoteEntry } from './places.js';
export type { Server, Servers, ServerSkill } from './servers.js';
export interface Places { places: Place[]; use: Record<Language, string>; copies: Copy[] }
export interface Asked { by: string; at: string }
// A plot an extension described (a ggplot drawn in R, with its marks bound to their rows) names
// what it drew; its record is kept beside the picture. figureProblem says why one was not kept.
export interface FigureSummary { describer: string; kind?: string; title?: string; layers: number; marks: number; bound: number; geoms: string[]; notes?: string[] }
export type Output = { kind: 'stdout' | 'stderr' | 'warning' | 'error'; text: string } | { kind: 'plot'; plot: number; width: number; height: number; figure?: FigureSummary; figureProblem?: string };
// A page the cell saved to a project file (ggsave) that an extension described. It names the file as
// the cell left it, its bytes and their SHA-256, so a figure follows those bytes, not the path:
// once the file is written again it is a picture until something saves it as a figure again.
export interface SavedFigure { number: number; path: string; bytes: number; sha256: string; figure?: FigureSummary; figureProblem?: string }
export interface CellRecord {
  cellId: string; changeId: string; by: string; sessionId: string; language: Language; code: string; purpose: string | null;
  // The notebook it was run in; none for the project's own notebook.
  notebook?: string;
  queuedAt: string; startedAt: string | null; endedAt: string | null; state: typeof cellStates[number]; number: number;
  outputs: Output[]; bytes: number; kept: number; cut: boolean; interrupt: Asked | null; problem: string | null;
  defined?: string[]; removed?: string[];
  // The session's values the code read, and the project files its strings name, read or written.
  used?: string[]; files?: Array<{ path: string; how: 'read' | 'wrote' }>;
  // The program and version that ran it, kept with the cell because a cell outlasts its session's
  // record. Cells recorded before have neither.
  program?: string | null; version?: string | null;
  saved?: SavedFigure[];
  // The earlier cell it was run in place of.
  replaces?: string;
}
export type Completion = { label: string; type: typeof completionTypes[number] };
export type InspectInput = { language: Language; notebook?: string; name: string; path?: number[]; offset?: number; limit?: number; sort?: { column: number; descending: boolean }; picture?: boolean };
// The protected resources are this machine's processes and memory, and the project's state
// folder. Each notebook has at most one session per language, and at most maxSessions sessions
// run at once in a project: a cell or start that would begin another is refused, naming the live
// ones, until one is stopped. At most maxQueued cells wait in each session. A
// cell keeps its first maxOutputBytes of output (the rest is counted) and at most maxPlots
// plots of at most maxPlotBytes each, each with a figure record of at most maxFigureBytes; at
// most maxCells cells are kept, the oldest going first with their plots. The session lists at
// most maxVariables variables. A run waits at most maxWaitMs for its cell. What a session's own
// code allocates is not bounded here.
// Reading a value shows at most inspectColumns columns, a page of at most 200 rows, elements or
// parts (inspectRows unless asked), cells of inspectCellChars characters and a printed form of
// inspectTextBytes; a table sorts only up to inspectSortRows rows. A reading that takes longer
// than inspectTimeoutMs is interrupted, and the session waits for it no longer than
// inspectGiveUpMs more before the caller is told. A reading asked for the picture of what an R
// value draws when it is printed keeps a PNG of at most inspectPictureBytes; a larger one is
// left out with the reason, and the rest of the reading stays.
// While a cell runs, a local R session on Unix answers readings from a fork of itself made when
// the cell started. The fork shares the session's memory until either of them changes a page,
// so the cell may come to hold a second time what it changes of what the session held: a
// session whose values take more than inspectForkShare of this machine's memory, by R's own
// count, is not forked (0: none ever is), and a reading then answers busy until the cell ends,
// as it does for every other session. A fork that has not said within inspectForkStartMs
// whether it is there is not waited for.
// A cell names at most this many project files it read or wrote.
export const lineageLimits = { files: 32 };
// Places: at most maxPlaces are named. A session on a server that is not ready within
// remoteStartTimeoutMs is ended; checking a place, listing a folder there and sending a signal
// end after their times. A listing names at most remoteEntries entries from at most
// remoteListBytes; a file larger than remoteCopyBytes is not copied, and a copy ends after
// remoteCopyTimeoutMs. The newest maxCopies copies are recorded. Reading serverctl's registry ends
// after serverctlReadMs; a session through serverctl lasts at most serverctlSessionS, serverctl's
// own limit for a command, after which serverctl ends it; a server's skill is read up to
// serverSkillBytes.
export const kernelLimits = { maxCells: 500, maxSessions: 8, maxQueued: 16, maxCodeBytes: 65536, maxOutputBytes: 256 * 1024, maxPlots: 8, maxPlotBytes: 4 * 1024 * 1024, maxFigureBytes: 16 * 1024 * 1024, maxVariables: 200, maxWaitMs: 600000, startTimeoutMs: 30000, stopGraceMs: 3000, maxEndedSessions: 20,
  // Completing a line: a line of at most completeLineChars is asked of the session, which gives
  // at most completeItems names and counts the rest; one that has not answered within
  // completeTimeoutMs is interrupted and the answer is timeout.
  completeItems: 200, completeTimeoutMs: 2000, completeLineChars: 4096,
  inspectRows: 50, inspectColumns: 50, inspectChildren: 200, inspectCellChars: 120, inspectTextBytes: 16 * 1024, inspectSortRows: 1000000, inspectTimeoutMs: 10000, inspectGiveUpMs: 5000, inspectForkShare: 0.25, inspectForkStartMs: 2000, inspectPictureBytes: 1024 * 1024,
  maxPlaces: 16, remoteStartTimeoutMs: 90000, remoteCheckTimeoutMs: 60000, remoteListTimeoutMs: 30000, remoteSignalTimeoutMs: 15000, remoteEntries: 500, remoteListBytes: 1024 * 1024, remoteCopyBytes: 64 * 1024 * 1024, remoteCopyTimeoutMs: 600000, maxCopies: 500,
  serverctlReadMs: 15000, serverctlSessionS: 7 * 24 * 3600, serverSkillBytes: 256 * 1024 };
export type KernelLimits = typeof kernelLimits;

interface Live {
  // The program a local session was started with when the project named one (null: the default),
  // and the project folder it runs in.
  started: string | null; root: string;
  // Settled once the session has ended and left the live sessions.
  ended: Promise<void>; settle: () => void;
  // A session on a server runs under ssh: its process there has the id it reported.
  record: SessionRecord; child: ChildProcess; place: Place | null; remotePid: number | null; answers: string; early: string; order: Promise<void>; queue: CellRecord[]; current: CellRecord | null; stopping: boolean; timer?: NodeJS.Timeout;
  // Printed text not yet placed, the highest mark seen on standard output, and answers waiting for theirs.
  printed: string; mark: number; held: Array<{ seq: number; msg: unknown }>; release?: NodeJS.Timeout;
  // The highest answer taken, and the mark whose answer the text after it waits for.
  answered: number; awaiting?: { seq: number; place: (text: string) => void; timer: NodeJS.Timeout };
  // The value being read now, and the readings waiting their turn.
  looking: { id: string; done: (msg: any) => void } | null; lookups: Promise<unknown>;
  // Where a local R session on Unix leaves a folder per running cell for readings of its fork
  // (runner.R, keep_fork), and the running cell whose fork is known not to answer, with why.
  forks: string | null; forkGone: { cell: CellRecord; problem: string } | null;
  // On Windows an R session answers on a named pipe of its own (answerPipe), closed once it has.
  pipe?: net.Server; answering?: net.Socket; answersClosed?: Promise<void>;
}
const markStart = '\x1eRHO:';
// The SHA-256 of a file's bytes, read in chunks.
async function fileDigest(file: string) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk as Buffer); bytes += (chunk as Buffer).length; }
  return { sha256: hash.digest('hex'), bytes };
}
// What an extension said of a plot, cut to the summary a cell keeps.
function figureSummary(value: any): FigureSummary {
  const n = (x: unknown) => Number.isSafeInteger(x) && (x as number) >= 0 ? x as number : 0;
  const t = (x: unknown) => typeof x === 'string' ? x.slice(0, 200) : undefined;
  const geoms = Array.isArray(value.geoms) ? value.geoms : typeof value.geoms === 'string' ? [value.geoms] : [];
  return { describer: t(value.describer) ?? 'unknown', ...(t(value.kind) ? { kind: t(value.kind) } : {}), ...(t(value.title) ? { title: t(value.title) } : {}),
    layers: n(value.layers), marks: n(value.marks), bound: n(value.bound), geoms: geoms.filter((g: unknown) => typeof g === 'string').slice(0, 32).map((g: string) => g.slice(0, 64)),
    // What the describer noticed about the figure (marks drawn elsewhere than their values, labels
    // naming other rows than the values they sit beside), so the Agent reads it with the cell.
    ...(Array.isArray(value.notes) && value.notes.length ? { notes: value.notes.filter((t: unknown) => typeof t === 'string').slice(0, 4).map((t: string) => t.slice(0, 300)) } : {}) };
}
// R on Windows sets these categories from the environment, and Windows has no C.UTF-8: given one,
// as an Agent's Git Bash gives LC_CTYPE, R warns at startup, runs in the C locale and prints
// "3 × 2" as "3 <U+00D7> 2". Without them a session takes the system's own locale, UTF-8 there.
const posixUtf8 = /^(C|POSIX)\.UTF-?8$/i, rLocale = /^LC_(ALL|CTYPE|COLLATE|TIME|MONETARY)$/;
const windowsEnvironment = (env: NodeJS.ProcessEnv) => Object.fromEntries(Object.entries(env).filter(([name, value]) => !(rLocale.test(name.toUpperCase()) && posixUtf8.test(value ?? ''))));
// On Windows a session's descriptor 3 reaches a program built on Microsoft's C runtime (Python),
// but R has no way to name it. There R opens a named pipe served here, by the name it is given in
// RHO_KERNEL_ANSWERS; the first connection is the session's and no other is taken.
function answerPipe() {
  const name = `\\\\.\\pipe\\rho-kernel-${randomBytes(16).toString('hex')}`;
  const server = net.createServer();
  const connected = new Promise<net.Socket>(resolve => {
    server.on('connection', socket => { if (server.listening) { server.close(); resolve(socket); } else socket.destroy(); });
  });
  return new Promise<{ name: string; server: net.Server; connected: Promise<net.Socket> }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(name, () => resolve({ name, server, connected }));
  });
}
// R and Python on Windows end printed lines with \r\n; a cell keeps \n, as elsewhere. A \r that ends
// one piece waits for the next, which may begin with its \n.
function newlines() {
  let carry = '';
  return (chunk: string, end = false) => {
    const text = carry + chunk;
    carry = !end && text.endsWith('\r') ? '\r' : '';
    return (carry ? text.slice(0, -1) : text).replace(/\r\n/g, '\n');
  };
}
const runners: Record<Language, string> = {
  r: fileURLToPath(new URL('../runners/runner.R', import.meta.url)),
  python: fileURLToPath(new URL('../runners/runner.py', import.meta.url)),
};
const id = (prefix: string) => prefix + randomBytes(8).toString('hex');
// A path within a place's folder: relative, without parent steps (an empty one is the folder).
const within = (relative: string, folder: boolean) => typeof relative === 'string' && relative.length <= 1024 && (folder || relative.length > 0) && !relative.startsWith('/') && !/[\0\n]/.test(relative) && !relative.split('/').includes('..');
const ended = (state: CellRecord['state']) => !['queued', 'running'].includes(state);
// A notebook's session of one language: the project's own notebook has no identity.
const slot = (language: Language, notebook?: string | null) => (notebook ?? '') + '|' + language;
const languageNames: Record<Language, string> = { r: 'R', python: 'Python' };
const sessionName = (language: Language, notebook?: string | null) => `${languageNames[language]} session${notebook ? ' of this notebook' : ''}`;

// The live R and Python sessions of one project's notebooks, each notebook's own, and the cells
// run in them. A notebook shown in several views is one notebook with one set of sessions. A cell keeps its
// identity: the same changeId from the same caller returns the same cell and never runs it
// twice. Cells run one at a time in their session, in the order they came. Reading never
// starts a session. When Rho closes, its sessions end with it: a later start records each as
// ended and a cell that was running as unknown, and runs nothing again.
export class KernelHost {
  private sessions: SessionRecord[] | null = null;
  private cells: CellRecord[] = [];
  private live = new Map<string, Live>();
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
  // The program each language's sessions start with when the project has named one (a path in
  // the project, as named): the last one a cell named, until another is named.
  private programs: Partial<Record<Language, string>> = {};
  private placesRead?: Promise<Places>;
  private placesWriting: Promise<void> = Promise.resolve();
  private ssh: Ssh;
  private serverctl: Serverctl;
  // extensions.r and extensions.python: files a local session loads to describe what its plots draw
  // (the figures plugin's). A session on a server has none: its plots stay pictures.
  constructor(private root: string, private options: { limits?: Partial<KernelLimits>; rscript?: string; python?: string; ssh?: string; serverctl?: string; onChange?: () => void; extensions?: { r?: string[]; python?: string[] } } = {}) {
    this.ssh = new Ssh(options.ssh ?? 'ssh');
    const limits = this.limits;
    this.serverctl = new Serverctl(options.serverctl ?? 'serverctl', { reuseS: 60, sessionS: limits.serverctlSessionS, readMs: limits.serverctlReadMs, skillBytes: limits.serverSkillBytes });
  }
  // A program named for a session: one in a folder of the project, such as the python of a
  // virtual environment made there (.venv/bin/python, on Windows .venv/Scripts/python.exe). Its
  // folder must be the project's own; the file itself may be the link a virtual environment makes to
  // the Python it was made from, and it is started by that name so the environment is the one that
  // runs. A folder of the project that is not there names no program (on Windows a venv has no bin).
  private async program(named: string) {
    const root = await fs.realpath(this.root), file = path.resolve(root, named);
    const inside = (folder: string) => folder === root || folder.startsWith(root + path.sep);
    const folder = await fs.realpath(path.dirname(file)).catch(() => null);
    requireThat(folder ? inside(folder) : inside(path.dirname(file)), 'scope', `Name a program in a folder of this project, such as .venv/bin/python; ${named} is not.`, { interpreter: named });
    requireThat(folder, 'not_found', `${named} is not a program that can run here.`, { interpreter: named });
    const program = path.join(folder, path.basename(file));
    const runs = await fs.stat(program).then(s => s.isFile(), () => false) && await fs.access(program, fsConstants.X_OK).then(() => true, () => false);
    requireThat(runs, 'not_found', `${named} is not a program that can run here.`, { interpreter: named });
    return program;
  }
  // A program in the project is named relative to it (.venv/bin/python), so the record stays true
  // when the project moves; any other keeps the path the session reported.
  private named(live: Live, program: string) {
    return !live.place && program.startsWith(live.root + path.sep) ? path.relative(live.root, program) : program;
  }
  private transport(place: Place): Transport { return place.via === 'serverctl' ? this.serverctl : this.ssh; }
  private get limits(): KernelLimits { return { ...kernelLimits, ...this.options.limits }; }
  private async folder() { return stateDirectory(this.root, '.rho/plugins/kernel'); }
  private async plots() { const folder = path.join(await this.folder(), 'plots'); await fs.mkdir(folder, { recursive: true, mode: 0o700 }); return folder; }
  private load() { return this.loading ??= this.readRecord(); }
  private async readRecord() {
    const state = await readJson<{ sessions: SessionRecord[]; cells: CellRecord[]; programs?: Partial<Record<Language, string>> }>(path.join(await this.folder(), 'state.json'), { sessions: [], cells: [] });
    this.programs = state.programs ?? {};
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
    this.writing = this.writing.then(async () => atomicJson(path.join(await this.folder(), 'state.json'), { sessions: this.sessions ?? [], cells: this.cells, programs: this.programs }));
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

  // Each cell as a timeline event: who ran it, from when it started (or was queued) to when it
  // ended, in which session and place, named by its purpose or its first line of code.
  async events(limit = 200) {
    const sessions = await this.load(), places = new Map(sessions.map(s => [s.sessionId, s.place?.label ?? null]));
    const outcome: Record<CellRecord['state'], TimelineEvent['outcome']> = { queued: 'running', running: 'running', done: 'done', error: 'failed', interrupted: 'stopped', 'not-run': 'stopped', unknown: 'unknown' };
    const events = this.cells.slice(-limit).reverse().map((c): TimelineEvent => {
      const place = places.get(c.sessionId);
      return { id: c.cellId, by: c.by, action: 'run', label: timelineLabel(c.purpose ?? c.code, 'A cell'), where: (c.language === 'r' ? 'R' : 'Python') + (place ? ' on ' + place : ''),
        startedAt: c.startedAt ?? c.queuedAt, endedAt: c.endedAt, outcome: outcome[c.state] };
    });
    return { events, omitted: Math.max(0, this.cells.length - limit) };
  }

  async run(input: { language: Language; code: string; purpose?: string; notebook?: string; replaces?: string; changeId: string; by: string; waitMs?: number; place?: string; interpreter?: string }) {
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

  private async queue(input: { language: Language; code: string; purpose?: string; notebook?: string; replaces?: string; changeId: string; by: string; place?: string; interpreter?: string }) {
    const known = this.cells.find(c => c.changeId === input.changeId && c.by === input.by);
    if (known) {
      requireThat(known.code === input.code && known.language === input.language, 'conflict', 'This change identity already names a different cell.');
    } else {
      requireThat(input.code.trim().length > 0 && Buffer.byteLength(input.code) <= this.limits.maxCodeBytes, 'invalid', `Write code of at most ${this.limits.maxCodeBytes} bytes.`, { limit: 'maxCodeBytes' });
      requireThat(input.notebook === undefined || new RegExp(notebookPattern).test(input.notebook), 'invalid', 'Name the notebook by the identity its cells carry.');
      // A cell run in place of an earlier one: that one has ended and is of this notebook and language.
      const replaced = input.replaces === undefined ? undefined : this.cells.find(c => c.cellId === input.replaces);
      if (input.replaces !== undefined) {
        requireThat(replaced, 'not_found', 'The cell to run in place of is no longer in the record. Run the code as a new cell.');
        requireThat(replaced.language === input.language && (replaced.notebook ?? null) === (input.notebook ?? null), 'invalid', 'A cell is run in place of one of its own notebook and language.');
        requireThat(ended(replaced.state), 'conflict', 'That cell has not ended. Wait for it or interrupt it, then run it again.');
      }
      const live = await this.ensure(input.language, input.by, input.place, input.interpreter, input.notebook);
      requireThat(live.queue.length < this.limits.maxQueued, 'limit', `At most ${this.limits.maxQueued} cells wait in a session. Wait for some to run or interrupt the one running.`, { limit: 'maxQueued', maximum: this.limits.maxQueued });
      // The oldest finished cells make room, with their plots.
      while (this.cells.length >= this.limits.maxCells) {
        const index = this.cells.findIndex(c => ended(c.state));
        requireThat(index >= 0, 'limit', 'The session record is full of cells that have not ended.', { limit: 'maxCells' });
        const [old] = this.cells.splice(index, 1);
        for (const output of old!.outputs) if (output.kind === 'plot') for (const end of ['.png', '.figure.json']) await fs.rm(path.join(await this.plots(), `${old!.cellId}-${output.plot}${end}`), { force: true });
        for (const saved of old!.saved ?? []) await fs.rm(path.join(await this.plots(), `${old!.cellId}-s${saved.number}.figure.json`), { force: true });
      }
      live.record.cells++;
      const cell: CellRecord = { cellId: id('k-'), changeId: input.changeId, by: input.by, sessionId: live.record.sessionId, language: input.language, code: input.code, purpose: input.purpose?.trim().slice(0, 200) || null,
        ...(input.notebook ? { notebook: input.notebook } : {}), ...(replaced ? { replaces: replaced.cellId } : {}),
        queuedAt: now(), startedAt: null, endedAt: null, state: 'queued', number: live.record.cells, outputs: [], bytes: 0, kept: 0, cut: false, interrupt: null, problem: null, defined: [], removed: [], used: [], files: [] };
      this.cells.push(cell); live.queue.push(cell);
      this.changed();
      await this.pump(live);
    }
    return this.cells.find(c => c.changeId === input.changeId && c.by === input.by)!;
  }

  // The notebook's live session of the language, started for this caller when there is none: where
  // the cell names, else where the project runs that language (this machine unless chosen). A cell
  // that names another place than where the live session runs is refused; its values stay there.
  private async ensure(language: Language, by: string, placeId?: string, interpreter?: string, notebook?: string) {
    const running = this.live.get(slot(language, notebook)), name = language === 'r' ? 'R' : 'Python', which = sessionName(language, notebook);
    const where = (live: Live) => live.place ? `on ${live.place.label}` : 'on this machine';
    requireThat(!interpreter || !placeId || placeId === 'local', 'invalid', 'An interpreter names a program in the project on this machine; a session on a server runs that server\'s.');
    const named = interpreter ? await this.program(interpreter) : null;
    if (running && !running.stopping) {
      requireThat(!placeId || placeId === (running.place?.placeId ?? 'local'), 'conflict', `The ${which} runs ${where(running)}. Run the cell there, or stop that session first; its values stay until then.`, { place: running.place?.placeId ?? 'local' });
      if (!named || !running.place && running.started === named) return running;
      // A session in which only this caller ran cells, none of them now, is its own to start
      // again with the program it names. Once anyone else ran a cell there, the values are shared
      // and only the person stops it.
      const own = !running.place && !running.current && !running.queue.length && this.cells.filter(c => c.sessionId === running.record.sessionId).every(c => c.by === by);
      requireThat(own, 'conflict', `The ${which} runs ${running.record.program ?? 'another program'}${running.current || running.queue.length ? ' and has a cell running' : ', and others ran cells in it'}. Ask the person to stop it in Sessions, then run this cell again to start one with ${interpreter}; its values stay until then.`, { program: running.started ?? running.record.program ?? null });
      this.stopping(this.sessions!, running.record.sessionId, by);
      await running.ended;
    }
    requireThat(!this.live.get(slot(language, notebook)), 'conflict', 'The session is stopping. Run the cell again when it has ended.');
    const open = [...this.live.values()];
    requireThat(open.length < this.limits.maxSessions, 'limit', `At most ${this.limits.maxSessions} sessions run at once in this project, and ${open.length} do: ${open.map(l => languageNames[l.record.language] + (l.record.notebook ? ' of notebook ' + l.record.notebook : ' of the project\'s notebook')).join(', ')}. Stop one in Sessions, then run again.`, { limit: 'maxSessions', maximum: this.limits.maxSessions });
    const chosen = placeId ?? (await this.placeState()).use[language] ?? 'local';
    const place = chosen === 'local' ? null : (await this.placeState()).places.find(p => p.placeId === chosen) ?? null;
    requireThat(chosen === 'local' || place, 'not_found', `No place is named ${chosen}. Read kernel.places for the places there are.`);
    const record: SessionRecord = { sessionId: id('s-'), language, state: 'starting', version: null, pid: null, startedAt: now(), startedBy: by, endedAt: null, ending: null, stop: null, problem: null, variables: [], variablesOmitted: 0, variablesAt: null, cells: 0,
      place: place ? { placeId: place.placeId, label: place.label, destination: place.destination, folder: place.folder } : null, host: null, ...(notebook ? { notebook } : {}) };
    this.sessions!.push(record);
    const old = this.sessions!.filter(s => s.state === 'ended');
    if (old.length > this.limits.maxEndedSessions) this.sessions!.splice(this.sessions!.indexOf(old[0]!), 1);
    const windows = !place && process.platform === 'win32';
    // A program the cell named, else the one the project named last while it is still there.
    requireThat(!named || !place, 'invalid', `${name} runs on ${place?.label} in this project; an interpreter names a program in the project on this machine.`);
    const kept = !named && !place && this.programs[language] ? await this.program(this.programs[language]!).catch(() => null) : null;
    if (named) this.programs[language] = path.relative(await fs.realpath(this.root), named);
    else if (!kept && this.programs[language]) delete this.programs[language];
    const selected = named ?? kept;
    const program = place ? 'ssh' : selected ?? (language === 'r' ? this.options.rscript ?? 'Rscript' : this.options.python ?? (windows ? 'python' : 'python3'));
    const root = await fs.realpath(this.root);
    // On a server the runner is sent first on the session's own input, named by its digest, so
    // the session needs nothing installed there but R or Python.
    const source = place ? await fs.readFile(runners[language]) : null;
    const runner = source && `.cache/rho/kernel/runner-${digest(source).slice(0, 16)}${language === 'r' ? '.R' : '.py'}`;
    const pipe = windows && language === 'r' ? await answerPipe() : null;
    const forks = !place && !windows && language === 'r' && this.limits.inspectForkShare > 0 ? await fs.mkdtemp(path.join(os.tmpdir(), 'rho-kernel-forks-')).catch(() => null) : null;
    const child = place ? await this.transport(place).spawn(place, sessionCommand(place, language === 'r' ? 'Rscript' : 'python3', runner!, source!.length), root)
      : spawn(program, [runners[language], root], { cwd: root, ...ownGroup, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], env: { ...(windows ? windowsEnvironment(process.env) : process.env), MPLBACKEND: 'Agg', PYTHONUNBUFFERED: '1', ...(pipe ? { RHO_KERNEL_ANSWERS: pipe.name } : {}), ...(this.options.extensions?.[language]?.length ? { RHO_KERNEL_EXTENSIONS: this.options.extensions[language]!.join(path.delimiter) } : {}) } });
    let settle = () => {};
    const ended = new Promise<void>(resolve => { settle = resolve; });
    const live: Live = { started: selected, root, ended, settle, record, child, place, remotePid: null, answers: '', early: '', order: Promise.resolve(), queue: [], current: null, stopping: false, printed: '', mark: 0, held: [], answered: 0, looking: null, lookups: Promise.resolve(), forks, forkGone: null, pipe: pipe?.server };
    this.live.set(slot(language, notebook), live);
    record.pid = place ? null : child.pid ?? null;
    const startMs = place ? this.limits.remoteStartTimeoutMs : this.limits.startTimeoutMs;
    live.timer = setTimeout(() => { if (record.state === 'starting') { record.problem = `The session did not start within ${Math.round(startMs / 1000)} s.`; this.signal(live, 'SIGKILL'); } }, startMs);
    const listen = (answers: NodeJS.ReadableStream) => {
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
    };
    // ssh carries two streams: the answers come on its standard output and what the session
    // prints on its standard error, standard output and error together.
    const printed = (place ? child.stderr : child.stdout) as NodeJS.ReadableStream;
    if (pipe) void pipe.connected.then(socket => { live.answering = socket; live.answersClosed = new Promise(resolve => socket.once('close', () => resolve())); listen(socket); });
    else listen((place ? child.stdout : child.stdio[3]) as NodeJS.ReadableStream);
    // What the session's process writes itself, past the code's own output (a program it ran,
    // a library's C code), belongs to the cell running then.
    // Before the session is ready, what it writes says why it could not start.
    const raw = (kind: 'stdout' | 'stderr') => (text: string) => {
      if (!text) return;
      if (live.current) { this.append(live.current, kind, text); this.soon(); }
      else if (record.version === null && live.early.length < 2048) live.early += text;
    };
    const out = windows ? newlines() : (text: string) => text, err = windows ? newlines() : (text: string) => text;
    printed.setEncoding('utf8'); printed.on('data', (chunk: string) => this.printed(live, out(chunk), raw('stdout')));
    printed.on('end', () => { const rest = out('', true); if (rest) this.printed(live, rest, raw('stdout')); });
    if (!place) { child.stderr!.setEncoding('utf8'); child.stderr!.on('data', (chunk: string) => raw('stderr')(err(chunk))); child.stderr!.on('end', () => raw('stderr')(err('', true))); }
    child.stdin!.on('error', () => {});
    if (source) child.stdin!.write(source);
    child.on('error', error => {
      record.problem = (error as NodeJS.ErrnoException).code === 'ENOENT' ? `${place ? this.transport(place).program : program} was not found. Install ${place ? place.via === 'serverctl' ? 'serverctl' : 'OpenSSH' : language === 'r' ? 'R' : 'Python'}, or name the program where the application is started.` : error.message;
    });
    // All it printed has been read by now, and on a pipe of its own once that has closed too;
    // answers still waiting go first.
    child.on('close', code => {
      live.pipe?.close();
      void (live.answersClosed ?? Promise.resolve()).then(() => { live.answered = Number.MAX_SAFE_INTEGER; this.marked(live, Number.MAX_SAFE_INTEGER); live.order = live.order.then(() => this.resume(live)).then(() => this.end(live, code)); });
    });
    this.changed();
    return live;
  }
  private take(live: Live, msg: unknown) {
    live.order = live.order.then(() => this.answer(live, msg)).catch(() => {});
    const seq = (msg as any)?.seq;
    if (!Number.isInteger(seq)) return;
    live.answered = Math.max(live.answered, seq);
    if (live.awaiting && live.answered >= live.awaiting.seq) live.order = live.order.then(() => this.resume(live));
  }
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
  // Standard output in order: text before a mark belongs before the answer that mark names, and
  // text after it after that answer, which may come later on its own stream (a relay, ssh).
  private printed(live: Live, chunk: string, place: (text: string) => void) {
    live.printed += chunk;
    if (live.awaiting) return;
    // Printed text joins the answers' queue, so it lands after an answer taken before it.
    const put = (text: string) => { if (text) live.order = live.order.then(() => place(text)).catch(() => {}); };
    for (;;) {
      const at = live.printed.indexOf(markStart);
      if (at < 0) {
        // Keep a tail that may be the start of a mark split across reads.
        let keep = 0;
        for (let k = Math.min(markStart.length - 1, live.printed.length); k > 0; k--) if (live.printed.endsWith(markStart.slice(0, k))) { keep = k; break; }
        put(live.printed.slice(0, live.printed.length - keep)); live.printed = live.printed.slice(live.printed.length - keep);
        return;
      }
      put(live.printed.slice(0, at));
      const end = live.printed.indexOf('\x1e', at + markStart.length);
      if (end < 0) { live.printed = live.printed.slice(at); return; }
      const mark = Number(live.printed.slice(at + markStart.length, end));
      live.printed = live.printed.slice(end + 1);
      if (!Number.isInteger(mark)) continue;
      this.marked(live, mark);
      // An answer that never comes (the session died writing it) lets the text through after a second.
      if (live.answered < mark) { live.awaiting = { seq: mark, place, timer: setTimeout(() => this.resume(live), 1000) }; return; }
    }
  }
  private resume(live: Live) {
    if (!live.awaiting) return;
    const { place, timer } = live.awaiting;
    clearTimeout(timer); live.awaiting = undefined;
    this.printed(live, '', place);
  }
  // A session on a server is signalled there, through the shared connection; until it has said
  // which process it is, and when it is killed, its ssh ends here too. Once its ssh has ended
  // nothing is sent there: the id may since name another process. Windows reuses a process id
  // soon, so a session here that has ended is not signalled there either. There a Python session
  // is interrupted with Ctrl+C, which wakes it from a wait as SIGINT does; R takes Ctrl+Break.
  private signal(live: Live, name: GroupSignal) {
    const exited = live.child.exitCode !== null || live.child.signalCode !== null;
    if (!live.place) { if (live.record.pid && !(exited && process.platform === 'win32')) void signalGroup(live.record.pid, name, { ctrlC: live.record.language === 'python' }); return; }
    if (exited) return;
    if (live.remotePid) void this.transport(live.place).run(live.place, signalCommand(live.remotePid, name), { timeoutMs: this.limits.remoteSignalTimeoutMs, maxBytes: 4096 });
    if (!live.remotePid || name === 'SIGKILL') { if (live.child.pid) void signalGroup(live.child.pid, 'SIGKILL'); }
  }

  private async pump(live: Live) {
    if (live.current || live.looking || live.record.state !== 'idle' || !live.queue.length) return;
    const cell = live.queue.shift()!;
    live.current = cell; cell.state = 'running'; cell.startedAt = now(); live.record.state = 'busy';
    cell.program = live.record.program ?? null; cell.version = live.record.version;
    // A session on a server draws in its own temporary folder and sends each plot with its answer.
    live.child.stdin!.write(JSON.stringify({ op: 'run', id: cell.cellId, number: cell.number, code: cell.code, plots: live.place ? null : await this.plots(), inline: !!live.place, maxPlots: this.limits.maxPlots, maxVariables: this.limits.maxVariables,
      ...(live.forks ? { fork: { dir: live.forks, maxBytes: Math.floor(os.totalmem() * this.limits.inspectForkShare) } } : {}) }) + '\n');
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
      Object.assign(record, { state: 'idle', version: String(msg.version ?? ''), program: typeof msg.executable === 'string' && msg.executable ? this.named(live, msg.executable.slice(0, 1024)) : record.program ?? null, variables: msg.variables?.items ?? [], variablesOmitted: msg.variables?.omitted ?? 0, variablesAt: now(), host: typeof msg.host === 'string' ? msg.host.slice(0, 256) : null });
      if (live.place) {
        live.remotePid = Number.isInteger(msg.pid) && msg.pid > 1 ? msg.pid : null; record.pid = live.remotePid;
        if (typeof msg.folder === 'string' && record.place) record.place.folder = msg.folder.slice(0, 1024);
      }
      this.changed(); await this.pump(live); return;
    }
    if (msg.kind === 'inspected' || msg.kind === 'completed') { const looking = live.looking; if (looking && looking.id === msg.id) looking.done(msg); return; }
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
        const output: Extract<Output, { kind: 'plot' }> = { kind: 'plot', plot: number, width: Number(msg.width) || 0, height: Number(msg.height) || 0 };
        const figure = path.join(plots, `${cell.cellId}-${number}.figure.json`);
        if (!live.place && msg.figure && typeof msg.figure === 'object') {
          const bytes = await fs.stat(figure).then(s => s.size, () => -1);
          if (bytes < 0) output.figureProblem = 'The figure record was not written.';
          else if (bytes > this.limits.maxFigureBytes) { await fs.rm(figure, { force: true }); output.figureProblem = `The figure record of ${bytes} bytes was larger than maxFigureBytes and was not kept.`; }
          else output.figure = figureSummary(msg.figure);
        } else if (typeof msg.figureProblem === 'string') output.figureProblem = msg.figureProblem.slice(0, 500);
        cell.outputs.push(output);
      }
      this.soon(); return;
    }
    if (msg.kind === 'saved') {
      // A file in the project the cell saved a plot to, read as the cell left it.
      const number = Number(msg.number), relative = typeof msg.path === 'string' ? msg.path : '';
      if (live.place || !Number.isSafeInteger(number) || number < 1 || number > this.limits.maxPlots || (cell.saved ?? []).some(s => s.number === number)) return;
      const file = relative.length <= 512 ? await confined(this.root, relative).catch(() => null) : null;
      const stat = file ? await fs.stat(file).catch(() => null) : null;
      if (!file || !stat?.isFile()) return;
      const { sha256, bytes } = await fileDigest(file);
      const saved: SavedFigure = { number, path: relative, bytes, sha256 };
      const record = path.join(await this.plots(), `${cell.cellId}-s${number}.figure.json`);
      if (msg.figure && typeof msg.figure === 'object') {
        const size = await fs.stat(record).then(s => s.size, () => -1);
        if (size < 0) saved.figureProblem = 'The figure record was not written.';
        else if (size > this.limits.maxFigureBytes) { await fs.rm(record, { force: true }); saved.figureProblem = `The figure record of ${size} bytes was larger than maxFigureBytes and was not kept.`; }
        else saved.figure = figureSummary(msg.figure);
      } else saved.figureProblem = typeof msg.figureProblem === 'string' ? msg.figureProblem.slice(0, 500) : 'Nothing described what this file draws.';
      (cell.saved ??= []).push(saved);
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
    if (live.forks) void fs.rm(live.forks, { recursive: true, force: true }).catch(() => {});
    const record = live.record;
    // ssh ends with 255 when the connection, not the session, ended: the process on the server
    // was not seen to end, and what the running cell did there was not observed.
    const lost = !!live.place && code === 255 && !live.stopping && record.version !== null;
    Object.assign(record, { state: 'ended', endedAt: now(), ending: live.stopping ? 'stopped' : record.version === null ? 'not-started' : lost ? 'disconnected' : 'exited', variables: [], variablesOmitted: 0 });
    if (record.version === null && !live.stopping) record.problem ??= `The session did not start${live.early.trim() ? ': ' + live.early.trim().slice(0, 600) : ` (exit ${code ?? 'by a signal'}).`}`;
    // serverctl ends a command at its own time limit, a session's lifetime through it.
    if (live.place?.via === 'serverctl' && code === 124 && !live.stopping) record.problem ??= `serverctl ended the session at its time limit (${Math.round(this.limits.serverctlSessionS / 3600)} h); its variables are gone.`;
    if (lost) record.problem ??= `The connection to ${live.place!.label} was lost. The session's process there${live.remotePid ? ` (${live.remotePid})` : ''} was not seen to end; its variables are out of reach.`;
    if (!live.stopping && record.version !== null) record.problem ??= `The session's process ended (exit ${code ?? 'by a signal'}); its variables are gone.`;
    if (live.current) {
      Object.assign(live.current, lost ? { state: 'unknown', endedAt: now(), problem: `The connection to ${live.place!.label} was lost while this cell ran; whether it finished there was not observed.` }
        : { state: 'error', endedAt: now(), problem: live.stopping ? 'The session was stopped while this cell ran.' : 'The session ended while this cell ran.' });
      this.finish(live.current);
    }
    for (const cell of live.queue) { Object.assign(cell, { state: 'not-run', endedAt: now(), problem: record.version === null ? record.problem ?? 'The session did not start.' : 'The session ended before this cell ran.' }); this.finish(cell); }
    if (this.live.get(slot(record.language, record.notebook)) === live) this.live.delete(slot(record.language, record.notebook));
    live.settle();
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

  // A session started without a cell, as the person starts or restarts one: the notebook's live
  // session of the language is returned as it is, and one that is stopping is waited for first. It
  // starts where the place names, else where the project runs that language, with the program it
  // runs it with.
  async start(input: { language: Language; place?: string; notebook?: string }, by: string) {
    await this.load();
    requireThat(input.notebook === undefined || new RegExp(notebookPattern).test(input.notebook), 'invalid', 'Name the notebook by the identity its cells carry.');
    const stopping = this.live.get(slot(input.language, input.notebook));
    if (stopping?.stopping) await stopping.ended;
    const live = await this.exclusive(() => this.ensure(input.language, by, input.place, undefined, input.notebook));
    return { session: structuredClone(live.record) };
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

  // Reading a value never starts a session and never waits for a cell. While a cell runs, a
  // session that keeps a fork of itself is read there, as it was when the cell started
  // (runningCell names the cell); any other session answers busy while a cell runs or waits.
  // Readings of one session go one at a time, and a cell queued meanwhile starts when a reading
  // of the session itself ends. The value is read as the session holds it now.
  async inspect(input: InspectInput, tries = 0): Promise<{ state: string; sessionId: string | null; afterCell: number; runningCell: number | null; readAt: string; problem: string | null; object: unknown }> {
    await this.load();
    const live = this.live.get(slot(input.language, input.notebook));
    const answer = (state: string, extra: { problem?: string | null; object?: unknown } = {}) => ({ state, sessionId: live?.record.sessionId ?? null, afterCell: live?.record.cells ?? 0, runningCell: null as number | null, readAt: now(), problem: extra.problem ?? null, object: extra.object ?? null });
    if (!live || live.stopping) return answer('none', { problem: `There is no live ${sessionName(input.language, input.notebook)}.` });
    const cell = live.current;
    if (cell && live.forks && tries < 3) {
      const reading = live.lookups.then(() => live.current === cell ? this.askFork(live, cell, input) : null).catch(() => null);
      live.lookups = reading;
      const got = await reading;
      // The cell ended meanwhile: the session itself is read, or the next cell's fork.
      if (!got) return this.inspect(input, tries + 1);
      return got.state === 'busy' ? answer('busy', got) : { ...answer(got.state, got), afterCell: cell.number - 1, runningCell: cell.number };
    }
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
        live.child.stdin!.write(JSON.stringify({ op: 'inspect', id: lookId, ...this.question(input) }) + '\n');
      });
    });
    live.lookups = reading.catch(() => {});
    return reading;
  }
  // The names that may follow a line being typed, asked of the live session between cells. It
  // starts no session and waits for no cell: while one runs or waits the answer is busy. The
  // session is held while it answers; one that has not answered within completeTimeoutMs is
  // interrupted, and the cells waiting go on whether it answers or not.
  async complete(input: { language: Language; notebook?: string; line: string }) {
    await this.load();
    const limits = this.limits, live = this.live.get(slot(input.language, input.notebook));
    requireThat(input.line.length <= limits.completeLineChars, 'invalid', `A line of at most ${limits.completeLineChars} characters is completed.`, { limit: 'completeLineChars' });
    const answer = (state: string, extra: { from?: number; items?: Completion[]; omitted?: number; problem?: string | null } = {}) => ({ state, sessionId: live?.record.sessionId ?? null, from: extra.from ?? input.line.length, items: extra.items ?? [], omitted: extra.omitted ?? 0, problem: extra.problem ?? null });
    if (!live || live.stopping) return answer('none');
    const busy = () => live.record.state !== 'idle' || !!live.current || live.queue.length > 0;
    if (busy()) return answer('busy');
    const reading = live.lookups.then(() => {
      if (busy() || live.stopping) return answer(live.record.state === 'ended' ? 'ended' : 'busy');
      return new Promise<ReturnType<typeof answer>>(resolve => {
        const lookId = id('i-');
        let told = false;
        const tell = (got: ReturnType<typeof answer>) => { if (!told) { told = true; resolve(got); } };
        const slow = setTimeout(() => this.signal(live, 'SIGINT'), limits.completeTimeoutMs);
        const giveUp = setTimeout(() => tell(answer('timeout', { problem: 'The session took too long to complete the line.' })), limits.completeTimeoutMs + limits.inspectGiveUpMs);
        // The session stays held until it answers, whatever the caller was told.
        live.looking = { id: lookId, done: msg => {
          clearTimeout(slow); clearTimeout(giveUp); if (live.looking?.id === lookId) live.looking = null;
          void this.pump(live);
          if (msg.state !== 'shown') return tell(answer(['timeout', 'failed', 'ended'].includes(msg.state) ? msg.state : 'failed', { problem: typeof msg.problem === 'string' ? msg.problem.slice(0, 500) : null }));
          // The session counts the name being completed in characters; the line is counted here as it was sent.
          const back = Math.max(0, Math.min(Number(msg.back) || 0, [...input.line].length)), typed = back ? [...input.line].slice(-back).join('') : '';
          const all: Completion[] = (Array.isArray(msg.items) ? msg.items : []).filter((i: any) => typeof i?.label === 'string' && i.label.length > 0 && i.label.length <= 512)
            .map((i: any): Completion => ({ label: i.label, type: (completionTypes as readonly string[]).includes(i.type) ? i.type : 'name' }));
          tell(answer('shown', { from: input.line.length - typed.length, items: all.slice(0, limits.completeItems), omitted: Math.max(0, Number(msg.omitted) || 0) + Math.max(0, all.length - limits.completeItems) }));
        } };
        live.child.stdin!.write(JSON.stringify({ op: 'complete', id: lookId, line: input.line, maxItems: limits.completeItems }) + '\n');
      });
    });
    live.lookups = reading.catch(() => {});
    return reading;
  }
  // What a reading asks its session, or the session's fork.
  private question(input: InspectInput) {
    const limits = this.limits;
    return { name: input.name, path: input.path ?? [], offset: input.offset ?? 0, limit: Math.min(input.limit ?? limits.inspectRows, 200), sort: input.sort ?? null, picture: !!input.picture,
      limits: { maxColumns: limits.inspectColumns, maxChildren: limits.inspectChildren, maxCellChars: limits.inspectCellChars, maxText: limits.inspectTextBytes, maxSortRows: limits.inspectSortRows, maxPicture: limits.inspectPictureBytes } };
  }
  // One reading of the fork a session made when this cell started. The reading is left as a file
  // in the cell's folder and the fork answers in another; null says the cell ended meanwhile.
  private async askFork(live: Live, cell: CellRecord, input: InspectInput): Promise<{ state: string; problem?: string | null; object?: unknown } | null> {
    const box = path.join(live.forks!, cell.cellId), limits = this.limits;
    const running = () => live.current === cell && !live.stopping && live.record.state !== 'ended';
    const read = async (name: string) => { try { return JSON.parse(await fs.readFile(path.join(box, name), 'utf8')); } catch { return null; } };
    const wait = async (name: string, ms: number, alive: () => boolean = () => true) => {
      for (const end = Date.now() + ms;;) {
        const got = await read(name);
        if (got) return got;
        if (!running() || !alive() || Date.now() >= end) return read(name);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    const waits = (why: string) => ({ state: 'busy', problem: `Cell ${cell.number} is running. ${why} The value can be read when the cell ends.` });
    const gone = (why: string) => { live.forkGone = { cell, problem: why }; return waits(why); };
    if (live.forkGone?.cell === cell) return waits(live.forkGone.problem);
    const state = await wait('state.json', limits.inspectForkStartMs);
    if (!running()) return null;
    if (!state) return gone('Its session made no copy of itself to read meanwhile.');
    if (state.state !== 'ready') return gone(typeof state.problem === 'string' ? state.problem : 'Its session made no copy of itself to read meanwhile.');
    const pid = Number(state.pid), alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const lookId = id('i-'), asked = path.join(box, `q-${lookId}.json`), answered = `a-${lookId}.json`;
    try {
      await fs.writeFile(asked + '.tmp', JSON.stringify({ id: lookId, ...this.question(input) }));
      await fs.rename(asked + '.tmp', asked);
    } catch { return running() ? gone('The copy its session kept to read meanwhile is gone.') : null; }
    // A reading that takes too long is taken back and the fork alone interrupted: with the
    // question gone it knows the interrupt was for the reading, not for the cell.
    const slow = setTimeout(() => void fs.rm(asked, { force: true }).catch(() => {}).then(() => this.signalFork(live, pid, 'SIGINT')), limits.inspectTimeoutMs);
    const got = await wait(answered, limits.inspectTimeoutMs + limits.inspectGiveUpMs, alive);
    clearTimeout(slow);
    void fs.rm(asked, { force: true }).catch(() => {}); void fs.rm(path.join(box, answered), { force: true }).catch(() => {});
    if (got) return got.state === 'missing' && !(input.path ?? []).length ? { state: 'missing', problem: `${input.name} was not in the session when cell ${cell.number} started, and the cell is still running.` } : { state: String(got.state), problem: got.problem ?? null, object: got.object ?? null };
    // A reading the fork did not come back from holds it for good, so it is ended: at once, or
    // after the time a reading may take when the cell ended first.
    if (!running()) { setTimeout(() => void this.signalFork(live, pid, 'SIGKILL'), limits.inspectTimeoutMs + limits.inspectGiveUpMs).unref(); return null; }
    if (!alive()) return gone('The copy its session kept to read meanwhile has ended.');
    void this.signalFork(live, pid, 'SIGKILL');
    live.forkGone = { cell, problem: 'A reading of the copy its session kept took too long, and the copy was ended.' };
    return { state: 'timeout', problem: 'Reading the value took too long.' };
  }
  // Signals a session's fork: only while it is still that session's child, as its number may
  // name another process by now.
  private async signalFork(live: Live, pid: number, signal: 'SIGINT' | 'SIGKILL') {
    const parent = await new Promise<number>(resolve => execFile('ps', ['-o', 'ppid=', '-p', String(pid)], (error, stdout) => resolve(error ? NaN : Number(String(stdout).trim()))));
    if (live.record.pid && parent === live.record.pid) try { process.kill(pid, signal); } catch { /* it ended meanwhile */ }
  }

  // The places a session can run in, where each language's next session starts (this machine
  // unless chosen), and the files copied from them.
  private placeState() {
    return this.placesRead ??= this.folder().then(async folder => {
      const state = await readJson<Partial<Places>>(path.join(folder, 'places.json'), {});
      // Places named before serverctl was known are reached with ssh.
      return { places: (state.places ?? []).map(p => ({ ...p, via: p.via ?? 'ssh' })), use: { r: state.use?.r ?? 'local', python: state.use?.python ?? 'local' }, copies: state.copies ?? [] };
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
  // A server serverctl manages is reached through it unless ssh is named: serverctl holds its
  // login and settings, which ssh alone does not have. A place on such a server stays with
  // serverctl when it is changed on the same server, even while serverctl cannot be asked.
  async setPlace(input: { place?: { placeId: string; label?: string; via?: Place['via']; destination: string; folder: string; setup?: string }; remove?: string; use?: Partial<Record<Language, string>> }, by: string) {
    await this.load();
    const was = input.place && !input.place.via ? (await this.placeState()).places.find(x => x.placeId === input.place!.placeId) : undefined;
    const kept = was?.via === 'serverctl' && was.destination.toLowerCase() === input.place!.destination.toLowerCase() ? was.destination : null;
    const managed = kept ?? (input.place && input.place.via !== 'ssh' ? await this.serverctl.named(input.place.destination) : null);
    requireThat(input.place?.via !== 'serverctl' || managed, 'not_found', `serverctl manages no server named ${input.place?.destination}. Read kernel.servers for the servers it manages.`);
    return this.exclusive(async () => {
      const state = await this.placeState();
      if (input.place) {
        const p = input.place, known = state.places.find(x => x.placeId === p.placeId), setup = (p.setup ?? '').replace(/\r\n?/g, '\n').trim();
        const via = managed ? 'serverctl' : 'ssh', destination = managed ?? p.destination;
        requireThat(known || state.places.length < this.limits.maxPlaces, 'limit', `At most ${this.limits.maxPlaces} places are named. Remove one first.`, { limit: 'maxPlaces', maximum: this.limits.maxPlaces });
        const same = known && known.via === via && known.destination === destination && known.folder === p.folder && known.setup === setup;
        const next: Place = { placeId: p.placeId, label: p.label?.trim() || p.placeId, via, destination, folder: p.folder, setup, by, at: now(), check: same ? known.check : null };
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
    const run = await this.transport(place).run(place, checkCommand(place), { timeoutMs: this.limits.remoteCheckTimeoutMs, maxBytes: 65536 });
    const check: PlaceCheck = { at: now(), by, ms: Date.now() - started, ...readCheck(run) };
    const state = await this.placeState(), current = state.places.find(p => p.placeId === placeId);
    if (current && current.via === place.via && current.destination === place.destination && current.folder === place.folder && current.setup === place.setup) { current.check = check; await this.savePlaces(state); }
    return { placeId, check };
  }

  // A folder within a place's folder, as the server lists it now.
  async list(placeId: string, sub = '') {
    requireThat(within(sub, true), 'scope', 'Name a folder within the place\'s folder, without parent steps.');
    const place = await this.placeOf(placeId);
    const run = await this.transport(place).run(place, listCommand(place, sub), { timeoutMs: this.limits.remoteListTimeoutMs, maxBytes: this.limits.remoteListBytes });
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
    const run = await this.transport(place).run(place, copyCommand(place, file, max), { timeoutMs: this.limits.remoteCopyTimeoutMs, maxBytes: max + 4096 });
    const { data, modifiedAt } = readCopy(run, max);
    await fs.mkdir(path.dirname(await confined(this.root, to, true)), { recursive: true });
    await atomicBytes(await confined(this.root, to, true), data);
    const copy: Copy = { placeId, path: file, to, bytes: data.length, modifiedAt, sha256: digest(data), copiedAt: now(), by };
    state.copies = [...state.copies.filter(c => c.to !== to), copy].slice(-this.limits.maxCopies);
    await this.savePlaces(state);
    return { copy };
  }

  // The servers the person manages with serverctl and the skills bound to each; one skill's text.
  servers() { return this.serverctl.servers(); }
  serverSkill(server: string, name: string) { return this.serverctl.skill(server, name); }

  async plot(cellId: string, plot: number) {
    await this.load();
    const cell = this.cells.find(c => c.cellId === cellId);
    requireThat(cell, 'not_found', 'This cell is not in the session record.');
    const output = cell.outputs.find(o => o.kind === 'plot' && o.plot === plot) as Extract<Output, { kind: 'plot' }> | undefined;
    requireThat(output, 'not_found', 'This cell kept no such plot.');
    const data = await fs.readFile(path.join(await this.plots(), `${cellId}-${plot}.png`));
    return { mediaType: 'image/png' as const, data: data.toString('base64'), width: output.width, height: output.height };
  }

  // The figure record an extension kept for a plot, as it wrote it; the figures plugin reads it.
  async figureRecord(cellId: string, plot: number) {
    await this.load();
    const cell = this.cells.find(c => c.cellId === cellId);
    requireThat(cell, 'not_found', 'This cell is not in the session record.');
    const output = cell.outputs.find(o => o.kind === 'plot' && o.plot === plot) as Extract<Output, { kind: 'plot' }> | undefined;
    requireThat(output, 'not_found', 'This cell kept no such plot.');
    requireThat(output.figure, 'not_found', output.figureProblem ?? 'This plot is a picture only: nothing described what it draws.');
    const file = path.join(await this.plots(), `${cellId}-${plot}.figure.json`);
    const stat = await fs.stat(file).catch(() => null);
    requireThat(stat && stat.size <= this.limits.maxFigureBytes, 'not_found', 'The figure record is no longer kept.');
    return { cell: { cellId: cell.cellId, number: cell.number, by: cell.by, purpose: cell.purpose, code: cell.code, language: cell.language, endedAt: cell.endedAt, sessionId: cell.sessionId }, output: structuredClone(output), bytes: await fs.readFile(file) };
  }

  // The figure a cell kept for a file it saved, found by the file's bytes: the newest cell that saved
  // those bytes. A file written since by anything else has other bytes and no figure.
  async savedFigure(sha256: string) {
    await this.load();
    let problem: string | undefined;
    for (const cell of [...this.cells].reverse()) for (const saved of [...(cell.saved ?? [])].reverse()) {
      if (saved.sha256 !== sha256) continue;
      if (!saved.figure) { problem ??= saved.figureProblem; continue; }
      const file = path.join(await this.plots(), `${cell.cellId}-s${saved.number}.figure.json`);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat || stat.size > this.limits.maxFigureBytes) { problem ??= 'The figure record is no longer kept.'; continue; }
      return { cell: { cellId: cell.cellId, number: cell.number, by: cell.by, purpose: cell.purpose, code: cell.code, language: cell.language, endedAt: cell.endedAt, sessionId: cell.sessionId }, output: structuredClone(saved), bytes: await fs.readFile(file) };
    }
    // A file a cell saved but could not describe says why; one no cell saved is simply a picture.
    requireThat(false, 'not_found', problem ?? 'No Notebook cell saved a figure as this file with these bytes: it is a picture only.', problem ? { saved: true } : {});
    throw new Error('unreachable');
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
      if (live.forks) void fs.rm(live.forks, { recursive: true, force: true }).catch(() => {});
      Object.assign(live.record, { state: 'ended', endedAt: now(), ending: 'rho-closed', variables: [] });
      if (live.current) Object.assign(live.current, { state: 'unknown', endedAt: now(), problem: 'Rho closed while this cell ran.' });
      for (const cell of live.queue) Object.assign(cell, { state: 'not-run', endedAt: now(), problem: 'Rho closed before this cell ran.' });
      clearTimeout(live.timer); clearTimeout(live.release);
      for (const stream of live.child.stdio) { stream?.removeAllListeners('data'); }
      live.answering?.removeAllListeners('data'); live.answering?.destroy(); live.pipe?.close();
      live.child.removeAllListeners('close');
    }
    this.live.clear();
    await Promise.all(exits);
    clearTimeout(this.saveTimer); this.saveTimer = undefined;
    await this.save();
  }
}

const content = [
  'A project has live R and Python sessions of its own, where your cells run unless you name a notebook, and each notebook the person opens in a workspace has its own R and Python sessions.',
  'To look at data, check a value or try a model, run code with kernel.run (language "r" or "python") instead of a one-off Rscript -e or python3 -c: what you define stays in the session for the next cell, and the person sees each cell, its output, its plots and the variables.',
  'Give each cell a short purpose. Pass waitMs to wait for it to finish; kernel.read reads it later.',
  'To run a corrected version of an earlier cell, pass replaces with that cell\'s cellId: the new cell is run in its place, where the person\'s notebook shows it, and the earlier run stays in the record under it. A cell that adds a step is a new cell.',
  'A cell or session that kernel.read lists with a notebook belongs to that notebook; pass the same notebook to kernel.run (and kernel.inspect) to work there, and leave it out to work in the project\'s sessions. When the person asks for work in their notebook, the Notebook views of their workspace, with each one\'s notebook, are in the interface context of their message. Values made in one notebook are not in another.',
  'A session starts with the first cell of its language in its notebook. Interrupt a cell that runs too long with kernel.interrupt; only the person stops a session.',
  'Results meant to last still go to files from a script, so they can be rebuilt without the session. Run the script in the session (source("analysis.R"), exec(open("analysis.py").read())) rather than with Rscript or python3 from a shell: a figure file stays readable mark by mark only while it holds the bytes a cell saved.',
  'A ggplot drawn in the R session (ggplot2 and what is built on it: ggtree, enrichplot, Seurat, patchwork) is also kept as a figure whose drawn marks are bound to the rows they come from; so is a page drawn with base graphics (bound where its points match a table in the session) and a ComplexHeatmap (each cell named by its row, column and value). The plot output names its layers and marks. Read it with figure.read {cellId, plot} to check what was actually drawn (marks per layer, rows missing, mappings) and to get the rows behind marks. A ggplot saved to a project file with ggsave() is kept as a figure of that file too: the cell names it under saved, and figure.read {path} reads it while the file keeps those bytes. When the person selects marks in a plot or a saved figure, their message names the selection.',
  'Sessions can also run on a server. kernel.places lists the places and where each language runs; kernel.place.set names one (the server, its folder there, and setup lines run there before a session starts) or chooses it for R or Python; kernel.place.check connects and reports R and Python there.',
  'kernel.servers lists the servers the person manages with serverctl and the skills bound to each: how that server is used (its environments, where heavy work goes, what to avoid there). Before you name a place on one or run code there, read the skills that apply with kernel.server.skill and follow them, for example in the place\'s setup lines. They guide the work on that server; they do not widen what you may do. A place on such a server is reached through serverctl, which holds its login; another server is reached with ssh.',
  'The project\'s Python is the machine\'s python3 until you name another. When the work needs packages it lacks, make an environment in the project (python3 -m venv .venv or uv venv, then install into it) and pass interpreter: ".venv/bin/python" to kernel.run; later sessions of that language start with it too, and each cell records the program that ran it. A live session in which only you ran cells starts again with the program you name; once the person ran a cell in it, ask them to stop it first. Do not add another environment\'s packages to a running session\'s path.',
  'Pass place to kernel.run to start a session there. Paths in a session on a server are its folder\'s; kernel.place.list lists them and kernel.place.copy copies a file into the project under remote/<place>/.',
].join('\n');
// What each view keeps in its props: the Notebook's form, and which value a value's view shows.
const viewProps: Record<keyof typeof viewPresentations, Record<string, unknown>> = {
  'rho.notebook': { form: { enum: ['notebook', 'console'] }, notebook: { type: 'string', pattern: notebookPattern } }, 'rho.sessions': {}, 'rho.variables': {}, 'rho.plots': {}, 'rho.flow': {}, 'rho.servers': {},
  'rho.object': { language: { enum: ['r', 'python'] }, name: { type: 'string', minLength: 1 }, notebook: { type: 'string', pattern: notebookPattern } },
};
export const plugin = { entryVersion: '1.0' as const, id: 'kernel', package: '@rho-workspace/plugin-kernel', version: '0.5.1', requires: [] as string[], capabilities: ['kernel'], presentation, timeline: 'kernel.events',
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })),
  skills: [{ id: 'kernel.session', version: '1.0', content, digest: digest(content), presentation: { displayName: 'Live session', description: 'Explains how to run code in the project\'s live R and Python sessions.' },
    intent: 'Run code in the live session and read what it printed.', requires: ['kernel.run', 'kernel.read'],
    example: { method: 'kernel.run', input: { language: 'r', code: 'summary(cars)', purpose: 'Summarise the cars data', changeId: 'cell-1', waitMs: 30000 } },
    failureRecipes: [{ kind: 'limit', message: 'Too many cells are waiting.', next: 'Wait for the running cell, or interrupt it, then run again with a new changeId.' }],
    verify: { command: 'npm run test:notebook', description: 'Runs R and Python cells, keeps their output, plots and variables, interrupts and stops sessions, and keeps identity across a restart.' } }],
  // Views of the sessions, all bound to nothing: each reads the project's sessions itself.
  components: Object.entries(viewPresentations).map(([id, presentation]) => ({ id, version: '1', owner: 'rho-plugins.kernel', bindings: {}, ui: './ui', presentation,
    propsSchema: { type: 'object', properties: { title: { type: 'string' }, ...viewProps[id as keyof typeof viewPresentations] } } })),
};
