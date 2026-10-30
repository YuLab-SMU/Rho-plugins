import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { KernelHost, kernelLimits } from '@rho-workspace/plugin-kernel';

const rscript = process.env.RHO_RSCRIPT ?? 'Rscript';
async function project() { return fs.mkdtemp(path.join(tmpdir(), 'rho-kernel-')); }
async function settled(host, cellId, ms = 20000) {
  const until = Date.now() + ms;
  for (;;) {
    const [cell] = (await host.read(1, cellId)).cells;
    if (!['queued', 'running'].includes(cell.state)) return cell;
    if (Date.now() > until) throw new Error('The cell did not end.');
    await new Promise(r => setTimeout(r, 25));
  }
}
const text = cell => cell.outputs.filter(o => o.text).map(o => o.text).join('');

test('R cells share one session: values stay, output, warnings, errors and plots are kept', async () => {
  const root = await project();
  await fs.writeFile(path.join(root, 'data.csv'), 'x,y\n1,2\n2,4\n3,7\n');
  const host = new KernelHost(root, { rscript });
  assert.deepEqual((await host.read()).sessions, [], 'reading starts no session');
  const first = await host.run({ language: 'r', code: 'd <- read.csv("data.csv")\nfit <- lm(y ~ x, d)\nmessage("read ", nrow(d))\nwarning("small")\nround(coef(fit), 2)', purpose: 'Fit y on x', changeId: 'one', by: 'agent:a', waitMs: 30000 });
  assert.equal(first.cell.state, 'done');
  assert.equal(first.cell.purpose, 'Fit y on x');
  assert.equal(first.cell.number, 1);
  assert.match(first.session.version, /^R version/);
  assert.deepEqual(first.cell.outputs.map(o => o.kind), ['stderr', 'warning', 'stdout']);
  assert.match(text(first.cell), /read 3\n/);
  assert.match(text(first.cell), /\(Intercept\)\s+x\s*\n\s*-0\.67\s+2\.50/);
  const names = first.session.variables.map(v => v.name);
  assert.deepEqual(names, ['d', 'fit'], 'the session lists what the code defined and nothing of its own');
  assert.equal(first.session.variables[0].size, '3 × 2');
  assert.match(first.session.variables[1].summary, /lm y ~ x/);

  // Printed lines arrive while the cell runs, in their place among its messages and warnings.
  const streamed = await host.run({ language: 'r', code: 'for (i in 1:3) { cat("step", i, "\\n"); if (i == 2) message("half"); Sys.sleep(0.4) }\nwarning("late")\ninvisible(1)', changeId: 'stream', by: 'agent:a' });
  await new Promise(r => setTimeout(r, 700));
  const midway = (await host.read(1, streamed.cell.cellId)).cells[0];
  assert.equal(midway.state, 'running');
  assert.match(text(midway), /^step 1 \n/, 'output printed so far is kept before the cell ends');
  const whole = await settled(host, streamed.cell.cellId);
  assert.deepEqual(whole.outputs.map(o => o.kind), ['stdout', 'stderr', 'stdout', 'warning']);
  assert.equal(text(whole), 'step 1 \nstep 2 \nhalf\nstep 3 \nWarning: late\n');
  const plot = await host.run({ language: 'r', code: 'plot(d$x, d$y)\nabline(fit)', changeId: 'two', by: 'browser:local', waitMs: 30000 });
  assert.equal(plot.cell.state, 'done');
  assert.equal(plot.cell.sessionId, first.cell.sessionId, 'a second cell runs in the same session');
  const plots = plot.cell.outputs.filter(o => o.kind === 'plot');
  assert.equal(plots.length, 1, 'a line drawn over points is one plot');
  const png = await host.plot(plot.cell.cellId, plots[0].plot);
  assert.equal(png.mediaType, 'image/png');
  assert.equal(Buffer.from(png.data, 'base64').subarray(1, 4).toString(), 'PNG');

  const failed = await host.run({ language: 'r', code: 'y <- 1\nstop("no such column")\nz <- 2', changeId: 'three', by: 'agent:a', waitMs: 30000 });
  assert.equal(failed.cell.state, 'error');
  assert.match(text(failed.cell), /Error: no such column\n/);
  assert.ok(failed.session.variables.some(v => v.name === 'y') && !failed.session.variables.some(v => v.name === 'z'), 'the first error stops the rest of the cell');
  await host.close();
});

test('Python cells share one session and show the last value and matplotlib figures', async () => {
  const root = await project();
  const host = new KernelHost(root);
  const first = await host.run({ language: 'python', code: 'from pathlib import Path\nfrom os.path import join\nrows = [3, 1, 2]\nprint("rows", len(rows))\nsorted(rows)', changeId: 'one', by: 'agent:a', waitMs: 30000 });
  assert.equal(first.cell.state, 'done');
  assert.equal(text(first.cell), 'rows 3\n[1, 2, 3]\n');
  assert.match(first.session.version, /^Python 3\./);
  assert.deepEqual(first.session.variables.map(v => [v.name, v.size]), [['rows', '3']], 'imported classes and functions are not listed as values');
  const failed = await host.run({ language: 'python', code: 'def f(n):\n    return n / 0\nf(len(rows))', changeId: 'two', by: 'agent:a', waitMs: 30000 });
  assert.equal(failed.cell.state, 'error');
  assert.match(text(failed.cell), /File "<cell 2>", line 2, in f\n\s+return n \/ 0/);
  assert.ok(failed.session.variables.some(v => v.name === 'f'), 'a function a cell defined is listed');
  assert.doesNotMatch(text(failed.cell), /runner\.py/);
  const hasPlot = await host.run({ language: 'python', code: 'import importlib.util\nprint(importlib.util.find_spec("matplotlib") is not None)', changeId: 'three', by: 'agent:a', waitMs: 30000 });
  if (text(hasPlot.cell).trim() === 'True') {
    const plotted = await host.run({ language: 'python', code: 'import matplotlib.pyplot as plt\nplt.plot(rows)\nplt.title("rows")', changeId: 'four', by: 'agent:a', waitMs: 30000 });
    assert.equal(plotted.cell.state, 'done');
    assert.equal(plotted.cell.outputs.filter(o => o.kind === 'plot').length, 1);
    const again = await host.run({ language: 'python', code: 'len(rows)', changeId: 'five', by: 'agent:a', waitMs: 30000 });
    assert.equal(again.cell.outputs.filter(o => o.kind === 'plot').length, 0, 'a figure is shown once, by the cell that made it');
  }
  await host.close();
});

test('a change identity names one cell; cells run one at a time in the order they came', async () => {
  const root = await project();
  const host = new KernelHost(root);
  const slow = await host.run({ language: 'python', code: 'import time\ntime.sleep(0.4)\norder = ["slow"]', changeId: 'slow', by: 'agent:a' });
  const fast = await host.run({ language: 'python', code: 'order.append("fast")\norder', changeId: 'fast', by: 'browser:local' });
  assert.equal((await host.read(1, fast.cell.cellId)).cells[0].state, 'queued');
  const again = await host.run({ language: 'python', code: 'import time\ntime.sleep(0.4)\norder = ["slow"]', changeId: 'slow', by: 'agent:a' });
  assert.equal(again.cell.cellId, slow.cell.cellId);
  await assert.rejects(host.run({ language: 'python', code: 'other', changeId: 'slow', by: 'agent:a' }), e => e.kind === 'conflict');
  const other = await host.run({ language: 'python', code: '1', changeId: 'slow', by: 'agent:b', waitMs: 30000 });
  assert.notEqual(other.cell.cellId, slow.cell.cellId, 'the identity belongs to its caller');
  assert.equal(text(await settled(host, fast.cell.cellId)), "['slow', 'fast']\n");
  const { cells } = await host.read();
  assert.deepEqual(cells.map(c => c.number), [1, 2, 3]);
  await host.close();
});

test('requests that arrive together queue one cell per identity and lose none', async () => {
  const root = await project();
  const host = new KernelHost(root);
  // A first read and runs at once, two of them the same request repeated.
  const [read, a, b, c] = await Promise.all([host.read(), host.run({ language: 'python', code: 'x = 1', changeId: 'same', by: 'agent:a' }), host.run({ language: 'python', code: 'x = 1', changeId: 'same', by: 'agent:a' }), host.run({ language: 'python', code: 'y = 2', changeId: 'other', by: 'browser:local', waitMs: 30000 })]);
  assert.ok(read.cells.length <= 2);
  assert.equal(a.cell.cellId, b.cell.cellId);
  assert.notEqual(a.cell.cellId, c.cell.cellId);
  const { cells } = await host.read();
  assert.deepEqual(cells.map(cell => cell.changeId).sort(), ['other', 'same']);
  await host.close();
});

test('interrupt stops the running cell and keeps the session; stop ends it and what waited is not run', async () => {
  const root = await project();
  const host = new KernelHost(root, { rscript });
  await assert.rejects(host.interrupt('k-0000000000000000', 'browser:local'), e => e.kind === 'not_found');
  await host.run({ language: 'python', code: 'kept = 41', changeId: 'a', by: 'agent:a', waitMs: 30000 });
  const long = await host.run({ language: 'python', code: 'import time\nwhile True: time.sleep(0.05)', changeId: 'b', by: 'agent:a' });
  await new Promise(r => setTimeout(r, 300));
  const waiting = await host.run({ language: 'python', code: 'kept = 0', changeId: 'b2', by: 'agent:a' });
  await host.interrupt(long.cell.cellId, 'browser:local');
  await host.interrupt(waiting.cell.cellId, 'browser:local');
  const stopped = await settled(host, long.cell.cellId);
  assert.equal((await settled(host, waiting.cell.cellId)).state, 'not-run', 'a waiting cell that is interrupted does not run');
  await host.interrupt(long.cell.cellId, 'browser:local');
  assert.equal(stopped.state, 'interrupted');
  assert.equal(stopped.interrupt.by, 'browser:local');
  const after = await host.run({ language: 'python', code: 'kept + 1', changeId: 'c', by: 'agent:a', waitMs: 30000 });
  assert.equal(text(after.cell), '42\n', 'the session and its values survive an interrupt');

  const r = await host.run({ language: 'r', code: 'Sys.sleep(30)', changeId: 'r-long', by: 'agent:a' });
  await new Promise(r => setTimeout(r, 1500));
  await host.interrupt(r.cell.cellId, 'browser:local');
  assert.equal((await settled(host, r.cell.cellId)).state, 'interrupted');
  assert.equal((await host.run({ language: 'r', code: '1 + 1', changeId: 'r-after', by: 'agent:a', waitMs: 30000 })).cell.state, 'done');

  const running = await host.run({ language: 'python', code: 'import time\ntime.sleep(30)', changeId: 'd', by: 'agent:a' });
  const next = await host.run({ language: 'python', code: 'kept', changeId: 'e', by: 'agent:a' });
  const { session } = await host.stop(running.session.sessionId, 'browser:local');
  assert.equal(session.stop.by, 'browser:local');
  assert.equal((await settled(host, running.cell.cellId)).state, 'error');
  const notRun = await settled(host, next.cell.cellId);
  assert.equal(notRun.state, 'not-run');
  const ended = (await host.read()).sessions.find(s => s.language === 'python' && s.sessionId === session.sessionId);
  assert.equal(ended.state, 'ended'); assert.equal(ended.ending, 'stopped'); assert.deepEqual(ended.variables, []);
  const fresh = await host.run({ language: 'python', code: "'kept' in globals()", changeId: 'f', by: 'agent:a', waitMs: 30000 });
  assert.notEqual(fresh.cell.sessionId, session.sessionId, 'a cell after stop starts a new session');
  assert.equal((await host.stop(session.sessionId, 'browser:local')).session.state, 'ended', 'stopping an ended session again changes nothing');
  assert.equal((await host.read()).sessions.find(s => s.sessionId === fresh.cell.sessionId).state, 'idle', 'and leaves the new one running');
  assert.equal(text(fresh.cell), 'False\n');
  await host.close();
});

test('after Rho closes, its sessions are recorded as ended and nothing runs again', async () => {
  const root = await project();
  const host = new KernelHost(root);
  await host.run({ language: 'python', code: 'x = 1', changeId: 'a', by: 'agent:a', waitMs: 30000 });
  const running = await host.run({ language: 'python', code: 'import time\ntime.sleep(30)', changeId: 'b', by: 'agent:a' });
  const waiting = await host.run({ language: 'python', code: 'x', changeId: 'c', by: 'agent:a' });
  await new Promise(r => setTimeout(r, 200));
  // A closed host forgets its children; the next one reads only the record.
  await host.close();
  const next = new KernelHost(root);
  const { sessions, cells } = await next.read();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].state, 'ended'); assert.equal(sessions[0].ending, 'rho-closed');
  assert.equal(cells.find(c => c.cellId === running.cell.cellId).state, 'unknown');
  assert.equal(cells.find(c => c.cellId === waiting.cell.cellId).state, 'not-run');
  const same = await next.run({ language: 'python', code: 'import time\ntime.sleep(30)', changeId: 'b', by: 'agent:a' });
  assert.equal(same.cell.state, 'unknown', 'the same identity returns the recorded cell and does not run it again');
  assert.equal((await next.read()).sessions.length, 1, 'and starts no session');
  await next.close();
});

test('limits: code size, waiting cells, kept output and a program that is missing', async () => {
  const root = await project();
  const host = new KernelHost(root, { limits: { maxQueued: 1, maxOutputBytes: 64 }, python: 'python3' });
  await assert.rejects(host.run({ language: 'python', code: 'x'.repeat(kernelLimits.maxCodeBytes + 1), changeId: 'big', by: 'agent:a' }), e => e.kind === 'invalid');
  const loud = await host.run({ language: 'python', code: 'print("é" * 100)', changeId: 'loud', by: 'agent:a', waitMs: 30000 });
  assert.equal(loud.cell.cut, true);
  assert.equal(loud.cell.kept, 64); assert.equal(loud.cell.bytes, 201);
  await host.run({ language: 'python', code: 'import time\ntime.sleep(1)', changeId: 'a', by: 'agent:a' });
  await host.run({ language: 'python', code: '1', changeId: 'b', by: 'agent:a' });
  await assert.rejects(host.run({ language: 'python', code: '2', changeId: 'c', by: 'agent:a' }), e => e.kind === 'limit' && e.details.limit === 'maxQueued');
  await host.close();

  const missing = new KernelHost(root, { rscript: path.join(root, 'no-Rscript') });
  const cell = await missing.run({ language: 'r', code: '1', changeId: 'x', by: 'agent:a', waitMs: 5000 });
  const done = await settled(missing, cell.cell.cellId);
  assert.equal(done.state, 'not-run');
  const session = (await missing.read()).sessions.find(s => s.language === 'r');
  assert.equal(session.ending, 'not-started');
  assert.match(session.problem, /was not found/);
  await missing.close();
});
