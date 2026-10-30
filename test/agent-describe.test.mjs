import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describeFile, describeInput } from '../plugins/agent/dist/describe.js';

// A stand-in for Claude Code: it records its arguments and input, then answers as told.
async function fake(answer) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'rho-describe-'));
  const bin = path.join(dir, 'claude');
  await fs.writeFile(bin, `#!/usr/bin/env node
const fs = require('node:fs');
let input = ''; process.stdin.on('data', d => input += d).on('end', () => {
  fs.writeFileSync(${JSON.stringify(path.join(dir, 'call.json'))}, JSON.stringify({ args: process.argv.slice(2), input, cwd: process.cwd() }));
  const answer = ${JSON.stringify(answer)};
  if (answer === 'hang') return setInterval(() => {}, 1000);
  process.stdout.write(typeof answer === 'string' ? answer : JSON.stringify(answer));
});
`, { mode: 0o755 });
  return { bin, dir, call: async () => JSON.parse(await fs.readFile(path.join(dir, 'call.json'), 'utf8')) };
}

test('a file is described in one sentence by Claude Code with no tools, no MCP servers and no kept session', async () => {
  const f = await fake({ type: 'result', is_error: false, result: '  Per-strain means\n and SDs of area. ', duration_ms: 900, total_cost_usd: 0.001, modelUsage: { 'small-model': {} } });
  const said = await describeFile({ binary: f.bin, cwd: f.dir, model: 'small-model', path: 'results/summary.csv', facts: '15 rows × 4 columns: strain, n, mean, sd', excerpt: 'strain,n,mean,sd\n1,3,10,1\n', request: 'Compare the strains.' });
  assert.deepEqual(said, { text: 'Per-strain means and SDs of area.', model: 'small-model', durationMs: 900, costUsd: 0.001 });
  const call = await f.call();
  assert.deepEqual(call.args.slice(0, 8), ['-p', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json', '--system-prompt']);
  assert.deepEqual(call.args.slice(-2), ['--model', 'small-model']);
  assert.match(call.input, /^File: results\/summary\.csv\nFacts read from the file: 15 rows × 4 columns/);
  assert.match(call.input, /The person's request to the Agent: Compare the strains\.\nFirst lines:\nstrain,n,mean,sd/);
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
