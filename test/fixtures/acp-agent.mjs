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
  log({ kind: r.method, session: p?.sessionId, text: p?.prompt?.[0]?.text, ...(r.method === 'session/new' ? { claudeMetadata: !!p?._meta?.claudeCode } : {}) });
  if (r.method === 'initialize') return reply({ protocolVersion: 1, agentInfo: { name: 'fault-fixture', version: '1' }, agentCapabilities: { loadSession: !process.env.ACP_NO_LOAD, ...(process.env.ACP_CAN_CLOSE ? { sessionCapabilities: { close: {} } } : {}) } });
  if (r.method === 'session/close') return reply({});
  if (r.method === 'session/new') return reply({ sessionId: 'original-session' });
  if (r.method === 'session/load') { update(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'replayed history' } }); update(p.sessionId, { sessionUpdate: 'plan', entries: [{ content: 'Historical plan', priority: 'medium', status: 'completed' }] }); return reply({}); }
  if (r.method === 'session/cancel') { if (active && !process.env.ACP_NO_CANCEL) { permission = null; send({ id: active, result: { stopReason: 'cancelled' } }); active = null; } return; }
  if (r.method === 'session/prompt') {
    active = r.id; const text = p.prompt[0].text;
    if (text === 'wrong-session') { update('different-session', { sessionUpdate: 'plan', entries: [] }); return; }
    if (text === 'observe') {
      update(p.sessionId, { sessionUpdate: 'plan', entries: [{ content: 'Read shared notes 你好', priority: 'high', status: 'in_progress' }] });
      update(p.sessionId, { sessionUpdate: 'usage_update', used: 128, size: 4096, cost: { amount: 0.125, currency: 'EUR' } });
      update(p.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'read-notes', title: 'Read the shared notes', name: 'Read', kind: 'read', status: 'in_progress', rawInput: { file_path: process.cwd() + '/project-notes.md' }, locations: [{ path: process.cwd() + '/project-notes.md' }] });
      update(p.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'run-analysis', title: 'Run the analysis', kind: 'execute', status: 'in_progress', rawInput: { command: 'Rscript analysis.R --input data.csv' } });
      setTimeout(() => {
        update(p.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'read-notes', status: 'completed' });
        update(p.sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'run-analysis', status: 'failed' });
        update(p.sessionId, { sessionUpdate: 'plan', entries: [{ content: 'Idle replacement', priority: 'low', status: 'completed' }] });
        update(p.sessionId, { sessionUpdate: 'session_info_update', title: 'Idle title 你好' });
      }, 40);
    }
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
