import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, symlink, mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

test('unsaved text takes a disk change to other lines and stays unsaved; overlapping changes are kept apart', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rho-document-merge-'));
  const file = path.join(root, 'analysis.R'), base = 'air <- read.csv("a.csv")\nfit <- lm(Ozone ~ Temp, data = air)\nprint(coef(fit))\n';
  await writeFile(file, base);
  const d = new Documents(root);
  const first = await d.open('analysis.R', 'human');
  // The person adds a line in Rho and does not save; the Agent's own editor appends another on disk.
  const typed = await d.edit(first.id, first.version, [{ from: base.length, to: base.length, insert: '# Person: drop rows.\n' }], 'h', 'human', { changeId: 'person-1', expectedRevision: first.revision });
  await writeFile(file, base + 'print(summary(fit))\n');
  const merged = await d.open('analysis.R', 'human');
  assert.equal(merged.content, base + 'print(summary(fit))\n# Person: drop rows.\n', 'both lines, the disk\'s first');
  assert.equal(merged.dirty, true, 'the person\'s line is still unsaved');
  assert.equal(merged.history.at(-1).author, 'disk');
  // The person's own undo removes only their line.
  const own = await d.undoOwn(first.id, merged.version, 'human', { changeId: 'undo-1', expectedRevision: merged.revision });
  assert.equal(own.content, base + 'print(summary(fit))\n');
  const again = await d.edit(first.id, own.version, [{ from: 0, to: 0, insert: '# mine\n' }], 'h2', 'human', { changeId: 'person-2', expectedRevision: own.revision });
  // A disk change to another line merges; the save then writes both.
  await writeFile(file, base.replace('print(coef(fit))', 'print(coef(fit), digits = 3)') + 'print(summary(fit))\n');
  const second = await d.open('analysis.R', 'human');
  assert.equal(second.content, '# mine\n' + base.replace('print(coef(fit))', 'print(coef(fit), digits = 3)') + 'print(summary(fit))\n');
  const saved = await d.save(first.id, second.version, second.diskDigest, 'human');
  assert.equal(await readFile(file, 'utf8'), second.content);
  assert.equal(saved.dirty, false);
  // An overlapping change is not merged: the buffer is kept and the save reports the divergence.
  const line = await d.edit(first.id, saved.version, [{ from: 0, to: 6, insert: '# ours' }], 'h3', 'human', { changeId: 'person-3', expectedRevision: saved.revision });
  await writeFile(file, second.content.replace('# mine', '# theirs'));
  const kept = await d.open('analysis.R', 'human');
  assert.equal(kept.content, line.content);
  await assert.rejects(d.save(first.id, kept.version, kept.diskDigest, 'human'), { kind: 'conflict' });
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

const hook = fileURLToPath(new URL('../plugins/documents/dist/claude-hook.js', import.meta.url));
const ask = (input) => { const r = spawnSync(process.execPath, [hook], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' }); return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }; };
const edit = (cwd, file, tool = 'Edit') => ({ hook_event_name: 'PreToolUse', tool_name: tool, cwd, tool_input: { file_path: file, old_string: 'a', new_string: 'b' }, session_id: 's', tool_use_id: 't' });

test('the Claude Code hook refuses a native edit only of a file with unsaved text, and names its buffer', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rho-document-hook-'));
  await writeFile(path.join(root, 'a.R'), 'x <- 1\n'); await writeFile(path.join(root, 'b.R'), 'y <- 2\n');
  await mkdir(path.join(root, 'sub'));
  const d = new Documents(root);
  const a = await d.open('a.R', 'browser:me'); await d.open('b.R', 'browser:me');
  // Clean buffers, files without one and new files pass without a word.
  assert.deepEqual(ask(edit(root, path.join(root, 'a.R'))), { status: 0, out: null, err: '' });
  assert.equal(ask(edit(root, path.join(root, 'c.R'), 'Write')).out, null);
  await d.edit(a.id, a.version, [{ from: 0, to: 0, insert: '# mine\n' }], 'h', 'browser:me');
  const refused = ask(edit(path.join(root, 'sub'), path.join(root, 'a.R'), 'MultiEdit')).out.hookSpecificOutput;
  assert.equal(refused.hookEventName, 'PreToolUse'); assert.equal(refused.permissionDecision, 'deny');
  assert.match(refused.permissionDecisionReason, /^a\.R has unsaved text in Rho/);
  assert.ok(refused.permissionDecisionReason.includes(JSON.stringify({ documentId: a.id })));
  // A determined change comes with the document.edit input that applies it to the buffer.
  const native = { ...edit(root, path.join(root, 'a.R')), tool_input: { file_path: path.join(root, 'a.R'), old_string: 'x <- 1\n', new_string: 'x <- 1\nz <- 3\n' } };
  const reason = ask(native).out.hookSpecificOutput.permissionDecisionReason;
  const ready = JSON.parse(reason.match(/keeping that text: (\{.*\})\. If it is refused/)[1]);
  assert.deepEqual(ready, { documentId: a.id, expectedVersion: 2, expectedRevision: 1, edits: [{ from: 14, to: 14, insert: 'z <- 3\n' }] });
  const applied = await d.edit(ready.documentId, ready.expectedVersion, ready.edits, 'agent-edit', 'agent:a', { changeId: 'agent-1', expectedRevision: ready.expectedRevision });
  assert.equal(applied.content, '# mine\nx <- 1\nz <- 3\n');
  // Already in the buffer: nothing to edit. A Write rewriting the line beside that text gets no ready input.
  assert.match(ask(native).out.hookSpecificOutput.permissionDecisionReason, /already has this change/);
  const write = ask({ ...edit(root, path.join(root, 'a.R'), 'Write'), tool_input: { file_path: path.join(root, 'a.R'), content: 'x <- 2\n' } }).out.hookSpecificOutput.permissionDecisionReason;
  assert.match(write, /rho_call document\.read with/); assert.doesNotMatch(write, /keeping that text/);
  // A disk that moved on since the buffer last matched it gets no ready input either.
  await writeFile(path.join(root, 'a.R'), 'x <- 10\n');
  assert.match(ask(native).out.hookSpecificOutput.permissionDecisionReason, /rho_call document\.read with/);
  await writeFile(path.join(root, 'a.R'), 'x <- 1\n');
  assert.equal(ask(edit(root, path.join(root, 'b.R'))).out, null);
  assert.equal(ask({ ...edit(root, path.join(root, 'a.R')), tool_name: 'Read' }).out, null);
  assert.equal(ask(edit(root, path.join(tmpdir(), 'elsewhere.R'))).out, null);
  // The buffer is unchanged and nothing was opened.
  assert.equal((await d.read(a.id)).content, '# mine\nx <- 1\nz <- 3\n'); assert.equal((await d.list()).length, 2);
  // Unreadable input lets the native tool proceed and says so.
  const broken = ask('{not json');
  assert.equal(broken.status, 0); assert.equal(broken.out, null); assert.match(broken.err, /native tool proceeds/);
  // A folder without Documents records stays without them.
  const plain = await mkdtemp(path.join(tmpdir(), 'rho-document-hook-plain-'));
  await writeFile(path.join(plain, 'a.R'), 'x\n');
  assert.equal(ask(edit(plain, path.join(plain, 'a.R'))).out, null);
  await assert.rejects(stat(path.join(plain, '.rho')), { code: 'ENOENT' });
});
