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
  assert.match(first.session.program, /Rscript(\.exe)?$/, 'the session names the program that ran it');
  assert.deepEqual([first.cell.program, first.cell.version], [first.session.program, first.session.version], 'and so does each cell');
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

// An Agent's Git Bash gives Rho LC_CTYPE=C.UTF-8, which Windows does not have: R warned at startup,
// ran in the C locale and printed "3 × 2" as "3 <U+00D7> 2".
test('on Windows a session given a POSIX C.UTF-8 locale prints text as it was written', { skip: process.platform !== 'win32' && 'only Windows has no C.UTF-8' }, async () => {
  const root = await project(), saved = { LC_ALL: process.env.LC_ALL, LC_CTYPE: process.env.LC_CTYPE };
  process.env.LC_ALL = 'C.UTF-8'; process.env.LC_CTYPE = 'C.utf8';
  const host = new KernelHost(root, { rscript });
  try {
    const shown = await host.run({ language: 'r', code: 'cat("3 \\u00d7 2", "\\u4e2d\\u6587", l10n_info()$`UTF-8`, "\\n")', changeId: 'utf8', by: 'agent:a', waitMs: 30000 });
    assert.equal(shown.cell.state, 'done');
    assert.equal(text(shown.cell), '3 × 2 中文 TRUE \n');
  } finally {
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    await host.close();
  }
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

// A virtual environment the Agent made in the project is the program its Python sessions run.
test('a cell names a program in the project, later sessions keep it, and every cell records what ran it', async () => {
  const root = await fs.realpath(await project());
  const windows = process.platform === 'win32', python = windows ? 'python' : 'python3';
  const made = spawnSync(python, ['-m', 'venv', '--without-pip', path.join(root, '.venv')], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const own = path.join(root, '.venv', windows ? 'Scripts/python.exe' : 'bin/python'), named = path.relative(root, own);
  const host = new KernelHost(root);
  try {
    await assert.rejects(host.run({ language: 'python', code: '1', changeId: 'outside', by: 'agent:a', interpreter: '../elsewhere/bin/python' }), e => e.kind === 'scope');
    await assert.rejects(host.run({ language: 'python', code: '1', changeId: 'missing', by: 'agent:a', interpreter: '.venv/bin/nothing' }), e => e.kind === 'not_found');
    assert.deepEqual((await host.read()).sessions, [], 'a refused program starts no session');
    // The Agent's first cell ran in the machine's Python; only it ran cells there, so naming the
    // environment starts that session again with it.
    const plainFirst = await host.run({ language: 'python', code: 'import pandas', changeId: 'missing-package', by: 'agent:a', waitMs: 30000 });
    assert.ok(path.isAbsolute(plainFirst.session.program));
    const first = await host.run({ language: 'python', code: 'import sys\nprint(sys.prefix)', changeId: 'venv', by: 'agent:a', interpreter: named, waitMs: 30000 });
    assert.equal(first.cell.state, 'done');
    assert.notEqual(first.session.sessionId, plainFirst.session.sessionId);
    const replaced = (await host.read()).sessions.find(s => s.sessionId === plainFirst.session.sessionId);
    assert.deepEqual([replaced.state, replaced.ending, replaced.stop.by], ['ended', 'stopped', 'agent:a'], 'the session it replaced was stopped by the caller that replaced it');
    assert.equal(text(first.cell).trim(), path.join(root, '.venv'), 'the environment is the one that runs');
    assert.equal(first.session.program, named, 'a program in the project is named relative to it');
    assert.deepEqual([first.cell.program, first.cell.version], [named, first.session.version]);
    assert.match(first.cell.version, /^Python 3\./);
    assert.equal((await host.run({ language: 'python', code: '2', changeId: 'same', by: 'agent:a', interpreter: named, waitMs: 30000 })).cell.state, 'done', 'naming the same program again is that session');
    // Once the person ran a cell in it, its values are shared: another program is refused and it runs on.
    await host.run({ language: 'python', code: 'kept = 1', changeId: 'person-cell', by: 'person', waitMs: 30000 });
    const other = path.join('.venv', windows ? 'Scripts/pythonw.exe' : 'bin/python3');
    await assert.rejects(host.run({ language: 'python', code: '1', changeId: 'other', by: 'agent:a', interpreter: other }), e => e.kind === 'conflict' && e.details.program === own && /Ask the person to stop it/.test(e.message));
    assert.equal((await host.read()).sessions.find(s => s.sessionId === first.session.sessionId).state, 'idle');
    const ended = async sessionId => { for (let i = 0; i < 400 && (await host.read()).sessions.find(s => s.sessionId === sessionId).state !== 'ended'; i++) await new Promise(r => setTimeout(r, 25)); };
    await host.stop(first.session.sessionId, 'person'); await ended(first.session.sessionId);
    // The person's next cell names nothing and starts with the project's program.
    const later = await host.run({ language: 'python', code: 'import sys\nprint(sys.prefix)', changeId: 'later', by: 'person', waitMs: 30000 });
    assert.equal(text(later.cell).trim(), path.join(root, '.venv'));
    assert.equal(later.cell.program, named);
    // A program that is gone is forgotten: the next session starts with the machine's Python.
    await host.stop(later.session.sessionId, 'person'); await ended(later.session.sessionId);
    await fs.rm(path.join(root, '.venv'), { recursive: true, force: true });
    const plain = await host.run({ language: 'python', code: 'import sys\nprint(sys.prefix == sys.base_prefix)', changeId: 'plain', by: 'person', waitMs: 30000 });
    assert.ok(path.isAbsolute(plain.cell.program), 'the machine\'s Python is named by the path it ran from');
  } finally { await host.close(); }
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

test('a cell run in place of an earlier one names it, and both stay in the record', async t => {
  const root = await project();
  const host = new KernelHost(root, { rscript });
  t.after(() => host.close());
  const first = await host.run({ language: 'python', code: 'x = 1\nx', changeId: 'one', by: 'agent:a', waitMs: 30000 });
  const again = await host.run({ language: 'python', code: 'x = 2\nx', changeId: 'two', by: 'browser:local', replaces: first.cell.cellId, waitMs: 30000 });
  assert.equal(again.cell.replaces, first.cell.cellId);
  assert.equal(again.cell.sessionId, first.cell.sessionId, 'it runs in the same session');
  assert.deepEqual([again.cell.number, text(again.cell)], [2, '2\n']);
  // The earlier run is in the record as it ended; nothing of it is changed.
  let { cells } = await host.read();
  assert.deepEqual(cells.map(c => [c.number, c.by, text(c), c.replaces ?? null]), [[1, 'agent:a', '1\n', null], [2, 'browser:local', '2\n', first.cell.cellId]]);
  // The same identity is the same cell, run once.
  assert.equal((await host.run({ language: 'python', code: 'x = 2\nx', changeId: 'two', by: 'browser:local', replaces: first.cell.cellId })).cell.cellId, again.cell.cellId);
  // A run takes the place of an ended cell of its own notebook and language, and of no other.
  await assert.rejects(host.run({ language: 'python', code: '1', changeId: 'gone', by: 'browser:local', replaces: 'k-0000000000000000' }), e => e.kind === 'not_found');
  await assert.rejects(host.run({ language: 'python', code: '1', changeId: 'elsewhere', by: 'browser:local', notebook: 'nb-1', replaces: first.cell.cellId }), e => e.kind === 'invalid');
  await assert.rejects(host.run({ language: 'r', code: '1', changeId: 'other', by: 'browser:local', replaces: first.cell.cellId }), e => e.kind === 'invalid');
  const slow = await host.run({ language: 'python', code: 'import time\ntime.sleep(0.5)', changeId: 'slow', by: 'agent:a' });
  await assert.rejects(host.run({ language: 'python', code: '1', changeId: 'early', by: 'browser:local', replaces: slow.cell.cellId }), e => e.kind === 'conflict');
  await settled(host, slow.cell.cellId);
  const read = await host.read(); cells = read.cells;
  assert.equal(cells.length, 3, 'a refused run adds no cell');
  assert.deepEqual(read.sessions.map(s => s.language), ['python'], 'and starts no session');
});

test('a live session completes the line being typed: it runs no call, prints nothing and adds no cell', async t => {
  const root = await project();
  await fs.writeFile(path.join(root, 'de.csv'), 'gene,log2fc\nA,1\n');
  const host = new KernelHost(root, { rscript, limits: { inspectForkShare: 0 } });
  t.after(() => host.close());
  assert.equal((await host.complete({ language: 'python', line: 'cou' })).state, 'none', 'completing starts no session');
  assert.deepEqual((await host.read()).sessions, []);
  const names = async (language, line) => {
    const got = await host.complete({ language, line });
    assert.equal(got.state, 'shown', line + ': ' + got.problem);
    return { from: got.from, labels: got.items.map(i => i.label), type: Object.fromEntries(got.items.map(i => [i.label, i.type])) };
  };
  await host.run({ language: 'python', code: 'import math\ncounts = {"alpha": 1, "beta col": 2}\nvalue_one = 41\nclass T:\n    @property\n    def p(self):\n        print("READ"); return 1\n    def meth(self): return 2\nobj = T()\ndef f():\n    print("CALLED"); return obj', changeId: 'py', by: 'browser:local', waitMs: 30000 });
  let got = await names('python', 'x = value');
  assert.deepEqual([got.from, got.labels, got.type.value_one], [4, ['value_one'], 'variable']);
  got = await names('python', 'counts["be');
  assert.deepEqual([got.from, got.labels, got.type['beta col']], [8, ['beta col'], 'property'], 'a dict names its keys inside the quotes');
  got = await names('python', 'math.sq');
  assert.deepEqual([got.from, got.labels, got.type.sqrt], [5, ['sqrt'], 'function']);
  got = await names('python', 'obj.');
  assert.deepEqual([got.from, got.labels.sort(), got.type.p, got.type.meth], [4, ['meth', 'p'], 'property', 'function'], 'a property is named without being read');
  assert.deepEqual((await names('python', 'f().')).labels, [], 'a call is not run to complete after it');
  assert.equal((await names('python', 'imp')).type.import, 'keyword');
  const after = await host.run({ language: 'python', code: 'value_one + 1', changeId: 'py2', by: 'browser:local', waitMs: 30000 });
  assert.deepEqual([after.cell.number, text(after.cell)], [2, '42\n'], 'completing printed nothing into the session and added no cell');

  await host.run({ language: 'r', code: 'de <- read.csv("de.csv")\nodd <- data.frame(`beta col` = 1, check.names = FALSE)\ng <- function() { cat("CALLED\\n"); de }', changeId: 'r', by: 'browser:local', waitMs: 60000 });
  got = await names('r', 'summary(de$');
  assert.deepEqual([got.from, got.labels, got.type.gene], [11, ['gene', 'log2fc'], 'property']);
  got = await names('r', 'de[["lo');
  assert.deepEqual([got.from, got.labels], [5, ['log2fc']], 'a table names its columns inside the quotes of a subscript');
  assert.deepEqual((await names('r', 'odd$')).labels, ['`beta col`'], 'a name R does not read as written is given in backticks');
  got = await names('r', 'mean(x, na.r');
  assert.deepEqual([got.from, got.type['na.rm']], [8, 'argument']);
  got = await names('r', 'read.csv("d');
  assert.deepEqual([got.from, got.labels, got.type['de.csv']], [10, ['de.csv'], 'file']);
  got = await names('r', 'stats::medi');
  assert.equal(got.from, 7); assert.ok(got.labels.includes('median'), got.labels.join(' '));
  got = await names('r', 'd');
  assert.deepEqual([got.type.de, got.type.g], ['variable', undefined]);
  assert.equal((await names('r', 'g')).type.g, 'function');
  assert.ok((await names('r', 'library(stat')).labels.includes('stats'), 'installed packages are named inside library()');
  assert.deepEqual((await names('r', 'g()$')).labels, [], 'a call is not run to complete after it');
  const rAfter = await host.run({ language: 'r', code: 'nrow(de)', changeId: 'r2', by: 'browser:local', waitMs: 30000 });
  assert.deepEqual([rAfter.cell.number, text(rAfter.cell)], [2, '[1] 1\n']);

  // While a cell runs or waits the answer is busy; nothing waits for the cell.
  const slow = await host.run({ language: 'python', code: 'import time\ntime.sleep(0.6)', changeId: 'slow', by: 'agent:a' });
  assert.equal((await host.complete({ language: 'python', line: 'cou' })).state, 'busy');
  await settled(host, slow.cell.cellId);
  await assert.rejects(host.complete({ language: 'python', line: 'x'.repeat(kernelLimits.completeLineChars + 1) }), e => e.kind === 'invalid' && e.details.limit === 'completeLineChars');
  assert.equal((await host.read()).cells.length, 5);
});

test('completion gives at most its limit of names and counts the rest', async t => {
  const root = await project();
  const host = new KernelHost(root, { limits: { completeItems: 3 } });
  t.after(() => host.close());
  await host.run({ language: 'python', code: 'a1 = a2 = a3 = a4 = a5 = 0', changeId: 'py', by: 'browser:local', waitMs: 30000 });
  const got = await host.complete({ language: 'python', line: 'a' });
  assert.equal(got.state, 'shown');
  assert.equal(got.items.length, 3);
  assert.ok(got.omitted >= 2, 'the names left out are counted: ' + got.omitted);
});

test('each notebook has its own sessions: a cell keeps its notebook, and a value made in one is not in another', async () => {
  const root = await project();
  const host = new KernelHost(root, { limits: { maxSessions: 3 } });
  const plain = await host.run({ language: 'python', code: 'shared = 20', changeId: 'a', by: 'browser:local', waitMs: 30000 });
  const named = await host.run({ language: 'python', code: 'mine = 1\nprint("shared" in dir())', notebook: 'nb-4f2a', changeId: 'b', by: 'browser:local', waitMs: 30000 });
  assert.equal(plain.cell.notebook, undefined, 'the project\'s own notebook has no identity');
  assert.equal(named.cell.notebook, 'nb-4f2a');
  assert.notEqual(named.cell.sessionId, plain.cell.sessionId, 'a session of its own');
  assert.equal(named.session.notebook, 'nb-4f2a'); assert.equal(plain.session.notebook, undefined);
  assert.equal(text(await settled(host, named.cell.cellId)), 'False\n', 'the project notebook\'s value is not there');
  const next = await host.run({ language: 'python', code: 'print(mine + 1)', notebook: 'nb-4f2a', changeId: 'c', by: 'agent:a', waitMs: 30000 });
  assert.equal(next.cell.sessionId, named.cell.sessionId); assert.equal(next.cell.number, 2);
  assert.equal(text(await settled(host, next.cell.cellId)), '2\n');
  // Reading a value names the notebook whose session holds it.
  assert.equal((await host.inspect({ language: 'python', notebook: 'nb-4f2a', name: 'mine' })).state, 'shown');
  assert.equal((await host.inspect({ language: 'python', name: 'mine' })).state, 'missing');
  assert.equal((await host.inspect({ language: 'python', notebook: 'nb-0000', name: 'mine' })).state, 'none');
  // A session starts without a cell in a notebook of its own, once.
  const started = await host.start({ language: 'python', notebook: 'nb-77' }, 'browser:local');
  assert.equal(started.session.notebook, 'nb-77');
  assert.equal((await host.start({ language: 'python', notebook: 'nb-77' }, 'browser:local')).session.sessionId, started.session.sessionId);
  // Three live sessions are the limit here: a fourth is refused, naming those that run.
  await assert.rejects(host.start({ language: 'r', notebook: 'nb-77' }, 'browser:local'), e => e.kind === 'limit' && /At most 3 sessions/.test(e.message) && /Stop one in Sessions/.test(e.message));
  await assert.rejects(host.run({ language: 'python', code: '1', notebook: 'two words', changeId: 'd', by: 'browser:local' }), e => e.kind === 'invalid');
  await assert.rejects(host.start({ language: 'python', notebook: 'two words' }, 'browser:local'), e => e.kind === 'invalid');
  await host.close();
  // The record keeps both across a restart of Rho.
  const later = new KernelHost(root);
  const record = await later.read();
  assert.deepEqual(record.cells.map(c => c.notebook ?? null), [null, 'nb-4f2a', 'nb-4f2a']);
  assert.deepEqual(record.sessions.map(s => s.notebook ?? null).sort(), [null, 'nb-4f2a', 'nb-77'].sort());
  await later.close();
});

test('each cell is a timeline event: who ran it, when, where and how it ended, newest first', async () => {
  const root = await project();
  const host = new KernelHost(root);
  await host.run({ language: 'python', code: '# load\nx = 1', changeId: 'a', by: 'browser:local', waitMs: 30000 });
  await host.run({ language: 'python', code: 'raise ValueError("no")', purpose: 'Check a failure', changeId: 'b', by: 'agent:a', waitMs: 30000 });
  const { events, omitted } = await host.events();
  assert.equal(omitted, 0);
  assert.deepEqual(events.map(e => [e.by, e.action, e.label, e.where, e.outcome]), [['agent:a', 'run', 'Check a failure', 'Python', 'failed'], ['browser:local', 'run', 'x = 1', 'Python', 'done']]);
  assert.ok(events.every(e => e.startedAt && e.endedAt && e.startedAt <= e.endedAt));
  const { plugin } = await import('@rho-workspace/plugin-kernel');
  assert.equal(plugin.timeline, 'kernel.events');
  assert.equal((await host.events(1)).omitted, 1);
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

test('a session starts without a cell, a live one is kept, and one that is stopping is waited for', async () => {
  const root = await project();
  const host = new KernelHost(root, { rscript });
  const first = await host.start({ language: 'python' }, 'browser:local');
  assert.ok(['starting', 'idle'].includes(first.session.state), first.session.state);
  assert.equal(first.session.startedBy, 'browser:local'); assert.equal(first.session.cells, 0);
  assert.equal((await host.start({ language: 'python' }, 'browser:local')).session.sessionId, first.session.sessionId, 'a live session is returned as it is');
  const cell = await host.run({ language: 'python', code: 'x = 1', changeId: 'a', by: 'agent:a', waitMs: 30000 });
  assert.equal(cell.cell.sessionId, first.session.sessionId, 'the next cell runs in the session started');
  // Restarting: stop, then start, which waits for the old session to end.
  await host.stop(first.session.sessionId, 'browser:local');
  const again = await host.start({ language: 'python' }, 'browser:local');
  assert.notEqual(again.session.sessionId, first.session.sessionId);
  assert.equal((await host.read()).sessions.find(s => s.sessionId === first.session.sessionId).state, 'ended');
  const fresh = await host.run({ language: 'python', code: "'x' in globals()", changeId: 'b', by: 'agent:a', waitMs: 30000 });
  assert.equal(fresh.cell.sessionId, again.session.sessionId);
  assert.equal(text(fresh.cell), 'False\n', 'the values went with the old session');
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
  const host = new KernelHost(root, { limits: { maxQueued: 1, maxOutputBytes: 64 } });
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
  // inspectForkShare 0: this session keeps no fork of itself, as none does on Windows, on a server or in Python.
  const host = new KernelHost(root, { rscript, limits: { inspectTimeoutMs: 800, inspectForkShare: 0 } });
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
  const art = await host.inspect({ language: 'r', name: 'art' });
  assert.equal(art.state, 'shown'); assert.equal(art.object.picture, undefined, 'no picture unless asked');
  // Asked for, what it draws comes with the reading as a PNG; a value that draws nothing has none.
  const drawn = (await host.inspect({ language: 'r', name: 'art', picture: true })).object;
  assert.match(drawn.picture.data, /^iVBORw0KGgo/); assert.deepEqual([drawn.picture.width, drawn.picture.height], [1008, 720]);
  assert.equal((await host.inspect({ language: 'r', name: 'd', picture: true })).object.picture, undefined);
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

// The R processes of a session's group, each as [pid, parent]: the session and its forks. On
// Linux the group also holds the relay of the session's answers, which is not one.
const group = (pid, all = false) => { const r = spawnSync('ps', ['-o', 'pid=,ppid=,comm=', '-g', String(pid)], { encoding: 'utf8' }); return r.stdout.trim().split('\n').filter(Boolean).map(line => line.trim().split(/\s+/)).filter(([, , name]) => all || path.basename(name) === 'R').map(([id, parent]) => [Number(id), Number(parent)]); };
test('while a cell runs, a local R session is read as it was when the cell started', { skip: process.platform === 'win32' && 'a session is forked on Unix only' }, async t => {
  const root = await project();
  const host = new KernelHost(root, { rscript, limits: { inspectTimeoutMs: 800 } });
  t.after(() => host.close());
  await host.run({ language: 'r', code: 'd <- data.frame(x = c(3, 1, 2))\nl <- list(a = 1, b = list(c = "z"))\nslow <- structure(list(), class = "slow")\nprint.slow <- function(x, ...) Sys.sleep(30)\nprint.drawn <- function(x, ...) { plot(1:3); invisible(x) }\nart <- structure(quote(f(a)), class = "drawn")\nset.seed(7); seed <- .Random.seed', changeId: 'make', by: 'agent:a', waitMs: 30000 });
  const pid = (await host.read()).sessions[0].pid;
  // The cell changes d and makes a value at once, then goes on for a while.
  const long = await host.run({ language: 'r', code: 'd$x <- d$x * 100\nmade <- 1\nSys.sleep(4)\nc(children = length(parallel:::children()), seed = identical(seed, .Random.seed), x = d$x[1])', changeId: 'long', by: 'agent:a' });
  const during = await host.inspect({ language: 'r', name: 'd' });
  assert.deepEqual([during.state, during.runningCell, during.afterCell], ['shown', 2, 1], 'read while cell 2 runs, as after cell 1');
  assert.deepEqual(during.object.table.columns[0].values, ['3', '1', '2'], 'what the cell has changed since is not in it');
  assert.equal((await host.inspect({ language: 'r', name: 'l', path: [1, 0] })).object.expression, 'l$b$c', 'a part is read the same way');
  // What a value draws is drawn there too: with Cairo, as R's own PNG device ends a forked process on macOS.
  const drawn = await host.inspect({ language: 'r', name: 'art', picture: true });
  assert.deepEqual([drawn.state, drawn.runningCell], ['shown', 2]);
  assert.ok(/^iVBORw0KGgo/.test(drawn.object.picture?.data ?? '') || /Cairo/.test(drawn.object.pictureProblem ?? ''), 'a picture, or why this R draws none while a cell runs');
  const absent = await host.inspect({ language: 'r', name: 'made' });
  assert.equal(absent.state, 'missing'); assert.match(absent.problem, /was not in the session when cell 2 started/);
  // A reading that takes too long stops there; the cell is not interrupted and the next reading is answered.
  const started = Date.now(), slow = await host.inspect({ language: 'r', name: 'slow' });
  assert.deepEqual([slow.state, slow.runningCell], ['timeout', 2]); assert.ok(Date.now() - started < 4000);
  assert.equal((await host.inspect({ language: 'r', name: 'd' })).state, 'shown');
  assert.equal(group(pid).filter(([, parent]) => parent === pid).length, 1, 'the fork is the session\'s one child');
  const ended = await settled(host, long.cell.cellId);
  assert.equal(ended.state, 'done', 'the cell ran to its end');
  assert.match(text(ended), /children\s+seed\s+x\s*\n\s*0\s+1\s+300/, 'the fork is not among the code\'s own parallel children, and the random numbers are where they were');
  const after = await host.inspect({ language: 'r', name: 'd' });
  assert.deepEqual([after.state, after.runningCell, after.afterCell, after.object.table.columns[0].values], ['shown', null, 2, ['300', '100', '200']], 'the session itself is read once the cell has ended');
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(group(pid).map(([id]) => id), [pid], 'the fork ended with its cell');
  // An interrupt is for the cell: it stops, and the session and its values stay.
  const stopped = await host.run({ language: 'r', code: 'Sys.sleep(30)', changeId: 'stopped', by: 'agent:a' });
  assert.equal((await host.inspect({ language: 'r', name: 'd' })).runningCell, 3);
  await host.interrupt(stopped.cell.cellId, 'agent:a');
  assert.equal((await settled(host, stopped.cell.cellId)).state, 'interrupted');
  assert.deepEqual((await host.inspect({ language: 'r', name: 'd' })).object.table.columns[0].values, ['300', '100', '200']);
  // Each of two cells in a row is read as it started.
  const first = await host.run({ language: 'r', code: 'Sys.sleep(1); k <- 1', changeId: 'first', by: 'agent:a' });
  const second = await host.run({ language: 'r', code: 'Sys.sleep(1); k <- 2', changeId: 'second', by: 'agent:a' });
  assert.equal((await host.inspect({ language: 'r', name: 'k' })).state, 'missing');
  await settled(host, first.cell.cellId);
  const next = await host.inspect({ language: 'r', name: 'k' });
  assert.deepEqual([next.state, next.runningCell, next.object.values.items[0].value], ['shown', 5, '1']);
  await settled(host, second.cell.cellId);
  // Stopping the session while a cell runs ends its fork too and leaves no folder of readings.
  const last = await host.run({ language: 'r', code: 'Sys.sleep(30)', changeId: 'last', by: 'agent:a' });
  assert.equal((await host.inspect({ language: 'r', name: 'd' })).state, 'shown');
  const folders = async () => (await fs.readdir(tmpdir())).filter(name => name.startsWith('rho-kernel-forks-')).length, before = await folders();
  await host.stop((await host.read()).sessions[0].sessionId, 'agent:a');
  await settled(host, last.cell.cellId);
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(group(pid, true), [], 'no process of the session is left');
  assert.equal(await folders(), before - 1);
});

test('a session whose values take more than the limit is not forked, and a reading says why it waits', { skip: process.platform === 'win32' && 'a session is forked on Unix only' }, async t => {
  const root = await project();
  // A share of this machine's memory that any session is over.
  const host = new KernelHost(root, { rscript, limits: { inspectForkShare: 1e-9 } });
  t.after(() => host.close());
  await host.run({ language: 'r', code: 'd <- 1', changeId: 'make', by: 'agent:a', waitMs: 30000 });
  const running = await host.run({ language: 'r', code: 'Sys.sleep(1)', changeId: 'long', by: 'agent:a' });
  const reading = await host.inspect({ language: 'r', name: 'd' });
  assert.deepEqual([reading.state, reading.runningCell], ['busy', null]);
  assert.match(reading.problem, /^Cell 2 is running\. The session's values take [\d.]+ MB, more than the 0\.0 MB up to which the session is copied for reading while a cell runs\. The value can be read when the cell ends\.$/);
  assert.equal(group((await host.read()).sessions[0].pid).length, 1, 'no fork was made');
  assert.equal((await settled(host, running.cell.cellId)).state, 'done');
  assert.equal((await host.inspect({ language: 'r', name: 'd' })).state, 'shown');
});

test('Python values: a data frame, an array, a dict, an object and a value that takes too long', async t => {
  const root = await project();
  const host = new KernelHost(root, { python: process.env.RHO_PYTHON, limits: { inspectTimeoutMs: 800 } });
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

// A stand-in for ssh: it runs the command on this machine, as a server would, in its own process
// group, with HOME set to the test's own "server" home, relaying the two streams ssh carries.
// SIGUSR1 ends it with 255, as a lost connection ends ssh, and leaves what it ran going.
const fakeSsh = `#!/usr/bin/env node
const { spawn } = require('node:child_process'), fs = require('node:fs');
const args = process.argv.slice(2), at = args.indexOf('--'), [destination, command] = args.slice(at + 1);
fs.appendFileSync(process.env.RHO_TEST_HOME + '/ssh.log', process.pid + '\\t' + command.replace(/\\s+/g, ' ') + '\\n');
if (destination === 'unreachable') { process.stderr.write('ssh: Could not resolve hostname unreachable: nodename nor servname provided, or not known\\n'); process.exit(255); }
// The "server" login has no locale, as a server without the client's locale has none.
const env = { ...process.env, HOME: process.env.RHO_TEST_HOME, LANG: 'C' };
for (const name of Object.keys(env)) if (name.startsWith('LC_')) delete env[name];
const child = spawn('sh', ['-c', command], { detached: true, stdio: 'pipe', env });
process.stdin.pipe(child.stdin); child.stdin.on('error', () => {});
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
process.on('SIGUSR1', () => process.exit(255));
child.on('close', code => process.exit(code ?? 255));
`;
// A stand-in for serverctl: its registry is serverctl.json in the test's "server" home (none
// there: an empty one), and exec runs the words after -- on this machine as fakeSsh does.
const fakeServerctl = `#!/usr/bin/env node
const { spawn } = require('node:child_process'), fs = require('node:fs');
const args = process.argv.slice(2), home = process.env.RHO_TEST_HOME, say = value => { process.stdout.write(JSON.stringify(value)); };
fs.appendFileSync(home + '/serverctl.log', process.pid + '\\t' + args.join(' ').replace(/\\s+/g, ' ') + '\\n');
const registry = fs.existsSync(home + '/serverctl.json') ? JSON.parse(fs.readFileSync(home + '/serverctl.json', 'utf8')) : { hosts: [], skills: [] };
if (registry.broken) { say({ ok: false, error: 'DatabaseError', message: registry.broken }); process.exit(2); }
const host = alias => registry.hosts.find(h => h.alias.toLowerCase() === String(alias).toLowerCase());
const status = s => fs.existsSync(s.path) ? 'ready' : 'missing';
const skills = alias => registry.skills.filter(s => s.servers.some(x => x.alias === alias)).map(s => ({ ...s, status: status(s), ...(status(s) === 'ready' ? {} : { status_message: 'SKILL.md not found: ' + s.path }) }));
if (args[0] === 'server' && args[1] === 'list') say(registry.hosts);
else if (args[0] === 'skill' && args[1] === 'list') say(registry.skills.map(s => ({ ...s, status: status(s), ...(status(s) === 'ready' ? {} : { status_message: 'SKILL.md not found: ' + s.path }) })));
else if (args[0] === 'skill' && args[1] === 'resolve') {
  const h = host(args[2]);
  if (!h) { say({ ok: false, error: 'DatabaseError', message: 'server not found: ' + args[2] }); process.exit(2); }
  const mine = skills(h.alias), ok = mine.every(s => s.status === 'ready');
  say({ ok, hosts: [{ alias: h.alias, skills: mine }], skills: mine }); process.exit(ok ? 0 : 1);
} else if (args[0] === 'exec') {
  if (!host(args[1])) { process.stderr.write('error: server not found: ' + args[1] + '\\n'); process.exit(2); }
  const words = args.slice(args.indexOf('--') + 1);
  const env = { ...process.env, HOME: home, LANG: 'C' };
  for (const name of Object.keys(env)) if (name.startsWith('LC_')) delete env[name];
  const child = spawn(words[0], words.slice(1), { detached: true, stdio: 'pipe', env });
  process.stdin.pipe(child.stdin); child.stdin.on('error', () => {});
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  child.on('close', code => process.exit(code ?? 255));
} else process.exit(2);
`;
// Remote places are not built for Windows: they share one ssh connection per server through
// ControlMaster and a socket under /tmp, which Windows' own OpenSSH does not offer, and end what a
// session started there as a process group, which Windows does not have.
const stand = { skip: process.platform === 'win32' && 'remote places run on macOS and Linux only' };
async function server() {
  const home = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'rho-server-')));
  const ssh = path.join(home, 'ssh'), serverctl = path.join(home, 'serverctl');
  await fs.writeFile(ssh, fakeSsh, { mode: 0o755 });
  await fs.writeFile(serverctl, fakeServerctl, { mode: 0o755 });
  await fs.mkdir(path.join(home, 'proj', 'out'), { recursive: true });
  await fs.writeFile(path.join(home, 'proj', 'counts.csv'), 'gene,n\na,1\nb,5\n');
  await fs.symlink(tmpdir(), path.join(home, 'proj', 'elsewhere'));
  process.env.RHO_TEST_HOME = home;
  return { home, ssh, serverctl, log: async () => (await fs.readFile(path.join(home, 'ssh.log'), 'utf8')).trim().split('\n').map(line => line.split('\t')) };
}

test('a session on a place runs there over ssh, and its files are listed and copied', stand, async t => {
  const root = await project(), { home, ssh, serverctl } = await server();
  const host = new KernelHost(root, { rscript, ssh, serverctl });
  t.after(() => host.close());
  assert.deepEqual(await host.places(), { places: [], use: { r: 'local', python: 'local' }, copies: [] });
  await host.setPlace({ place: { placeId: 'lab', label: 'Lab server', destination: 'lab', folder: '~/proj', setup: 'export ORIGIN=lab' }, use: { r: 'lab' } }, 'browser:local');
  const { check } = await host.check('lab', 'browser:local');
  assert.equal(check.ok, true);
  assert.equal(check.folder, path.join(home, 'proj'));
  assert.match(check.r, /^R version/);
  assert.equal(check.jsonlite, true);
  assert.equal((await host.places()).places[0].check.at, check.at, 'what a check saw is kept with the place');

  // R runs where the project chose; the runner is sent on the session's own input.
  const first = await host.run({ language: 'r', code: 'd <- read.csv("counts.csv")\nmessage(Sys.getenv("ORIGIN"))\nplot(d$n)\nwrite.csv(d, "out/d.csv")', changeId: 'r1', by: 'agent:a', waitMs: 30000 });
  assert.equal(first.cell.state, 'done');
  assert.deepEqual(first.cell.outputs.map(o => o.kind), ['stderr', 'plot']);
  assert.equal(first.cell.outputs[0].text, 'lab\n', 'the place\'s setup lines ran before the session');
  assert.equal((await host.places()).places[0].via, 'ssh', 'a server serverctl does not manage is reached with ssh');
  assert.deepEqual(first.session.place, { placeId: 'lab', label: 'Lab server', destination: 'lab', folder: path.join(home, 'proj') });
  assert.ok(first.session.host);
  assert.deepEqual(first.cell.files, [{ path: 'counts.csv', how: 'read' }, { path: 'out/d.csv', how: 'wrote' }]);
  const png = await host.plot(first.cell.cellId, first.cell.outputs[1].plot);
  assert.equal(Buffer.from(png.data, 'base64').subarray(1, 4).toString(), 'PNG', 'the plot came with its answer');
  assert.deepEqual(await fs.readdir(path.join(home, '.cache', 'rho', 'kernel')), [(await fs.readdir(path.join(home, '.cache', 'rho', 'kernel')))[0]]);
  assert.equal((await host.inspect({ language: 'r', name: 'd' })).object.table.rows, 2);
  assert.equal(first.session.variables.find(v => v.name === 'd').size, '2 × 2', 'a login without a UTF-8 locale still sends UTF-8');
  await assert.rejects(host.run({ language: 'r', code: '1', changeId: 'r2', by: 'agent:a', place: 'local' }), { kind: 'conflict', message: /runs on Lab server/ });

  // Interrupting signals the session's process group there; the session and its values stay.
  const slow = await host.run({ language: 'r', code: 'for (i in 1:100) Sys.sleep(0.1)', changeId: 'slow', by: 'browser:local' });
  await new Promise(r => setTimeout(r, 800));
  await host.interrupt(slow.cell.cellId, 'browser:local');
  assert.equal((await settled(host, slow.cell.cellId, 8000)).state, 'interrupted');
  assert.match(text((await host.run({ language: 'r', code: 'nrow(d)', changeId: 'r3', by: 'agent:a', waitMs: 30000 })).cell), /\[1\] 2/);

  // Python goes where the cell names; this machine still runs it when asked.
  const py = await host.run({ language: 'python', code: 'import os\nos.getcwd()', changeId: 'p1', by: 'agent:a', waitMs: 30000, place: 'lab' });
  assert.equal(text(py.cell), `'${path.join(home, 'proj')}'\n`);

  const listed = await host.list('lab', '');
  assert.equal(listed.folder, path.join(home, 'proj'));
  assert.deepEqual(listed.entries.map(e => [e.name, e.kind]), [['out', 'folder'], ['counts.csv', 'file'], ['elsewhere', 'link']]);
  assert.deepEqual((await host.list('lab', 'out')).entries.map(e => [e.name, e.bytes]), [['d.csv', (await fs.stat(path.join(home, 'proj', 'out', 'd.csv'))).size]]);
  await assert.rejects(host.list('lab', 'elsewhere'), { kind: 'scope' }, 'a link does not widen what is read there');
  await assert.rejects(host.list('lab', '../'), { kind: 'scope' });
  const { copy } = await host.copy('lab', 'out/d.csv', 'browser:local');
  assert.equal(copy.to, 'remote/lab/out/d.csv');
  assert.equal(await fs.readFile(path.join(root, copy.to), 'utf8'), await fs.readFile(path.join(home, 'proj', 'out', 'd.csv'), 'utf8'));
  assert.equal(copy.modifiedAt, (await host.list('lab', 'out')).entries[0].modifiedAt, 'a copy and a listing name the same time');
  await host.copy('lab', 'out/d.csv', 'browser:local');
  await fs.appendFile(path.join(root, copy.to), 'mine\n');
  await assert.rejects(host.copy('lab', 'out/d.csv', 'browser:local'), { kind: 'conflict' }, 'a copy changed here is not replaced');
  await assert.rejects(host.copy('lab', 'out', 'browser:local'), { kind: 'not_found' });
  await assert.rejects(host.copy('lab', 'counts.csv', 'browser:local').then(() => host.setPlace({ remove: 'lab' }, 'browser:local')), { kind: 'conflict' }, 'a place a session runs in stays');

  const r = (await host.read()).sessions.find(s => s.language === 'r');
  await host.stop(r.sessionId, 'browser:local');
  for (let i = 0; i < 100 && (await host.read()).sessions.find(s => s.sessionId === r.sessionId).state !== 'ended'; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal((await host.read()).sessions.find(s => s.sessionId === r.sessionId).ending, 'stopped');
});

test('a lost connection leaves the running cell unknown and runs nothing again', stand, async t => {
  const root = await project(), { ssh, serverctl, log } = await server();
  const host = new KernelHost(root, { rscript, ssh, serverctl });
  t.after(() => host.close());
  await host.setPlace({ place: { placeId: 'lab', destination: 'lab', folder: '~/proj' } }, 'browser:local');
  const first = await host.run({ language: 'r', code: 'x <- 1', changeId: 'r1', by: 'agent:a', waitMs: 30000, place: 'lab' });
  const long = await host.run({ language: 'r', code: 'Sys.sleep(5)', changeId: 'r2', by: 'agent:a' });
  await new Promise(r => setTimeout(r, 500));
  const [session] = (await log()).find(([, command]) => command.includes('exec Rscript'));
  process.kill(Number(session), 'SIGUSR1');
  const cell = await settled(host, long.cell.cellId, 8000);
  assert.equal(cell.state, 'unknown');
  assert.match(cell.problem, /connection to lab was lost/);
  const ended = (await host.read()).sessions.find(s => s.sessionId === first.session.sessionId);
  assert.equal(ended.ending, 'disconnected');
  assert.match(ended.problem, /was not seen to end/);
  const next = await host.run({ language: 'r', code: 'exists("x")', changeId: 'r3', by: 'agent:a', waitMs: 30000 });
  assert.notEqual(next.session.sessionId, first.session.sessionId, 'the next cell starts another session');
  assert.equal(next.session.place, null, 'where the project runs R is unchanged by a cell that named a place');
  assert.equal((await host.read()).cells.filter(c => c.code === 'Sys.sleep(5)').length, 1, 'the unknown cell is not run again');
});

// The pa14-qs case (Rho-cases, 2026-10-31): an Agent put the skill's `mkdir -p` in a place's
// setup; the check looked for the folder before it ran and reported none, and a session started
// without that check would not have found it.
test('a place whose setup lines make its folder is ready for a session and a check alike', stand, async t => {
  const root = await project(), { home, ssh, serverctl } = await server();
  const host = new KernelHost(root, { rscript, ssh, serverctl });
  t.after(() => host.close());
  await host.setPlace({ place: { placeId: 'new', label: 'New results', destination: 'lab', folder: '~/results/a', setup: 'mkdir -p ~/results/a' }, use: { r: 'new' } }, 'agent:a');
  const run = await host.run({ language: 'r', code: 'cat(basename(getwd()))', changeId: 'w', by: 'agent:a', waitMs: 30000 });
  assert.equal(run.cell.state, 'done', run.cell.problem ?? run.session.problem ?? '');
  assert.equal(run.session.place.folder, path.join(home, 'results', 'a'));
  await host.setPlace({ place: { placeId: 'other', label: 'Other results', destination: 'lab', folder: '~/results/b', setup: 'mkdir -p ~/results/b' } }, 'agent:a');
  const { check } = await host.check('other', 'agent:a');
  assert.equal(check.ok, true, check.problem ?? '');
  assert.equal(check.folder, path.join(home, 'results', 'b'));
  await host.setPlace({ place: { placeId: 'none', label: 'Nowhere', destination: 'lab', folder: '~/results/c' } }, 'agent:a');
  assert.equal((await host.check('none', 'agent:a')).check.problem, 'The folder is not on the server, or this account cannot open it.');
});

test('a place that cannot be reached says what ssh said', stand, async t => {
  const root = await project(), { ssh, serverctl } = await server();
  const host = new KernelHost(root, { rscript, ssh, serverctl });
  t.after(() => host.close());
  await host.setPlace({ place: { placeId: 'gone', destination: 'unreachable', folder: '/data' }, use: { python: 'gone' } }, 'browser:local');
  const { check } = await host.check('gone', 'agent:a');
  assert.equal(check.ok, false);
  assert.match(check.problem, /Could not resolve hostname/);
  const run = await host.run({ language: 'python', code: '1', changeId: 'p1', by: 'agent:a', waitMs: 30000 });
  assert.equal(run.cell.state, 'not-run');
  assert.equal(run.session.ending, 'not-started');
  assert.match(run.session.problem, /Could not resolve hostname/);
  await assert.rejects(host.setPlace({ use: { r: 'nowhere' } }, 'agent:a'), { kind: 'not_found' });
});

test('a server managed with serverctl is reached through it, and the skills bound to it are read', stand, async t => {
  const root = await project(), { home, serverctl } = await server();
  const skill = path.join(home, 'skills', 'lab-r', 'SKILL.md');
  await fs.mkdir(path.dirname(skill), { recursive: true });
  await fs.writeFile(skill, '---\nname: lab-r\ndescription: How R is used on Lab.\n---\n\n# Lab\n\nBefore R, run `export LAB_R=ready`.\n');
  const registry = { hosts: [{ alias: 'Lab', hostname: '10.1.2.3', username: 'me', tags: ['cluster'], facts: { os: 'Debian GNU/Linux 12' } }, { alias: 'Other', hostname: 'other.example.org', tags: [], facts: null }],
    skills: [{ name: 'lab-r', description: 'How R is used on Lab.', path: skill, servers: [{ id: 'x', alias: 'Lab' }] }] };
  await fs.writeFile(path.join(home, 'serverctl.json'), JSON.stringify(registry));
  // No ssh at all: a managed server is reached only through serverctl.
  const host = new KernelHost(root, { rscript, ssh: path.join(home, 'no-ssh'), serverctl });
  t.after(() => host.close());

  const servers = await host.servers();
  assert.deepEqual(servers.tool, { program: serverctl, ok: true, problem: null });
  assert.deepEqual(servers.servers, [
    { server: 'Lab', system: 'Debian GNU/Linux 12', tags: ['cluster'], skills: [{ name: 'lab-r', description: 'How R is used on Lab.', path: skill, status: 'ready', problem: null }] },
    { server: 'Other', system: null, tags: [], skills: [] }]);
  assert.doesNotMatch(JSON.stringify(servers), /10\.1\.2\.3|example\.org|"me"/, 'a server\'s address and account stay with serverctl');
  const read = await host.serverSkill('lab', 'LAB-R');
  assert.equal(read.server, 'Lab');
  assert.match(read.text, /export LAB_R=ready/);
  await assert.rejects(host.serverSkill('Lab', 'gpu'), { kind: 'not_found' });
  await assert.rejects(host.serverSkill('Nowhere', 'lab-r'), { kind: 'unavailable', message: /server not found/ });

  // Named without via, a server serverctl manages is reached through it, under serverctl's name.
  await host.setPlace({ place: { placeId: 'lab', label: 'Lab', destination: 'lab', folder: '~/proj', setup: 'export LAB_R=ready' }, use: { r: 'lab' } }, 'agent:a');
  const [place] = (await host.places()).places;
  assert.deepEqual([place.via, place.destination], ['serverctl', 'Lab']);
  await assert.rejects(host.setPlace({ place: { placeId: 'x', via: 'serverctl', destination: 'nowhere', folder: '~' } }, 'agent:a'), { kind: 'not_found' });
  const { check } = await host.check('lab', 'agent:a');
  assert.equal(check.ok, true);
  assert.match(check.r, /^R version/);
  const cell = await host.run({ language: 'r', code: 'cat(Sys.getenv("LAB_R"), nrow(read.csv("counts.csv")))', changeId: 'r1', by: 'agent:a', waitMs: 30000 });
  assert.equal(text(cell.cell), 'ready 2', 'the setup lines the skill gave ran before the session');
  assert.equal(cell.session.place.destination, 'Lab');
  const slow = await host.run({ language: 'r', code: 'for (i in 1:100) Sys.sleep(0.1)', changeId: 'slow', by: 'agent:a' });
  await new Promise(r => setTimeout(r, 800));
  await host.interrupt(slow.cell.cellId, 'agent:a');
  assert.equal((await settled(host, slow.cell.cellId, 8000)).state, 'interrupted', 'interrupt goes through serverctl too');
  assert.deepEqual((await host.list('lab', '')).entries.map(e => e.name).sort(), ['counts.csv', 'elsewhere', 'out']);
  const calls = (await fs.readFile(path.join(home, 'serverctl.log'), 'utf8')).trim().split('\n').map(line => line.split('\t')[1]);
  assert.ok(calls.filter(c => c.startsWith('exec ')).every(c => c.startsWith('exec Lab --timeout ') && c.includes(' --reuse 60 -- ')), 'each command goes through serverctl exec on a shared connection');
  assert.ok(calls.some(c => c.startsWith('exec Lab --timeout 604800 ')), 'a session lasts up to serverctl\'s limit for one command');

  // A skill that is not ready withholds the server's skills, as serverctl resolves them together.
  await fs.rm(skill);
  const [lab] = (await host.servers()).servers;
  assert.equal(lab.skills[0].status, 'missing');
  assert.match(lab.skills[0].problem, /SKILL.md not found/);
  await assert.rejects(host.serverSkill('Lab', 'lab-r'), { kind: 'unavailable', message: /lab-r is missing/ });

  // When serverctl cannot read its registry, what it said is the answer.
  await fs.writeFile(path.join(home, 'serverctl.json'), JSON.stringify({ broken: 'database schema 8 is newer than supported 5' }));
  assert.deepEqual((await host.servers()).tool, { program: serverctl, ok: false, problem: 'serverctl: database schema 8 is newer than supported 5' });
  await host.setPlace({ place: { placeId: 'lab', label: 'Lab', destination: 'lab', folder: '~/proj', setup: 'export LAB_R=ready\nexport MORE=1' } }, 'browser:local');
  assert.deepEqual([(await host.places()).places[0].via, (await host.places()).places[0].destination], ['serverctl', 'Lab'], 'a place changed on its server stays with serverctl while serverctl cannot be asked');
  const missing = new KernelHost(await project(), { rscript, serverctl: path.join(home, 'no-serverctl') });
  assert.match((await missing.servers()).tool.problem, /no-serverctl was not found/);
});
