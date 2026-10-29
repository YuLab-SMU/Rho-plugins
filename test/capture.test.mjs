import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Files } from '../plugins/files/dist/index.js';
import { Tables, declarationValidator } from '../plugins/tables/dist/index.js';

test('captured code remains readable after overwrites, deletion and duplicate captures', async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rho-capture-'));
 try {
  const files = new Files(root, 'p'); const file = path.join(root, '脚本.py');
  await fs.writeFile(file, 'print("old")\n'); const a = await files.capture('脚本.py');
  assert.equal((await files.capture('脚本.py')).id, a.id);
  await fs.writeFile(file, 'print("new")\n'); const b = await files.capture('脚本.py');
  assert.notEqual(a.id, b.id); await fs.rm(file);
  assert.equal((await files.bytes(a)).data.toString(), 'print("old")\n');
  assert.equal((await files.bytes(b)).data.toString(), 'print("new")\n');
  assert.equal(a.provenance.producerConfirmed, false);
  await assert.rejects(files.capture('../outside'), e => e.kind === 'scope');
  await fs.symlink('/etc/hosts', path.join(root, 'link'));
  await assert.rejects(files.capture('link'), e => e.kind === 'scope');
 } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('snapshot budgets refuse new bytes and preserve captured resources; buffers stay distinct', async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rho-capture-budget-'));
 try {
  const files = new Files(root, 'p', { maxArtifactBytes: 10 });
  await fs.writeFile(path.join(root, 'a.txt'), 'abc'); const a = await files.capture('a.txt');
  const buffer = await files.captureBytes(Buffer.from('draft'), { path: 'a.txt', kind: 'file', format: { mimeType: 'text/plain' } }, { kind: 'buffer', documentId: 'd', version: 2, dirty: true });
  assert.notEqual(a.id, buffer.id); assert.equal(buffer.provenance.observation.dirty, true);
  await fs.writeFile(path.join(root, 'b.txt'), 'too large');
  await assert.rejects(files.capture('b.txt'), e => e.kind === 'limit');
  assert.equal((await files.bytes(a)).data.toString(), 'abc');
  await assert.rejects(files.capture('a.txt', { expectedDigest: '0'.repeat(64) }), e => e.kind === 'stale');
 } finally { await fs.rm(root, { recursive: true, force: true }); }
});
