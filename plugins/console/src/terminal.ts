import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Writable } from 'node:stream';
import { confined, now, requireThat, stateDirectory } from '@rho-workspace/plugin-contracts';
import headless from '@xterm/headless';
import { signalGroup } from './process-group.js';
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
  // On Windows, the console host draws the screen (ConPTY): a page's terminal emulator is told so
  // (xterm's windowsPty), since that host repaints the screen itself when the size changes.
  windowsPty?: { backend: 'conpty'; buildNumber: number } | null;
}
type Screen = InstanceType<typeof headless.Terminal>;
// What the Windows bridge said: its own process and the shell's, how the shell ended, or why it
// could not start the shell.
interface Said { bridge?: number; shell?: number; exit?: number; error?: string }
interface Live {
  child: ChildProcess; control: Writable | null; record: TerminalRecord; chunks: Buffer[]; waiters: Set<() => void>; errors: string; killTimer?: NodeJS.Timeout; screen: Screen;
  // Who has typed since the last prompt, and the command running.
  tracking: Tracking;
  // Windows: what the bridge said, once it said the shell started (or the console ended) and once
  // its pipe closed, whether Rho hung it up, and the file that tells the bridge Rho closed it.
  said?: Said; started?: Promise<void>; heard?: Promise<void>; hungUp?: boolean; closeFile?: string;
  // Its shell was started with marks: its first prompt is known when it shows.
  marked?: boolean;
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

// On Windows the pseudo-terminal is the console host Windows itself runs for one (conhost.exe, as
// ConPTY starts it), started headless: it takes what is typed on its input, prints the screen as
// VT sequences on its output, takes a new size on its input as CSI 8 ; rows ; cols t, and closing
// its input closes the console as closing a window does. Windows has it, so nothing compiled
// ships with Rho. The console's first program is a few lines of Windows PowerShell, which Windows
// also has. A program started in the background (as Rho may be) passes on a flag to ignore Ctrl+C
// to all it starts, so no program in the terminal would take Ctrl+C: the bridge turns Ctrl+C back on
// (in C# that Add-Type compiles, as process-group.ts does) and starts the shell, which inherits
// that, then keeps itself from ending on Ctrl+C. The console host ends with 0 whatever its programs
// did, so the bridge says the shell's process and how it ended over a named pipe Rho listens on.
// The bridge puts itself in a job object of its own before it starts the shell, so all the shell
// starts belongs to that job, even a program whose parent has ended. When Rho closes the terminal
// it first writes the close file the bridge was given, then hangs up: the programs in the job have
// `graceMs` to end (each program on the console is sent its close event, and a shell keeps its
// history as it ends), and the bridge ends those left. Without that, a subshell Git Bash forks as
// its console closes is sent no close event, and stays for minutes with the project folder as its
// own. When the shell ends by itself (`exit`), what it started in the background goes on. The
// bridge's own start takes about half a second. The shell to start comes in RHO_TERMINAL_SPEC.
const windowsBridge = `$ProgressPreference = 'SilentlyContinue'
$spec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:RHO_TERMINAL_SPEC)) | ConvertFrom-Json
Remove-Item Env:RHO_TERMINAL_SPEC
$pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', $spec.pipe, [System.IO.Pipes.PipeDirection]::Out)
$pipe.Connect(10000)
$say = New-Object System.IO.StreamWriter($pipe)
$say.AutoFlush = $true
try {
  Add-Type -Namespace Rho -Name TerminalBridge -MemberDefinition @'
public delegate bool Handler(uint ctrl);
static Handler kept;
static System.IntPtr job;
static string closeFile;
static int graceMs;
static bool ended;
static readonly object gate = new object();
[DllImport("kernel32.dll")] static extern bool SetConsoleCtrlHandler(System.IntPtr handler, bool add);
[DllImport("kernel32.dll")] static extern bool SetConsoleCtrlHandler(Handler handler, bool add);
[DllImport("kernel32.dll")] static extern System.IntPtr CreateJobObject(System.IntPtr attributes, string name);
[DllImport("kernel32.dll")] static extern bool SetInformationJobObject(System.IntPtr job, int kind, long[] info, int length);
[DllImport("kernel32.dll")] static extern bool QueryInformationJobObject(System.IntPtr job, int kind, long[] info, int length, System.IntPtr returned);
[DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(System.IntPtr job, System.IntPtr process);
// Ctrl+C reaches the shell; the job lets a program that asks leave it (JOB_OBJECT_LIMIT_BREAKAWAY_OK).
public static void Begin(string file, int grace) {
  closeFile = file; graceMs = grace;
  SetConsoleCtrlHandler(System.IntPtr.Zero, false);
  job = CreateJobObject(System.IntPtr.Zero, null);
  long[] limits = new long[8]; limits[2] = 0x800;
  if (job == System.IntPtr.Zero || !SetInformationJobObject(job, 2, limits, 64) || !AssignProcessToJobObject(job, System.Diagnostics.Process.GetCurrentProcess().Handle)) job = System.IntPtr.Zero;
}
public static void Hold() { kept = Handle; SetConsoleCtrlHandler(kept, true); }
// The job's programs other than the bridge (JobObjectBasicProcessIdList: two counts, then the ids).
static System.Collections.Generic.List<int> Members() {
  var members = new System.Collections.Generic.List<int>();
  long[] list = new long[1025];
  if (job == System.IntPtr.Zero || !QueryInformationJobObject(job, 3, list, list.Length * 8, System.IntPtr.Zero)) return members;
  int self = System.Diagnostics.Process.GetCurrentProcess().Id, count = (int)(list[0] >> 32);
  for (int i = 1; i <= count && i < list.Length; i++) if ((int)list[i] != self) members.Add((int)list[i]);
  return members;
}
// Rho closed the terminal: what was started in it has graceMs to end, then what is left is ended.
public static void End() {
  lock (gate) {
    if (ended || !System.IO.File.Exists(closeFile)) return;
    ended = true;
    var until = System.DateTime.UtcNow.AddMilliseconds(graceMs);
    while (Members().Count > 0 && System.DateTime.UtcNow < until) System.Threading.Thread.Sleep(50);
    foreach (int id in Members()) { try { System.Diagnostics.Process.GetProcessById(id).Kill(); } catch { } }
  }
}
static bool Handle(uint ctrl) { if (ctrl == 2) End(); return true; }
'@
  [Rho.TerminalBridge]::Begin($spec.closeFile, $spec.graceMs)
  $info = New-Object System.Diagnostics.ProcessStartInfo($spec.file, $spec.arguments)
  $info.UseShellExecute = $false
  $shell = [System.Diagnostics.Process]::Start($info)
  [Rho.TerminalBridge]::Hold()
  $say.WriteLine('{"bridge":' + $PID + ',"shell":' + $shell.Id + '}')
  $shell.WaitForExit()
  $say.WriteLine('{"exit":' + $shell.ExitCode + '}')
  [Rho.TerminalBridge]::End()
} catch {
  $say.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
}
$say.Dispose()
`;
const windows = process.platform === 'win32';
const system32 = (...parts: string[]) => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', ...parts);
const windowsPowerShell = () => system32('WindowsPowerShell', 'v1.0', 'powershell.exe');
// One argument as a Windows program reads its command line (CommandLineToArgvW).
const windowsArgument = (arg: string) => arg && !/[\s"]/.test(arg) ? arg : '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
// A program named without a folder, found on PATH as Windows finds it (with PATHEXT). A program
// installed as a Windows app (PowerShell from the Store or winget) is on PATH as an execution alias,
// which Windows starts but Node cannot read: it is found by its name in the folder's listing.
function onPath(program: string, env: NodeJS.ProcessEnv) {
  const variable = (name: string) => Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1];
  const extensions = path.extname(program) ? [''] : (variable('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const aliases = path.join(variable('LOCALAPPDATA') ?? '', 'Microsoft', 'WindowsApps').toLowerCase();
  for (const folder of (variable('PATH') ?? '').split(path.delimiter).filter(Boolean)) for (const extension of extensions) {
    const file = path.join(folder, program + extension.toLowerCase());
    try { accessSync(file, constants.X_OK); if (statSync(file).isFile()) return file; } catch { /* not here */ }
    if (path.resolve(folder).toLowerCase() === aliases && aliasNames(folder).has((program + extension).toLowerCase())) return file;
  }
  return null;
}
const aliasNames = (folder: string) => { try { return new Set(readdirSync(folder).map(name => name.toLowerCase())); } catch { return new Set<string>(); } };

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
  // The shell: the one named; else on Windows pwsh on PATH, then Windows PowerShell, then ComSpec
  // (SHELL there is Git Bash's /usr/bin/bash, not a Windows path); else SHELL, else /bin/sh.
  private shell() {
    if (windows) {
      const env = { ...process.env, ...this.options.env }, named = this.options.shell;
      if (named) return path.isAbsolute(named) ? named : onPath(named, env) ?? named;
      return onPath('pwsh', env) ?? (existsSync(windowsPowerShell()) ? windowsPowerShell() : process.env.ComSpec ?? system32('cmd.exe'));
    }
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
    requireThat(whole(input.cols, 2, this.limits.maxCols) && whole(input.rows, 1, this.limits.maxRows), 'invalid', `Size the terminal between 2 × 1 and ${this.limits.maxCols} × ${this.limits.maxRows}.`);
    // An ended terminal makes room; a live one is never closed for another.
    while (this.live.size >= this.limits.maxTerminals) {
      const ended = [...this.live.values()].find(l => l.record.endedAt !== null);
      requireThat(ended, 'limit', `At most ${this.limits.maxTerminals} terminals are open in a project at once. Close one first.`, { limit: 'maxTerminals', maximum: this.limits.maxTerminals });
      this.live.delete(ended.record.terminalId); ended.screen.dispose();
    }
    const cwd = input.cwd ?? '', folder = cwd ? await confined(this.root, cwd) : await fs.realpath(this.root);
    requireThat((await fs.stat(folder)).isDirectory(), 'invalid', 'Open a terminal in a folder of this project.');
    const shell = this.shell(), name = windows ? path.basename(shell).toLowerCase().replace(/\.exe$/, '') : path.basename(shell);
    const login = ['zsh', 'bash', 'fish', 'sh', 'ksh', 'dash', 'ash', 'mksh'].includes(name);
    const windowsPty = windows ? { backend: 'conpty' as const, buildNumber: Number(os.release().split('.')[2]) || 0 } : null;
    const record: TerminalRecord = { terminalId: 't-' + randomBytes(8).toString('hex'), by: input.by, shell, cwd, cols: input.cols, rows: input.rows, startedAt: now(), endedAt: null, exit: null, bytes: 0, kept: 0, problem: null, recording: false, windowsPty };
    // A shell that marks its commands starts with Rho's startup files around the person's own.
    await this.log.load();
    const kind = markedShell(shell), nonce = randomBytes(12).toString('hex'), base: NodeJS.ProcessEnv = { ...process.env, ...this.options.env };
    for (const [key, value] of Object.entries(base)) if (value === undefined) delete base[key];
    const marks = kind ? await shellMarks(kind, await this.folder(), nonce, base, this.root, shell).catch(() => null) : null;
    const env: NodeJS.ProcessEnv = { ...base, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Rho', ...marks?.env };
    const args = marks ? marks.args : login ? ['-l'] : [];
    let child: ChildProcess, said: Said | undefined, started: Promise<void> | undefined, heard: Promise<void> | undefined, closeFile: string | undefined;
    try {
      if (windows) ({ child, said, started, heard, closeFile } = await this.windowsPty(shell, args, input, folder, env));
      // Its own process group: a signal to Rho's group does not reach the shell through it.
      else child = spawn(this.options.python ?? 'python3', ['-u', '-c', bridge, String(input.cols), String(input.rows), shell, ...args], { cwd: folder, env, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    } catch (error) {
      requireThat(false, 'unavailable', 'The terminal could not be started: ' + (error instanceof Error ? error.message : windows ? 'the console host did not start.' : 'python3 did not start.'));
      throw error;
    }
    const screen = new headless.Terminal({ cols: input.cols, rows: input.rows, scrollback: this.limits.screenScrollback, allowProposedApi: true, ...(windowsPty ? { windowsPty } : {}) });
    const live: Live = { child, control: windows ? null : child.stdio[3] as Writable, record, chunks: [], waiters: new Set(), errors: '', screen, tracking: { typers: [], lastTyper: null, running: null, prompt: null }, said, started, heard, closeFile, marked: !!marks };
    const wake = () => { for (const done of [...live.waiters]) done(); };
    if (marks) this.log.watch(screen, record.terminalId, nonce, live.tracking, record.by, () => { if (!record.recording) { record.recording = true; this.changed(); wake(); } }, !!windowsPty);
    this.live.set(record.terminalId, live);
    const take = (chunk: Buffer) => {
      live.chunks.push(chunk); record.bytes += chunk.length; screen.write(chunk);
      // The oldest output goes once more than the scrollback is kept.
      let held = record.bytes - record.kept;
      while (live.chunks.length > 1 && held - live.chunks[0]!.length >= this.limits.scrollbackBytes) { const old = live.chunks.shift()!; held -= old.length; record.kept += old.length; }
      wake();
    };
    // The console host sets up its empty screen before the bridge has started the shell; that is
    // held until the shell starts, so a reader waiting for the first output waits for the shell's.
    let early: Buffer[] | null = started ? [] : null;
    void started?.then(() => { const chunks = early ?? []; early = null; for (const chunk of chunks) take(chunk); });
    child.stdout!.on('data', (chunk: Buffer) => { if (early) early.push(chunk); else take(chunk); });
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
    child.on('error', error => ended(null, null, !/ENOENT/.test(error.message) ? error.message : windows ? 'A terminal on Windows needs its console host, conhost.exe, and it was not found.' : 'A terminal needs python3 on this machine to open a pseudo-terminal, and it was not found.'));
    child.on('close', (code, signal) => {
      if (!windows) return ended(code, signal);
      // The console host ends with 0: how the shell ended is what the bridge said, once its pipe closed.
      void Promise.race([live.heard, new Promise(resolve => setTimeout(resolve, 1000))]).then(() => {
        const told = live.said ?? {};
        if (told.error) return ended(null, null, 'The terminal could not start its shell: ' + told.error.trim());
        if (told.exit !== undefined) return ended(told.exit >>> 0, null);
        ended(null, null, live.hungUp ? undefined : told.shell === undefined ? 'The terminal could not start its shell.' : 'Its shell ended, and how was not seen.');
      });
    });
    this.changed();
    return { terminal: { ...record } };
  }

  // Windows: the console host, headless, with the bridge as its first program. What the bridge says
  // comes over a pipe of this terminal's own, which takes one connection and closes when the
  // console does (or after 30 s without one). `started` settles when the bridge says the shell
  // started or nothing more will be said; `heard` when its pipe has closed.
  private async windowsPty(shell: string, args: string[], size: { cols: number; rows: number }, cwd: string, env: NodeJS.ProcessEnv) {
    const pipe = 'rho-terminal-' + randomBytes(12).toString('hex'), server = net.createServer(), said: Said = {};
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen('\\\\.\\pipe\\' + pipe, () => resolve()); });
    let begun = () => {}, settled = () => {};
    const started = new Promise<void>(resolve => { begun = resolve; }), heard = new Promise<void>(resolve => { settled = resolve; });
    const over = () => { clearTimeout(unheard); server.close(); begun(); settled(); };
    const unheard = setTimeout(over, 30000);
    unheard.unref();
    server.once('connection', socket => {
      clearTimeout(unheard); server.close();
      let pending = '';
      socket.on('data', (chunk: Buffer) => {
        pending += chunk.toString('utf8');
        for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) {
          try { Object.assign(said, JSON.parse(pending.slice(0, at))); } catch { /* not a message */ }
          pending = pending.slice(at + 1);
        }
        if (said.shell !== undefined || said.error !== undefined) begun();
      });
      socket.on('error', () => {});
      socket.on('close', over);
    });
    // The bridge's grace ends before Rho's, so the console is ended by it, not by taskkill.
    const graceMs = Math.max(100, this.limits.closeGraceMs - 500), closeFile = path.join(os.tmpdir(), pipe + '.close');
    const spec = Buffer.from(JSON.stringify({ pipe, file: shell, arguments: args.map(windowsArgument).join(' '), graceMs, closeFile })).toString('base64');
    const child = spawn(system32('conhost.exe'), ['--headless', '--width', String(size.cols), '--height', String(size.rows), '--', windowsPowerShell(), '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsBridge, 'utf16le').toString('base64')],
      { cwd, env: { ...env, RHO_TERMINAL_SPEC: spec }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.once('close', () => { clearTimeout(unheard); server.close(); begun(); void fs.rm(closeFile, { force: true }).catch(() => {}); });
    child.once('error', over);
    return { child, said, started, heard, closeFile };
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
    if (live.record.endedAt === null && (live.record.cols !== cols || live.record.rows !== rows)) {
      live.record.cols = cols; live.record.rows = rows;
      // The console host takes a size on its input; the Python bridge on descriptor 3.
      if (windows) live.child.stdin!.write(`\x1b[8;${rows};${cols}t`); else live.control?.write(`${cols} ${rows}\n`);
      live.screen.resize(cols, rows);
    }
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
  // just typed has printed what it prints at once. On Windows, from the start (after 0), a shell
  // that marks its commands is waited for until its first prompt shows: the console host draws its
  // empty screen first, and a shell may print nothing for seconds as it starts (PowerShell reading
  // a profile). `offset` is the bytes printed by then.
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
      const until = Date.now() + Math.min(input.waitMs!, limits.maxWaitMs), first = windows && input.after === 0 && live.marked;
      while ((record.bytes <= input.after || (first && !record.recording)) && record.endedAt === null && Date.now() < until) await wait(until - Date.now());
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
    if (windows) {
      // Closing the console's input closes the console, as closing its window does; the close
      // file first tells the bridge to end what is left of the terminal's programs after its grace.
      // What is still there after Rho's grace ends with all it started (taskkill /T /F); a shell the
      // bridge said had ended is not named, since Windows soon gives its process id to another.
      live.hungUp = true;
      if (live.closeFile) try { writeFileSync(live.closeFile, ''); } catch { /* The bridge then leaves its programs to the console's close. */ }
      live.child.stdin?.end();
      live.killTimer = setTimeout(() => {
        const shell = live.said?.exit === undefined ? live.said?.shell : undefined;
        if (live.record.endedAt === null && pid) void signalGroup(pid, 'SIGKILL', { members: shell ? [shell] : [] });
      }, this.limits.closeGraceMs);
      live.killTimer.unref?.();
      return;
    }
    const signal = (name: NodeJS.Signals) => { try { if (pid) process.kill(pid, name); } catch { /* It has ended. */ } };
    signal('SIGTERM');
    live.killTimer = setTimeout(() => signal('SIGKILL'), this.limits.closeGraceMs);
    live.killTimer.unref?.();
  }
  // Rho closing: every shell is hung up, and a command still running is recorded as not seen to
  // end. The returned promise settles once the record is written. On Windows a console still there
  // after the grace period is ended with what it started, so nothing left on it holds Rho open.
  async shutdown() {
    const ending: Promise<void>[] = [];
    for (const live of this.live.values()) {
      this.end(live); if (!windows) clearTimeout(live.killTimer);
      if (live.tracking.running) ending.push(this.log.end(live.tracking, null, 'Rho closed while it ran; how it ended was not seen.', live.screen));
      live.screen.dispose();
    }
    this.live.clear();
    await Promise.all(ending);
    await this.log.save();
  }
}
