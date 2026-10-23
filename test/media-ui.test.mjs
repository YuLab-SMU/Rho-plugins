import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWhole, mediaChunkBytes, mediaByteBudget } from '@rho-workspace/plugin-media/ui';

// The owner refuses a page larger than fileLimits.maxReadBytes (64 KiB) with a limit
// error, so the renderer must page at that size or larger files never display.
test('the renderer pages at the owner byte limit and rebuilds the bytes in order', async () => {
  assert.equal(mediaChunkBytes, 64 * 1024);
  const total = 150 * 1024;
  const calls = [];
  const bytes = Uint8Array.from({ length: total }, (_, i) => i % 251);
  const client = {
    async call(method, input) {
      calls.push(input.maxBytes);
      assert.equal(method, 'resource.read');
      if (input.maxBytes > 64 * 1024) { const error = new Error('limit'); error.error = { kind: 'limit' }; throw error; }
      const end = Math.min(input.offset + input.maxBytes, total);
      const slice = Buffer.from(bytes.subarray(input.offset, end)).toString('base64');
      return { data: slice, more: end < total, nextOffset: end };
    }
  };
  const whole = await readWhole(client, 'project', { id: 'a'.repeat(64), version: 'b'.repeat(64) });
  assert.equal(whole.length, total);
  assert.deepEqual(Array.from(whole.subarray(0, 4)), [0, 1, 2, 3]);
  assert.equal(whole[total - 1], (total - 1) % 251, 'the last byte is the last byte, not a truncation');
  assert.ok(calls.every(size => size <= 64 * 1024), 'no page exceeds the owner limit');
  assert.ok(calls.length >= 3, 'the read actually paged');
});

test('a file beyond the display budget is refused instead of silently truncated', async () => {
  let offset = 0;
  const client = { async call(_m, input) { const end = input.offset + input.maxBytes; return { data: Buffer.alloc(input.maxBytes).toString('base64'), more: true, nextOffset: end }; } };
  await assert.rejects(readWhole(client, 'p', { id: 'a'.repeat(64), version: 'b'.repeat(64) }, 32 * 1024), /display budget/);
});

test('a page that does not advance is refused rather than looped forever', async () => {
  const client = { async call() { return { data: 'AA==', more: true, nextOffset: 0 }; } };
  await assert.rejects(readWhole(client, 'p', { id: 'a'.repeat(64), version: 'b'.repeat(64) }), /in order/);
});
