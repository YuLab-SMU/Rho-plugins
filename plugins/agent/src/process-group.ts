import { execFile, type SpawnOptions } from 'node:child_process';
import path from 'node:path';

// A process and what it starts, run so they can be interrupted and ended together. On Unix that is
// a process group of its own. Windows has no process group a signal can name; there the process
// gets a console of its own without a window (windowsHide, with no stdio inherited). What it starts
// shares that console, so no window opens, and a console control event reaches all of them.
export const ownGroup: Pick<SpawnOptions, 'detached' | 'windowsHide'> = process.platform === 'win32' ? { windowsHide: true } : { detached: true };

export type GroupSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL';
const system32 = (file: string) => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', file);
// Raises a console control event (0 Ctrl+C, 1 Ctrl+Break) on the console of a process: attaches to
// it, keeps the event from ending this helper, names the processes there and raises the event for
// all of them. It prints their ids and exits 0 when the event was raised, else the Windows error.
const consoleScript = (pid: number, ctrl: 0 | 1) => `Add-Type -Namespace Rho -Name ConsoleEvent -MemberDefinition @'
public delegate bool Handler(uint ctrl);
static readonly Handler Keep = ctrl => true;
[DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();
[DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll", SetLastError = true)] static extern bool SetConsoleCtrlHandler(Handler handler, bool add);
[DllImport("kernel32.dll", SetLastError = true)] static extern uint GetConsoleProcessList(uint[] ids, uint count);
[DllImport("kernel32.dll", SetLastError = true)] static extern bool GenerateConsoleCtrlEvent(uint ctrl, uint group);
public static int Raise(uint pid, uint ctrl, System.IO.TextWriter output) {
  FreeConsole();
  if (!AttachConsole(pid)) return Marshal.GetLastWin32Error();
  SetConsoleCtrlHandler(Keep, true);
  uint[] ids = new uint[1024];
  uint count = GetConsoleProcessList(ids, (uint)ids.Length);
  uint self = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
  for (uint i = 0; i < count && i < ids.Length; i++) if (ids[i] != self) output.Write(ids[i] + " ");
  int error = GenerateConsoleCtrlEvent(ctrl, 0) ? 0 : Marshal.GetLastWin32Error();
  // The event reaches this process too, on a thread of its own; let it pass before detaching.
  System.Threading.Thread.Sleep(100);
  FreeConsole();
  return error;
}
'@
exit [Rho.ConsoleEvent]::Raise(${pid}, ${ctrl}, [Console]::Out)`;
const run = (file: string, args: string[], timeoutMs: number) => new Promise<{ ok: boolean; out: string }>(resolve => {
  execFile(file, args, { windowsHide: true, timeout: timeoutMs }, (error, out) => resolve({ ok: !error, out }));
});

/** Signals a process started with ownGroup and what it started, and resolves the members the
 * signal reached as far as they are known: none on Unix, where the group itself is named. Windows
 * has no signals. There SIGINT and SIGTERM raise Ctrl+Break on the process's console, which ends
 * most console programs and which an R session takes as an interrupt; with ctrlC SIGINT raises
 * Ctrl+C, which a process that turned its own Ctrl+C handling back on (the Python session) takes
 * at once, even in a wait. They resolve the processes that were on that console. SIGKILL ends the
 * process with the processes it started, and the members given (taskkill /T /F). Nothing here
 * waits for anything to end. */
export async function signalGroup(pid: number, signal: GroupSignal, { members = [], ctrlC = false, timeoutMs = 20000 }: { members?: number[]; ctrlC?: boolean; timeoutMs?: number } = {}): Promise<number[]> {
  if (process.platform !== 'win32') { try { process.kill(-pid, signal); } catch { /* it has ended */ } return []; }
  if (signal === 'SIGKILL') {
    await run(system32('taskkill.exe'), ['/T', '/F', ...[pid, ...members.filter(m => m !== pid)].flatMap(id => ['/PID', String(id)])], timeoutMs);
    return [];
  }
  const script = consoleScript(pid, signal === 'SIGINT' && ctrlC ? 0 : 1);
  const raised = await run(system32('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], timeoutMs);
  return raised.out.split(/\s+/).filter(Boolean).map(Number).filter(Number.isSafeInteger);
}

/** Whether a process started with ownGroup, or one of its group, is still there. Windows can only
 * tell for the process itself and for the members a signal resolved. */
export function groupAlive(pid: number, members: number[] = []) {
  const alive = (id: number) => { try { process.kill(id, 0); return true; } catch { return false; } };
  return process.platform === 'win32' ? [pid, ...members].some(alive) : alive(-pid);
}
