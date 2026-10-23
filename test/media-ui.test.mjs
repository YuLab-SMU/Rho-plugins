import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWhole } from '@rho-workspace/plugin-media/ui';
const ref = { id: 'a'.repeat(64), version: 'b'.repeat(64) };
function source(data, limit = 4096) {
  const calls = [];
  return { calls, async call(method, input) {
    calls.push(input); assert.equal(method, 'resource.read');
    const size = input.maxBytes ?? limit; assert.ok(size <= limit);
    const end = Math.min(data.length, input.offset + size);
    return { resource: { ...ref, bytes: data.length }, encoding: 'base64', offset: input.offset, nextOffset: end, more: end < data.length, maxReadBytes: limit, data: data.subarray(input.offset, end).toString('base64') };
  } };
}
test('media negotiates a non-default owner page size and preserves every byte', async () => {
  const bytes = Buffer.from(Array.from({ length: 150 * 1024 }, (_, i) => i % 251)), client = source(bytes);
  assert.deepEqual(Buffer.from(await readWhole(client, 'p', ref)), bytes);
  assert.ok(client.calls.length > 30); assert.equal(client.calls[0].maxBytes, undefined);
  assert.ok(client.calls.slice(1).every(c => c.maxBytes === 4096));
});
test('oversized media is refused after metadata instead of downloading the whole file', async () => {
  const client = source(Buffer.alloc(100000));
  await assert.rejects(readWhole(client, 'p', ref, 8192), /display budget/); assert.equal(client.calls.length, 1);
});
test('media rejects inconsistent progress, changed references and early EOF', async () => {
  for (const override of [{ nextOffset: 0 }, { offset: 8 }, { resource: { ...ref, version: 'c'.repeat(64), bytes: 9000 } }, { more: false }]) {
    const client = source(Buffer.alloc(9000)), call = client.call.bind(client);
    client.call = async (...args) => ({ ...await call(...args), ...override });
    await assert.rejects(readWhole(client, 'p', ref), /in order|identity/);
  }
});
test('closing a media view cancels paging without another resource request', async () => {
  const controller = new AbortController(), client = source(Buffer.alloc(9000)), call = client.call.bind(client);
  client.call = async (...args) => { const page = await call(...args); controller.abort(); return page; };
  await assert.rejects(readWhole(client, 'p', ref, 10000, undefined, controller.signal), { name: 'AbortError' }); assert.equal(client.calls.length, 1);
});
