import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NativeActivity } from '../plugins/agent/dist/native.js';
import { ClaudeCodeObserver } from '../plugins/agent/dist/claude-native.js';
import { isNativeTime } from '../plugins/agent/dist/contract.js';
test('native CLI observer ignores prose/reasoning, binds original native ids and preserves one observation per envelope', async () => {
  const events = []; let initialized = 0;
  const observer = new ClaudeCodeObserver({ sessionId: 'actual-session', onInit: async () => { initialized++; }, append: async e => events.push(e), outputs: async () => [] }, 1);
  await observer.observe({ type: 'system', subtype: 'init', session_id: 'actual-session' });
  const request = { type: 'assistant', session_id: 'actual-session', message: { content: [{ type: 'thinking', thinking: 'excluded' }, { type: 'text', text: 'done' }, { type: 'tool_use', id: 'original', name: 'Bash', input: { command: 'python3 analysis.py' } }] } };
  await observer.observe(request); await observer.observe(request);
  const returned = { type: 'user', session_id: 'actual-session', message: { content: [{ type: 'tool_result', tool_use_id: 'original', content: 'native result' }] } };
  await observer.observe(returned); await observer.observe(returned);
  assert.equal(initialized, 1); assert.deepEqual(events.map(x => x.kind), ['tool.requested', 'tool.returned']);
  assert.deepEqual(events.map(x => x.sourceSeq), [0, 1]); assert.ok(events.every(x => x.detailsRef === null));
  await assert.rejects(observer.observe({ ...request, session_id: 'another' }), /session identity/);
  await assert.rejects(observer.observe({ ...request, message: { content: [{ type: 'tool_use', id: 'second', name: 'Read' }] } }), /maxTools/);
  const lost = [];
  const interrupted = new ClaudeCodeObserver({ sessionId: 'actual-session', onInit: async () => {}, append: async e => lost.push(e) });
  await interrupted.observe({ type: 'system', subtype: 'init', session_id: 'actual-session' });
  await interrupted.observe(request); await interrupted.finish(); await interrupted.finish();
  assert.deepEqual(lost.map(x => x.kind), ['tool.requested', 'tool.observation-lost']);
  assert.equal(lost[1].outcome, 'unknown');
  assert.equal(isNativeTime('2026-02-29T00:00:00Z'), false);
  assert.equal(isNativeTime('2024-02-29T00:00:00Z'), true);
  assert.equal(isNativeTime('2026-10-21T24:00:00Z'), false);
});
test('native activity batch limits, receipt eviction and source epoch exhaustion preserve retained output', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rho-native-owner-'));
  try {
    const owner = new NativeActivity(root, 'project', { maxRetainedEvents: 2, maxSourceEpochs: 1, maxRecordBytes: 200, maxBatchEvents: 2, maxBatchBytes: 1000 });
    await owner.initialize();
    const body = { projectId: 'project', taskId: 'task', bindingId: 'binding', adapterId: 'adapter', adapterEpoch: 'epoch', events: [] };
    const event = (sourceSeq, kind = 'tool.requested') => ({ sourceSeq, kind, nativeToolUseId: 'tool', tool: 'Bash', at: '2026-10-21T00:00:00Z', detailsRef: null, outcome: kind === 'tool.requested' ? 'requested' : 'returned' });
    const first = await owner.append({ ...body, events: [event(0), event(1, 'tool.returned')] });
    await assert.rejects(owner.append({ ...body, events: [{ ...event(2), tool: 'x'.repeat(400) }] }), /maxRecordBytes/);
    await assert.rejects(owner.append({ ...body, adapterEpoch: 'second', events: [event(0)] }), /epochs are full/);
    await assert.rejects(owner.append({ ...body, events: [event(2), event(3), event(4)] }), /maxBatchEvents/);
    assert.deepEqual((await owner.read({ after: 0, cursor: null, limit: 100, maxBytes: 65536 })).entries.map(x => x.eventId), first.accepted.map(x => x.eventId));
    const bytesRoot = path.join(root, 'exact-byte-boundary'); await fs.mkdir(bytesRoot);
    const wide = new NativeActivity(bytesRoot, 'project'); await wide.initialize();
    await wide.append({ ...body, events: [event(0)] });
    const file = path.join(bytesRoot, '.rho/plugins/agent/native.json'), previous = await fs.readFile(file);
    await wide.append({ ...body, events: [event(1, 'tool.returned')] });
    const actualBytes = (await fs.readFile(file)).length;
    await fs.writeFile(file, previous);
    const bounded = new NativeActivity(bytesRoot, 'project', { maxRetainedBytes: actualBytes - 1 });
    await assert.rejects(bounded.append({ ...body, events: [event(1, 'tool.returned')] }), /store is full/);
    assert.deepEqual(await fs.readFile(file), previous);
    const emptyRoot = path.join(root, 'empty-too-small'); await fs.mkdir(emptyRoot);
    await assert.rejects(new NativeActivity(emptyRoot, 'project', { maxRetainedBytes: 1 }).initialize(), /Empty native/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('native feedback fetch receipt is tied to the exact MCP tool result, never Bash input or model prose', async () => {
  const events = [];
  const observer = new ClaudeCodeObserver({ sessionId: 'session', onInit: async () => {}, append: async e => events.push(e) });
  await observer.observe({ type: 'system', subtype: 'init', session_id: 'session' });
  await observer.observe({ type: 'assistant', message: { content: [
    { type: 'text', text: 'feedback.read fetch-1 returned' },
    { type: 'tool_use', id: 'shell', name: 'Bash', input: { fetchId: 'spoof' } },
    { type: 'tool_use', id: 'fetch', name: 'mcp__rho__rho_feedback_read', input: { fetchId: 'fetch-1' } },
  ] } });
  await observer.observe({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'shell', content: 'fetch-1' },
    { type: 'tool_result', tool_use_id: 'fetch', content: 'whole feedback' },
  ] } });
  assert.deepEqual(events.map(e => [e.nativeToolUseId, e.kind, e.fetchId ?? null]), [
    ['shell', 'tool.requested', null], ['fetch', 'tool.requested', 'fetch-1'],
    ['shell', 'tool.returned', null], ['fetch', 'tool.returned', 'fetch-1'],
  ]);
});

test('layered native tool attributes fetch only to rho_call feedback.read, not a different operation', async () => {
  const events = [], observer = new ClaudeCodeObserver({ sessionId: 'session', onInit: async () => {}, append: async e => events.push(e) });
  await observer.observe({ type: 'system', subtype: 'init', session_id: 'session' });
  for (const [id, operation] of [['wrong','document.read'], ['right','feedback.read']]) {
    await observer.observe({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'mcp__rho__rho_call', input: { operation, input: { fetchId: 'fetch-real' } } }] } });
    await observer.observe({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'result' }] } });
  }
  assert.deepEqual(events.map(e => e.fetchId ?? null), [null,null,'fetch-real','fetch-real']);
});
