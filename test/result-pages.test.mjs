import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ResultPages } from '../plugins/agent/dist/result-pages.js';

test('large replies retain exact values while JSON pointers and Unicode text pages stay within budget', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rho-results-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  let executed = 0, allowed = true;
  const authorize = async method => { assert.equal(method, 'document.read'); if (!allowed) throw Object.assign(new Error('revoked'), { kind: 'scope' }); };
  const pages = new ResultPages(root, 'one', authorize);
  const content = '中文 🧬 <>&\\n'.repeat(6000), original = { apiVersion: '2.0', ok: true, value: { 'a/b~c': content, rows: Array.from({ length: 100 }, (_, i) => ({ i, text: 'x'.repeat(600) })) } };
  const response = await pages.deliver('document.read', async () => { executed++; return original; }, 1024);
  assert.equal(response.complete, false); assert.ok(Buffer.byteLength(JSON.stringify(response)) < 1024);
  const ref = response.result.ref;
  const top = await pages.read({ ref }); assert.deepEqual(top.entries.map(e => e.key), ['apiVersion', 'ok', 'value']);
  let offset = 0, text = '';
  for (;;) {
    const page = await pages.read({ ref, path: '/value/a~1b~0c', offset, maxBytes: 1024 });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) + 64 <= 1024); text += page.value;
    assert.equal(page.value.includes('\ufffd'), false);
    if (page.complete) break; assert.ok(page.next > offset); offset = page.next;
  }
  assert.equal(text, content); assert.equal(executed, 1);
  const rows = await pages.read({ ref, path: '/value/rows', offset: 20, limit: 2, maxBytes: 1024 });
  assert.deepEqual(rows.entries.map(e => e.key), ['20', '21']); assert.equal(rows.entries[0].type, 'object'); assert.equal('value' in rows.entries[0], false);
  const restarted = new ResultPages(root, 'one', authorize); assert.equal((await restarted.read({ ref, path: '/ok' })).value, true);
  allowed = false; await assert.rejects(restarted.read({ ref }), { kind: 'scope' }); allowed = true;
  await assert.rejects(new ResultPages(root, 'other', authorize).read({ ref }), { kind: 'not_found' });
  allowed = false; await restarted.read({ ref, release: true }); await assert.rejects(pages.read({ ref }), { kind: 'not_found' }); assert.equal(executed, 1);
});

test('result retention exhaustion refuses the next operation before it is invoked', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rho-results-full-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pages = new ResultPages(root, 'one', async () => {}, { maxResultBytes: 4096, maxRetainedBytes: 8192, maxResults: 1 });
  let executed = 0;
  const first = await pages.deliver('document.read', async () => { executed++; return { ok: true, value: 'x'.repeat(2000) }; }, 1024);
  await assert.rejects(pages.deliver('action.submit', async () => { executed++; return { ok: true }; }), { kind: 'limit' }); assert.equal(executed, 1);
  assert.equal((await pages.read({ ref: first.result.ref, path: '/value', maxBytes: 4096 })).value.length, 2000);
});
