import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeAcpConversation } from '../plugins/agent/dist/conversation.js';
const fixture = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url));
async function setup(extra = {}) {
  const root = await fs.mkdtemp('/tmp/rho-acp-owner-'), log = path.join(root, 'calls.jsonl');
  const options = { cwd: root, mcpServers: [], command: { file: process.execPath, args: [fixture] }, env: { ACP_TEST_LOG: log, ...extra }, limits: { maxAgentTurns: 8, maxOutputBytes: 32768, maxLineBytes: 4096, stopGraceMs: 100, connectTimeoutMs: 3000 } };
  const drivers = [];
  return { options, create(sessionId) { const driver = new ClaudeAcpConversation({ ...options, sessionId }); drivers.push(driver); return driver; },
    async calls() { return (await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse); },
    async close() { await Promise.all(drivers.map(x => x.close())); await fs.rm(root, { recursive: true, force: true }); } };
}
function turn(text, overrides = {}) {
  const events = [], identities = [], controller = new AbortController();
  return { events, identities, controller, request: { text, signal: controller.signal, async session(x) { identities.push(x); }, event(x) { events.push(x); }, async permission() { return 'allow'; }, ...overrides } };
}
test('ACP keeps one connection for multiple turns and loads only the recorded session after connection loss', async () => {
  const f = await setup();
  try {
    let driver = f.create(); const a = turn('hello 你好'), b = turn('again');
    assert.equal((await driver.run(a.request)).state, 'completed');
    assert.equal((await driver.run(b.request)).state, 'completed');
    assert.equal(a.identities[0].acpSessionId, 'original-session');
    assert.equal(a.identities[0].nativeSessionId, undefined, 'ACP identity is not fabricated as native identity');
    assert.equal((await f.calls()).filter(x => x.kind === 'spawn').length, 1);
    assert.ok(!JSON.stringify(a.events).includes('private reasoning'));
    const lost = turn('disconnect'); assert.equal((await driver.run(lost.request)).state, 'unknown');
    assert.ok(lost.events.some(x => x.step?.text === 'retained ')); await driver.close();
    driver = f.create('original-session'); const recovered = turn('new instruction');
    assert.equal((await driver.run(recovered.request)).state, 'completed');
    assert.ok(!JSON.stringify(recovered.events).includes('replayed history'));
    const calls = await f.calls();
    assert.equal(calls.filter(x => x.kind === 'session/new').length, 1);
    assert.equal(calls.filter(x => x.kind === 'session/load').length, 1);
    assert.equal(calls.filter(x => x.kind === 'effect').length, 1);
  } finally { await f.close(); }
});
test('ACP confirms cancellation from the original prompt response and keeps an unconfirmed stop unknown', async () => {
  for (const noAck of [false, true]) {
    const f = await setup(noAck ? { ACP_NO_CANCEL: '1' } : {});
    try {
      const driver = f.create(), t = turn('wait');
      t.request.event = e => { t.events.push(e); if (e.step?.id === 'slow') t.controller.abort(); };
      const result = await driver.run(t.request);
      assert.equal(result.state, noAck ? 'unknown' : 'stopped');
      if (!noAck) assert.equal(result.result.reason, 'cancelled');
      assert.equal((await f.calls()).filter(x => x.kind === 'session/prompt').length, 1);
    } finally { await f.close(); }
  }
});
test('ACP does not send a prompt before durable session acceptance and refuses unsupported loading', async () => {
  const f = await setup();
  try {
    const t = turn('must not run', { async session() { throw new Error('storage failed'); } });
    assert.equal((await f.create().run(t.request)).state, 'failed');
    assert.equal((await f.calls()).filter(x => x.kind === 'session/prompt').length, 0);
  } finally { await f.close(); }
  const g = await setup({ ACP_NO_LOAD: '1' });
  try {
    assert.equal((await g.create('original-session').run(turn('must not run').request)).state, 'failed');
    assert.equal((await g.calls()).filter(x => x.kind === 'session/new' || x.kind === 'session/prompt').length, 0);
  } finally { await g.close(); }
});
test('ACP forwards only offered permission choices and bounds output before an unterminated line grows', async () => {
  const f = await setup();
  try {
    const driver = f.create(); let permission;
    assert.equal((await driver.run(turn('permission', { async permission(p) { permission = p; return 'invented'; } }).request)).state, 'completed');
    assert.equal(permission.title, 'Write a test file');
    assert.equal((await f.calls()).find(x => x.kind === 'choice').result.outcome.outcome, 'cancelled');
    const t = turn('oversize');
    assert.equal((await driver.run(t.request)).state, 'unknown');
    assert.ok(t.events.some(x => x.type === 'limit' && x.reason === 'line-limit'));
  } finally { await f.close(); }
});
