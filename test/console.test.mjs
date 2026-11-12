import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

// The terminal: the person's shell on a pseudo-terminal. Python opens it on macOS and Linux, the
// console host (ConPTY) on Windows, where these tests have counterparts of their own below.
import { TerminalHost, terminalLimits } from '@rho-workspace/plugin-console';
const posixOnly = windows && 'it runs /bin/sh; Windows has its own test below';
const windowsOnly = !windows && 'the console host is Windows\' own';
// Reads until the text printed so far matches, or the shell ends.
async function until(host, terminalId, pattern, state = { at: 0, text: '' }, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const read = await host.read(terminalId, state.at, 200);
    state.at = read.nextOffset; state.text += Buffer.from(read.data, 'base64').toString('utf8'); state.terminal = read.terminal;
    if (pattern.test(state.text) || (read.terminal.endedAt && !read.more)) return state;
    if (Date.now() > end) throw new Error('The terminal did not print ' + pattern + ': ' + JSON.stringify(state.text.slice(-300)));
  }
}

test('a terminal is a shell on a real terminal: it has a size, takes keys and Ctrl+C, and says how it ended', { skip: posixOnly }, async t => {
  const root = await project(), host = new TerminalHost(root, { shell: '/bin/sh' });
  t.after(() => host.shutdown());
  const { terminal } = await host.open({ cols: 80, rows: 24, by: 'browser:local' });
  assert.match(terminal.terminalId, /^t-[a-f0-9]{16}$/);
  const seen = { at: 0, text: '' };
  host.write(terminal.terminalId, 'test -t 0 && stty size && echo "term=$TERM" && pwd\n');
  await until(host, terminal.terminalId, /24 80\r\nterm=xterm-256color\r\n.*rho-console-/s, seen);
  host.resize(terminal.terminalId, 100, 30);
  host.write(terminal.terminalId, 'stty size\n');
  await until(host, terminal.terminalId, /30 100\r\n/, seen);
  // Ctrl+C reaches the running program through the terminal, and the shell goes on.
  host.write(terminal.terminalId, 'sleep 30\n');
  await new Promise(r => setTimeout(r, 300));
  host.write(terminal.terminalId, '\x03');
  host.write(terminal.terminalId, 'echo "after=$?"\n');
  await until(host, terminal.terminalId, /after=130\r\n/, seen);
  assert.deepEqual(host.list().terminals.map(t => [t.terminalId, t.cols, t.rows, t.endedAt]), [[terminal.terminalId, 100, 30, null]]);
  host.write(terminal.terminalId, 'exit 3\n');
  const last = await until(host, terminal.terminalId, /never printed/, seen);
  assert.deepEqual(last.terminal.exit, { code: 3, signal: null });
  await assert.rejects(async () => host.write(terminal.terminalId, 'x'), e => e.kind === 'condition');
  host.close(terminal.terminalId);
  await assert.rejects(host.read(terminal.terminalId, 0), e => e.kind === 'not_found');
});

test('an Agent reads a terminal as text and types in it: its screen, a command\'s settled output, a full-screen program, and who typed', { skip: posixOnly }, async t => {
  const root = await project(), host = new TerminalHost(root, { shell: '/bin/sh', limits: { quietMs: 300 } });
  t.after(() => host.shutdown());
  const { terminal } = await host.open({ cols: 40, rows: 10, by: 'browser:local' });
  await host.screen(terminal.terminalId, { after: 0, waitMs: 8000 });
  // The person's own typing is theirs; the Agent's is kept as the latest input of another.
  const set = host.write(terminal.terminalId, 'PS1="$ "\n', 'browser:local');
  assert.equal(host.list().terminals[0].typedBy ?? null, null);
  await host.screen(terminal.terminalId, { after: set.offset, waitMs: 8000 });
  const sent = host.write(terminal.terminalId, 'printf "\\033[31mred\\033[0m %s\\n" one; echo two; echo a-line-much-longer-than-forty-columns-to-wrap-it\r', 'agent:a');
  assert.equal(typeof sent.offset, 'number');
  const after = await host.screen(terminal.terminalId, { after: sent.offset, waitMs: 10000 });
  assert.equal(after.quiet, true, 'the output came and stopped');
  assert.equal(after.fullScreen, false);
  assert.ok(after.lines.includes('red one') && after.lines.includes('two'), 'colours stripped: ' + JSON.stringify(after.lines));
  assert.ok(after.lines.includes('a-line-much-longer-than-forty-columns-to-wrap-it'), 'a wrapped line is joined again');
  assert.equal(after.lines.at(-1), '$ ', 'the prompt is last, nothing below it');
  assert.equal(after.terminal.typedBy.by, 'agent:a');
  // Nothing printed within the wait: not quiet, and the screen as it is.
  const idle = await host.screen(terminal.terminalId, { after: after.offset, waitMs: 400 });
  assert.equal(idle.quiet, false); assert.equal(idle.offset, after.offset);
  // A full-screen program has the screen until it is left.
  const opened = host.write(terminal.terminalId, 'printf "\\033[?1049h\\033[Hfull screen"; sleep 2; printf "\\033[?1049l"\r', 'agent:a');
  const full = await host.screen(terminal.terminalId, { after: opened.offset, waitMs: 1500 });
  assert.equal(full.fullScreen, true); assert.ok(full.lines.some(l => l.startsWith('full screen')));
  assert.ok((await host.screen(terminal.terminalId, { lines: 2 })).lines.length <= 2);
  await assert.rejects(host.screen(terminal.terminalId, { lines: 501 }), e => e.kind === 'limit');
});

test('terminal limits: how many are open, the scrollback kept, and one write', { skip: posixOnly }, async t => {
  const root = await project(), host = new TerminalHost(root, { shell: '/bin/sh', limits: { maxTerminals: 1, scrollbackBytes: 4096, maxWriteBytes: 16 } });
  t.after(() => host.shutdown());
  const { terminal } = await host.open({ cols: 80, rows: 24, by: 'browser:local' });
  await assert.rejects(host.open({ cols: 80, rows: 24, by: 'browser:local' }), e => e.kind === 'limit' && e.details.limit === 'maxTerminals');
  await assert.rejects(host.open({ cols: 1, rows: 24, by: 'browser:local' }), e => e.kind === 'invalid');
  await assert.rejects(async () => host.write(terminal.terminalId, 'x'.repeat(17)), e => e.kind === 'limit' && e.details.limit === 'maxWriteBytes');
  // Far more than the scrollback, and than one read of the terminal (64 KiB): a reader from the
  // start is told how much is gone.
  host.write(terminal.terminalId, 'seq 1 30000\n');
  await until(host, terminal.terminalId, /29999\r\n30000\r\n/);
  const read = await host.read(terminal.terminalId, 0);
  assert.ok(read.dropped > 30000, 'older output is counted, not returned');
  assert.equal(read.offset, read.terminal.kept);
  assert.ok(read.terminal.bytes - read.terminal.kept < 4096 + 65536, 'about the scrollback is kept');
  await assert.rejects(host.read(terminal.terminalId, 0, 0, terminalLimits.maxReadBytes + 1), e => e.kind === 'limit');
  // Its shell ended, the terminal makes room for another.
  host.write(terminal.terminalId, 'exit\n');
  await until(host, terminal.terminalId, /never printed/);
  const next = await host.open({ cols: 80, rows: 24, by: 'browser:local' });
  assert.notEqual(next.terminal.terminalId, terminal.terminalId);
  // Rho closing hangs up what is open.
  assert.equal(host.list().terminals.length, 1);
  host.shutdown();
  assert.deepEqual(host.list().terminals, []);
});

// On Windows the console host draws the screen, and its bytes carry its own cursor moves, so these
// read what the terminal shows. cmd.exe is Windows' own shell; node prints what printf does elsewhere.
const cmdExe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
const node = `"${process.execPath}"`;
async function showing(host, terminalId, pattern, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const screen = await host.screen(terminalId, { lines: 500 });
    const text = screen.lines.join('\n');
    if (pattern.test(text)) return screen;
    if (screen.terminal.endedAt || Date.now() > end) throw new Error('The terminal did not show ' + pattern + ': ' + JSON.stringify(text.slice(-400)));
    await new Promise(r => setTimeout(r, 100));
  }
}
const endedIn = async (host, ms = 10000) => { for (let i = 0; i < ms / 100 && !host.list().terminals[0].endedAt; i++) await new Promise(r => setTimeout(r, 100)); return host.list().terminals[0]; };

test('on Windows a terminal is a shell on the console host: it has a size, takes keys and Ctrl+C, and says how it ended', { skip: windowsOnly }, async t => {
  const root = await project(), host = new TerminalHost(root, { shell: cmdExe });
  t.after(() => host.shutdown());
  const { terminal } = await host.open({ cols: 80, rows: 24, by: 'browser:local' });
  const id = terminal.terminalId;
  assert.match(id, /^t-[a-f0-9]{16}$/);
  assert.equal(terminal.windowsPty.backend, 'conpty');
  await showing(host, id, />$/m);
  host.write(id, 'mode con | findstr "Lines Columns" & echo term=%TERM% & cd\r');
  await showing(host, id, /Lines:\s+24\n\s*Columns:\s+80\nterm=xterm-256color\s*\n.*rho-console-/);
  host.resize(id, 100, 30);
  host.write(id, 'mode con | findstr "Lines Columns"\r');
  await showing(host, id, /Lines:\s+30\n\s*Columns:\s+100/);
  // Ctrl+C reaches the running program, though whatever started Rho may have it ignored.
  host.write(id, 'ping -n 30 127.0.0.1\r');
  await showing(host, id, /Reply from 127\.0\.0\.1/);
  const stopped = Date.now();
  host.write(id, '\x03');
  await showing(host, id, /Control-C[\s\S]*>$/);
  assert.ok(Date.now() - stopped < 10000, 'ping stopped at once');
  // A program Ctrl+C ended exits with STATUS_CONTROL_C_EXIT (0xC000013A), Windows' 128 + SIGINT.
  host.write(id, 'echo after=%errorlevel%\r');
  await showing(host, id, /^after=-1073741510$/m);
  assert.deepEqual(host.list().terminals.map(t => [t.terminalId, t.cols, t.rows, t.endedAt]), [[id, 100, 30, null]]);
  host.write(id, 'exit 3\r');
  assert.deepEqual((await endedIn(host)).exit, { code: 3, signal: null });
  await assert.rejects(async () => host.write(id, 'x'), e => e.kind === 'condition');
  host.close(id);
  await assert.rejects(host.read(id, 0), e => e.kind === 'not_found');
});

test('on Windows an Agent reads a terminal as text and types in it: its screen, a command\'s settled output, a full-screen program, and who typed', { skip: windowsOnly }, async t => {
  const root = await project(), host = new TerminalHost(root, { shell: cmdExe, limits: { quietMs: 500 } });
  t.after(() => host.shutdown());
  const { terminal } = await host.open({ cols: 40, rows: 10, by: 'browser:local' });
  const id = terminal.terminalId;
  await showing(host, id, />$/m);
  const set = host.write(id, 'prompt $$$S\r', 'browser:local');
  assert.equal(host.list().terminals[0].typedBy ?? null, null);
  await host.screen(id, { after: set.offset, waitMs: 8000 });
  const sent = host.write(id, `${node} -e "console.log('\\x1b[31mred\\x1b[0m one')" & echo two & echo a-line-much-longer-than-forty-columns-to-wrap-it\r`, 'agent:a');
  const after = await host.screen(id, { after: sent.offset, waitMs: 10000 });
  assert.equal(after.quiet, true, 'the output came and stopped');
  assert.equal(after.fullScreen, false);
  // cmd's echo keeps the space before &, and the console host clears the end of a line rather
  // than printing its spaces, so the prompt reads '$'.
  const lines = after.lines.map(l => l.trimEnd());
  assert.ok(lines.includes('red one') && lines.includes('two'), 'colours stripped: ' + JSON.stringify(after.lines));
  assert.ok(lines.includes('a-line-much-longer-than-forty-columns-to-wrap-it'), 'a wrapped line is joined again');
  assert.equal(lines.at(-1), '$', 'the prompt is last, nothing below it');
  assert.equal(after.terminal.typedBy.by, 'agent:a');
  // Nothing printed within the wait: not quiet, and the screen as it is.
  const idle = await host.screen(id, { after: after.offset, waitMs: 400 });
  assert.equal(idle.quiet, false); assert.equal(idle.offset, after.offset);
  // A full-screen program has the screen until it is left, when the console host passes the switch
  // to the alternate screen on, as Windows 11's (build 26100) does; Windows Server 2022's (20348)
  // draws the program's screen as the main one, and there it is not seen as full screen.
  const opened = host.write(id, `${node} -e "process.stdout.write('\\x1b[?1049h\\x1b[Hfull screen'); setTimeout(() => process.stdout.write('\\x1b[?1049l'), 2000)"\r`, 'agent:a');
  const full = await showing(host, id, /^full screen/m);
  const switched = Buffer.from((await host.read(id, opened.offset)).data, 'base64').includes('\x1b[?1049h');
  if (!switched) t.diagnostic('this console host does not pass the alternate screen on');
  assert.equal(full.fullScreen, switched);
  assert.ok((await host.screen(id, { lines: 2 })).lines.length <= 2);
  await assert.rejects(host.screen(id, { lines: 501 }), e => e.kind === 'limit');
});

test('on Windows terminal limits: how many are open, the scrollback kept, and one write', { skip: windowsOnly }, async t => {
  const root = await project();
  await fs.writeFile(path.join(root, 'n.txt'), Array.from({ length: 30000 }, (_, i) => String(i + 1) + '\r\n').join(''));
  const host = new TerminalHost(root, { shell: cmdExe, limits: { maxTerminals: 1, scrollbackBytes: 4096, maxWriteBytes: 16 } });
  t.after(() => host.shutdown());
  const { terminal } = await host.open({ cols: 80, rows: 24, by: 'browser:local' });
  const id = terminal.terminalId;
  await assert.rejects(host.open({ cols: 80, rows: 24, by: 'browser:local' }), e => e.kind === 'limit' && e.details.limit === 'maxTerminals');
  await assert.rejects(host.open({ cols: 1, rows: 24, by: 'browser:local' }), e => e.kind === 'invalid');
  await assert.rejects(async () => host.write(id, 'x'.repeat(17)), e => e.kind === 'limit' && e.details.limit === 'maxWriteBytes');
  // Far more than the scrollback, and than one read of the terminal (64 KiB): a reader from the
  // start is told how much is gone.
  await showing(host, id, />$/m);
  host.write(id, 'type n.txt\r');
  await showing(host, id, /^29999\n30000\n[\s\S]*>$/m);
  const read = await host.read(id, 0);
  assert.ok(read.dropped > 30000, 'older output is counted, not returned');
  assert.equal(read.offset, read.terminal.kept);
  assert.ok(read.terminal.bytes - read.terminal.kept < 4096 + 65536, 'about the scrollback is kept');
  await assert.rejects(host.read(id, 0, 0, terminalLimits.maxReadBytes + 1), e => e.kind === 'limit');
  // Its shell ended, the terminal makes room for another.
  host.write(id, 'exit\r');
  assert.ok((await endedIn(host)).endedAt);
  const next = await host.open({ cols: 80, rows: 24, by: 'browser:local' });
  assert.notEqual(next.terminal.terminalId, id);
  // Rho closing hangs up what is open.
  assert.equal(host.list().terminals.length, 1);
  host.shutdown();
  assert.deepEqual(host.list().terminals, []);
});

// zsh, bash and fish mark each command for Rho, and sh, dash and ksh their prompt; on Windows, Git
// Bash marks its commands as bash does. A home of its own keeps the machine's startup files out.
const gitBash = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
const shells = (windows ? [gitBash] : ['/bin/bash', '/bin/zsh', '/usr/bin/zsh', '/usr/bin/fish', '/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/bin/sh', '/bin/dash', '/usr/bin/dash', '/bin/ksh', '/usr/bin/ksh', '/usr/bin/ksh93', '/bin/mksh', '/usr/bin/mksh'])
  .filter(file => { try { return spawnSync(file, ['-c', 'true']).status === 0; } catch { return false; } });
const one = list => [...new Set(list.map(s => path.basename(s)))].map(name => list.find(s => path.basename(s) === name));
// A shell's name, without Windows' .exe.
const named = shell => path.basename(shell).replace(/\.exe$/i, '');
// What a shell is: /bin/sh and ksh may be another shell by another name.
const real = shell => { try { return named(fsSync.realpathSync(shell)); } catch { return named(shell); } };
const sideways = shell => ['mksh', 'mksh-static', 'pdksh', 'oksh'].includes(real(shell));
// Where each keeps Rho's history of its commands; dash keeps none.
const historyFile = (shell, root, home) => {
  const name = named(shell);
  if (name === 'fish') return path.join(home, '.local/share/fish', 'rho_' + createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 12) + '_history');
  return real(shell) === 'dash' ? null : path.join(root, '.rho/plugins/console/history', (['zsh', 'bash'].includes(name) ? name : 'sh') + '_history');
};
for (const shell of one(shells.filter(s => !sideways(s)))) {
  test(`a ${named(shell)} terminal records each command with who typed it, keeps its own history, and ignores a mark without its nonce`, async t => {
    const root = await project(), home = await fs.mkdtemp(path.join(tmpdir(), 'rho-home-'));
    await fs.mkdir(path.join(root, 'sub'));
    // Under the console host a shell waits before each mark, and takes longer to start.
    const options = { shell, env: { HOME: home, ZDOTDIR: home, HISTFILE: path.join(home, 'machine_history'), XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), ENV: undefined }, limits: { quietMs: windows ? 800 : 300 } };
    const host = new TerminalHost(root, options);
    t.after(() => host.shutdown());
    const { terminal } = await host.open({ cols: 60, rows: 12, by: 'browser:local' });
    const id = terminal.terminalId;
    await host.screen(id, { after: 0, waitMs: windows ? 25000 : 8000 });
    const type = async (text, by) => host.screen(id, { after: host.write(id, text, by).offset, waitMs: 8000 });
    await type('cd sub && echo "one; 中文"\r', 'browser:local');
    await type('printf "a\\nb"; false\r', 'agent:a');
    // Both type a line; a fake mark printed by a program changes nothing.
    host.write(id, 'ls /no-such-', 'browser:local');
    await type('folder; printf "\\033]6973;forged;S;rm -rf /;/\\007"\r', 'agent:a');
    assert.equal(host.list().terminals[0].recording, true);
    const { commands } = await host.commandList(10);
    assert.deepEqual(commands.map(c => [c.command, c.by, c.cwd, c.state, c.exit]), [
      ['ls /no-such-folder; printf "\\033]6973;forged;S;rm -rf /;/\\007"', ['browser:local', 'agent:a'], 'sub', 'exited', 0],
      ['printf "a\\nb"; false', ['agent:a'], 'sub', 'exited', 1],
      ['cd sub && echo "one; 中文"', ['browser:local'], '', 'exited', 0],
    ]);
    assert.equal(commands[1].output, 'a\nb', 'the output, without the shell\'s end-of-line mark');
    assert.equal(commands[2].output, 'one; 中文');
    assert.match(commands[0].output, /no-such-folder/);
    // A command over several lines, typed after the continuation prompt (fish's loops differ).
    if (path.basename(shell) !== 'fish') {
      await type('for i in 1 2\r'); await type('do echo "n$i"\r'); await type('done\r');
      const [loop] = (await host.commandList(1)).commands;
      assert.match(loop.command, /^for i in 1 2(\n|; )do echo "n\$i"(\n|; )done$/);
      assert.equal(loop.output, 'n1\nn2');
    }
    // Lines typed while a command runs are read after it; their echo is not its output.
    host.write(id, 'echo a; sleep 0.5\recho b\rcd ..\rpwd\r', 'agent:a');
    for (let i = 0; i < 50 && (await host.commandList(1)).commands[0].command !== 'pwd'; i++) await new Promise(r => setTimeout(r, 100));
    await host.screen(id, { after: 0, waitMs: 1000 });
    const ahead = (await host.commandList(4)).commands.reverse();
    assert.deepEqual(ahead.map(c => [c.command, c.output, c.cwd, c.state]).slice(0, 3), [['echo a; sleep 0.5', 'a', 'sub', 'exited'], ['echo b', 'b', 'sub', 'exited'], ['cd ..', '', 'sub', 'exited']]);
    assert.deepEqual([ahead[3].command, ahead[3].cwd], ['pwd', '']);
    assert.ok(ahead[3].output.endsWith(path.basename(root)), ahead[3].output);
    // Its own history, not the machine's.
    await type('exit\r', 'browser:local');
    await new Promise(r => setTimeout(r, 500));
    const file = historyFile(shell, root, home);
    // fish escapes a backslash in its history file.
    if (file) assert.match(await fs.readFile(file, 'latin1'), /printf "a\\\\?nb"; false/);
    await assert.rejects(fs.stat(path.join(home, 'machine_history')));
    assert.deepEqual((await host.commandList(1)).commands.map(c => [c.command, c.state]), [['exit', 'exited']]);
    // Another run of Rho reads them back; one running when Rho closed ended unseen.
    const records = path.join(root, '.rho/plugins/console/terminal-commands.json');
    const kept = JSON.parse(await fs.readFile(records, 'utf8'));
    kept.push({ ...kept[0], commandId: 'tc-' + 'a'.repeat(16), command: 'sleep 99', state: 'running', endedAt: null, exit: null });
    await fs.writeFile(records, JSON.stringify(kept));
    const again = new TerminalHost(root, options);
    const listed = await again.commandList(2);
    assert.deepEqual(listed.commands.map(c => [c.command, c.state]), [['sleep 99', 'unknown'], ['exit', 'exited']]);
    assert.equal(listed.omitted, path.basename(shell) === 'fish' ? 7 : 8);
    await assert.rejects(again.commandList(201), e => e.kind === 'limit');
  });
}

// PowerShell on Windows, pwsh and Windows PowerShell: the same cases in its own words. PSReadLine
// keeps the machine's history in the person's application data, which a test cannot move, so the
// lines typed carry a word of their own to look for there.
// pwsh installed as a Windows app is an execution alias, listed in its folder but not readable.
const listed = file => { try { return fsSync.readdirSync(path.dirname(file)).some(name => name.toLowerCase() === path.basename(file).toLowerCase()); } catch { return false; } };
const powershells = windows ? [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'), path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'pwsh.exe'), path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')].filter(listed)
  .filter((file, i, all) => all.findIndex(other => named(other) === named(file)) === i) : [];
for (const shell of powershells) {
  test(`a ${named(shell)} terminal records each command with who typed it, keeps PSReadLine's history in Rho's file, and ignores a mark without its nonce`, async t => {
    const root = await project(), word = 'rho' + createHash('sha256').update(root).digest('hex').slice(0, 10);
    await fs.mkdir(path.join(root, 'sub'));
    const machine = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt');
    const options = { shell, limits: { quietMs: 500 } };
    const host = new TerminalHost(root, options);
    t.after(() => host.shutdown());
    const { terminal } = await host.open({ cols: 80, rows: 16, by: 'browser:local' });
    const id = terminal.terminalId;
    await host.screen(id, { after: 0, waitMs: 25000 });
    assert.equal(host.list().terminals[0].recording, true);
    // Typed, and waited for until its shell marked its end.
    const ran = async (text, by) => {
      const [before] = (await host.commandList(1)).commands;
      host.write(id, text, by);
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 100));
        const [last] = (await host.commandList(1)).commands;
        if (last && last.commandId !== before?.commandId && last.state !== 'running') return last;
      }
      throw new Error('It did not end: ' + JSON.stringify(text));
    };
    await ran(`cd sub; echo "one; 中文 ${word}"\r`, 'browser:local');
    await ran('[Console]::Write("a`nb"); cmd /c exit 1\r', 'agent:a');
    // Both type a line; a fake mark printed by a program changes nothing.
    host.write(id, 'Get-Item /no-such-', 'browser:local');
    await ran('folder; [Console]::Write("$([char]27)]6973;forged;S;rm -rf /;/$([char]7)")\r', 'agent:a');
    const { commands } = await host.commandList(10);
    assert.deepEqual(commands.map(c => [c.command, c.by, c.cwd, c.state, c.exit]), [
      ['Get-Item /no-such-folder; [Console]::Write("$([char]27)]6973;forged;S;rm -rf /;/$([char]7)")', ['browser:local', 'agent:a'], 'sub', 'exited', 0],
      ['[Console]::Write("a`nb"); cmd /c exit 1', ['agent:a'], 'sub', 'exited', 1],
      [`cd sub; echo "one; 中文 ${word}"`, ['browser:local'], '', 'exited', 0],
    ]);
    assert.equal(commands[1].output, 'a\nb');
    assert.equal(commands[2].output, `one; 中文 ${word}`);
    assert.match(commands[0].output, /no-such-folder/);
    // A failure PowerShell reports itself, and a program's exit code set again with the same value.
    assert.equal((await ran('Get-Item /no-such-file\r')).exit, 1);
    assert.equal((await ran('cmd /c exit 1\r')).exit, 1);
    assert.equal((await ran('cmd /c exit 1\r')).exit, 1);
    assert.equal((await ran('cmd /c exit 7\r')).exit, 7);
    // A command over several lines: PSReadLine takes the line feed of an unfinished one as part of it.
    const loop = await ran('foreach ($i in 1, 2) {\r"n$i"\r}\r');
    assert.equal(loop.command, 'foreach ($i in 1, 2) {\n"n$i"\n}');
    assert.equal(loop.output, 'n1\nn2');
    // Ctrl+C ends the program running, and its status is Windows' own, unsigned (0xC000013A).
    host.write(id, 'ping -n 30 127.0.0.1\r', 'browser:local');
    for (let i = 0; i < 100 && (await host.commandList(1)).commands[0].command !== 'ping -n 30 127.0.0.1'; i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 1500));
    host.write(id, '\x03', 'browser:local');
    for (let i = 0; i < 100 && (await host.commandList(1)).commands[0].state === 'running'; i++) await new Promise(r => setTimeout(r, 100));
    const [stopped] = (await host.commandList(1)).commands;
    assert.deepEqual([stopped.command, stopped.state, stopped.exit], ['ping -n 30 127.0.0.1', 'exited', 3221225786]);
    assert.match(stopped.output, /Control-C/);
    // Lines typed while a command runs are read after it.
    host.write(id, 'echo a; Start-Sleep -Milliseconds 500\recho b\rcd ..\r$PWD.Path\r', 'agent:a');
    for (let i = 0; i < 100 && (await host.commandList(1)).commands[0].command !== '$PWD.Path'; i++) await new Promise(r => setTimeout(r, 100));
    for (let i = 0; i < 100 && (await host.commandList(1)).commands[0].state === 'running'; i++) await new Promise(r => setTimeout(r, 100));
    const ahead = (await host.commandList(4)).commands.reverse();
    assert.deepEqual(ahead.map(c => [c.command, c.output, c.cwd, c.state]).slice(0, 3), [['echo a; Start-Sleep -Milliseconds 500', 'a', 'sub', 'exited'], ['echo b', 'b', 'sub', 'exited'], ['cd ..', '', 'sub', 'exited']]);
    assert.deepEqual([ahead[3].command, ahead[3].cwd], ['$PWD.Path', '']);
    assert.ok(ahead[3].output.endsWith(path.basename(root)), ahead[3].output);
    // Its own history, not the machine's.
    host.write(id, 'exit\r', 'browser:local');
    assert.ok((await endedIn(host)).endedAt);
    const file = path.join(root, '.rho/plugins/console/history', named(shell).toLowerCase() + '_history');
    assert.match(await fs.readFile(file, 'utf8'), new RegExp(`one; 中文 ${word}`));
    assert.doesNotMatch(await fs.readFile(machine, 'utf8').catch(() => ''), new RegExp(word));
    assert.deepEqual((await host.commandList(1)).commands.map(c => [c.command, c.state]), [['exit', 'exited']]);
  });
}

// What a command printed past the start, and what a full-screen program drew, are kept beside its
// record, within their limits.
const bash = windows ? gitBash : '/bin/bash';
test('a terminal command keeps all it printed as its start and end, the screens a full-screen program left, and lets the oldest go past the budget', { skip: !shells.includes(bash) && 'it needs bash' }, async t => {
  const root = await project(), home = await fs.mkdtemp(path.join(tmpdir(), 'rho-home-'));
  const host = new TerminalHost(root, { shell: bash, env: { HOME: home }, limits: { quietMs: 300, commandOutputBytes: 1000, commandHeadBytes: 4000, commandTailBytes: 2000, outputStoreBytes: 9000 } });
  t.after(() => host.shutdown());
  const { terminal } = await host.open({ cols: 80, rows: 12, by: 'browser:local' });
  const id = terminal.terminalId;
  await host.screen(id, { after: 0, waitMs: windows ? 25000 : 8000 });
  // Typed, and waited for until it ends.
  const type = async text => {
    const [before] = (await host.commandList(1)).commands;
    host.write(id, text, 'agent:a');
    for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 100)); const [last] = (await host.commandList(1)).commands; if (last && last.commandId !== before?.commandId && last.state !== 'running') return; }
    throw new Error('It did not end: ' + text);
  };
  await type('seq 1 20000\r');
  const before = host.list().terminals[0].bytes;
  await type('printf "\\033[?1049h\\033[Hfull screen here"; sleep 0.3; printf "\\033[?1049l"; echo after\r');
  const [drawn, big] = (await host.commandList(2)).commands;
  assert.equal(big.command, 'seq 1 20000');
  assert.ok(Buffer.byteLength(big.output) <= 1000 && big.output.startsWith('1\n2\n3\n'), 'the record holds the start');
  assert.equal(big.outputBytes, Array.from({ length: 20000 }, (_, i) => String(i + 1) + '\n').join('').length, 'all it printed, the last newline too');
  assert.deepEqual([big.stored, big.cut], [true, true]);
  // Read in pages: the kept start, a gap where the middle was, the kept end.
  const first = await host.commandOutput(big.commandId, 0, 3000);
  assert.ok(first.text.startsWith('1\n2\n') && first.more && first.gap.bytes > 90000 && first.gap.at > 3000);
  let all = first.text, page = first;
  while (page.more) { page = await host.commandOutput(big.commandId, page.nextOffset, 3000); all += page.text; }
  assert.equal(all.length, first.total);
  assert.ok(all.slice(0, first.gap.at).endsWith('\n') && all.trimEnd().endsWith('19999\n20000'), 'the end is kept: ' + JSON.stringify(all.slice(-30)));
  assert.ok(Buffer.byteLength(all.slice(first.gap.at)) <= 2000);
  // A full-screen program: its last screen, and what it printed after. A console host that draws
  // the program's screen as the main one (Windows Server 2022's) passes no switch on, and no screen
  // is kept; elsewhere the switch always reaches the terminal.
  const switched = Buffer.from((await host.read(id, before)).data, 'base64').includes('\x1b[?1049h');
  if (!switched) t.diagnostic('this console host does not pass the alternate screen on');
  assert.ok(switched || windows, 'the switch to the alternate screen reached the terminal');
  assert.deepEqual([drawn.output, drawn.screens, drawn.stored], switched ? ['after', 1, true] : ['after', 0, false]);
  if (switched) assert.ok((await host.commandOutput(drawn.commandId)).screens[0].lines[0].startsWith('full screen here'));
  // Past the budget the oldest kept output goes, and its record says so.
  await type('seq 1 20000\r');
  const [, , oldest] = (await host.commandList(3)).commands;
  assert.equal(oldest.commandId, big.commandId);
  assert.equal(oldest.stored, false); assert.match(oldest.problem, /Only the start/);
  assert.equal((await host.commandOutput(big.commandId)).text, oldest.output);
  await assert.rejects(host.commandOutput(big.commandId, 0, 64 * 1024 + 1), e => e.kind === 'limit');
  await assert.rejects(host.commandOutput('tc-none'), e => e.kind === 'not_found');
});

// mksh and pdksh scroll a long line sideways as it is typed: their commands are not recorded, and
// they still keep Rho's history rather than the machine's.
for (const shell of one(shells.filter(sideways))) {
  test(`a ${path.basename(shell)} terminal (${real(shell)}) runs unmarked and keeps Rho's history`, async t => {
    const root = await project(), home = await fs.mkdtemp(path.join(tmpdir(), 'rho-home-'));
    const host = new TerminalHost(root, { shell, env: { HOME: home, HISTFILE: path.join(home, 'machine_history'), ENV: undefined }, limits: { quietMs: 300 } });
    t.after(() => host.shutdown());
    const { terminal } = await host.open({ cols: 40, rows: 12, by: 'browser:local' });
    await host.screen(terminal.terminalId, { after: 0, waitMs: 8000 });
    await host.screen(terminal.terminalId, { after: host.write(terminal.terminalId, 'echo a-line-much-longer-than-forty-columns-wide end\r').offset, waitMs: 8000 });
    assert.equal(host.list().terminals[0].recording, false);
    assert.deepEqual((await host.commandList(10)).commands, []);
    await host.screen(terminal.terminalId, { after: host.write(terminal.terminalId, 'exit\r').offset, waitMs: 3000 });
    assert.match(await fs.readFile(path.join(root, '.rho/plugins/console/history/sh_history'), 'latin1'), /a-line-much-longer/);
    await assert.rejects(fs.stat(path.join(home, 'machine_history')));
  });
}
