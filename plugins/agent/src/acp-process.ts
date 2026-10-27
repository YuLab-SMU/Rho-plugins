/** End only the stdio process group created by this plugin. A wrapper exiting
 * does not establish that its native runtime exited; retain escalation until the
 * owned group is gone or the grace period ends. Detached native jobs are separate. */
export async function stopAcpProcess(pid: number, graceMs: number) {
  const signal = (name: NodeJS.Signals) => { try { process.kill(-pid, name); } catch {} };
  const alive = () => { try { process.kill(-pid, 0); return true; } catch { return false; } };
  signal('SIGTERM'); const deadline = Date.now() + graceMs;
  while (alive() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  if (alive()) signal('SIGKILL');
}
