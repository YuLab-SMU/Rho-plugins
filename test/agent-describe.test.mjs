import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describeFile, describeInput } from '../plugins/agent/dist/describe.js';
import { compactCatalog, findModel, callCost, loadModelCatalog } from '../plugins/agent/dist/models.js';

// A stand-in for Claude Code: it records its arguments and the message it was given on stdin,
// then answers as a stream, as told.
async function fake(answer) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'rho-describe-'));
  const bin = path.join(dir, 'claude');
  await fs.writeFile(bin, `#!/usr/bin/env node
const fs = require('node:fs');
let input = ''; process.stdin.on('data', d => input += d).on('end', () => {
  fs.writeFileSync(${JSON.stringify(path.join(dir, 'call.json'))}, JSON.stringify({ args: process.argv.slice(2), input: JSON.parse(input) }));
  const answer = ${JSON.stringify(answer)};
  if (answer === 'hang') return setInterval(() => {}, 1000);
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init' }) + '\\n');
  process.stdout.write(typeof answer === 'string' ? answer : JSON.stringify(answer) + '\\n');
});
`, { mode: 0o755 });
  return { bin, dir, call: async () => JSON.parse(await fs.readFile(path.join(dir, 'call.json'), 'utf8')) };
}
const used = { 'small-model': { inputTokens: 10, outputTokens: 40, cacheReadInputTokens: 0, cacheCreationInputTokens: 1000, costUSD: 0.012, costBasis: 'unknown' } };

test('a file is described in one sentence by Claude Code with no tools, no MCP servers and no kept session', async () => {
  const f = await fake({ type: 'result', is_error: false, result: '  Per-strain means\n and SDs of area. ', duration_ms: 900, total_cost_usd: 0.012, modelUsage: used });
  const said = await describeFile({ binary: f.bin, cwd: f.dir, model: 'small-model', path: 'results/summary.csv', facts: '15 rows × 4 columns: strain, n, mean, sd', excerpt: 'strain,n,mean,sd\n1,3,10,1\n', request: 'Compare the strains.' });
  assert.deepEqual(said, { text: 'Per-strain means and SDs of area.', model: 'small-model', durationMs: 900, costUsd: 0.012, costBasis: 'unknown', tokens: { input: 10, output: 40, cacheRead: 0, cacheWrite: 1000 } });
  const call = await f.call();
  assert.deepEqual(call.args.slice(0, 10), ['-p', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);
  assert.deepEqual(call.args.slice(-2), ['--model', 'small-model']);
  assert.match(call.args[11], /Say what the file holds/);
  const [text] = call.input.message.content;
  assert.match(text.text, /^File: results\/summary\.csv\nFacts read from the file: 15 rows × 4 columns/);
  assert.match(text.text, /The person's request to the Agent: Compare the strains\.\nFirst lines:\nstrain,n,mean,sd/);
});

test('a figure goes as an image to a model that takes images, and as what made it to one that does not', async () => {
  const f = await fake({ type: 'result', is_error: false, result: 'Bars of mean area by ratio.', modelUsage: used });
  await describeFile({ binary: f.bin, cwd: f.dir, path: 'plot.png', facts: 'PNG image, 3 × 2 px', strategy: 'image', image: { mediaType: 'image/png', data: Buffer.from('png-bytes') } });
  let call = await f.call();
  assert.deepEqual(call.input.message.content.map(c => c.type), ['image', 'text']);
  assert.deepEqual(call.input.message.content[0].source, { type: 'base64', media_type: 'image/png', data: Buffer.from('png-bytes').toString('base64') });
  assert.match(call.args[call.args.indexOf('--system-prompt') + 1], /You are shown the figure/);
  await describeFile({ binary: f.bin, cwd: f.dir, path: 'plot.png', facts: 'PNG image, 3 × 2 px', strategy: 'context', context: "plt.bar(ratios, area)\nplt.savefig('plot.png')" });
  call = await f.call();
  assert.deepEqual(call.input.message.content.map(c => c.type), ['text']);
  assert.match(call.input.message.content[0].text, /What made it:\nplt\.bar/);
  assert.match(call.args[call.args.indexOf('--system-prompt') + 1], /not shown the figure itself/);
  await assert.rejects(describeFile({ binary: f.bin, cwd: f.dir, path: 'big.png', facts: 'x', strategy: 'image', image: { mediaType: 'image/png', data: Buffer.alloc(64) }, limits: { maxImageBytes: 32 } }), /maxImageBytes/);
});

test('input is bounded, and an error, an empty answer or a call past its time is reported, not retried', async () => {
  assert.ok(Buffer.byteLength(describeInput({ path: 'a.txt', facts: 'x', excerpt: 'é'.repeat(10000) }, 512)) <= 512 + 6);
  const failed = await fake({ type: 'result', is_error: true, result: 'Model not found' });
  await assert.rejects(describeFile({ binary: failed.bin, cwd: failed.dir, path: 'a.txt', facts: 'x', excerpt: '' }), /Model not found/);
  const empty = await fake({ type: 'result', is_error: false, result: '  ' });
  await assert.rejects(describeFile({ binary: empty.bin, cwd: empty.dir, path: 'a.txt', facts: 'x', excerpt: '' }), /empty description/);
  const garbled = await fake('not json');
  await assert.rejects(describeFile({ binary: garbled.bin, cwd: garbled.dir, path: 'a.txt', facts: 'x', excerpt: '' }), /without a description/);
  const slow = await fake('hang');
  const started = Date.now();
  await assert.rejects(describeFile({ binary: slow.bin, cwd: slow.dir, path: 'a.txt', facts: 'x', excerpt: '', limits: { timeoutMs: 400, stopGraceMs: 200 } }), /longer than 0 s and was stopped/);
  assert.ok(Date.now() - started < 5000);
});

const raw = {
  anthropic: { models: { 'claude-opus-5-5': { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', canonical_model_id: 'anthropic/claude-opus-5-5', modalities: { input: ['text', 'image', 'pdf'] }, cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 } } } },
  'host-a': { models: { 'maker/fast-1': { id: 'maker/fast-1', canonical_model_id: 'maker/fast-1', modalities: { input: ['text', 'image'] }, cost: { input: 0.2, output: 0.6 } } } },
  'host-b': { models: { 'fast-1': { id: 'fast-1', canonical_model_id: 'maker/fast-1', modalities: { input: ['text', 'image'] }, cost: { input: 0.4, output: 1.2 } } } },
  'host-c': { models: { 'Maker/Fast-1': { id: 'Maker/Fast-1', canonical_model_id: 'maker/fast-1', modalities: { input: ['text'] }, cost: { input: 0, output: 0 } } } },
  textonly: { models: { 'reader-2': { id: 'reader-2', modalities: { input: ['text'] }, cost: { input: 1, output: 2 } } } },
};

test('a session\'s model is found on models.dev by its provider, its maker or every provider that lists it', () => {
  const catalog = compactCatalog(raw, '2026-10-30T00:00:00.000Z');
  const opus = findModel(catalog, 'auto/claude-opus-5-5');
  assert.deepEqual([opus.listed, opus.basis, opus.images, opus.price.input], ['anthropic/claude-opus-5-5', 'origin', true, 4]);
  const gateway = findModel(catalog, 'my-gateway/fast-1[1m]');
  assert.deepEqual([gateway.listed, gateway.basis, gateway.providers, gateway.images, gateway.price], ['maker/fast-1', 'median', 3, true, { input: 0.30000000000000004, output: 0.8999999999999999 }], 'a free listing is left out of the median');
  assert.deepEqual([findModel(catalog, 'host-b/fast-1').basis, findModel(catalog, 'host-b/fast-1').price.input], ['provider', 0.4]);
  assert.equal(findModel(catalog, 'reader-2').images, false);
  assert.equal(findModel(catalog, 'unlisted-9'), null);
  const tokens = { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 };
  assert.deepEqual(callCost({ costUsd: 0.01, costBasis: 'list', tokens }, gateway), { usd: 0.01, basis: 'reported', note: "Claude Code's list price" });
  const estimated = callCost({ costUsd: 0.015, costBasis: 'unknown', tokens }, gateway);
  assert.equal(estimated.basis, 'estimated'); assert.ok(Math.abs(estimated.usd - 0.0012) < 1e-9); assert.match(estimated.note, /median price for maker\/fast-1 across 3 providers/);
  assert.deepEqual(callCost({ costUsd: 0.015, costBasis: 'unknown', tokens }, null), { usd: null, basis: 'unknown', note: "Claude Code did not know this model's price and guessed $0.0150" });
});

test('the catalog is read from its file while fresh, fetched within its byte limit, and kept when a fetch fails', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'rho-models-')), file = path.join(dir, 'models-dev.json');
  let calls = 0;
  const body = JSON.stringify(raw), ok = async () => { calls++; return new Response(body, { status: 200 }); };
  let now = Date.parse('2026-10-30T00:00:00Z');
  const first = await loadModelCatalog(file, { fetch: ok, now: () => now });
  assert.equal(first.catalog.models.length, 5); assert.equal(calls, 1);
  await loadModelCatalog(file, { fetch: ok, now: () => now + 1000 }); assert.equal(calls, 1, 'fresh from the file');
  now += 25 * 3600 * 1000;
  const down = await loadModelCatalog(file, { fetch: async () => { calls++; throw new Error('offline'); }, now: () => now });
  assert.deepEqual([down.stale, down.catalog.models.length], [true, 5]); assert.match(down.problem, /offline/);
  await loadModelCatalog(file, { fetch: ok, now: () => now + 1000 }); assert.equal(calls, 2, 'not asked again right after a failure');
  const big = await loadModelCatalog(path.join(dir, 'other.json'), { fetch: ok, limits: { maxBytes: 100 } });
  assert.equal(big.catalog, null); assert.match(big.problem, /larger than maxBytes/);
});
