import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeAcpConversation, CodexAcpConversation } from '../plugins/agent/dist/conversation.js';
const fixture = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url));
async function setup(extra = {}) {
  const root = await fs.mkdtemp('/tmp/rho-acp-owner-'), log = path.join(root, 'calls.jsonl');
  const options = { cwd: root, mcpServers: [], command: { file: process.execPath, args: [fixture] }, env: { ACP_TEST_LOG: log, ...extra }, limits: { maxAgentTurns: 8, maxOutputBytes: 32768, maxLineBytes: 4096, stopGraceMs: 100, connectTimeoutMs: 3000 } };
  const drivers = [];
  return { options, create(sessionId, overrides = {}) { const driver = new ClaudeAcpConversation({ ...options, sessionId, ...overrides }); drivers.push(driver); return driver; },
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
test('session projection observes idle updates, separates replay, replaces plans and keeps native currency', async () => {
  const f = await setup(), observations = [];
  try {
    let acknowledged = false;
    const driver = f.create(undefined, { observe: value => { assert.ok(acknowledged); observations.push(value); } });
    const t = turn('observe', { async session() { acknowledged = true; } });
    assert.equal((await driver.run(t.request)).state, 'completed');
    // Tool steps retain what the Agent is doing: its own title, the ACP category
    // and one identifying input, never raw tool output.
    const read = t.events.find(e => e.step?.id === 'read-notes').step;
    assert.equal(read.title, 'Read the shared notes'); assert.equal(read.toolKind, 'read');
    assert.match(read.detail, /project-notes\.md$/);
    const run = t.events.find(e => e.step?.id === 'run-analysis').step;
    assert.equal(run.toolKind, 'execute'); assert.equal(run.detail, 'Rscript analysis.R --input data.csv');
    const turnEvents = structuredClone(t.events);
    // The next message's durable acknowledgement may overlap a late update from
    // the previous turn. Reusing a connection is not a history replay phase.
    await driver.run(turn('reuse', { async session() { await new Promise(r => setTimeout(r, 80)); } }).request);
    for (let i = 0; i < 100 && observations.at(-1)?.info?.title !== 'Idle title 你好'; i++) await new Promise(r => setTimeout(r, 10));
    let last = observations.at(-1);
    assert.equal(last.info.title, 'Idle title 你好'); assert.equal(last.plan.entries.length, 1); assert.equal(last.plan.entries[0].content, 'Idle replacement');
    assert.equal(last.plan.origin, 'live'); assert.equal(last.usage.cost.currency, 'EUR');
    assert.equal(last.tools[0].outcome, 'returned'); assert.equal(last.tools[0].locations.length, 1);
    assert.deepEqual(t.events, turnEvents, 'idle observation does not mutate the ended turn');
    assert.ok(!JSON.stringify(observations).includes('private reasoning')); assert.ok(last.unrepresented > 0);
    await driver.close(); assert.equal(observations.at(-1).connected, false);
    const reloaded = [], next = f.create(last.sessionId, { observation: observations.at(-1), observe: v => reloaded.push(v) });
    const second = turn('continue'); assert.equal((await next.run(second.request)).state, 'completed');
    assert.equal(reloaded.at(-1).plan.origin, 'history'); assert.ok(reloaded.at(-1).sequence > last.sequence);
    assert.ok(!JSON.stringify(second.events).includes('Historical plan'));
  } finally { await f.close(); }
});
test('a different session cannot contaminate the retained projection', async () => {
  const f = await setup(), observations = [];
  try {
    const driver = f.create(undefined, { observe: v => observations.push(v) });
    assert.equal((await driver.run(turn('wrong-session').request)).state, 'unknown');
    assert.ok(observations.every(o => o.sessionId === 'original-session' && o.plan === null));
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
    const bounded = f.create(undefined, { observe() { throw new Error('Projection full'); } });
    const result = await bounded.run(turn('not dispatched').request);
    assert.equal(result.state, 'failed'); assert.match(result.problem, /Projection full/); assert.equal(bounded.connected, false);
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

test('Codex uses the same ACP identity and cancellation contract without Claude session metadata', async () => {
  const f = await setup({ ACP_CAN_CLOSE: '1' }); let driver;
  try {
    driver = new CodexAcpConversation(f.options);
    const a = turn('first'); assert.equal((await driver.run(a.request)).state, 'completed');
    const b = turn('second'); assert.equal((await driver.run(b.request)).state, 'completed');
    const waiting = turn('wait', { event(e) { if (e.step?.id === 'slow') waiting.controller.abort(); } });
    assert.equal((await driver.run(waiting.request)).state, 'stopped');
    await driver.close();
    const calls = await f.calls(); assert.equal(calls.filter(c => c.kind === 'session/new').length, 1);
    assert.equal(calls.filter(c => c.kind === 'session/prompt').length, 3);
    assert.equal(calls.filter(c => c.kind === 'session/cancel').length, 1);
    assert.equal(calls.filter(c => c.kind === 'session/close').length, 1);
    assert.equal(calls.find(c => c.kind === 'session/new').claudeMetadata, false);
  } finally { await driver?.close(); await f.close(); }
});
