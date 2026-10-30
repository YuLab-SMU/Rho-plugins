import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ConsoleRunner, consoleLimits } from '@rho-workspace/plugin-console';

async function project() { return fs.mkdtemp(path.join(tmpdir(), 'rho-console-')); }
async function ended(runner, commandId, ms = 5000) {
  const until = Date.now() + ms;
  for (;;) {
    const record = (await runner.list()).commands.find(c => c.commandId === commandId);
    if (record.state !== 'running') return record;
    if (Date.now() > until) throw new Error('The command did not end.');
    await new Promise(r => setTimeout(r, 25));
  }
}

test('a command runs in the project folder, keeps its output and how it ended', async () => {
  const root = await project();
  await fs.mkdir(path.join(root, 'data'));
  const runner = new ConsoleRunner(root, { shell: '/bin/sh' });
  const record = await runner.run({ command: 'pwd; echo é; echo oops >&2; exit 3', changeId: 'one', by: 'browser:local' });
  assert.equal(record.state, 'running');
  const done = await ended(runner, record.commandId);
  assert.equal(done.state, 'exited');
  assert.deepEqual(done.exit, { code: 3, signal: null });
  const out = await runner.output(record.commandId);
  assert.match(out.text, new RegExp((await fs.realpath(root)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\n'));
  assert.match(out.text, /é\n/); assert.match(out.text, /oops\n/);
  assert.equal(out.more, false); assert.equal(out.running, false);
  const inData = await runner.run({ command: 'pwd', cwd: 'data', changeId: 'two', by: 'browser:local' });
  await ended(runner, inData.commandId);
  assert.match((await runner.output(inData.commandId)).text, /\/data\n$/);
  await assert.rejects(runner.run({ command: 'pwd', cwd: '../', changeId: 'three', by: 'browser:local' }));
  await runner.close();
});

test('the same change identity never runs a command twice; a different command under it conflicts', async () => {
  const root = await project();
  const runner = new ConsoleRunner(root, { shell: '/bin/sh' });
  const first = await runner.run({ command: 'echo x >> count.txt', changeId: 'same', by: 'browser:local' });
  await ended(runner, first.commandId);
  const again = await runner.run({ command: 'echo x >> count.txt', changeId: 'same', by: 'browser:local' });
  assert.equal(again.commandId, first.commandId);
  assert.equal(await fs.readFile(path.join(root, 'count.txt'), 'utf8'), 'x\n');
  await assert.rejects(runner.run({ command: 'echo y', changeId: 'same', by: 'browser:local' }), e => e.kind === 'conflict');
  await runner.close();
});

test('stop reaches the processes a command started', async () => {
  const root = await project();
  const runner = new ConsoleRunner(root, { shell: '/bin/sh' });
  const record = await runner.run({ command: 'sleep 30 & sleep 30; wait', changeId: 'long', by: 'browser:local' });
  await new Promise(r => setTimeout(r, 100));
  const stopping = await runner.stop(record.commandId, 'browser:local');
  assert.equal(stopping.stop.by, 'browser:local');
  const done = await ended(runner, record.commandId);
  assert.equal(done.state, 'stopped');
  assert.throws(() => process.kill(-record.pid, 0));
  await runner.close();
});

test('output past the kept size is counted, not silently dropped, and pages end on whole characters', async () => {
  const root = await project();
  const runner = new ConsoleRunner(root, { shell: '/bin/sh', limits: { maxOutputBytes: 1000, tailBytes: 100, maxReadBytes: 64 } });
  const record = await runner.run({ command: "i=0; while [ $i -lt 400 ]; do printf 'éééééééé\\n'; i=$((i+1)); done; echo last-line", changeId: 'big', by: 'browser:local' });
  const done = await ended(runner, record.commandId);
  assert.equal(done.cut, true);
  assert.ok(done.bytes > done.kept);
  let offset = 0, text = '';
  for (;;) {
    const page = await runner.output(record.commandId, offset, 64);
    assert.doesNotMatch(page.text, /�/);
    text += page.text; offset = page.nextOffset;
    if (!page.more) break;
  }
  assert.match(text, /… [\d,]+ bytes not kept …/);
  assert.match(text, /last-line\n$/);
  await assert.rejects(runner.output(record.commandId, 0, 65), e => e.kind === 'limit');
  await runner.close();
});

test('too many running commands are refused with the named limit', async () => {
  const root = await project();
  const runner = new ConsoleRunner(root, { shell: '/bin/sh', limits: { maxRunning: 1 } });
  const first = await runner.run({ command: 'sleep 5', changeId: 'a', by: 'browser:local' });
  await assert.rejects(runner.run({ command: 'echo b', changeId: 'b', by: 'browser:local' }), e => e.kind === 'limit' && e.details?.limit === 'maxRunning');
  await runner.stop(first.commandId, 'browser:local');
  await ended(runner, first.commandId);
  await runner.close();
});

test('after a restart a command still running is continuing and a vanished one is unknown', async () => {
  const root = await project();
  const runner = new ConsoleRunner(root, { shell: '/bin/sh' });
  const alive = await runner.run({ command: 'sleep 5', changeId: 'alive', by: 'browser:local' });
  const gone = await runner.run({ command: 'sleep 5', changeId: 'gone', by: 'browser:local' });
  await runner.close();
  process.kill(-gone.pid, 'SIGKILL');
  await new Promise(r => setTimeout(r, 100));
  const next = new ConsoleRunner(root, { shell: '/bin/sh' });
  const records = (await next.list()).commands;
  assert.equal(records.find(r => r.commandId === alive.commandId).state, 'continuing');
  assert.equal(records.find(r => r.commandId === gone.commandId).state, 'unknown');
  // A restarted console does not run a known command again under its identity.
  assert.equal((await next.run({ command: 'sleep 5', changeId: 'alive', by: 'browser:local' })).commandId, alive.commandId);
  process.kill(-alive.pid, 'SIGKILL');
  await next.close();
});

test('limits are named and finite', () => {
  for (const value of Object.values(consoleLimits)) assert.ok(Number.isFinite(value) && value > 0);
});
