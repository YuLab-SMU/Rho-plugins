// Explicit, bounded coordination process. It neither owns native execution nor
// starts/resumes Claude. The private descriptor selects at most 16 project/session
// targets; all records and deduplication remain in the Agent owner via Rho.
import fs from 'node:fs/promises';
const file = process.env.RHO_ADAPTER_CONNECTION;
if (!file) throw new Error('Select a private native adapter descriptor.');
const raw = JSON.parse(await fs.readFile(file, 'utf8')), connections = Array.isArray(raw) ? raw : [raw];
if (!connections.length || connections.length > 16) throw new Error('Worker protects at most 16 selected project/session connections.');
for (const connection of connections) { const url = new URL(connection.url); if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Only the selected local service is supported.'); }
const maxCycles = Number(process.env.RHO_FEEDBACK_WORKER_MAX_CYCLES ?? 1200), maxMs = Number(process.env.RHO_FEEDBACK_WORKER_MAX_MS ?? 600000);
if (!Number.isSafeInteger(maxCycles) || maxCycles < 1 || maxCycles > 100000 || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 43200000) throw new Error('Worker cycle/time budgets are invalid.');
let stopping = false, cycles = 0, acceptSteps = 0, lookupSteps = 0, unknown = 0;
process.on('SIGTERM', () => { stopping = true; }); process.on('SIGINT', () => { stopping = true; });
async function call(connection: any, method: string, input: any = {}) {
  const response = await fetch(new URL('/api/adapter/' + method, connection.url), { method: 'POST', headers: { authorization: 'Bearer ' + connection.token, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: connection.projectId, registrationId: connection.registrationId, externalSessionId: connection.externalSessionId, ...input }), signal: AbortSignal.timeout(Math.max(1, Math.min(6000, maxMs - (Date.now() - started)))) });
  const result = await response.json() as any;
  if (!result.ok) throw new Error('Selected original delivery cannot currently be observed.');
  return result.value;
}
const started = Date.now();
while (!stopping && cycles < maxCycles && Date.now() - started < maxMs) {
  cycles++;
  for (const connection of connections) {
    if (stopping || Date.now() - started >= maxMs) break;
    try {
      const pending = await call(connection, 'feedback.pending');
      if (!Array.isArray(pending) || pending.length > 128) throw new Error('Pending original delivery list exceeds its bound.');
      for (const item of pending) {
        if (stopping || Date.now() - started >= maxMs) break;
        const value = await call(connection, 'feedback.step', { submissionId: item.submissionId });
        if (value.action === 'accept') acceptSteps++; else if (value.action === 'lookup') lookupSteps++;
        if (value.state === 'unknown') unknown++;
      }
    } catch { unknown++; }
  }
  if (!stopping && cycles < maxCycles && Date.now() - started < maxMs) await new Promise(resolve => setTimeout(resolve, 500));
}
process.stdout.write(JSON.stringify({ stopped: stopping ? 'requested' : 'budget-reached', cycles, acceptSteps, lookupSteps, unknown, retained: 'Original delivery identities and uncertainty remain with the owner; no native replay.' }) + '\n');
