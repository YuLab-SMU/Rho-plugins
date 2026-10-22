import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Documents } from '@rho-workspace/plugin-documents';
import { Files, ProjectPaths } from '@rho-workspace/plugin-files';
import { planExecution } from '@rho-workspace/plugin-r';
import { digest } from '@rho-workspace/plugin-contracts';

test('selected source folders retain distinct files, shared alias buffers and actual conditional saves', async () => {
  const root = await fs.mkdtemp('/private/tmp/rho-sources-');
  try {
    const workspace = path.join(root, 'workspace'), a = path.join(root, 'a'), b = path.join(root, 'b');
    for (const folder of [workspace, a, b]) await fs.mkdir(folder);
    await fs.writeFile(path.join(a, 'same.txt'), '中文 A'); await fs.writeFile(path.join(b, 'same.txt'), 'B 🧬');
    const paths = new ProjectPaths(workspace, [{ id: 'a', root: a, name: 'a' }, { id: 'b', root: b, name: 'b' }, { id: 'alias', root: a, name: 'alias' }]);
    const docs = new Documents(workspace, {}, paths), files = new Files(workspace, 'project', {}, [], paths);
    await fs.writeFile(path.join(workspace, '@notes.txt'), 'ordinary filename');
    assert.equal((await docs.open('@notes.txt', 'human')).content, 'ordinary filename');
    const first = await docs.open('@a/same.txt', 'human'), second = await docs.open('@b/same.txt', 'human');
    assert.notEqual(first.id, second.id); assert.equal((await docs.open('@alias/same.txt', 'human')).id, first.id);
    const edited = await docs.edit(second.id, second.version, [{ from: 0, to: 0, insert: 'saved ' }], 'human', 'human');
    await docs.save(second.id, edited.version, second.diskDigest, 'human');
    assert.equal(await fs.readFile(path.join(b, 'same.txt'), 'utf8'), 'saved B 🧬');
    assert.equal(await fs.readFile(path.join(a, 'same.txt'), 'utf8'), '中文 A');
    const r = await files.register('@a/same.txt', {}, 'available');
    assert.equal(Buffer.from((await files.read(r, 0)).data, 'base64').toString(), '中文 A');
    await fs.writeFile(path.join(a, 'run.R'), 'cat("source script")');
    const input = { script: { kind: 'file', path: '@a/run.R', digest: digest('cat("source script")') }, args: [], requirements: [], artifacts: [], completion: null };
    assert.match((await planExecution(workspace, input, 'source-script', { libraryPaths: [] }, files, docs)).code, /source script/);
    for (const ref of ['@unknown/same.txt', '@a/../b/same.txt', '@a/.rho/private']) await assert.rejects(docs.open(ref, 'human'), { kind: 'scope' });
    await fs.symlink(b, path.join(a, 'link'));
    await assert.rejects(docs.open('@a/link/same.txt', 'human'), { kind: 'scope' });
    await fs.writeFile(path.join(b, 'same.txt'), 'external');
    const next = await docs.edit(second.id, (await docs.read(second.id)).version, [{ from: 0, to: 0, insert: 'draft ' }], 'human', 'human');
    await assert.rejects(docs.save(second.id, next.version, (await docs.read(second.id)).diskDigest, 'human'), { kind: 'conflict' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
