import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Files } from '@rho-workspace/plugin-files';

test('file registration, verification and range reads never buffer entire source or snapshot files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rho-byte-pages-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = Buffer.alloc(3 * 1024 * 1024, 79), file = path.join(root, 'large.bin'); await fs.writeFile(file, bytes);
  const owner = new Files(root, 'p', { maxReadBytes: 4096 });
  const readFile = fs.readFile;
  fs.readFile = async (name, ...args) => { assert.ok(String(name) !== file && !String(name).includes('/snapshots/'), 'large bytes must use bounded IO'); return readFile(name, ...args); };
  try {
    const registered = await owner.register('large.bin', { operationId: 'source' }, 'available'), ref = { id: registered.id, version: registered.version };
    for (const offset of [0, 4096, 40960, bytes.length - 11]) {
      const page = await owner.read(ref, offset); assert.deepEqual(Buffer.from(page.data, 'base64'), bytes.subarray(offset, offset + 4096)); assert.equal(page.maxReadBytes, 4096);
    }
    await assert.rejects(owner.read(ref, 0, 0), { kind: 'limit' });
    await assert.rejects(owner.read(ref, 0, 4097), { kind: 'limit' });
    const handle = await fs.open(file, 'r+'); await handle.write(Buffer.from('changed'), 0, 7, 4096); await handle.close();
    await assert.rejects(owner.read(ref, 4096), { kind: 'stale' });
  } finally { fs.readFile = readFile; }
});
