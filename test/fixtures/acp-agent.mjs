// Protocol fault fixture. No model, user credentials or native Agent is involved.
import fs from 'node:fs';
import { createInterface } from 'node:readline';
const log = value => fs.appendFileSync(process.env.ACP_TEST_LOG, JSON.stringify(value) + '\n');
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const update = (sessionId, value) => send({ method: 'session/update', params: { sessionId, update: value } });
let active, permission;
log({ kind: 'spawn', pid: process.pid });
createInterface({ input: process.stdin }).on('line', line => {
  const r = JSON.parse(line), p = r.params;
  const reply = result => send({ id: r.id, result });
  if (!r.method) { if (permission) { log({ kind: 'choice', result: r.result }); permission(); permission = null; } return; }
  log({ kind: r.method, session: p?.sessionId, text: p?.prompt?.[0]?.text });
  if (r.method === 'initialize') return reply({ protocolVersion: 1, agentInfo: { name: 'fault-fixture', version: '1' }, agentCapabilities: { loadSession: !process.env.ACP_NO_LOAD } });
  if (r.method === 'session/new') return reply({ sessionId: 'original-session' });
  if (r.method === 'session/load') { update(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'replayed history' } }); return reply({}); }
  if (r.method === 'session/cancel') { if (active && !process.env.ACP_NO_CANCEL) { permission = null; send({ id: active, result: { stopReason: 'cancelled' } }); active = null; } return; }
  if (r.method === 'session/prompt') {
    active = r.id; const text = p.prompt[0].text;
    update(p.sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'private reasoning fixture' } });
    update(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'retained ' }, messageId: 'one' });
    if (text === 'disconnect') { log({ kind: 'effect' }); process.exit(7); }
    if (text === 'oversize') { process.stdout.write('x'.repeat(8192)); return; }
    if (text === 'wait') { update(p.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'slow', title: 'Waiting', status: 'in_progress' }); return; }
    if (text === 'permission') {
      permission = () => { update(p.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'tool', status: 'completed' }); active = null; reply({ stopReason: 'end_turn' }); };
      send({ id: 'permission-1', method: 'session/request_permission', params: { sessionId: p.sessionId, toolCall: { toolCallId: 'tool', title: 'Write a test file', status: 'pending' }, options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny', name: 'Reject', kind: 'reject_once' }] } }); return;
    }
    update(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text }, messageId: 'one' });
    active = null; reply({ stopReason: 'end_turn' });
  }
});
