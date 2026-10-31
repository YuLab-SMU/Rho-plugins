import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { requireThat } from '@rho-workspace/plugin-contracts';
export { destinationPattern, folderPattern, placeIdPattern, serverPattern } from './contract.js';

// Where a live session runs: this machine, or a folder on another machine, reached as the person
// reaches it. A server the person manages with serverctl is reached through serverctl, which
// holds its login, its host keys and its shared connection (servers.ts). Another is reached with
// ssh as the person's own ssh setup reaches it (their config, keys and agent), in batch mode, so
// it never asks for a password or a new host key. When either cannot log in it says why, and
// that is what is shown. Connections to one server are shared, so listing its files or
// interrupting a cell does not log in again. What the server's login shell prints on the way in
// is not taken as an answer. How a server is used beyond that (its environments, where heavy work
// goes) is not written here: it is the server's own skills', and a place's setup lines carry it.
export interface Place { placeId: string; label: string; via: 'ssh' | 'serverctl'; destination: string; folder: string; setup: string; by: string; at: string; check: PlaceCheck | null }
// What one connection observed: the system, the machine's name, the folder as the server
// resolved it (null when it is not there), R and Python with the packages a session needs.
export interface PlaceCheck {
  at: string; by: string; ok: boolean; ms: number; system: string | null; host: string | null; folder: string | null;
  r: string | null; jsonlite: boolean | null; python: string | null; matplotlib: boolean | null; problem: string | null;
}
export interface RemoteEntry { name: string; kind: 'folder' | 'file' | 'link' | 'other'; bytes: number; modifiedAt: string | null }
export interface Copy { placeId: string; path: string; to: string; bytes: number; modifiedAt: string | null; sha256: string; copiedAt: string; by: string }

const marker = '\x1eRHO\x1e';

export const quote = (text: string) => "'" + text.replace(/'/g, `'\\''`) + "'";
// The folder as the server's shell names it, with ~ as the account's home.
const folderIn = (folder: string) => folder === '~' ? '"$HOME"' : folder.startsWith('~/') ? '"$HOME"/' + quote(folder.slice(2)) : quote(folder);
// A command on the server, as its words.
export type Remote = string[];
// A login shell, as the person's own terminal on the server has: module systems and conda set
// up R and Python there, and a plain command often does not find them.
const login = (script: string): Remote => ['bash', '-lc', script];

export interface RemoteRun { code: number | null; signal: NodeJS.Signals | null; out: Buffer; err: string; cut: boolean; timedOut: boolean }
export interface RunLimits { timeoutMs: number; maxBytes: number; input?: string | Buffer }
// How a place's server is reached: a session's process, and one command with what it printed.
export interface Transport {
  readonly program: string;
  spawn(place: Pick<Place, 'destination'>, command: Remote, cwd: string): Promise<ChildProcess>;
  run(place: Pick<Place, 'destination'>, command: Remote, limits: RunLimits): Promise<RemoteRun>;
}

// A program run here, with what it printed kept up to maxBytes. Past the time, it and what it
// started (ssh under serverctl) are ended together.
export function runProgram(program: string, args: string[], limits: RunLimits) {
  const child = spawn(program, args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  return new Promise<RemoteRun>(resolve => {
    const out: Buffer[] = []; let bytes = 0, err = '', cut = false, timedOut = false;
    const end = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const timer = setTimeout(() => { timedOut = true; end(); }, limits.timeoutMs);
    child.stdout!.on('data', (chunk: Buffer) => {
      if (cut) return;
      if (bytes + chunk.length > limits.maxBytes) { out.push(chunk.subarray(0, limits.maxBytes - bytes)); bytes = limits.maxBytes; cut = true; end(); return; }
      out.push(chunk); bytes += chunk.length;
    });
    child.stderr!.setEncoding('utf8'); child.stderr!.on('data', (text: string) => { if (err.length < 4096) err += text; });
    child.stdin!.on('error', () => {});
    child.on('error', error => { err += (error as NodeJS.ErrnoException).code === 'ENOENT' ? `${program} was not found.` : error.message; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, out: Buffer.concat(out), err, cut, timedOut }); });
    child.stdin!.end(limits.input ?? '');
  });
}

export class Ssh implements Transport {
  constructor(readonly program = 'ssh', private options: { connectTimeoutS: number; aliveIntervalS: number; aliveCountMax: number } = { connectTimeoutS: 15, aliveIntervalS: 15, aliveCountMax: 4 }) {}
  // Shared connections live in a folder of this user's own; ssh's socket paths must be short.
  private async control() {
    const uid = process.getuid?.() ?? 0, folder = path.join('/tmp', `rho-ssh-${uid}`);
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const st = await fs.lstat(folder);
    requireThat(st.isDirectory() && st.uid === uid && (st.mode & 0o077) === 0, 'condition', `${folder} must be a folder only this user can open; it holds shared ssh connections.`);
    return folder;
  }
  // ssh hands the command to the account's shell there as one line.
  async args(place: Pick<Place, 'destination'>, command: Remote) {
    const o = this.options;
    return ['-T', '-o', 'BatchMode=yes', '-o', `ConnectTimeout=${o.connectTimeoutS}`, '-o', `ServerAliveInterval=${o.aliveIntervalS}`, '-o', `ServerAliveCountMax=${o.aliveCountMax}`,
      '-o', 'ControlMaster=auto', '-o', `ControlPath=${await this.control()}/%C`, '-o', 'ControlPersist=60', '--', place.destination, command.map(w => /^[A-Za-z0-9_.\/-]+$/.test(w) ? w : quote(w)).join(' ')];
  }
  async spawn(place: Pick<Place, 'destination'>, command: Remote, cwd: string): Promise<ChildProcess> {
    return spawn(this.program, await this.args(place, command), { cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  async run(place: Pick<Place, 'destination'>, command: Remote, limits: RunLimits) { return runProgram(this.program, await this.args(place, command), limits); }
}

// What a failed connection said, as ssh or serverctl said it: its last lines.
export const said = (run: RemoteRun, what: string) => {
  if (run.timedOut) return `${what} took too long; the connection was ended.`;
  const lines = run.err.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Warning: Permanently added'));
  return lines.length ? lines.slice(-3).join(' ') : `${what} ended with exit ${run.code ?? run.signal}.`;
};
// What follows the marker the script printed, past anything the login shell printed first.
const after = (out: Buffer) => { const at = out.indexOf(marker); return at < 0 ? null : out.subarray(at + Buffer.byteLength(marker)); };

// Text from a session is UTF-8, so what it lists and prints keeps its characters. A login whose
// character set is not (no locale set, or one the server does not have) takes a UTF-8 character
// type the server has, as a terminal set up for UTF-8 there would; LC_ALL, when set, is kept.
const utf8 = `case "$(locale charmap 2>/dev/null)" in UTF-8|utf8) ;; *) if [ -z "$LC_ALL" ]; then for l in C.UTF-8 C.utf8 en_US.UTF-8 en_US.utf8; do if locale -a 2>/dev/null | grep -qx "$l"; then export LC_CTYPE="$l"; break; fi; done; fi;; esac`;
// The session's command: the runner, sent first on the session's own input and kept in the
// account's cache folder under its digest; into the folder, the place's own setup lines (module
// load, conda activate) there, and then the runner, its answers on standard output and what the
// code prints on standard error: ssh carries two streams back, and the answers need their own.
export function sessionCommand(place: Place, program: string, runner: string, bytes: number) {
  return login(`f="$HOME"/${quote(runner)}; mkdir -p "$(dirname "$f")" && head -c ${bytes} > "$f.$$" && mv -f "$f.$$" "$f" || exit 96
cd -- ${folderIn(place.folder)} || exit 97
${place.setup}
cd -- ${folderIn(place.folder)} || exit 97
${utf8}
exec ${program} "$f" "$PWD" 3>&1 1>&2`);
}
// A signal to the session's process group, which holds what its code started.
export function signalCommand(pid: number, signal: NodeJS.Signals): Remote {
  // dash, a common sh, takes no "--" here.
  return ['sh', '-c', `g=$(ps -o pgid= -p ${pid} 2>/dev/null | tr -d ' '); [ -n "$g" ] && kill -${signal.replace(/^SIG/, '')} -"$g"`];
}

export function checkCommand(place: Place) {
  const r = quote('cat(R.version.string, requireNamespace("jsonlite", quietly = TRUE), sep = "\\t")');
  const python = quote('import sys, importlib.util as u; print("Python " + sys.version.split()[0], u.find_spec("matplotlib") is not None, sep="\\t")');
  return login(String.raw`if cd -- ${folderIn(place.folder)} 2>/dev/null; then f=$(pwd -P); else f=; fi
${place.setup}
${utf8}
printf '\036RHO\036\n'
printf 'system\t%s\n' "$(uname -sm 2>/dev/null)"
printf 'host\t%s\n' "$(uname -n 2>/dev/null)"
printf 'folder\t%s\n' "$f"
if command -v Rscript >/dev/null 2>&1; then printf 'r\t%s\n' "$(Rscript -e ${r} 2>/dev/null)"; fi
if command -v python3 >/dev/null 2>&1; then printf 'python\t%s\n' "$(python3 -c ${python} 2>/dev/null)"; fi`);
}
export function readCheck(run: RemoteRun): Omit<PlaceCheck, 'at' | 'by' | 'ms'> {
  const body = after(run.out);
  if (!body) return { ok: false, system: null, host: null, folder: null, r: null, jsonlite: null, python: null, matplotlib: null, problem: said(run, 'Connecting') };
  const facts = new Map(body.toString('utf8').split('\n').map(line => [line.slice(0, line.indexOf('\t')), line.slice(line.indexOf('\t') + 1)] as const));
  const [r, jsonlite] = (facts.get('r') ?? '').split('\t'), [python, matplotlib] = (facts.get('python') ?? '').split('\t');
  const folder = facts.get('folder') || null;
  return { ok: !!folder, system: facts.get('system') || null, host: facts.get('host') || null, folder, r: r || null, jsonlite: r ? jsonlite === 'TRUE' : null,
    python: python || null, matplotlib: python ? matplotlib === 'True' : null, problem: folder ? null : 'The folder is not on the server, or this account cannot open it.' };
}

// A folder within the place's folder: its entries, folders first. A path that leads out of the
// place's folder, through a link among others, is refused: links do not widen what is read.
export function listCommand(place: Place, sub: string) {
  return login(String.raw`cd -- ${folderIn(place.folder)} || exit 97
base=$(pwd -P)
cd -- ${quote(sub || '.')} || exit 98
here=$(pwd -P)
case "$here" in "$base"|"$base"/*) ;; *) exit 95;; esac
printf '\036RHO\036%s\n' "$here"
if find . -maxdepth 0 -printf '' >/dev/null 2>&1; then find . -mindepth 1 -maxdepth 1 -printf '%y\t%s\t%T@\t%P\0'
else for f in * .[!.]* ..?*; do if [ -e "$f" ] || [ -h "$f" ]; then stat -f '%HT%t%z%t%m%t%N' -- "$f"; printf '\0'; fi; done; fi`);
}
const kinds: Record<string, RemoteEntry['kind']> = { d: 'folder', f: 'file', l: 'link', Directory: 'folder', 'Regular File': 'file', 'Symbolic Link': 'link' };
export function readList(run: RemoteRun, maxEntries: number) {
  const body = after(run.out);
  requireThat(body, run.code === 95 ? 'scope' : 'unavailable', run.code === 95 ? 'That folder leads outside the place\'s folder; links do not widen what is read there.'
    : run.code === 98 ? 'That folder is not on the server.' : said(run, 'Listing the folder'));
  const newline = body.indexOf('\n'), folder = body.subarray(0, newline).toString('utf8');
  const entries: RemoteEntry[] = [];
  for (const record of body.subarray(newline + 1).toString('utf8').split('\0')) {
    const [kind, size, mtime, ...name] = record.replace(/\n$/, '').split('\t');
    if (!name.length || !name.join('\t')) continue;
    // Whole seconds, as a copy records the file's time.
    const seconds = Math.floor(Number(mtime));
    entries.push({ name: name.join('\t'), kind: kinds[kind!] ?? 'other', bytes: Number(size) || 0, modifiedAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null });
  }
  entries.sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name));
  return { folder, entries: entries.slice(0, maxEntries), omitted: Math.max(0, entries.length - maxEntries), cut: run.cut };
}

// One regular file within the place's folder, not a link, its size and time first. A file
// larger than maxBytes is not sent.
export function copyCommand(place: Place, file: string, maxBytes: number) {
  return login(String.raw`cd -- ${folderIn(place.folder)} || exit 97
base=$(pwd -P)
f=${quote(file)}
cd -- "$(dirname -- "$f")" || exit 98
here=$(pwd -P)
case "$here" in "$base"|"$base"/*) ;; *) exit 95;; esac
n=$(basename -- "$f")
[ -h "$n" ] && exit 93
[ -f "$n" ] || exit 94
s=$(stat -c '%s %Y' -- "$n" 2>/dev/null || stat -f '%z %m' -- "$n")
printf '\036RHO\036%s\n' "$s"
set -- $s
[ "$1" -le ${maxBytes} ] || exit 92
exec cat -- "$n"`);
}
export function readCopy(run: RemoteRun, maxBytes: number) {
  const body = after(run.out);
  const why: Record<number, [string, string]> = { 93: ['scope', 'That is a link; links do not widen what is read there.'], 94: ['not_found', 'That is not a file on the server.'], 95: ['scope', 'That file is outside the place\'s folder.'], 98: ['not_found', 'That file is not on the server.'] };
  if (run.code !== null && why[run.code]) requireThat(false, why[run.code]![0], why[run.code]![1]);
  requireThat(body, 'unavailable', said(run, 'Copying the file'));
  const newline = body.indexOf('\n'), [size, mtime] = body.subarray(0, newline).toString('utf8').trim().split(/\s+/).map(Number);
  requireThat(run.code !== 92, 'limit', `The file is ${size} bytes; files larger than ${maxBytes} bytes stay on the server.`, { limit: 'remoteCopyBytes', maximum: maxBytes });
  const data = body.subarray(newline + 1);
  requireThat(run.code === 0 && !run.cut && data.length === size, 'unavailable', run.code === 0 ? `The file changed while it was copied (${data.length} of ${size} bytes arrived); copy it again.` : said(run, 'Copying the file'));
  return { data, modifiedAt: Number.isFinite(mtime) && mtime! > 0 ? new Date(mtime! * 1000).toISOString() : null };
}
