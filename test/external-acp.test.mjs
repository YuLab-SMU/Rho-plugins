import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ExternalAcpObserver, readExternalAcp, externalAcpLimits } from '../plugins/agent/dist/external-acp.js';
const update = (o, sid, value) => o.agentMessage({ method: 'session/update', params: { sessionId: sid, update: value } });
function attach(o, root, sid, load = false) {
  o.client({ id: 1, method: load ? 'session/load' : 'session/new', params: { cwd: root, ...(load ? { sessionId: sid } : {}) } });
  o.agentMessage({ id: 1, result: load ? {} : { sessionId: sid } });
}
test('external ACP preserves source identity, replay and original-client permissions without creating a conversation', async () => {
  const root = await fs.mkdtemp('/tmp/rho-external-acp-'); let o, faults = 0;
  try {
    assert.deepEqual(readExternalAcp(root), { sessions: [], omitted: 0 });
    await assert.rejects(fs.stat(path.join(root, '.rho')), { code: 'ENOENT' });
    o = new ExternalAcpObserver(root, 'codex', () => faults++); attach(o, root, 'native-session');
    o.client({ id: 2, method: 'session/prompt', params: { sessionId: 'native-session', prompt: [{ type: 'text', text: 'PRIVATE PROMPT' }] } });
    update(o, 'native-session', { sessionUpdate: 'plan', entries: [{ content: 'Read input 你好', status: 'in_progress', priority: 'high' }] });
    update(o, 'native-session', { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'PRIVATE REASONING' } });
    update(o, 'native-session', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Public reply 你好' } });
    o.agentMessage({ id: 'choice', method: 'session/request_permission', params: { sessionId: 'native-session', toolCall: { title: 'PRIVATE TOOL INPUT' }, options: [] } });
    let first = readExternalAcp(root).sessions[0]; assert.equal(first.pendingPermissions, 1); assert.equal(first.state, 'running');
    o.client({ id: 'choice', result: { outcome: { outcome: 'cancelled' } } });
    o.agentMessage({ id: 2, result: { stopReason: 'cancelled' } });
    first = readExternalAcp(root).sessions[0]; assert.equal(first.state, 'stopped'); assert.equal(first.pendingPermissions, 0); assert.equal(first.prompts, 1);
    assert.equal(first.lastMessage, 'Public reply 你好'); assert.ok(!JSON.stringify(first).includes('PRIVATE'));
    o.close(); assert.equal(readExternalAcp(root).sessions[0].connected, false);
    o = new ExternalAcpObserver(root, 'codex', () => faults++);
    o.client({ id: 1, method: 'session/load', params: { sessionId: 'native-session', cwd: root } });
    update(o, 'native-session', { sessionUpdate: 'plan', entries: [{ content: 'Loaded plan', status: 'completed', priority: 'low' }] });
    o.agentMessage({ id: 1, result: {} });
    const loaded = readExternalAcp(root).sessions[0]; assert.equal(loaded.id, first.id); assert.equal(loaded.prompts, 1);
    assert.ok(loaded.observation.sequence > first.observation.sequence); assert.equal(loaded.observation.plan.origin, 'history');
    o.client({ id: 3, method: 'session/prompt', params: { sessionId: 'native-session' } }); o.close();
    assert.equal(readExternalAcp(root).sessions[0].state, 'unknown'); assert.equal(faults, 0);
  } finally { o?.close(); await fs.rm(root, { recursive: true, force: true }); }
});
test('external observation refuses other projects, symlink stores and simultaneous writers; bounds retained messages', async () => {
  const root = await fs.mkdtemp('/tmp/rho-external-scope-'), other = await fs.mkdtemp('/tmp/rho-external-other-'); let a,b,c;
  try {
    a = new ExternalAcpObserver(root, 'claude'); attach(a, other, 'outside'); assert.equal(readExternalAcp(root).sessions.length, 0);
    attach(a, root, 'ours'); let failed = 0;
    b = new ExternalAcpObserver(root, 'claude', () => failed++); attach(b, root, 'ours'); assert.equal(failed, 1); b.close();
    a.client({ id: 2, method: 'session/prompt', params: { sessionId: 'ours' } });
    update(a, 'ours', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'a'.repeat(externalAcpLimits.maxMessageChars + 20) } });
    a.agentMessage({ id: 2, result: { stopReason: 'end_turn' } });
    const kept = readExternalAcp(root).sessions[0]; assert.equal(kept.lastMessage.length, externalAcpLimits.maxMessageChars); assert.equal(kept.omittedMessageChars, 20);
    a.close(); await fs.mkdir(path.join(other, '.rho')); await fs.symlink(path.join(root, '.rho/agent'), path.join(other, '.rho/agent'));
    assert.throws(() => c = new ExternalAcpObserver(other, 'codex'), /outside/);
    assert.equal(readExternalAcp(other).sessions.length, 0);
  } finally { a?.close(); b?.close(); c?.close(); await fs.rm(root, { recursive: true, force: true }); await fs.rm(other, { recursive: true, force: true }); }
});
