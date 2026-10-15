import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest, readJson, requireThat, stateDirectory } from './common.js';
// The adapter is a caller too: freeze its managed intent before the first HTTP
// delivery, independent of whether the external conversation is persisted.
export async function retainAgentIntent(descriptor: string, connection: { projectId: string; externalSessionId: string }, method: string, input: Record<string, unknown>, maxIntents = 256) {
  if (!['action.submit', 'requirements.prepare'].includes(method)) return;
  requireThat(typeof input.operationId === 'string' && /^[A-Za-z0-9._:@-]{1,128}$/.test(input.operationId), 'invalid', 'Choose and retain an operationId before managed delivery.');
  requireThat(Number.isSafeInteger(maxIntents) && maxIntents > 0, 'invalid', 'Invalid Agent intent budget.');
  const owner = await fs.realpath(path.dirname(descriptor));
  const directory = await stateDirectory(owner, 'mcp-intents-' + digest(canonical([connection.projectId, connection.externalSessionId])));
  const intent = { method, input: { ...input, projectId: connection.projectId } };
  async function confirmed() { const d = await fs.open(directory, 'r'); try { await d.sync(); } finally { await d.close(); } }
  function same(existing: any) {
    if (existing?.input?.operationId !== input.operationId) return false;
    requireThat(canonical(existing) === canonical(intent), 'conflict', 'This operationId already names a different retained Agent intent.');
    return true;
  }
  // Existing identities remain usable even after the operator lowers the budget.
  for (const name of (await fs.readdir(directory)).filter(n => /^\d+\.json$/.test(n))) if (same(await readJson(path.join(directory, name)))) return confirmed();
  const temporary = path.join(directory, randomUUID() + '.tmp');
  const h = await fs.open(temporary, 'wx', 0o600);
  try { await h.writeFile(JSON.stringify(intent) + '\n'); await h.sync(); } finally { await h.close(); }
  try {
    // Fixed write-once slots bound concurrent processes as well as sequential
    // calls. A collision is read before proceeding, so the same identity cannot
    // occupy a later slot or replace the winning bytes.
    for (let slot = 0; slot < maxIntents; slot++) {
      const file = path.join(directory, String(slot).padStart(6, '0') + '.json');
      try { await fs.link(temporary, file); }
      catch (e: any) { if (e.code !== 'EEXIST') throw e; if (same(await readJson(file))) return confirmed(); continue; }
      await confirmed();
      return;
    }
    requireThat(false, 'limit', 'Agent managed-intent retention is full; earlier identities are retained.', { limit: 'maxAgentIntents', maximum: maxIntents });
  } finally { await fs.rm(temporary, { force: true }); }
}
