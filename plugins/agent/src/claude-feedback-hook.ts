// Explicit Claude Code PostToolUse hook entry. The selected integration supplies
// a private descriptor outside project source. Stdout contains hook JSON only.
import fs from 'node:fs/promises';
const descriptor = process.env.RHO_ADAPTER_CONNECTION;
if (!descriptor) throw new Error('Set RHO_ADAPTER_CONNECTION to the private native adapter descriptor.');
const connection = JSON.parse(await fs.readFile(descriptor, 'utf8'));
const endpoint = new URL(connection.url);
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') throw new Error('Native feedback only supports the selected local service.');
async function call(method: string, values: any) {
  const response = await fetch(new URL('/api/adapter/' + method, endpoint), { method: 'POST', headers: { authorization: 'Bearer ' + connection.token, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: connection.projectId, registrationId: connection.registrationId, externalSessionId: connection.externalSessionId, ...values }), signal: AbortSignal.timeout(5000) });
  const result = await response.json() as any;
  if (!result.ok) throw new Error('Original feedback boundary is unavailable.');
  return result.value;
}
try {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 65536) throw new Error('Hook input exceeds 64 KiB.'); chunks.push(chunk); }
  const input = JSON.parse(Buffer.concat(chunks).toString());
  if (input.session_id !== connection.externalSessionId || input.hook_event_name !== 'PostToolUse' || typeof input.tool_use_id !== 'string') throw new Error('Hook changed native session or boundary.');
  const next = await call('feedback.next', { nativeToolUseId: input.tool_use_id });
  if (next.delivery) {
    const e = next.delivery;
    const additionalContext = 'A submitted question is available for this original business session. Fetch the complete frozen feedback operation feedback.read with ' + JSON.stringify({ taskId: e.taskId, deliveryId: e.deliveryId, contextId: e.contextId, fetchId: 'fetch:' + e.deliveryId, query: { after: 0, cursor: null, limit: 1, maxBytes: 16384 } }) + '. Resolve feedback.read using rho_index/rho_resolve, then rho_call with its complete contractRef. Use rho_read to page only the necessary fields when the reply carries a result reference. Preserve the related document\'s current version and human edits. Reply explicitly to the original message. Reading does not prove understanding.';
    await new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }), error => error ? reject(error) : resolve()));
    await call('feedback.emitted', { nativeToolUseId: input.tool_use_id, deliveryId: e.deliveryId });
  }
} catch { process.stderr.write('Native feedback observation unavailable; original delivery retained without re-emission.\n'); }
