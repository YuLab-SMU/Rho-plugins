import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { KernelHost } from '@rho-workspace/plugin-kernel';
import { Figures, rExtension, parseRecord, elementMarks, markRow, plugin } from '@rho-workspace/plugin-figures';

// Real R sessions describe real plots here. The describer needs ggplot2, svglite, xml2 and
// jsonlite; patchwork is used where present. Without them these checks are skipped, not passed.
const rscript = process.env.RHO_RSCRIPT ?? 'Rscript';
const probe = spawnSync(rscript, ['-e', 'cat(vapply(c("ggplot2","svglite","xml2","jsonlite","patchwork"), requireNamespace, TRUE, quietly = TRUE))'], { encoding: 'utf8' });
const have = probe.status === 0 ? probe.stdout.trim().split(/\s+/).map(v => v === 'TRUE') : [];
const skip = have.slice(0, 4).every(Boolean) ? false : 'R with ggplot2, svglite, xml2 and jsonlite is not available';
const patchwork = have[4] === true;

async function session() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'rho-figures-'));
  const host = new KernelHost(root, { rscript, extensions: { r: [rExtension] } });
  const figures = new Figures(root, { record: (cellId, plot) => host.figureRecord(cellId, plot) });
  let n = 0;
  const run = async (code, by = 'browser:local') => {
    const { cell } = await host.run({ language: 'r', code, changeId: 'c' + ++n, by, waitMs: 120000 });
    assert.equal(cell.state, 'done', cell.outputs.map(o => o.text ?? '').join(''));
    return { cell, plots: cell.outputs.filter(o => o.kind === 'plot') };
  };
  return { root, host, figures, run };
}
const record = async (host, cellId, plot = 1) => parseRecord((await host.figureRecord(cellId, plot)).bytes);

test('a ggplot drawn in a cell is described: every point is bound to its row, and rows can be read, matched and selected', { skip, timeout: 180000 }, async () => {
  const { root, host, figures, run } = await session();
  try {
    await run(`set.seed(1); n <- 400
res <- data.frame(log2FoldChange = rnorm(n, 0, 2), padj = 10^-runif(n, 0, 12), row.names = sprintf("G%03d", seq_len(n)))
res$significant <- res$padj < 0.01 & abs(res$log2FoldChange) > 1`);
    const { cell, plots } = await run(`library(ggplot2)
ggplot(res, aes(log2FoldChange, -log10(padj), colour = significant)) + geom_point() +
  geom_text(data = subset(res, padj < 1e-11), aes(label = rownames(subset(res, padj < 1e-11))), vjust = -1)`);
    assert.equal(plots.length, 1);
    const summary = plots[0].figure;
    assert.ok(summary, plots[0].figureProblem ?? 'the plot output names its figure');
    assert.equal(summary.describer, 'ggplot');
    assert.deepEqual(summary.geoms, ['Point', 'Text']);
    const fig = await record(host, cell.cellId);
    assert.equal(fig.schema, 'rho.figure/1');
    assert.equal(fig.figure.layers[0].marks, 400);
    assert.equal(fig.figure.layers[0].bound, 'mark');
    const labelled = Number(spawnSync(rscript, ['-e', 'set.seed(1); n <- 400; x <- rnorm(n, 0, 2); cat(sum(10^-runif(n, 0, 12) < 1e-11))'], { encoding: 'utf8' }).stdout);
    assert.equal(fig.figure.layers[1].marks, labelled, 'the label layer has one mark for each labelled row');

    // Each drawn element names marks of this figure; together they cover every point.
    const svg = fig.svg;
    const attrs = [...svg.matchAll(/data-rho="(\d+\.\d+)"/g)].map(m => m[1]);
    const covered = new Set(attrs.flatMap(a => elementMarks(fig, a)).filter(m => m.layer === 0).map(m => m.mark));
    assert.equal(covered.size, 400, 'every point is drawn by an element that names it');
    assert.match(svg, /^(<\?xml[^>]*>\s*)?<svg[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/, 'the picture is SVG with its namespace');
    assert.doesNotMatch(svg, /<script/i);

    // The summary an Agent reads first, then rows by condition, by mark and by selection.
    const read = await figures.read({ cellId: cell.cellId, plot: 1 });
    assert.equal(read.summary.sources[0].key, '.rownames', 'the plot data is keyed by its row names');
    assert.deepEqual(read.summary.layers.map(l => [l.geom, l.source, l.bound]), [['Point', 'data', 'mark'], ['Text', 'layer2', 'mark']]);
    assert.ok(read.summary.sources[0].columns.some(c => c.name === 'padj'));
    const strong = await figures.read({ cellId: cell.cellId, plot: 1, where: [{ column: 'padj', op: 'lt', value: 1e-11 }, { column: 'significant', op: 'eq', value: true }], limit: 500 });
    assert.ok(strong.matched.total > 0);
    for (const row of strong.rows) { assert.ok(row.values.padj < 1e-11); assert.equal(row.values.significant, true); assert.match(row.key.value, /^G\d{3}$/); }
    const one = await figures.read({ cellId: cell.cellId, plot: 1, marks: ['0.41'] });
    assert.equal(one.rows[0].key.value, 'G042', 'built row 41 of the points is row 42 of the data');
    assert.ok(Math.abs(one.rows[0].built.x - one.rows[0].values.log2FoldChange) < 1e-9, 'its drawn position is its value');
    await assert.rejects(figures.read({ cellId: cell.cellId, plot: 1, marks: ['0.400'] }), /names no layer or row/);
    await assert.rejects(figures.read({ cellId: cell.cellId, plot: 1, where: [{ column: 'nope', op: 'eq', value: 1 }] }), /No source or built column/);

    // A selection is kept once, named by who made it and its change; reusing that change for
    // other marks is refused.
    const marks = strong.matched.marks.slice(0, 5);
    const { selection } = await figures.select({ cellId: cell.cellId, plot: 1, marks, note: 'Strongest', changeId: 'pick-1' }, 'agent:a');
    assert.equal(selection.count, marks.length);
    assert.deepEqual((await figures.select({ cellId: cell.cellId, plot: 1, marks, note: 'Strongest', changeId: 'pick-1' }, 'agent:a')).selection, selection);
    await assert.rejects(figures.select({ cellId: cell.cellId, plot: 1, marks: marks.slice(1), note: 'Strongest', changeId: 'pick-1' }, 'agent:a'), /already names a different selection/);
    const other = await figures.select({ cellId: cell.cellId, plot: 1, marks: ['0.1'], changeId: 'pick-1' }, 'browser:local');
    assert.notEqual(other.selection.selectionId, selection.selectionId, 'another principal\'s change is its own selection');
    const bySelection = await figures.read({ cellId: cell.cellId, plot: 1, selection: selection.selectionId });
    assert.deepEqual(bySelection.rows.map(r => r.mark), marks);
    const brief = await figures.brief(cell.cellId, 1, selection.selectionId, 3);
    assert.equal(brief.count, marks.length);
    assert.equal(brief.rows.length, 3);
    assert.equal(brief.note, 'Strongest');
    const kept = await figures.read({ cellId: cell.cellId, plot: 1, form: 'selections' });
    assert.equal(kept.selections.length, 2);
    await assert.rejects(figures.read({ cellId: cell.cellId, plot: 1, selection: 'f-0000000000000000' }), /no such selection/);
    assert.ok((await fs.readdir(path.join(root, '.rho/plugins/figures', `${cell.cellId}-1`))).length === 2);
  } finally { await host.close(); }
});

test('what a layer computed is read in data units: counts, boxes on a log scale, facets and lines by group', { skip, timeout: 180000 }, async () => {
  const { host, run } = await session();
  try {
    const { cell } = await run(`library(ggplot2)
d <- data.frame(gene = rep(c("A", "B"), each = 8), dex = rep(c("trt", "untrt"), 8), count = c(100, 10, 120, 12, 140, 14, 160, 16, 1000, 50, 1100, 55, 1200, 60, 1300, 65))
ggplot(d, aes(dex, count)) + geom_boxplot() + geom_point() + facet_wrap(~ gene) + scale_y_log10()`);
    const fig = await record(host, cell.cellId);
    assert.deepEqual(fig.figure.layers.map(l => [l.geom, l.bound]), [['Boxplot', 'mark'], ['Point', 'mark']]);
    assert.equal(fig.figure.layers[0].marks, 4, 'one box for each treatment in each facet');
    const boxes = [0, 1, 2, 3].map(m => markRow(fig, { layer: 0, mark: m }));
    const treated = boxes.find(b => b.facets.gene === 'B' && b.built.x === 'trt');
    assert.ok(treated, 'a box names its facet and its level on the discrete axis');
    // The scale transforms before the statistic: the median drawn between 1100 and 1200 on a log
    // scale is their geometric mean, read back in counts.
    assert.ok(Math.abs(treated.built.middle - Math.sqrt(1100 * 1200)) < 0.01, `a median on a log scale is read in counts (${treated.built.middle})`);
    assert.ok(Math.abs(treated.built.ymin - 1000) < 1e-6);
    const point = markRow(fig, { layer: 1, mark: 0 });
    assert.equal(point.values.count, 100, 'a point drawn from a row keeps that row');

    const bars = await run(`ggplot(d, aes(dex)) + geom_bar()`);
    const barFig = await record(host, bars.cell.cellId);
    assert.equal(barFig.figure.layers[0].source, null, 'a count is computed: it has no row of its own');
    assert.deepEqual([0, 1].map(m => markRow(barFig, { layer: 0, mark: m }).built.count), [8, 8]);

    const lines = await run(`e <- data.frame(t = rep(1:5, 3), y = c(1:5, 2 * 1:5, 3 * 1:5), series = rep(c("a", "b", "c"), each = 5)); ggplot(e, aes(t, y, colour = series)) + geom_line()`);
    const lineFig = await record(host, lines.cell.cellId);
    assert.equal(lineFig.figure.layers[0].bound, 'group', 'a line stands for the rows of its group');
    const lineUnits = lineFig.units.filter(u => u.layer === 0);
    assert.deepEqual(lineUnits.flatMap(u => u.marks).map(m => m.length).sort(), [5, 5, 5]);
  } finally { await host.close(); }
});

test('a composition numbers its layers across its plots; plots other systems draw stay pictures without a problem', { skip, timeout: 180000 }, async () => {
  const { host, run } = await session();
  try {
    if (patchwork) {
      const { cell, plots } = await run(`library(ggplot2); library(patchwork)
(ggplot(mtcars, aes(wt, mpg)) + geom_point()) + (ggplot(mtcars, aes(factor(cyl))) + geom_bar() + labs(title = "Cylinders"))`);
      assert.equal(plots[0].figure.kind, 'patchwork');
      const fig = await record(host, cell.cellId);
      assert.deepEqual(fig.figure.layers.map(l => [l.plot, l.geom]), [[1, 'Point'], [2, 'Bar']]);
      assert.equal(markRow(fig, { layer: 0, mark: 0 }).key.value, 'Mazda RX4', 'rows keep their names inside a composition');
    }
    const base = await run(`plot(mtcars$wt, mtcars$mpg)`);
    assert.equal(base.plots.length, 1);
    assert.equal(base.plots[0].figure, undefined);
    assert.equal(base.plots[0].figureProblem, undefined, 'a plot nothing describes is a picture, not a failure');
    await assert.rejects(host.figureRecord(base.cell.cellId, 1), /picture only/);
  } finally { await host.close(); }
});

test('describing a plot leaves the session as the cell left it: no output, no variables, the same random numbers', { skip, timeout: 180000 }, async () => {
  const { host, run } = await session();
  try {
    const plain = await run(`set.seed(3); a <- runif(1); cat(format(a, digits = 15))`);
    const drawn = await run(`set.seed(3); library(ggplot2); print(ggplot(data.frame(x = 1:3, y = c(1, NA, 3)), aes(x, y)) + geom_point()); b <- runif(1); cat(format(b, digits = 15))`);
    assert.ok(drawn.plots[0].figure, drawn.plots[0].figureProblem);
    const text = c => c.outputs.filter(o => o.kind === 'stdout').map(o => o.text).join('');
    assert.equal(text(drawn.cell), text(plain.cell), 'drawing the figure again draws no random numbers the code would see');
    assert.equal(drawn.cell.outputs.filter(o => o.kind === 'warning').length, 1, 'the cell warns once about its missing value; drawing it again for the figure does not warn again');
    const vars = (await host.read()).sessions.at(-1).variables.map(v => v.name);
    assert.deepEqual(vars.sort(), ['a', 'b']);
  } finally { await host.close(); }
});

test('the plugin declares its operations and a skill that names them', () => {
  assert.equal(plugin.id, 'figures');
  assert.deepEqual(plugin.requires, ['kernel']);
  assert.deepEqual(plugin.operations.map(o => o.method).sort(), ['figure.read', 'figure.select']);
  assert.deepEqual(plugin.skills[0].requires, ['figure.read', 'figure.select']);
  assert.equal(plugin.skills[0].verify.command, 'npm run test:figures');
});
