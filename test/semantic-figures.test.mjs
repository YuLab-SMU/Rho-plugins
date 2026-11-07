import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { run, limits } from '../plugins/semantic-figures/host.mjs';

const id = 'a'.repeat(32), sha = value => createHash('sha256').update(value).digest('hex');
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rho-figure-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = Buffer.from('captured bytes'), dir = path.join(root, '.rho-figures', id);
  await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(root, 'source.rds'), source);
  const object = { schema: 'rho.semantic-figure/1', title: 'Test figure', adapter: 'ggtree', source: { path: 'source.rds', sha256: sha(source) }, entities: [{ key: 'clade:test', kind: 'clade', label: 'Two tips', members: ['α', 'B'], related: ['clade:test'] }] };
  const bytes = JSON.stringify(object); await fs.writeFile(path.join(dir, 'figure.json'), bytes);
  const calls = [], ctx = { projectRoot: root, invocationId: 'test-invocation', changeId: key => key, call: async (method, input) => { calls.push({ method, input }); return method === 'kernel.read' ? { sessions: [] } : { cell: { cellId: 'original-cell' } }; } };
  return { root, dir, calls, ctx, digest: sha(bytes) };
}

test('reads preserve the captured source identity and never start a runtime', async t => {
  const f = await setup(t);
  assert.equal((await run('read', { id }, f.ctx)).sourceState, 'unchanged');
  await fs.writeFile(path.join(f.root, 'source.rds'), 'new source');
  assert.equal((await run('read', { id }, f.ctx)).sourceState, 'changed');
  await fs.unlink(path.join(f.root, 'source.rds'));
  const kept = await run('read', { id }, f.ctx);
  assert.equal(kept.sourceState, 'unavailable'); assert.equal(kept.digest, f.digest);
  assert.deepEqual(f.calls, []);
});

test('selection is conditional and unknown entities do not overwrite acknowledged content', async t => {
  const f = await setup(t), input = { id, expectedDigest: f.digest, expectedRevision: 0, keys: ['clade:test'] };
  const chosen = await run('select', input, f.ctx); assert.equal(chosen.revision, 1);
  await assert.rejects(run('select', { ...input, keys: [] }, f.ctx), /another view/);
  await assert.rejects(run('select', { ...input, expectedRevision: 1, keys: ['unbound'] }, f.ctx), /unknown entity/);
  await assert.rejects(run('select', { ...input, expectedDigest: '0'.repeat(64) }, f.ctx), /version changed/);
  const selected = await run('selection', { id, expectedDigest: f.digest }, f.ctx);
  assert.deepEqual(selected.entities[0].members, ['α', 'B']); assert.deepEqual(selected.keys, ['clade:test']);
  assert.deepEqual(f.calls, []);
});

test('concurrent writes have one winner and leave a readable selection', async t => {
  const f = await setup(t), input = { id, expectedDigest: f.digest, expectedRevision: 0, keys: ['clade:test'] };
  const results = await Promise.allSettled([run('select', input, f.ctx), run('select', input, { ...f.ctx, invocationId: 'second' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await run('selection', { id, expectedDigest: f.digest }, f.ctx)).revision, 1);
});

test('capture checks path containment and source budget before any write or native execution', async t => {
  const f = await setup(t), outside = await fs.mkdtemp(path.join(os.tmpdir(), 'rho-figure-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'private.rds'), 'outside');
  await fs.symlink(path.join(outside, 'private.rds'), path.join(f.root, 'link.rds'));
  await assert.rejects(run('capture', { adapter: 'ggtree', source: 'link.rds' }, f.ctx), /leaves the project/);
  await assert.rejects(run('capture', { adapter: 'ggtree', source: '../private.rds' }, f.ctx), /project-relative/);
  await fs.writeFile(path.join(f.root, 'large.rds'), Buffer.alloc(limits.sourceBytes + 1));
  await assert.rejects(run('capture', { adapter: 'ggtree', source: 'large.rds' }, f.ctx), /read limit/);
  assert.equal(f.calls.filter(c => c.method === 'kernel.run').length, 0);
  assert.deepEqual(await fs.readdir(path.join(f.root, '.rho-figures')), [id]);
});

test('capture preserves source bytes and returns the original native cell', async t => {
  const f = await setup(t);
  const result = await run('capture', { adapter: 'ggtree', source: 'source.rds', title: 'Unicode 树' }, f.ctx);
  assert.equal(result.cell.cellId, 'original-cell');
  assert.equal(await fs.readFile(path.join(f.root, '.rho-figures', result.id, 'source.rds'), 'utf8'), 'captured bytes');
  assert.equal(f.calls.filter(c => c.method === 'kernel.run').length, 1);
  assert.match(f.calls.find(c => c.method === 'kernel.run').input.code, /Unicode 树/);
  await assert.rejects(run('capture', { adapter: 'ggtree', source: 'source.rds' }, f.ctx), /EEXIST/);
  assert.equal(f.calls.filter(c => c.method === 'kernel.run').length, 1);
});
