import { groupAlive, signalGroup } from './process-group.js';

/** End only the stdio process group created by this plugin. A wrapper exiting
 * does not establish that its native runtime exited; retain escalation until the
 * owned group is gone or the grace period ends. Detached native jobs are separate.
 * On Windows the group is the processes on the wrapper's console when it was signalled. */
export async function stopAcpProcess(pid: number, graceMs: number) {
  const members = await signalGroup(pid, 'SIGTERM'); const deadline = Date.now() + graceMs;
  while (groupAlive(pid, members) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  if (groupAlive(pid, members)) await signalGroup(pid, 'SIGKILL', { members });
}
