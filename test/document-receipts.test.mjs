import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Documents } from '@rho-workspace/plugin-documents';

async function fixture(t, limits = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'rho-doc-receipts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const owner = new Documents(root, limits);
  const doc = await owner.open('notes.md', 'human');
  return { root, owner, doc };
}
const change = (doc, changeId) => ({ changeId, expectedRevision: doc.revision });

test('lost edit/undo/save replies resume the original identity across owner restart', async t => {
  const { root, owner, doc } = await fixture(t);
  const edit = [doc.id, doc.version, [{ from: 0, to: 0, insert: '中文 🧬\n' }], 'typing', 'human', change(doc, 'edit-1')];
  const written = await owner.edit(...edit);
  let restarted = new Documents(root);
  assert.deepEqual(await restarted.edit(...edit), written);
  assert.equal(written.undo.length, 1);
  const save = [doc.id, written.version, null, 'human', change(written, 'save-1')];
  const saved = await restarted.save(...save);
  assert.equal(saved.version, written.version, 'save preserves content version');
  assert.equal(saved.revision, written.revision + 1, 'save advances mutation revision');
  // A retry must not overwrite a later outside edit even with a retained receipt.
  await fs.writeFile(path.join(root, 'notes.md'), 'outside');
  assert.deepEqual(await new Documents(root).save(...save), saved);
  assert.equal(await fs.readFile(path.join(root, 'notes.md'), 'utf8'), 'outside');
  const undo = [doc.id, saved.version, 'human', change(saved, 'undo-1')];
  const undone = await restarted.undo(...undo);
  assert.equal(undone.content, '');
  assert.deepEqual(await new Documents(root).undo(...undo), undone);
  assert.equal(undone.undo.length, 0);
});

test('receipts identify the original author, payload and operation; replies retain current state', async t => {
  const { owner, doc } = await fixture(t);
  const args = [doc.id, 1, [{ from: 0, to: 0, insert: 'a' }], 'a', 'human', change(doc, 'same-id')];
  const a = await owner.edit(...args);
  const b = await owner.edit(doc.id, a.version, [{ from: 1, to: 1, insert: 'b' }], 'b', 'agent');
  const retry = await owner.edit(...args);
  assert.equal(retry.content, 'ab'); assert.equal(retry.version, b.version);
  assert.equal(retry.receipt.version, a.version);
  for (const changed of [
    [...args.slice(0, 4), 'agent', args[5]],
    [doc.id, 1, [{ from: 0, to: 0, insert: 'different' }], ...args.slice(3)],
    [...args.slice(0, 5), { ...args[5], expectedRevision: 1 }]
  ]) await assert.rejects(owner.edit(...changed), { kind: 'conflict' });
  await assert.rejects(owner.undo(doc.id, 1, 'human', args[5]), { kind: 'conflict' });
  assert.equal((await owner.read(doc.id)).revision, b.revision);
});

test('bounded receipt expiry cannot replay clean saves at the same content version', async t => {
  const { root, owner, doc } = await fixture(t, { maxReceipts: 2 });
  const original = [doc.id, 1, null, 'human', change(doc, 'save-0')];
  let saved = await owner.save(...original);
  for (let i = 1; i < 4; i++) saved = await owner.save(doc.id, 1, saved.diskDigest, 'human', change(saved, 'save-' + i));
  assert.equal(saved.receipts.length, 2); assert.equal(saved.retainedFromRevision, 3);
  assert.equal(saved.version, 1); assert.equal(saved.revision, 4);
  await assert.rejects(new Documents(root, { maxReceipts: 2 }).save(...original), e => e.kind === 'stale' && e.details.actualRevision === 4);
  assert.equal((await owner.read(doc.id)).revision, 4);
});

test('interrupted save retains intent and resumes after disk replacement without another write', async t => {
  const { root, owner, doc } = await fixture(t);
  const edited = await owner.edit(doc.id, 1, [{ from: 0, to: 0, insert: 'acknowledged 中文' }], 'a', 'human');
  const originalPersist = owner.persist.bind(owner);
  owner.persist = async state => {
    if (!state.pendingSave && state.revision === edited.revision + 1) throw new Error('injected crash after replacement');
    return originalPersist(state);
  };
  const args = [doc.id, edited.version, null, 'human', change(edited, 'interrupted')];
  await assert.rejects(owner.save(...args), /injected crash/);
  const restarted = new Documents(root);
  const pending = await restarted.read(doc.id);
  assert.equal(pending.pendingSave.change.changeId, 'interrupted');
  assert.equal(pending.revision, edited.revision);
  assert.equal(await fs.readFile(path.join(root, 'notes.md'), 'utf8'), edited.content);
  const before = await fs.stat(path.join(root, 'notes.md'));
  await assert.rejects(restarted.undo(doc.id, edited.version, 'human'), { kind: 'condition' });
  await assert.rejects(restarted.save(doc.id, edited.version, null, 'agent', change(edited, 'replacement')), { kind: 'condition' });
  const resumed = await restarted.save(...args);
  assert.equal(resumed.pendingSave, undefined); assert.equal(resumed.receipt.changeId, 'interrupted');
  const after = await fs.stat(path.join(root, 'notes.md'));
  assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(resumed.revision, edited.revision + 1);
  assert.deepEqual(await restarted.save(...args), resumed);
});

test('pending saves preserve outside writes and archives; old archives and callers still work', async t => {
  const { root, owner, doc } = await fixture(t);
  const legacy = { ...doc }; delete legacy.revision; delete legacy.receipts; delete legacy.retainedFromRevision;
  await fs.writeFile(path.join(root, '.rho/plugins/documents', doc.id + '.json'), JSON.stringify(legacy));
  assert.equal((await owner.open('notes.md', 'human')).revision, 0);
  const edited = await owner.edit(doc.id, 1, [{ from: 0, to: 0, insert: 'draft' }], 'a', 'human');
  assert.equal(edited.revision, 1); assert.deepEqual(edited.receipts, []);
  const originalPersist = owner.persist.bind(owner);
  owner.persist = async state => {
    await originalPersist(state);
    if (state.pendingSave) throw new Error('injected crash before replacement');
  };
  const args = [doc.id, edited.version, null, 'human', change(edited, 'pending')];
  await assert.rejects(owner.save(...args), /injected crash/);
  const pending = await new Documents(root).read(doc.id);
  await fs.writeFile(path.join(root, 'notes.md'), 'outside');
  await assert.rejects(new Documents(root).save(...args), { kind: 'conflict' });
  assert.equal(await fs.readFile(path.join(root, 'notes.md'), 'utf8'), 'outside');
  const target = await fs.mkdtemp(path.join(tmpdir(), 'rho-doc-restore-'));
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  const restored = new Documents(target);
  const report = await restored.restore(pending, 'human');
  assert.equal(report.state, 'conflict'); assert.ok(report.pendingSave);
  await restored.restore(legacy, 'human');
  assert.equal((await restored.read(doc.id)).revision, 0);
});

test('invalid Unicode and exceeded budgets do not acknowledge an identified mutation', async t => {
  const { owner, doc } = await fixture(t, { maxBufferBytes: 8 });
  for (const insert of ['\ud800', 'too many bytes']) {
    await assert.rejects(owner.edit(doc.id, 1, [{ from: 0, to: 0, insert }], 'a', 'human', change(doc, 'not-accepted')));
    const current = await owner.read(doc.id);
    assert.equal(current.version, 1); assert.equal(current.revision, 0); assert.equal(current.receipts.length, 0);
  }
});
