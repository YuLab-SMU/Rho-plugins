import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Documents } from '@rho-workspace/plugin-documents';
import { DocumentSync, diff, groups, currentRanges } from '../plugins/documents/dist/ui-model.js';

// A client that reaches the real owner the way Rho dispatch does.
function client(docs, author, faults = {}) {
  const calls = [];
  return { calls, async call(method, b) {
    calls.push({ method, b });
    const change = b.changeId === undefined ? undefined : { changeId: b.changeId, expectedRevision: b.expectedRevision };
    const run = () => ({
      'document.read': () => docs.read(b.documentId),
      'document.save': () => docs.save(b.documentId, b.expectedVersion, b.expectedDiskDigest, author, change),
      'document.edit': () => docs.edit(b.documentId, b.expectedVersion, b.edits, b.undoGroup, author, change),
      'document.undoOwn': () => docs.undoOwn(b.documentId, b.expectedVersion, author, change),
      'document.revert': () => docs.revert(b.documentId, b.expectedVersion, b.targetChangeId, author, change),
      'document.change.read': () => docs.readChange(b.documentId, b.targetChangeId),
    })[method]();
    if (faults[method]?.length) { const fault = faults[method].shift(); if (fault === 'lost-reply') { await run(); throw new TypeError('fetch failed'); } }
    try { return await run(); } catch (error) { if (error.kind) { const e = new Error(error.message); e.error = { kind: error.kind }; throw e; } throw error; }
  } };
}
function port(initial = '') {
  let text = initial, composing = false;
  return { text: () => text, replace(next) { text = next; }, composing: () => composing, type(next) { text = next; }, setComposing(v) { composing = v; } };
}
const settle = async sync => {
  for (let i = 0; sync.busy && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sync.busy, false, 'adapter reached an acknowledged boundary');
  await sync.load();
};

test('diff keeps surrogate pairs whole', () => {
  assert.deepEqual(diff('a🧬b', 'a🧪b'), { from: 1, to: 3, insert: '🧪', removed: '🧬' });
  assert.equal(diff('same', 'same'), null);
});

test('browser input is sent once per identity, lost replies resend the same request, and composition waits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rho-ui-doc-'));
  await writeFile(path.join(root, 'a.R'), 'x <- 1\n');
  const docs = new Documents(root), opened = await docs.open('a.R', 'agent:a');
  const c = client(docs, 'browser:me', { 'document.edit': ['lost-reply'] });
  const sync = new DocumentSync(c, 'p', opened.id, 'browser:me'), view = port();
  sync.attach(view); await sync.load();
  assert.equal(view.text(), 'x <- 1\n');
  view.setComposing(true); view.type('x <- 1\n中'); sync.local(view);
  assert.equal(c.calls.filter(x => x.method === 'document.edit').length, 0, 'no send during composition');
  view.setComposing(false); sync.flush();
  await settle(sync);
  const edits = c.calls.filter(x => x.method === 'document.edit');
  assert.equal(edits.length, 2); assert.deepEqual(edits[0].b, edits[1].b, 'the lost reply is retried with the identical request');
  assert.equal((await docs.read(opened.id)).content, 'x <- 1\n中');
  assert.equal(sync.confirmed.version, 2);
});

test('a stale edit is kept aside and the acknowledged buffer is shown; undo touches only own edits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rho-ui-doc-'));
  await writeFile(path.join(root, 'a.R'), 'a\nb\n');
  const docs = new Documents(root), opened = await docs.open('a.R', 'agent:a');
  const sync = new DocumentSync(client(docs, 'browser:me'), 'p', opened.id, 'browser:me'), view = port();
  sync.attach(view); await sync.load();
  view.type('a\nb\nmine\n'); sync.local(view); await settle(sync);
  // The Agent edits line 1 after the browser edit.
  const current = await docs.read(opened.id);
  await docs.edit(opened.id, current.version, [{ from: 0, to: 1, insert: 'A' }], 'g', 'agent:a', { changeId: 'agent-1', expectedRevision: current.revision });
  await sync.observe(current.version + 1);
  assert.equal(view.text(), 'A\nb\nmine\n');
  assert.ok(await sync.undo());
  assert.equal(view.text(), 'A\nb\n', 'only the browser edit is undone');
  // Typing against an old version without observing is not rebased.
  const latest = await docs.read(opened.id);
  await docs.edit(opened.id, latest.version, [{ from: 0, to: 0, insert: '#' }], 'g2', 'agent:a', { changeId: 'agent-2', expectedRevision: latest.revision });
  view.type('A\nb\nlost?\n'); sync.local(view); await settle(sync);
  assert.equal(view.text(), '#A\nb\n');
  assert.equal(sync.aside.text, 'A\nb\nlost?\n');
  const list = groups(sync.confirmed);
  const agent = list.filter(g => g.author === 'agent:a');
  assert.deepEqual(agent.map(g => g.lines), [[1, 1], [1, 1]]);
  assert.ok(await sync.revert(agent[0]));
  assert.equal(view.text(), '#a\nb\n');
  assert.equal(groups(sync.confirmed).find(g => g.changeIds.includes('agent-1')).active, false);
  assert.deepEqual(currentRanges(sync.confirmed.history, e => e.changeId === 'agent-2'), [{ from: 0, to: 1, changeId: 'agent-2' }]);
});

test('session identity cannot be inferred from another author or a receipt', async () => {
  const { authorLabel } = await import('../plugins/documents/dist/ui-model.js');
  const buffer = { id: 'd', path: 'a.R', content: 'remote', version: 1, revision: 0, receipt: { author: 'agent:a' } };
  for (const me of [undefined, 'browser:me']) {
    const sync = new DocumentSync({ call: async () => buffer }, 'p', 'd', me);
    await sync.load();
    assert.equal(sync.me, me);
    assert.equal(authorLabel('agent:a', sync.me), 'Claude Code');
    assert.equal(authorLabel('browser:other', sync.me), 'Another tab');
  }
  assert.equal(authorLabel('browser:me', 'browser:me'), 'You');
});

test('exact reads reconstruct retained versions and never substitute live text for missing history', async () => {
  const { readVersion } = await import('../plugins/documents/dist/ui-model.js');
  const root = await mkdtemp(path.join(tmpdir(), 'rho-ui-version-'));
  await writeFile(path.join(root, 'a.R'), '原文 🧬');
  const docs = new Documents(root, { maxHistoryEntries: 1 }), opened = await docs.open('a.R', 'agent:a');
  let current = await docs.edit(opened.id, 1, [{ from: 0, to: 2, insert: '第一版' }], 'g1', 'agent:a');
  const c = client(docs, 'browser:me');
  assert.equal(await readVersion(c, 'p', opened.id, 1), '原文 🧬');
  assert.equal(await readVersion(c, 'p', opened.id, 2), current.content);
  current = await docs.edit(opened.id, 2, [{ from: 0, to: 3, insert: '第二版' }], 'g2', 'agent:a');
  assert.equal(await readVersion(c, 'p', opened.id, 2), '第一版 🧬');
  await assert.rejects(readVersion(c, 'p', opened.id, 1), /no longer available/);
  await assert.rejects(readVersion(c, 'p', opened.id, 99), /no longer available/);
});

test('a conflict publishes the recovery copy, pauses input, and keeps it through subsequent reads', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rho-ui-pause-'));
  await writeFile(path.join(root, 'a.R'), 'base');
  const docs = new Documents(root), opened = await docs.open('a.R', 'agent:a');
  const sync = new DocumentSync(client(docs, 'browser:me'), 'p', opened.id, 'browser:me');
  const view = port(); sync.attach(view); await sync.load();
  const tick = sync.stateVersion;
  await docs.edit(opened.id, 1, [{ from: 0, to: 0, insert: 'remote ' }], 'g', 'agent:a');
  view.type('base 我的输入'); sync.local(view); await settle(sync);
  assert.equal(sync.aside.text, 'base 我的输入'); assert.ok(sync.stateVersion > tick);
  view.type('other'); sync.local(view); await settle(sync);
  assert.equal((await docs.read(opened.id)).content, 'remote base');
  assert.equal(sync.aside.text, 'base 我的输入');
  await sync.load(); assert.equal(sync.aside.text, 'base 我的输入');
  await sync.discardAside(); view.type('remote base继续'); sync.local(view); await settle(sync);
  assert.equal((await docs.read(opened.id)).content, 'remote base继续');
});

test('undo retries its original identity and commands do not race each other', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rho-ui-undo-'));
  await writeFile(path.join(root, 'a.R'), 'a');
  const docs = new Documents(root), opened = await docs.open('a.R', 'agent:a');
  const c = client(docs, 'browser:me', { 'document.undoOwn': ['lost-reply'] });
  const sync = new DocumentSync(c, 'p', opened.id, 'browser:me'), view = port();
  sync.attach(view); await sync.load(); view.type('ab'); sync.local(view); await settle(sync);
  const result = await Promise.all([sync.undo(), sync.undo()]);
  assert.deepEqual(result, [true, false]);
  const calls = c.calls.filter(x => x.method === 'document.undoOwn');
  assert.deepEqual(calls[0].b, calls[1].b); assert.notEqual(calls[1].b.changeId, calls[2].b.changeId);
  assert.equal((await docs.read(opened.id)).content, 'a');
});

test('unconfirmed byte limit preserves earlier pending input rather than replacing it with the confirmed buffer', async () => {
  const sync = new DocumentSync({ call: async () => ({ id: 'd', content: 'a', version: 1, revision: 0 }) }, 'p', 'd', 'browser:me', { maxUnconfirmedBytes: 8 });
  const view = port(); sync.attach(view); await sync.load();
  view.setComposing(true); view.type('a中文'); sync.local(view);
  view.type('a中文🧬'); sync.local(view);
  assert.equal(view.text(), 'a中文'); assert.match(sync.notice, /byte limit/);
});


test('typing during a stale undo is kept aside and composition-end cannot resume submission', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rho-ui-stale-undo-'));
  await writeFile(path.join(root, 'a.R'), 'a');
  const docs = new Documents(root), opened = await docs.open('a.R', 'agent:a');
  const base = client(docs, 'browser:me');
  let release, reached; const gate = new Promise(r => { release = r; }), ready = new Promise(r => { reached = r; });
  const c = { call: async (method, input) => { if (method === 'document.undoOwn') { reached(); await gate; } return base.call(method, input); } };
  const sync = new DocumentSync(c, 'p', opened.id, 'browser:me'), view = port();
  sync.attach(view); await sync.load(); view.type('ab'); sync.local(view); await settle(sync);
  const undo = sync.undo(); await ready;
  const state = await docs.read(opened.id);
  await docs.edit(opened.id, state.version, [{ from: 0, to: 0, insert: 'remote ' }], 'g', 'agent:a');
  view.type('ab未确认'); sync.local(view); release(); assert.equal(await undo, false);
  assert.equal(sync.aside.text, 'ab未确认'); assert.equal(view.text(), 'remote ab');
  sync.flush(); await sync.load(); assert.equal((await docs.read(opened.id)).content, 'remote ab');
  assert.equal(sync.busy, false);
});

test('closing a composing view retains its draft for reopening and cannot submit from a destroyed port', async () => {
  const { acquire } = await import('../plugins/documents/dist/ui-model.js');
  const root = await mkdtemp(path.join(tmpdir(), 'rho-ui-close-'));
  await writeFile(path.join(root, 'a.R'), 'base');
  const docs = new Documents(root), opened = await docs.open('a.R', 'agent:a');
  const c = client(docs, 'browser:me'), held = acquire(c, 'p-close', opened.id, 'browser:me');
  const view = port(), detach = held.sync.attach(view); await held.sync.load();
  view.setComposing(true); view.type('base未完成'); held.sync.local(view);
  detach(); held.release();
  view.text = () => { throw new Error('destroyed port must not be read'); };
  const next = acquire(c, 'p-close', opened.id, 'browser:me'); assert.equal(next.sync, held.sync);
  assert.equal(next.sync.aside.text, 'base未完成'); next.sync.flush(); await next.sync.load();
  assert.equal((await docs.read(opened.id)).content, 'base'); assert.equal(next.sync.busy, false);
  await next.sync.discardAside(); next.release();
});

test('browser saves flush pending input, reuse a lost acknowledgement identity and preserve disk conflicts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rho-ui-save-'));
  const file = path.join(root, 'a.R'); await writeFile(file, 'old\n');
  const docs = new Documents(root), opened = await docs.open('a.R', 'browser:me');
  const c = client(docs, 'browser:me', { 'document.save': ['lost-reply'] });
  const sync = new DocumentSync(c, 'p', opened.id, 'browser:me'), view = port(); sync.attach(view); await sync.load();
  view.type('saved 中文 🧬\n'); sync.local(view);
  assert.equal(await sync.save(), true); assert.equal(await readFile(file, 'utf8'), view.text());
  const calls = c.calls.filter(c => c.method === 'document.save'); assert.equal(calls.length, 2); assert.deepEqual(calls[0].b, calls[1].b);
  assert.equal(sync.confirmed.dirty, false);
  view.type('keep my buffer\n'); sync.local(view); await settle(sync);
  await writeFile(file, 'external edit\n');
  assert.equal(await sync.save(), false); assert.equal(await readFile(file, 'utf8'), 'external edit\n');
  assert.equal(view.text(), 'keep my buffer\n'); assert.equal(sync.confirmed.dirty, true); assert.match(sync.notice, /changed on disk/);
});

test('another author saving the same text version updates disk conditions before the next browser edit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rho-ui-save-observe-'));
  const docs = new Documents(root), opened = await docs.open('a.R', 'browser:me');
  const sync = new DocumentSync(client(docs, 'browser:me'), 'p', opened.id, 'browser:me'), view = port(); sync.attach(view); await sync.load();
  view.type('one'); sync.local(view); await settle(sync);
  const base = sync.confirmed;
  const other = await docs.save(base.id, base.version, base.diskDigest, 'agent:other', { changeId: 'other-save', expectedRevision: base.revision });
  assert.equal(other.version, base.version); assert.ok(other.revision > base.revision);
  await sync.observe(other.version, other.revision);
  assert.equal(sync.confirmed.dirty, false); assert.equal(sync.confirmed.diskDigest, other.diskDigest);
  view.type('two'); sync.local(view); assert.equal(await sync.save(), true);
  assert.equal(await readFile(path.join(root, 'a.R'), 'utf8'), 'two'); assert.equal(sync.aside, null);
});
