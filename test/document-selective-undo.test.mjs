import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Documents } from '@rho-workspace/plugin-documents';

async function fixture(t, content = 'a b c', limits = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'rho-author-undo-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'note.md'), content);
  const owner = new Documents(root, limits), doc = await owner.open('note.md', 'human');
  return { root, owner, doc };
}
const condition = (doc, changeId) => ({ changeId, expectedRevision: doc.revision });
const edit = (o, d, from, to, insert, author, id, group = id) => o.edit(d.id, d.version, [{ from, to, insert }], group, author, condition(d, id));

test('author undo composes a typing group and preserves later edits between its separate ranges', async t => {
  const { owner, doc } = await fixture(t);
  let d = await edit(owner, doc, 0, 1, 'A', 'human', 'h1', 'typing');
  d = await edit(owner, d, 4, 5, 'C', 'human', 'h2', 'typing');
  d = await edit(owner, d, 2, 3, 'B', 'agent', 'a1');
  const undo = [d.id, d.version, 'human', condition(d, 'undo-human')];
  const undone = await owner.undoOwn(...undo);
  assert.equal(undone.content, 'a B c');
  assert.deepEqual(undone.history.at(-1).reverts, ['h1', 'h2']);
  assert.deepEqual(await owner.undoOwn(...undo), undone);
  const entries = (await owner.history(d.id)).entries;
  assert.equal(entries.find(e => e.changeId === 'a1').revertedBy, null);
  assert.equal(entries.find(e => e.changeId === 'h1').revertedBy, 'undo-human');
  await assert.rejects(owner.undoOwn(d.id, undone.version, 'human', condition(undone, 'again')), { kind: 'not_found' });
  const agentUndo = await owner.undoOwn(d.id, undone.version, 'agent', condition(undone, 'undo-agent'));
  assert.equal(agentUndo.content, 'a b c');
});

test('Show before is an exact historical snapshot; one change can be reverted after a prefix insertion', async t => {
  const { root, owner, doc } = await fixture(t, 'hello x');
  let d = await edit(owner, doc, 6, 7, 'Y', 'agent', 'agent-change');
  d = await edit(owner, d, 0, 0, '中文🧬 ', 'human', 'human-change');
  const snapshot = await owner.readChange(d.id, 'agent-change');
  assert.equal(snapshot.before.content, 'hello x'); assert.equal(snapshot.after.content, 'hello Y');
  const args = [d.id, d.version, 'agent-change', 'human', condition(d, 'revert-agent')];
  const reverted = await owner.revert(...args);
  assert.equal(reverted.content, '中文🧬 hello x');
  assert.deepEqual(await new Documents(root).revert(...args), reverted);
  assert.deepEqual(await owner.readChange(d.id, 'agent-change'), { ...snapshot, change: { ...snapshot.change, revertedBy: 'revert-agent' } });
  await assert.rejects(owner.revert(d.id, reverted.version, 'agent-change', 'human', condition(reverted, 'twice')), { kind: 'condition' });
  await assert.rejects(owner.revert(...args.slice(0, 3), 'other', args[4]), { kind: 'conflict' });
  await assert.rejects(owner.undoOwn(d.id, d.version, 'human', condition(d, 'stale')), { kind: 'stale' });
});

test('overlapping later text refuses selective undo; undoing that overlap restores safe reversibility', async t => {
  const { owner, doc } = await fixture(t, 'abc');
  let d = await edit(owner, doc, 0, 1, 'A', 'agent', 'agent');
  d = await edit(owner, d, 0, 1, 'H', 'human', 'human');
  await assert.rejects(owner.revert(d.id, d.version, 'agent', 'human', condition(d, 'conflict')), { kind: 'conflict' });
  const { receipt, ...confirmed } = d;
  assert.deepEqual(await owner.read(d.id), confirmed);
  d = await owner.undoOwn(d.id, d.version, 'human', condition(d, 'own'));
  assert.equal(d.content, 'Abc');
  d = await owner.revert(d.id, d.version, 'agent', 'human', condition(d, 'after-undo'));
  assert.equal(d.content, 'abc');
});

test('adjacent Unicode deletions and same-boundary insertions have explicit reversible/refused outcomes', async t => {
  const { owner, doc } = await fixture(t, 'a😀bc');
  let d = await owner.edit(doc.id, 1, [{ from: 0, to: 1, insert: '' }, { from: 1, to: 3, insert: '' }], 'a', 'agent', condition(doc, 'delete'));
  assert.equal((await owner.readChange(doc.id, 'delete')).before.content, 'a😀bc');
  d = await edit(owner, d, 2, 2, '!', 'human', 'suffix');
  d = await owner.revert(d.id, d.version, 'delete', 'human', condition(d, 'restore'));
  assert.equal(d.content, 'a😀bc!');
  d = await edit(owner, d, 0, 1, '', 'agent', 'delete-a');
  d = await edit(owner, d, 0, 0, '?', 'human', 'prefix');
  await assert.rejects(owner.revert(d.id, d.version, 'delete-a', 'human', condition(d, 'ambiguous')), { kind: 'conflict' });
  assert.equal((await owner.read(d.id)).content, '?😀bc!');
});

test('group composition handles edits to text inserted by an earlier call in the same group', async t => {
  const { owner, doc } = await fixture(t, 'abc');
  let d = await edit(owner, doc, 1, 1, 'x', 'human', 'one', 'typing');
  d = await edit(owner, d, 1, 2, '中文😀', 'human', 'two', 'typing');
  d = await edit(owner, d, d.content.length, d.content.length, '!', 'agent', 'suffix');
  d = await owner.undoOwn(d.id, d.version, 'human', condition(d, 'group-undo'));
  assert.equal(d.content, 'abc!');
});

test('retention boundaries and text/work budgets preserve acknowledged content and prevent partial group undo', async t => {
  const { owner, doc } = await fixture(t, '', { maxHistoryEntries: 2 });
  let d = doc;
  for (let i = 0; i < 3; i++) d = await edit(owner, d, d.content.length, d.content.length, 'x', 'human', 'h' + i, 'typing');
  assert.equal(d.history.length, 2); assert.equal(d.historyRetainedFromVersion, 3);
  await assert.rejects(owner.readChange(d.id, 'h0'), e => e.kind === 'not_found' && e.details.retainedFromVersion === 3);
  await assert.rejects(owner.undoOwn(d.id, d.version, 'human', condition(d, 'partial')), { kind: 'condition' });
  assert.equal((await owner.read(d.id)).content, 'xxx');
  const limited = new Documents(owner.root, { maxHistoryEdits: 1 });
  await assert.rejects(limited.edit(d.id, d.version, [{ from: 0, to: 1, insert: 'a' }, { from: 2, to: 3, insert: 'b' }], 'big', 'human', condition(d, 'too-many')), { kind: 'limit' });
  const tiny = new Documents(owner.root, { maxUndoBytes: 1 });
  await assert.rejects(tiny.revert(d.id, d.version, 'h2', 'human', condition(d, 'too-large')), { kind: 'limit' });
  assert.equal((await owner.read(d.id)).revision, d.revision);
});

test('archive restore validates retained history; legacy archives do not invent authors or before snapshots', async t => {
  const { owner, doc } = await fixture(t, 'abc');
  const d = await edit(owner, doc, 1, 2, '中', 'agent', 'original');
  const target = await fs.mkdtemp(path.join(tmpdir(), 'rho-author-restore-'));
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  const restored = new Documents(target);
  assert.equal((await restored.restore(d, 'operator')).state, 'available');
  assert.equal((await restored.readChange(d.id, 'original')).before.content, 'abc');
  const differentAuthor = structuredClone(d); differentAuthor.history[0].author = 'other';
  assert.equal((await restored.restore(differentAuthor, 'operator')).state, 'conflict');
  assert.equal((await restored.readChange(d.id, 'original')).change.author, 'agent');
  const bad = structuredClone(d); bad.history[0].edits[0].removed = 'wrong';
  await assert.rejects(restored.restore(bad, 'operator'));
  const legacy = structuredClone(d); delete legacy.history; delete legacy.historyRetainedFromVersion;
  const other = await fs.mkdtemp(path.join(tmpdir(), 'rho-author-legacy-'));
  t.after(() => fs.rm(other, { recursive: true, force: true }));
  const old = new Documents(other); await old.restore(legacy, 'human');
  assert.equal((await old.history(d.id)).entries.length, 0);
  await assert.rejects(old.undoOwn(d.id, d.version, 'agent', condition(d, 'no-history')), { kind: 'not_found' });
  assert.equal((await old.undo(d.id, d.version, 'human')).content, 'abc');
});
