import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicJson, now, readJson, requireThat } from '@rho-workspace/plugin-contracts';
import type headless from '@xterm/headless';
import { markCode, unescapeMark } from './shell-marks.js';

// The commands run in a project's terminals, as their shells marked them, and what each printed.
//
// A shell marks a command in one of two ways (shell-marks.ts). zsh, bash and fish say when a
// command starts, with its line and folder (S), and when it ended, with its status (F). sh, dash
// and ksh93 can only mark their prompt: its start, with the last status (F), and its end, with
// the folder (B); the command is then the line typed after the prompt, read from the screen when
// the line feed that runs it arrives, and the lines typed after each continuation prompt (C) that
// follows before it prints anything. A shell without a line editor of its own (dash) does not
// show a line typed while a command ran again when it reads it, so the line shown after the prompt
// is checked against the lines typed: one typed after the prompt appears there as typed; else the
// oldest line typed before the prompt appeared is what the shell read, and what is shown after the
// prompt is what that printed. Either way, everyone whose input reached the shell since the prompt
// typed the command, and the latest of them entered it. A line shown as typed while a command runs
// is the terminal's echo of input, not what the command printed.
//
// What a command printed is read line by line from the terminal emulator as each line feed
// completes a line, so carriage returns, colours and cursor moves within a line are applied and
// nothing depends on how much of the screen is kept. What a full-screen program (an editor, top,
// less) drew is kept as the screen it showed when it left. A line rewritten after its line feed
// (a progress display that moves the cursor up) is kept as it first stood. On Windows the console
// host draws the screen in its own order, so there a row is read when it scrolls off the screen or
// when the command's end is marked, as it stands then (rows()).
//
// The protected resources are the project's state folder and Rho's memory. At most maxCommands
// records are kept (the oldest go first, with their output), each line up to commandChars
// characters. Of each command's output the record holds the first commandOutputBytes; a file
// beside it holds the first commandHeadBytes and the last commandTailBytes, the bytes between
// counted as cut, and at most maxScreens full screens. All such files together stay under
// outputStoreBytes: the oldest are let go first, and their records say so. A listing returns at
// most maxCommandsListed records, a read of output at most maxOutputChars characters.
export const commandLimits = { maxCommands: 500, commandChars: 4096, commandOutputBytes: 16 * 1024, commandHeadBytes: 512 * 1024, commandTailBytes: 64 * 1024,
  maxScreens: 4, outputStoreBytes: 64 * 1024 * 1024, maxCommandsListed: 200, maxOutputChars: 64 * 1024 };
export type CommandLimits = typeof commandLimits;

// `unknown` is a command whose end was not seen: its terminal or Rho closed while it ran.
export type TerminalCommandState = 'running' | 'exited' | 'unknown';
export interface TerminalCommand {
  commandId: string; terminalId: string; command: string; cwd: string;
  // Who typed it, the first first, and who entered it.
  by: string[]; enteredBy: string;
  startedAt: string; endedAt: string | null; state: TerminalCommandState; exit: number | null;
  // The start of what it printed; all it printed, in bytes; whether a file keeps the rest (and any
  // full screens), and whether some in the middle is not kept even there.
  output: string; outputBytes: number; stored: boolean; storedBytes: number; screens: number; cut: boolean;
  problem: string | null;
}
export interface CommandScreen { at: string; lines: string[] }
interface Stored { head: string; tail: string; cutBytes: number; screens: CommandScreen[] }

type Screen = InstanceType<typeof headless.Terminal>;
type Marker = NonNullable<ReturnType<Screen['registerMarker']>>;
type Buffer_ = Screen['buffer']['active'];
type Line = NonNullable<ReturnType<Buffer_['getLine']>>;
// `last`: under the Windows console host, the last row of output taken (see rows()).
interface Running { command: TerminalCommand; head: string[]; headBytes: number; tail: string[]; tailBytes: number; cutBytes: number; screens: CommandScreen[]; fromScreen: boolean; last?: Marker }
// A line typed, as the terminal's line discipline edits it; `plain` when no key a line editor
// takes (arrows, tab, other control keys) was in it, so its text is what the shell read.
interface TypedLine { text: string; plain: boolean; seq: number; echoed: boolean }
interface PromptEnd { marker: Marker; col: number; seq: number }
// One terminal's part: who typed since the prompt, the command running, the lines typed and not
// yet read, and where the line typed after an sh prompt (or its continuation prompt) begins.
export interface Tracking {
  typers: string[]; lastTyper: string | null; running: Running | null;
  prompt: (PromptEnd & { cwd: string }) | null; continued?: PromptEnd | null;
  input?: { text: string; plain: boolean }; lines?: TypedLine[]; seq?: number;
  // Its screen is drawn by the Windows console host (ConPTY).
  conpty?: boolean;
}
const maxLinesTyped = 50;

const bytes = (text: string) => Buffer.byteLength(text);
const cutTo = (text: string, limit: number) => { const b = Buffer.from(text); return b.length <= limit ? text : b.subarray(0, limit).toString('utf8').replace(/�$/, ''); };
// A line the screen wrapped is one line: the rows from `from` to `to`, joined.
function logical(buffer: Buffer_, to: number, from?: number) {
  let start = to;
  if (from === undefined) while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
  else start = from;
  const rows: Line[] = [];
  for (let i = start; i <= to; i++) { const row = buffer.getLine(i); if (row) rows.push(row); }
  return rows;
}
const text = (rows: Line[], col = 0) => rows.map((row, i) => row.translateToString(true, i === 0 ? col : 0)).join('');
// zsh ends output that has no final newline with a % or # in inverse video: the shell's, not the command's.
function withoutEndMark(rows: Line[], line: string) {
  for (let r = rows.length - 1; r >= 0; r--) for (let x = rows[r]!.length - 1; x >= 0; x--) {
    const cell = rows[r]!.getCell(x);
    if (!cell || !cell.getChars().trim()) continue;
    return cell.isInverse() && ['%', '#'].includes(cell.getChars()) ? line.replace(/[%#]\s*$/, '') : line;
  }
  return line;
}

export class CommandLog {
  private commands: TerminalCommand[] | null = null;
  private writing: Promise<void> = Promise.resolve();
  private realRoot: string | null = null;
  constructor(private root: string, private folder: () => Promise<string>, private limits: () => CommandLimits, private changed: () => void) {}

  // The recorded commands; any still running when Rho closed ended unseen.
  async load() {
    if (this.commands) return this.commands;
    const commands = await readJson<TerminalCommand[]>(path.join(await this.folder(), 'terminal-commands.json'), []);
    if (this.commands) return this.commands;
    this.realRoot = await fs.realpath(this.root).catch(() => this.root);
    let dirty = false;
    for (const c of commands) {
      // Records from before output was kept whole.
      c.enteredBy ??= c.by.at(-1) ?? ''; c.outputBytes ??= bytes(c.output); c.stored ??= false; c.storedBytes ??= 0; c.screens ??= 0;
      if (c.state === 'running') { Object.assign(c, { state: 'unknown', problem: 'Rho closed while it ran; how it ended was not seen.' }); dirty = true; }
    }
    this.commands = commands;
    if (dirty) void this.save();
    return commands;
  }
  save() {
    this.writing = this.writing.then(async () => atomicJson(path.join(await this.folder(), 'terminal-commands.json'), this.commands ?? [])).catch(() => {});
    return this.writing;
  }
  private async outputs() { const dir = path.join(await this.folder(), 'terminal-output'); await fs.mkdir(dir, { recursive: true, mode: 0o700 }); return dir; }
  private outputFile = async (commandId: string) => path.join(await this.outputs(), commandId + '.json');

  // The newest first, from `offset` on.
  async list(limit = 50, offset = 0) {
    const limits = this.limits();
    requireThat(Number.isInteger(limit) && limit >= 1 && limit <= limits.maxCommandsListed, 'limit', `List at most ${limits.maxCommandsListed} commands at a time.`, { limit: 'maxCommandsListed', maximum: limits.maxCommandsListed });
    requireThat(Number.isInteger(offset) && offset >= 0, 'invalid', 'Start the listing at a whole number of commands.');
    const ordered = [...await this.load()].reverse();
    return { commands: ordered.slice(offset, offset + limit).map(c => ({ ...c, by: [...c.by] })), omitted: Math.max(0, ordered.length - offset - limit) };
  }

  // What a command printed, from a character offset: the kept start, then (after `gap`, the
  // characters' place where the cut bytes were) the kept end; and on the first page, the full
  // screens it drew.
  async output(commandId: string, offset = 0, maxChars = this.limits().maxOutputChars) {
    const limits = this.limits();
    requireThat(Number.isInteger(maxChars) && maxChars >= 1 && maxChars <= limits.maxOutputChars, 'limit', `Read at most ${limits.maxOutputChars} characters at a time.`, { limit: 'maxOutputChars', maximum: limits.maxOutputChars });
    const command = (await this.load()).find(c => c.commandId === commandId);
    requireThat(command, 'not_found', 'No terminal command has this identity. List them with console.terminal.commands.');
    const kept: Stored = command.stored ? await readJson<Stored | null>(await this.outputFile(commandId), null) ?? { head: command.output, tail: '', cutBytes: 0, screens: [] } : { head: command.output, tail: '', cutBytes: 0, screens: [] };
    const all = kept.head + kept.tail, from = Math.min(Math.max(0, offset), all.length), piece = all.slice(from, from + maxChars);
    const short = !command.stored && bytes(command.output) < command.outputBytes;
    return { commandId, text: piece, offset: from, nextOffset: from + piece.length, more: from + piece.length < all.length, total: all.length,
      gap: kept.cutBytes ? { at: kept.head.length, bytes: kept.cutBytes } : null, screens: from === 0 ? kept.screens : [],
      problem: short ? command.problem ?? 'Only the start of what it printed is kept.' : null };
  }

  // Input reached the shell from `by`.
  typed(tracking: Tracking, by: string | undefined, data = '') {
    if (by) { if (!tracking.typers.includes(by)) tracking.typers.push(by); tracking.lastTyper = by; }
    const input = tracking.input ??= { text: '', plain: true }, lines = tracking.lines ??= [], limit = this.limits().commandChars;
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        tracking.seq = (tracking.seq ?? 0) + 1;
        lines.push({ text: input.text, plain: input.plain, seq: tracking.seq, echoed: false });
        if (lines.length > maxLinesTyped) lines.shift();
        input.text = ''; input.plain = true;
      } else if (ch === '\x7f' || ch === '\b') input.text = Array.from(input.text).slice(0, -1).join('');
      else if (ch === '\x15') input.text = '';
      else if (ch === '\x17') input.text = input.text.replace(/\S*\s*$/, '');
      // Ctrl+C: the terminal drops what was typed and not yet read.
      else if (ch === '\x03') { input.text = ''; input.plain = true; lines.length = 0; }
      else if (ch < ' ') input.plain = false;
      else if (input.text.length < limit) input.text += ch;
    }
  }

  // The line a shell read after a prompt (or continuation prompt) that ended when `seq` lines had
  // been typed, given what is shown after it (null when nothing was). Lines typed before it went
  // to the programs that ran. Null when no typed line accounts for it.
  private read(tracking: Tracking, seq: number, shown: string | null) {
    const lines = tracking.lines ??= [];
    if (shown !== null) {
      const echoed = lines.findIndex(q => q.plain && q.seq > seq && q.text.trim() === shown);
      if (echoed >= 0) { lines.splice(0, echoed + 1); return { text: shown, shown: true }; }
    }
    const ahead = lines.findIndex(q => q.seq <= seq && q.plain);
    // A line editor shows a line typed ahead when it reads it; dash does not.
    if (ahead >= 0) { const text = lines.splice(0, ahead + 1).at(-1)!.text.trim(); return { text, shown: text === shown }; }
    // Typed after the prompt with a line editor's keys: the line as the shell shows it.
    if (shown !== null && lines.some(q => q.seq > seq)) { lines.length = 0; return { text: shown, shown: true }; }
    return null;
  }
  private more(running: Running, line: string) { running.command.command = Array.from(running.command.command + '\n' + line).slice(0, this.limits().commandChars).join(''); }

  // A terminal's emulator, watched: its shell's marks, the lines it completes and the full screens
  // its programs leave. `opener` types when no input was seen. `conpty`: the Windows console host
  // draws its screen.
  watch(screen: Screen, terminalId: string, nonce: string, tracking: Tracking, opener: string, ready: () => void, conpty = false) {
    const buffer = () => screen.buffer.active;
    tracking.conpty = conpty;
    screen.parser.registerOscHandler(markCode, data => { this.mark(screen, terminalId, nonce, tracking, opener, ready, data); return true; });
    screen.onLineFeed(() => {
      const b = buffer();
      if (b.type !== 'normal') return;
      const y = b.baseY + b.cursorY - 1;
      const shown = (at: PromptEnd) => { const from = at.marker.line; at.marker.dispose(); return from >= 0 && from <= y ? text(logical(b, y, from), at.col).trim() : ''; };
      // After a continuation prompt, a further line of the command.
      const continued = tracking.continued, running = tracking.running;
      if (continued && running) {
        tracking.continued = null;
        const line = shown(continued), got = this.read(tracking, continued.seq, line);
        if (got?.text) this.more(running, got.text);
        if (got && !got.shown && line) this.line(running, line);
        return;
      }
      if (running) {
        if (tracking.conpty) return;
        const line = text(logical(b, y));
        // The terminal's echo of a line typed is not what the command printed.
        const echo = tracking.lines?.find(q => !q.echoed && q.plain && q.text.trim() && q.text.trim() === line.trim());
        if (echo) echo.echoed = true; else this.line(running, line);
        return;
      }
      // After an sh prompt, the line feed that runs the line typed there.
      const prompt = tracking.prompt;
      if (!prompt) return;
      tracking.prompt = null;
      const line = shown(prompt), got = this.read(tracking, prompt.seq, line);
      if (!got?.text) return;
      this.start(tracking, terminalId, got.text, prompt.cwd, opener, true);
      if (!got.shown && line) this.line(tracking.running!, line);
    });
    // Under the console host, a row that scrolls off the screen is final (rows()).
    screen.onScroll(() => {
      const running = tracking.running, b = buffer();
      if (tracking.conpty && running && b.type === 'normal') this.rows(screen, running, b.baseY - 1);
    });
    // A full-screen program leaving: what it showed then.
    screen.parser.registerCsiHandler({ prefix: '?', final: 'l' }, params => {
      if (tracking.running && buffer().type === 'alternate' && params.some(p => p === 1049 || p === 1047 || p === 47)) this.frame(screen, tracking.running);
      return false;
    });
  }

  // Under the Windows console host a row on the screen reaches the terminal as the host draws it,
  // in its own order: a blank row by moving the cursor past it, and the whole screen again, its
  // rows still blank below the cursor, when the size changes or a full-screen program leaves. A row
  // is final once it scrolls off the screen, as the host never draws scrollback again, or when the
  // shell marks the command's end (it waits for the host to draw first). A command's output is the
  // rows after the last one taken, up to `y`; a line that goes on below `y` is taken once whole.
  private rows(screen: Screen, running: Running, y: number) {
    const b = screen.buffer.active, last = running.last;
    const from = last && !last.isDisposed && last.line >= 0 ? last.line + 1 : y;
    let to = y;
    if (b.getLine(y + 1)?.isWrapped) { while (to >= from && b.getLine(to)?.isWrapped) to--; to--; }
    if (to < from) return;
    for (let start = from, r = from; r <= to; r++) {
      if (r < to && b.getLine(r + 1)?.isWrapped) continue;
      this.line(running, text(logical(b, r, start)));
      start = r + 1;
    }
    last?.dispose();
    running.last = screen.registerMarker(to - b.baseY - b.cursorY);
  }

  private frame(screen: Screen, running: Running) {
    const b = screen.buffer.active, lines: string[] = [];
    for (let i = 0; i < screen.rows; i++) lines.push(b.getLine(b.baseY + i)?.translateToString(true) ?? '');
    while (lines.length && !lines.at(-1)!.trim()) lines.pop();
    if (!lines.length) return;
    running.screens.push({ at: now(), lines });
    if (running.screens.length > this.limits().maxScreens) running.screens.shift();
  }

  // A line it printed: kept whole in the start while it fits, then among the last lines kept.
  private line(running: Running, line: string, newline = true) {
    const limits = this.limits(), piece = line + (newline ? '\n' : ''), size = bytes(piece);
    running.command.outputBytes += size;
    if (running.headBytes + size <= limits.commandHeadBytes) { running.head.push(piece); running.headBytes += size; return; }
    // The start is full from here: one line larger than it keeps its own start.
    if (!running.head.length) {
      const kept = cutTo(piece, limits.commandHeadBytes);
      running.head.push(kept); running.headBytes = limits.commandHeadBytes; running.cutBytes += size - bytes(kept);
      return;
    }
    running.headBytes = limits.commandHeadBytes;
    // A line larger than the end kept keeps its own end.
    const whole = Buffer.from(piece), kept = whole.length > limits.commandTailBytes ? whole.subarray(-limits.commandTailBytes).toString('utf8').replace(/^\uFFFD/, '') : piece;
    running.cutBytes += size - bytes(kept);
    running.tail.push(kept); running.tailBytes += bytes(kept);
    while (running.tailBytes > limits.commandTailBytes && running.tail.length > 1) { const old = running.tail.shift()!; running.tailBytes -= bytes(old); running.cutBytes += bytes(old); }
  }

  private start(tracking: Tracking, terminalId: string, line: string, folder: string, opener: string, fromScreen = false, screen?: Screen) {
    const limits = this.limits(), at = now();
    const inside = (root: string) => { const relative = path.relative(root, folder); return relative.startsWith('..') || path.isAbsolute(relative) ? null : relative; };
    const cwd = folder ? inside(this.root) ?? (this.realRoot ? inside(this.realRoot) : null) ?? folder : '';
    const by = tracking.typers.length ? [...tracking.typers] : tracking.lastTyper ? [tracking.lastTyper] : [opener];
    const command: TerminalCommand = { commandId: 'tc-' + randomBytes(8).toString('hex'), terminalId, command: Array.from(line).slice(0, limits.commandChars).join(''), cwd, by, enteredBy: tracking.lastTyper ?? by.at(-1)!,
      startedAt: at, endedAt: null, state: 'running', exit: null, output: '', outputBytes: 0, stored: false, storedBytes: 0, screens: 0, cut: false, problem: null };
    if (tracking.running) { tracking.running.last?.dispose(); Object.assign(tracking.running.command, { state: 'unknown', endedAt: at, problem: 'Another command started before its end was seen.' }); }
    // Under the console host, output starts below the row the command was typed on.
    const last = tracking.conpty && screen?.buffer.active.type === 'normal' ? screen.registerMarker(-1) : undefined;
    tracking.running = { command, head: [], headBytes: 0, tail: [], tailBytes: 0, cutBytes: 0, screens: [], fromScreen, ...(last ? { last } : {}) };
    tracking.typers = [];
    const commands = this.commands!;
    commands.push(command);
    while (commands.length > limits.maxCommands) { const old = commands.shift()!; if (old.stored) void this.outputFile(old.commandId).then(file => fs.rm(file, { force: true })).catch(() => {}); }
    void this.save(); this.changed();
  }

  // The command running ends: with a status, or (null) unseen. Its record says it ended once what
  // it printed is kept and the older output past the budget let go, so a reader that sees it ended
  // reads every record settled.
  async end(tracking: Tracking, status: number | null, problem?: string, screen?: Screen) {
    const running = tracking.running;
    if (!running) return;
    tracking.running = null;
    running.last?.dispose();
    tracking.continued?.marker.dispose(); tracking.continued = null;
    if (screen?.buffer.active.type === 'alternate') this.frame(screen, running);
    const command = running.command, limits = this.limits(), head = running.head.join(''), tail = running.tail.join(''), endedAt = now();
    const whole = (head + tail).replace(/\n$/, '');
    command.output = cutTo(head, limits.commandOutputBytes).replace(/\n$/, '');
    command.screens = running.screens.length; command.cut = running.cutBytes > 0;
    let lost: string | null = null;
    if (bytes(command.output) < bytes(whole) || running.screens.length) {
      const kept: Stored = { head, tail, cutBytes: running.cutBytes, screens: running.screens };
      const size = bytes(JSON.stringify(kept));
      command.stored = true; command.storedBytes = size;
      try { await atomicJson(await this.outputFile(command.commandId), kept); await this.budget(); }
      catch { command.stored = false; command.storedBytes = 0; lost = 'What it printed past the start could not be kept.'; }
    }
    Object.assign(command, status === null ? { state: 'unknown', exit: null, problem: problem ?? null } : { state: 'exited', exit: status }, { endedAt });
    if (lost) command.problem = lost;
    void this.save(); this.changed();
  }

  // The output files stay under outputStoreBytes: the oldest are let go.
  private async budget() {
    const limits = this.limits(), stored = this.commands!.filter(c => c.stored);
    let total = stored.reduce((sum, c) => sum + c.storedBytes, 0);
    for (const c of stored) {
      if (total <= limits.outputStoreBytes) break;
      await fs.rm(await this.outputFile(c.commandId), { force: true }).catch(() => {});
      total -= c.storedBytes; Object.assign(c, { stored: false, storedBytes: 0, screens: 0, problem: `Only the start of what it printed is kept: the terminals' kept output reached ${Math.round(limits.outputStoreBytes / 1048576)} MiB and older output went first.` });
    }
  }

  // A mark from the terminal's shell, read where it falls in the output. Marks without this
  // terminal's nonce are output like any other and change nothing.
  private mark(screen: Screen, terminalId: string, nonce: string, tracking: Tracking, opener: string, ready: () => void, data: string) {
    const [given, kind, ...rest] = data.split(';');
    if (given !== nonce || !this.commands) return;
    const b = screen.buffer.active;
    if (kind === 'S') {
      const [line = '', folder = ''] = rest.map(unescapeMark);
      tracking.prompt?.marker.dispose(); tracking.prompt = null;
      // The shell read the lines typed up to this one.
      const lines = tracking.lines ??= [], first = line.split('\n')[0]!.trim(), at = lines.findIndex(q => q.text.trim() === first);
      lines.splice(0, at >= 0 ? at + 1 : lines.length);
      this.start(tracking, terminalId, line, folder, opener, false, screen);
    } else if (kind === 'F') {
      // Back at a prompt with no line shown since the last: the shell read a line typed before
      // that prompt appeared and ran it without showing it.
      // What it printed then starts after that prompt.
      const prompt = tracking.prompt, continued = tracking.continued;
      let from: { line: number; col: number } | null = null;
      if (prompt && !tracking.running) {
        tracking.prompt = null;
        const got = this.read(tracking, prompt.seq, null);
        if (got?.text) { this.start(tracking, terminalId, got.text, prompt.cwd, opener, true); from = { line: prompt.marker.line, col: prompt.col }; }
        prompt.marker.dispose();
      } else if (continued && tracking.running) {
        tracking.continued = null;
        const got = this.read(tracking, continued.seq, null);
        if (got?.text) { this.more(tracking.running, got.text); from = { line: continued.marker.line, col: continued.col }; }
        continued.marker.dispose();
      }
      // A line the command printed without a final newline ends where the prompt begins. Under the
      // console host, the rows above it not taken yet come first.
      const running = tracking.running, y = b.baseY + b.cursorY;
      let taken = false;
      if (running && b.type === 'normal' && tracking.conpty) {
        let begins = y;
        while (begins > 0 && b.getLine(begins)?.isWrapped) begins--;
        this.rows(screen, running, begins - 1);
        taken = !!running.last && !running.last.isDisposed && running.last.line >= begins;
      }
      if (running && !taken && b.type === 'normal' && (!from || (from.line >= 0 && from.line <= y))) {
        const rows = from ? logical(b, y, from.line) : logical(b, y), last = text(rows, from?.col);
        if (last.trim()) this.line(running, withoutEndMark(rows, last).replace(/\s+$/, ''), false);
      }
      const known = !!rest[0] && /^\d+$/.test(rest[0]);
      void this.end(tracking, known ? Number(rest[0]) : null, known ? undefined : 'Its shell did not say how it ended.', screen);
      tracking.typers = [];
      ready();
    } else if (kind === 'B') {
      // An sh prompt ends here; the line typed after it is the command.
      tracking.prompt?.marker.dispose();
      const marker = !tracking.running && b.type === 'normal' ? screen.registerMarker(0) : undefined;
      tracking.prompt = marker ? { marker, col: b.cursorX, seq: tracking.seq ?? 0, cwd: unescapeMark(rest.join(';')) } : null;
    } else if (kind === 'C') {
      // An sh continuation prompt ends here: the command read from the screen goes on in the line
      // typed after it, while it has printed nothing. One before it with no line shown since: the
      // shell read a line typed earlier without showing it.
      const running = tracking.running, before = tracking.continued;
      tracking.continued = null; before?.marker.dispose();
      if (!running?.fromScreen || running.command.outputBytes) return;
      if (before) { const got = this.read(tracking, before.seq, null); if (got?.text) this.more(running, got.text); }
      const marker = b.type === 'normal' ? screen.registerMarker(0) : undefined;
      if (marker) tracking.continued = { marker, col: b.cursorX, seq: tracking.seq ?? 0 };
    }
  }
}
