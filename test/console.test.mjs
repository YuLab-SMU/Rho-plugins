import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ConsoleRunner, consoleLimits } from '@rho-workspace/plugin-console';

// Windows has no /bin/sh; these run under Git for Windows' sh, as Core's own checks do, and a
// test of its own runs the default cmd.exe. There pwd -W names the folder as Windows does.
const windows = process.platform === 'win32';
const sh = windows ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'usr', 'bin', 'sh.exe') : '/bin/sh', pwd = windows ? 'pwd -W' : 'pwd';
const exited = pid => { try { process.kill(pid, 0); return false; } catch { return true; } };
// Ends what a command left running: its process group on Unix, its process tree on Windows.
const kill = pid => { if (windows) spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' }); else process.kill(-pid, 'SIGKILL'); };
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
  const runner = new ConsoleRunner(root, { shell: sh });
  const record = await runner.run({ command: pwd + '; echo é; echo oops >&2; exit 3', changeId: 'one', by: 'browser:local' });
  assert.equal(record.state, 'running');
  const done = await ended(runner, record.commandId);
  assert.equal(done.state, 'exited');
  assert.deepEqual(done.exit, { code: 3, signal: null });
  const out = await runner.output(record.commandId);
  assert.match(out.text, new RegExp((await fs.realpath(root)).replaceAll(path.sep, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\n'));
  assert.match(out.text, /é\n/); assert.match(out.text, /oops\n/);
  assert.equal(out.more, false); assert.equal(out.running, false);
  const inData = await runner.run({ command: pwd, cwd: 'data', changeId: 'two', by: 'browser:local' });
  await ended(runner, inData.commandId);
  assert.match((await runner.output(inData.commandId)).text, /\/data\n$/);
  await assert.rejects(runner.run({ command: 'pwd', cwd: '../', changeId: 'three', by: 'browser:local' }));
  await runner.close();
});

test('each command is a timeline event: who ran it, while it ran, in which folder and how it ended', async () => {
  const root = await project();
  await fs.mkdir(path.join(root, 'data'));
  const runner = new ConsoleRunner(root, { shell: sh });
  const ok = await runner.run({ command: 'true', changeId: 'ok', by: 'browser:local' });
  await ended(runner, ok.commandId);
  const bad = await runner.run({ command: 'exit 2', cwd: 'data', changeId: 'bad', by: 'browser:local' });
  await ended(runner, bad.commandId);
  const { events, omitted } = await runner.events();
  assert.equal(omitted, 0);
  assert.deepEqual(events.map(e => [e.id, e.by, e.label, e.where, e.outcome]), [[bad.commandId, 'browser:local', 'exit 2', 'Console in data', 'failed'], [ok.commandId, 'browser:local', 'true', 'Console', 'done']]);
  assert.ok(events.every(e => e.endedAt));
  const { plugin } = await import('@rho-workspace/plugin-console');
  assert.equal(plugin.timeline, 'console.events');
  await runner.close();
});

test('the same change identity never runs a command twice; a different command under it conflicts', async () => {
  const root = await project();
  const runner = new ConsoleRunner(root, { shell: sh });
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
  const runner = new ConsoleRunner(root, { shell: sh });
  const record = await runner.run({ command: windows ? 'sleep 30 & cat /proc/$!/winpid > child.pid; sleep 30; wait' : 'sleep 30 & sleep 30; wait', changeId: 'long', by: 'browser:local' });
  await new Promise(r => setTimeout(r, 100));
  const stopping = await runner.stop(record.commandId, 'browser:local');
  assert.equal(stopping.stop.by, 'browser:local');
  const done = await ended(runner, record.commandId);
  assert.equal(done.state, 'stopped');
  if (windows) assert.ok(exited(Number(await fs.readFile(path.join(root, 'child.pid'), 'utf8'))), "the command's own child has ended");
  else assert.throws(() => process.kill(-record.pid, 0));
  await runner.close();
});

test('output past the kept size is counted, not silently dropped, and pages end on whole characters', async () => {
  const root = await project();
  const runner = new ConsoleRunner(root, { shell: sh, limits: { maxOutputBytes: 1000, tailBytes: 100, maxReadBytes: 64 } });
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
  const runner = new ConsoleRunner(root, { shell: sh, limits: { maxRunning: 1 } });
  const first = await runner.run({ command: 'sleep 5', changeId: 'a', by: 'browser:local' });
  await assert.rejects(runner.run({ command: 'echo b', changeId: 'b', by: 'browser:local' }), e => e.kind === 'limit' && e.details?.limit === 'maxRunning');
  await runner.stop(first.commandId, 'browser:local');
  await ended(runner, first.commandId);
  await runner.close();
});

test('after a restart a command still running is continuing and a vanished one is unknown', async () => {
  const root = await project();
  const runner = new ConsoleRunner(root, { shell: sh });
  const alive = await runner.run({ command: 'sleep 5', changeId: 'alive', by: 'browser:local' });
  const gone = await runner.run({ command: 'sleep 5', changeId: 'gone', by: 'browser:local' });
  await runner.close();
  kill(gone.pid);
  await new Promise(r => setTimeout(r, 100));
  const next = new ConsoleRunner(root, { shell: sh });
  const records = (await next.list()).commands;
  assert.equal(records.find(r => r.commandId === alive.commandId).state, 'continuing');
  assert.equal(records.find(r => r.commandId === gone.commandId).state, 'unknown');
  // A restarted console does not run a known command again under its identity.
  assert.equal((await next.run({ command: 'sleep 5', changeId: 'alive', by: 'browser:local' })).commandId, alive.commandId);
  kill(alive.pid);
  await next.close();
});

test('limits are named and finite', () => {
  for (const value of Object.values(consoleLimits)) assert.ok(Number.isFinite(value) && value > 0);
});

test('on Windows a command runs in cmd.exe unless a shell is named, and Stop ends it', { skip: !windows && 'cmd.exe is the Windows default' }, async () => {
  const root = await project();
  const runner = new ConsoleRunner(root);
  const record = await runner.run({ command: 'cd & echo "a b" & echo oops 1>&2 & exit /b 3', changeId: 'one', by: 'browser:local' });
  const done = await ended(runner, record.commandId);
  assert.equal(done.state, 'exited');
  assert.deepEqual(done.exit, { code: 3, signal: null });
  const out = (await runner.output(record.commandId)).text;
  assert.match(out, new RegExp((await fs.realpath(root)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\r?\n'));
  assert.match(out, /"a b"/); assert.match(out, /oops/);
  // ping goes on past a Ctrl+Break, so Stop has to end it after the grace period.
  const long = await runner.run({ command: 'ping -n 30 127.0.0.1 >nul', changeId: 'long', by: 'browser:local' });
  await new Promise(r => setTimeout(r, 300));
  await runner.stop(long.commandId, 'browser:local');
  assert.equal((await ended(runner, long.commandId, 20000)).state, 'stopped');
  await runner.close();
});
