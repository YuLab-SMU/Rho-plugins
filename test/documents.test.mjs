import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Documents } from '@rho-workspace/plugin-documents';

test('shared Unicode buffer, stale concurrency, undo groups, disk conflict and recovery', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rho-document-'));
  await writeFile(path.join(root, 'analysis.R'), '# 中文 🧬\n');
  const human = new Documents(root), agent = new Documents(root);
  const first = await human.open('analysis.R', 'human');
  assert.equal((await agent.open('analysis.R', 'agent')).id, first.id);
  const edited = await agent.edit(first.id, 1, [{ from: first.content.length, to: first.content.length, insert: 'x <- 1\n' }], 'agent-a', 'agent');
  await assert.rejects(human.edit(first.id, 1, [{ from: 0, to: 0, insert: 'stale' }], 'a', 'human'), { kind: 'stale' });
  assert.equal((await human.read(first.id)).content, edited.content);
  const continued = await human.edit(first.id, 2, [{ from: edited.content.length, to: edited.content.length, insert: 'y <- 2\n' }], 'human-a', 'human');
  const undone = await human.undo(first.id, continued.version, 'human');
  assert.equal(undone.content, edited.content);
  assert.equal((await new Documents(root).read(first.id)).version, undone.version);
  await assert.rejects(human.edit(first.id, undone.version, [{ from: 6, to: 7, insert: '?' }], 'broken', 'human'), { kind: 'invalid' });
  await writeFile(path.join(root, 'analysis.R'), '# external write\n');
  await assert.rejects(human.save(first.id, undone.version, first.diskDigest, 'human'), { kind: 'conflict' });
  assert.equal(await readFile(path.join(root, 'analysis.R'), 'utf8'), '# external write\n');
  assert.equal((await human.read(first.id)).content, edited.content);
  const snapshot = await human.snapshot(first.id, undone.version);
  await human.edit(first.id, undone.version, [{ from: 0, to: 0, insert: '# after acceptance\n' }], 'b', 'human');
  assert.equal(snapshot.code, edited.content);
  await symlink(root, path.join(root, 'linked'));
  await assert.rejects(human.open('linked/analysis.R', 'human'), { kind: 'scope' });
});

test('buffer and undo limits preserve the last acknowledged state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rho-document-limit-'));
  const d = new Documents(root, { maxBufferBytes: 12, maxTotalBytes: 12, maxUndoBytes: 20, maxDocuments: 1 });
  const a = await d.open('a.R', 'human');
  await d.edit(a.id, 1, [{ from: 0, to: 0, insert: '中文' }], 'a', 'human');
  await assert.rejects(d.edit(a.id, 2, [{ from: 2, to: 2, insert: '超出预算' }], 'b', 'agent'), { kind: 'limit' });
  assert.equal((await d.read(a.id)).content, '中文');
  await assert.rejects(d.open('b.R', 'agent'), { kind: 'limit' });
});

test('serialized document and aggregate budgets refuse before replacing acknowledged records', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'rho-document-records-'));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(root, { recursive: true, force: true }); });
  const owner = new Documents(root);
  const original = await owner.open('a.md', 'human');
  const size = Buffer.byteLength(JSON.stringify(original)) + 1;
  const limited = new Documents(root, { maxRecordBytes: size + 20, maxTotalRecordBytes: size + 20 });
  await assert.rejects(limited.edit(original.id, 1, [{ from: 0, to: 0, insert: 'next' }], 'a', 'human'), e => e.kind === 'limit');
  assert.deepEqual(await owner.read(original.id), original);
  await assert.rejects(limited.open('b.md', 'human'), e => e.kind === 'limit');
  assert.equal((await owner.list()).length, 1);
  const tooSmall = new Documents(root, { maxRecordBytes: size - 1 });
  await assert.rejects(tooSmall.open('a.md', 'human'), e => e.kind === 'limit');
  assert.deepEqual(await owner.read(original.id), original);
});

test('a clean buffer adopts its changed file on open; unsaved text is never replaced', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rho-document-disk-'));
  await writeFile(path.join(root, 'analysis.R'), 'x <- 1\ny <- 2\n# 中文 🧬\n');
  const d = new Documents(root);
  const first = await d.open('analysis.R', 'human');
  // Another program (an Agent's own editor) changes one line on disk.
  await writeFile(path.join(root, 'analysis.R'), 'x <- 1\ny <- mean(x)\n# 中文 🧬\n');
  const followed = await d.open('analysis.R', 'human');
  assert.equal(followed.content, 'x <- 1\ny <- mean(x)\n# 中文 🧬\n');
  assert.equal(followed.version, first.version + 1);
  assert.equal(followed.dirty, false);
  const entry = followed.history.at(-1);
  assert.equal(entry.author, 'disk');
  assert.deepEqual(entry.edits, [{ from: 12, to: 13, insert: 'mean(x)', removed: '2' }]);
  // The text before stays readable through the owner's history.
  assert.equal((await d.readChange(first.id, entry.changeId)).before.content, 'x <- 1\ny <- 2\n# 中文 🧬\n');
  // Opening an unchanged file is a read: no new version.
  assert.equal((await d.open('analysis.R', 'human')).version, followed.version);
  // The person's unsaved text is kept even though the file changed again.
  const typed = await d.edit(first.id, followed.version, [{ from: 0, to: 0, insert: '# mine\n' }], 'h', 'human');
  await writeFile(path.join(root, 'analysis.R'), 'z <- 3\n');
  const kept = await d.open('analysis.R', 'human');
  assert.equal(kept.content, typed.content);
  assert.equal(kept.version, typed.version);
  await assert.rejects(d.save(first.id, typed.version, typed.diskDigest, 'human'), { kind: 'conflict' });
  // A file that is no longer UTF-8 leaves a clean buffer as it was.
  const other = path.join(root, 'notes.md');
  await writeFile(other, 'notes\n');
  const notes = await d.open('notes.md', 'human');
  await writeFile(other, Buffer.from([0xff, 0xfe, 0x00]));
  assert.equal((await d.open('notes.md', 'human')).content, notes.content);
});
