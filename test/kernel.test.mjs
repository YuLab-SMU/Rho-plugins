import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
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
  // The plot stays open for the session: a later cell draws over it, as a script run line by
  // line does, and reports the plot it changed.
  const over = await host.run({ language: 'r', code: 'abline(h = 3, lty = 2)', changeId: 'over', by: 'browser:local', waitMs: 30000 });
  assert.equal(over.cell.state, 'done', 'a line drawn over an earlier cell\'s plot needs no new plot');
  assert.equal(over.cell.outputs.filter(o => o.kind === 'plot').length, 1);
  assert.equal((await host.run({ language: 'r', code: 'k <- 1', changeId: 'none', by: 'browser:local', waitMs: 30000 })).cell.outputs.filter(o => o.kind === 'plot').length, 0, 'a cell that draws nothing shows no plot');
  // A new plot whose function sets par() first does not show the page before it again.
  assert.equal((await host.run({ language: 'r', code: 'barplot(c(a = 1, b = 2))', changeId: 'bars', by: 'browser:local', waitMs: 30000 })).cell.outputs.filter(o => o.kind === 'plot').length, 1);
  // One expression that draws two pages (a sourced script) keeps both.
  const pages = await host.run({ language: 'r', code: 'local({ plot(d$x, d$y); abline(fit); barplot(c(a = 1, b = 2)) })', changeId: 'pages', by: 'browser:local', waitMs: 30000 });
  assert.equal(pages.cell.outputs.filter(o => o.kind === 'plot').length, 2, 'each page a cell draws is kept');

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

test('a value is read as its session describes it, without starting, waiting or changing anything', async t => {
  const root = await project();
  const host = new KernelHost(root, { rscript, limits: { inspectTimeoutMs: 800 } });
  t.after(() => host.close());
  assert.equal((await host.inspect({ language: 'r', name: 'd' })).state, 'none', 'reading starts no session');
  assert.deepEqual((await host.read()).sessions, []);
  const made = await host.run({ language: 'r', code: 'd <- data.frame(x = c(3, 1, 2, NA), g = factor(c("a", "b", "a", "b")))\nfit <- glm(I(x > 1) ~ g, data = d, family = binomial)\nl <- list(a = 1, b = list(c = "z"))', changeId: 'make', by: 'agent:a', waitMs: 30000 });
  assert.deepEqual(made.cell.defined, ['d', 'fit', 'l'], 'the cell names what it made');
  const table = await host.inspect({ language: 'r', name: 'd', limit: 2, sort: { column: 0, descending: true } });
  assert.equal(table.state, 'shown'); assert.equal(table.afterCell, 1);
  assert.equal(table.object.kind, 'table');
  assert.deepEqual(table.object.table.rowLabels, ['1', '3'], 'sorted rows keep their own labels');
  assert.deepEqual(table.object.table.columns.map(c => [c.name, c.type, c.missing, c.values]), [['x', 'numeric', 1, ['3', '2']], ['g', 'factor', 0, ['a', 'a']]]);
  // A value that draws when printed (as a ggplot does) draws on the reading's own device: the
  // session's plot is unchanged, so the next cell shows none.
  await host.run({ language: 'r', code: 'print.drawn <- function(x, ...) { plot(1:3); invisible(x) }\nart <- structure(quote(f(a)), class = "drawn")', changeId: 'art', by: 'agent:a', waitMs: 30000 });
  assert.equal((await host.inspect({ language: 'r', name: 'art' })).state, 'shown');
  assert.equal((await host.run({ language: 'r', code: 'k <- 1', changeId: 'after-art', by: 'agent:a', waitMs: 30000 })).cell.outputs.filter(o => o.kind === 'plot').length, 0);
  const model = (await host.inspect({ language: 'r', name: 'fit' })).object;
  assert.equal(model.kind, 'model');
  assert.ok(model.facts.some(f => f.label === 'Family' && /binomial/.test(f.value)));
  assert.deepEqual(model.table.rowLabels, ['(Intercept)', 'gb']);
  assert.equal(model.children.items[0].expression, 'fit$coefficients');
  assert.ok(model.table.columns[0].values.every(v => !/0$/.test(v) || /^-?\d+$/.test(v)), 'each coefficient at its own precision, without padding');
  // Counts read as counts: one way by value, two ways as rows and columns.
  await host.run({ language: 'r', code: 'one <- table(d$g)\ntwo <- table(d$g, d$x > 1)', changeId: 'counts', by: 'agent:a', waitMs: 30000 });
  const one = (await host.inspect({ language: 'r', name: 'one' })).object;
  assert.equal(one.kind, 'vector'); assert.deepEqual(one.values.items, [{ name: 'a', value: '2' }, { name: 'b', value: '2' }]);
  assert.ok(one.facts.some(f => f.label === 'Total' && f.value === '4'));
  const two = (await host.inspect({ language: 'r', name: 'two' })).object;
  assert.equal(two.kind, 'table'); assert.deepEqual(two.table.rowLabels, ['a', 'b']); assert.deepEqual(two.table.columns.map(c => c.name), ['FALSE', 'TRUE']);
  const part = await host.inspect({ language: 'r', name: 'l', path: [1, 0] });
  assert.equal(part.object.expression, 'l$b$c'); assert.equal(part.object.values.items[0].value, 'z');
  assert.equal((await host.inspect({ language: 'r', name: 'l', path: [5] })).state, 'missing');
  // A reading that takes too long is interrupted and the session goes on.
  await host.run({ language: 'r', code: 'slow <- structure(list(), class = "slow")\nprint.slow <- function(x, ...) Sys.sleep(30)', changeId: 'slow', by: 'agent:a', waitMs: 30000 });
  const started = Date.now();
  assert.equal((await host.inspect({ language: 'r', name: 'slow' })).state, 'timeout');
  assert.ok(Date.now() - started < 8000);
  // While a cell runs the answer is busy, and a cell queued during a reading waits for it.
  const running = await host.run({ language: 'r', code: 'Sys.sleep(1)\nrm(l)', changeId: 'busy', by: 'agent:a' });
  assert.equal((await host.inspect({ language: 'r', name: 'd' })).state, 'busy');
  const after = await settled(host, running.cell.cellId);
  assert.equal(after.state, 'done'); assert.deepEqual(after.removed, ['l']);
  assert.equal((await host.inspect({ language: 'r', name: 'd' })).state, 'shown');
  const [reading, queued] = await Promise.all([host.inspect({ language: 'r', name: 'fit' }), host.run({ language: 'r', code: 'nrow(d)', changeId: 'after', by: 'agent:a', waitMs: 30000 })]);
  assert.equal(reading.state, 'shown'); assert.equal(queued.cell.state, 'done');
  assert.match(text(queued.cell), /\[1\] 4/);
  assert.deepEqual((await host.inspect({ language: 'r', name: 'd' })).object.table.columns.map(c => c.name), ['x', 'g'], 'reading changed nothing');
});

test('Python values: a data frame, an array, a dict, an object and a value that takes too long', async t => {
  const root = await project();
  const host = new KernelHost(root, { python: process.env.RHO_PYTHON ?? 'python3', limits: { inspectTimeoutMs: 800 } });
  t.after(() => host.close());
  let pandas = true;
  const probe = await host.run({ language: 'python', code: 'import importlib.util\nimportlib.util.find_spec("pandas") is not None', changeId: 'probe', by: 'agent:a', waitMs: 30000 });
  if (!/True/.test(text(probe.cell))) pandas = false;
  await host.run({ language: 'python', code: 'd = {"a": 1, "b": {"c": "z"}}\nclass Box:\n    def __init__(self): self.size = 3\nbox = Box()\nclass Slow:\n    def __repr__(self):\n        import time; time.sleep(30)\nslow = Box()\nslow.inner = Slow()', changeId: 'make', by: 'agent:a', waitMs: 30000 });
  const dict = (await host.inspect({ language: 'python', name: 'd', path: [1] })).object;
  assert.equal(dict.expression, "d['b']"); assert.deepEqual(dict.children.items.map(c => [c.name, c.expression]), [['c', "d['b']['c']"]]);
  assert.deepEqual((await host.inspect({ language: 'python', name: 'box' })).object.children.items.map(c => c.expression), ['box.size']);
  // Its part's repr is what takes too long.
  assert.equal((await host.inspect({ language: 'python', name: 'slow' })).state, 'timeout');
  const next = await host.run({ language: 'python', code: '1 + 1', changeId: 'next', by: 'agent:a', waitMs: 30000 });
  assert.equal(text(next.cell), '2\n', 'the session goes on after an interrupted reading');
  if (!pandas) { t.diagnostic('pandas is not installed; the data frame was not read'); return; }
  await host.run({ language: 'python', code: 'import pandas as pd, numpy as np\nframe = pd.DataFrame({"x": [3.0, 1.0, None], "s": ["p", "q", "r"]})\narr = np.arange(6).reshape(2, 3)', changeId: 'frame', by: 'agent:a', waitMs: 30000 });
  const frame = (await host.inspect({ language: 'python', name: 'frame', sort: { column: 0, descending: false } })).object;
  assert.equal(frame.kind, 'table'); assert.deepEqual(frame.table.rowLabels, ['1', '0', '2']);
  assert.deepEqual(frame.table.columns[0].values, ['1', '3', 'NaN']);
  assert.equal((await host.inspect({ language: 'python', name: 'arr' })).object.size, '2 × 3');
  assert.equal((await host.inspect({ language: 'python', name: 'frame', path: [1] })).object.expression, "frame['s']");
});

test('a cell names the values and project files it read and what it made of them', async t => {
  const root = await project();
  await fs.mkdir(path.join(root, 'data')); await fs.mkdir(path.join(root, 'out'));
  await fs.writeFile(path.join(root, 'data', 'm.csv'), 'g,x\na,1\nb,2\na,4\n');
  const host = new KernelHost(root, { rscript });
  t.after(() => host.close());
  const run = async (language, code, changeId) => (await host.run({ language, code, changeId, by: 'agent:a', waitMs: 30000 })).cell;
  const read = await run('r', 'm <- read.csv("data/m.csv")\nfirebrick <- "firebrick"', 'r1');
  assert.deepEqual(read.used, [], 'a name the session did not hold is not a read');
  assert.deepEqual(read.files, [{ path: 'data/m.csv', how: 'read' }], 'a string that is not a file is no file');
  const made = await run('r', 'means <- aggregate(x ~ g, data = m, FUN = mean)\nwrite.csv(means, "out/means.csv", row.names = FALSE)', 'r2');
  assert.deepEqual(made.used, ['m']); assert.deepEqual(made.defined, ['means']);
  assert.deepEqual(made.files, [{ path: 'out/means.csv', how: 'wrote' }]);
  const changed = await run('r', 'm$x <- m$x * 2', 'r3');
  assert.deepEqual(changed.defined, ['m'], 'a change that keeps the listing the same is still a change');
  assert.deepEqual(changed.used, ['m']);
  assert.deepEqual((await run('r', 'outside <- "../elsewhere.csv"', 'r4')).files, [], 'a path outside the project is not followed');
  const py = await run('python', 'import csv\nrows = list(csv.DictReader(open("data/m.csv")))\ntotal = sum(float(r["x"]) for r in rows)', 'p1');
  assert.deepEqual(py.files, [{ path: 'data/m.csv', how: 'read' }]);
  assert.deepEqual(py.defined.sort(), ['rows', 'total']);
  const next = await run('python', 'rows[0]["x"] = "9"\nshare = total / len(rows)', 'p2');
  assert.deepEqual(next.used, ['rows', 'total']);
  assert.deepEqual(next.defined.sort(), ['rows', 'share'], 'a value changed in place is defined by the cell that changed it');
});

test('what a function or comprehension binds is its own, and folders are read and written', async t => {
  const root = await project();
  await fs.mkdir(path.join(root, 'aln'));
  for (const name of ['a.fa', 'b.fa']) await fs.writeFile(path.join(root, 'aln', name), '>s\nAC\n');
  const host = new KernelHost(root, { rscript });
  t.after(() => host.close());
  const run = async (language, code, changeId) => (await host.run({ language, code, changeId, by: 'agent:a', waitMs: 30000 })).cell;
  await run('r', 'x <- 3\nk <- 2\np <- "kept"', 'r1');
  const r = await run('r', 'sq <- sapply(1:3, function(x) { p <- x * k; p })\ng <- function(p) p$n', 'r2');
  assert.deepEqual(r.used, ['k'], 'arguments and names a function assigns for itself are not the session\'s');
  assert.deepEqual(r.defined.sort(), ['g', 'sq']);
  const listed = await run('r', 'fa <- list.files("aln")\ndir.create("out")\nwriteLines(fa, file.path("out", "names.txt"))', 'r3');
  assert.deepEqual(listed.files, [{ path: 'aln/', how: 'read' }, { path: 'out/', how: 'wrote' }]);
  assert.deepEqual((await run('r', 'dir.create("out2")\nwriteLines("a", "out2/a.txt")', 'r4')).files, [{ path: 'out2/a.txt', how: 'wrote' }], 'a folder holding a named file is left to the file');
  const again = await run('r', 'for (p in 1:2) k <- k + p\nfa <- list.files("aln")\nlength(fa)', 'r5');
  assert.deepEqual(again.used, ['k'], 'a cell run again reads what it made itself, not the value it is about to replace');
  await run('python', 'p = "kept"\nn = 0', 'p1');
  const py = await run('python', 'import pathlib\nnames = {p.name: len(p.read_text()) for p in sorted(pathlib.Path("aln").glob("*.fa"))}\nsizes = sorted(names.values(), key=lambda p: -p)', 'p2');
  assert.deepEqual(py.used, [], 'a comprehension\'s and a lambda\'s names are their own');
  assert.deepEqual(py.defined.sort(), ['names', 'sizes']);
  assert.deepEqual(py.files, [{ path: 'aln/', how: 'read' }]);
  assert.deepEqual((await run('python', 'names = {"a": 1}\nfor key in names:\n    n += names[key]', 'p3')).used, ['n']);
  assert.deepEqual((await run('python', 'cols = {"aln": 1}\nfirst = cols["aln"]', 'p4')).files, [], 'a key that matches a folder\'s name is not the folder');
  assert.deepEqual((await run('r', 'l <- list(aln = 1)\nl[["aln"]]', 'r6')).files, []);
});

test('an S4 value read from a file lists its size at once, so printing it changes nothing', async t => {
  const root = await project();
  const made = spawnSync(rscript, ['-e', 'saveRDS(Matrix::Matrix(1:6, 2, sparse = TRUE), "m.rds")'], { cwd: root });
  if (made.status !== 0) { t.skip('the Matrix package is not installed'); return; }
  const host = new KernelHost(root, { rscript });
  t.after(() => host.close());
  const run = async (code, changeId) => (await host.run({ language: 'r', code, changeId, by: 'agent:a', waitMs: 30000 })).cell;
  await run('m <- readRDS("m.rds")', 'r1');
  assert.equal((await host.read()).sessions[0].variables.find(v => v.name === 'm').size, '2 × 3');
  assert.deepEqual((await run('m', 'r2')).defined, [], 'printing a value does not make it');
});
