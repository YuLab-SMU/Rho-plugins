import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
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
// Base graphics pages are described through gridGraphics; heatmaps need ComplexHeatmap.
const drawing = spawnSync(rscript, ['-e', 'cat(vapply(c("gridGraphics","ComplexHeatmap"), requireNamespace, TRUE, quietly = TRUE))'], { encoding: 'utf8' });
const [gridGraphics, complexHeatmap] = drawing.status === 0 ? drawing.stdout.trim().split(/\s+/).map(v => v === 'TRUE') : [false, false];

async function session() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'rho-figures-'));
  const host = new KernelHost(root, { rscript, extensions: { r: [rExtension] } });
  const figures = new Figures(root, { record: (cellId, plot) => host.figureRecord(cellId, plot), saved: sha256 => host.savedFigure(sha256) });
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
    const brief = await figures.brief({ cellId: cell.cellId, plot: 1 }, selection.selectionId, 3);
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

test('a composition numbers its layers across its plots; drawings no describer knows stay pictures without a problem', { skip, timeout: 180000 }, async () => {
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
    const drawn = await run(`grid::grid.newpage(); grid::grid.rect(width = 0.5)`);
    assert.equal(drawn.plots.length, 1);
    assert.equal(drawn.plots[0].figure, undefined);
    assert.equal(drawn.plots[0].figureProblem, undefined, 'a plot nothing describes is a picture, not a failure');
    await assert.rejects(host.figureRecord(drawn.cell.cellId, 1), /picture only/);
  } finally { await host.close(); }
});

test('a page drawn with base graphics is a figure: its points are bound to the table that holds their values, its bars to their labels', { skip: skip || (!gridGraphics && 'gridGraphics is not available'), timeout: 180000 }, async () => {
  const { host, figures, run } = await session();
  try {
    await run(`set.seed(4); res <- data.frame(baseMean = c(0, 10^runif(299, 0, 4)), lfc = rnorm(300), row.names = sprintf("G%03d", 1:300)); res$lfc[9] <- 8`);
    // A point at zero on a log axis is not drawn, and one past the limit is drawn at the limit.
    const { cell, plots } = await run(`plot(res$baseMean, pmin(res$lfc, 3), log = "x", pch = ifelse(res$lfc > 3, 2, 16), main = "MA", xlab = "mean", ylab = "log fold change")
abline(h = 0)
text(res$baseMean[2:3], res$lfc[2:3], rownames(res)[2:3])`);
    assert.equal(plots.length, 1);
    assert.ok(plots[0].figure, plots[0].figureProblem);
    assert.deepEqual([plots[0].figure.describer, plots[0].figure.geoms, plots[0].figure.marks, plots[0].figure.bound], ['graphics', ['points', 'abline', 'text'], 302, 302]);
    const fig = await record(host, cell.cellId);
    const [points, line, labels] = fig.figure.layers;
    assert.deepEqual([points.marks, points.bound, points.source, points.mapping], [299, 'mark', 'res', { x: 'baseMean', y: 'lfc' }]);
    assert.deepEqual(points.notes, ['1 of 299 marks are drawn at a y other than their lfc.']);
    assert.equal(markRow(fig, { layer: 0, mark: 0 }).key.value, 'G002', 'the first drawn point is the first row with a mean above zero');
    assert.deepEqual([line.source, markRow(fig, { layer: 1, mark: 0 }).built.yintercept], [null, 0]);
    assert.deepEqual([labels.source, markRow(fig, { layer: 2, mark: 1 }).key.value, markRow(fig, { layer: 2, mark: 1 }).built.label], ['res', 'G003', 'G003']);
    assert.deepEqual([fig.figure.plots[0].title, fig.figure.plots[0].labels, fig.figure.plots[0].positions.x.transform], ['MA', { x: 'mean', y: 'log fold change' }, 'log-10']);
    const x = markRow(fig, { layer: 0, mark: 0 }).built.x;
    assert.ok(Math.abs(x - markRow(fig, { layer: 0, mark: 0 }).values.baseMean) <= 1e-9 * x, 'a log axis is read back in the data\'s units');
    // The point past the limit is found by its row's value, not by where it was drawn.
    const far = await figures.read({ cellId: cell.cellId, plot: 1, where: [{ column: 'lfc', op: 'gt', value: 7 }, { layer: 0, column: 'lfc', op: 'gt', value: 7 }] });
    assert.deepEqual(far.matched.marks, ['0.7']);
    const covered = new Set([...fig.svg.matchAll(/data-rho="(\d+\.\d+)"/g)].flatMap(m => elementMarks(fig, m[1])).map(m => `${m.layer}.${m.mark}`));
    assert.equal(covered.size, 302, 'every point, the line and both labels are drawn by elements that name them');

    const bars = await run(`barplot(c(alpha = 3, beta = 5, gamma = 2))`);
    const barFig = await record(host, bars.cell.cellId);
    assert.equal(barFig.figure.layers[0].geom, 'rect');
    assert.deepEqual([0, 1, 2].map(m => [markRow(barFig, { layer: 0, mark: m }).built.label, markRow(barFig, { layer: 0, mark: m }).built.ymax]), [['alpha', 3], ['beta', 5], ['gamma', 2]]);
  } finally { await host.close(); }
});

test('a ComplexHeatmap is a figure: each cell names its row, column, value and slice, in the order drawn', { skip: skip || (!complexHeatmap && 'ComplexHeatmap is not available'), timeout: 180000 }, async () => {
  const { host, run } = await session();
  try {
    const { cell, plots } = await run(`suppressPackageStartupMessages(library(ComplexHeatmap)); set.seed(1)
mat <- matrix(rnorm(48), 12, dimnames = list(paste0("g", 1:12), paste0("s", 1:4)))
Heatmap(mat, name = "z-score (VST)", row_split = rep(c("a", "b"), 6))`);
    assert.ok(plots[0].figure, plots[0].figureProblem);
    assert.deepEqual([plots[0].figure.describer, plots[0].figure.marks, plots[0].figure.bound], ['ComplexHeatmap', 48, 48]);
    const fig = await record(host, cell.cellId);
    assert.deepEqual([fig.figure.layers[0].geom, fig.figure.layers[0].source], ['heatmap', 'mat']);
    for (let m = 0; m < 48; m++) {
      const row = markRow(fig, { layer: 0, mark: m });
      assert.equal(row.values[row.built.column], row.built.value, 'a cell\'s value is its row\'s value in its column');
    }
    // The top left cell drawn is the first row and column of the order the heatmap was drawn in.
    const order = (await run(`o <- draw(Heatmap(mat, name = "z-score (VST)", row_split = rep(c("a", "b"), 6))); cat(rownames(mat)[row_order(o)[[1]][1]], colnames(mat)[column_order(o)[1]])`)).cell.outputs.filter(o => o.kind === 'stdout').map(o => o.text).join('').trim().split(' ');
    const cells = [...fig.svg.matchAll(/<rect[^>]*\sx="([\d.]+)"[^>]*\sy="([\d.]+)"[^>]*data-rho="(\d+\.\d+)"/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]), at: m[3] }));
    assert.equal(cells.length, 48);
    const corner = cells.sort((a, b) => a.y - b.y || a.x - b.x)[0];
    const first = markRow(fig, elementMarks(fig, corner.at)[0]);
    assert.deepEqual([first.built.row, first.built.column, first.facets['row slice']], [...order, 'a']);
  } finally { await host.close(); }
});

test('a ggplot saved with ggsave is a figure of the file while the file keeps the bytes the cell saved', { skip, timeout: 180000 }, async () => {
  const { root, host, figures, run } = await session();
  const sha = async relative => createHash('sha256').update(await fs.readFile(path.join(root, relative))).digest('hex');
  try {
    const saving = await run(`library(ggplot2); dir.create("results")
p <- ggplot(mtcars, aes(wt, mpg, colour = factor(cyl))) + geom_point()
ggsave("results/cars.png", p, width = 6, height = 4, dpi = 100)
ggsave(tempfile(fileext = ".png"), p)
x <- 1`);
    assert.equal(saving.plots.length, 0, 'saving draws nothing in the cell');
    assert.equal(saving.cell.saved?.length, 1, 'a file outside the project is not kept');
    const [saved] = saving.cell.saved;
    assert.deepEqual([saved.path, saved.number, saved.sha256], ['results/cars.png', 1, await sha('results/cars.png')]);
    assert.ok(saved.figure, saved.figureProblem);
    assert.equal(saved.figure.marks, 32);
    assert.deepEqual((await host.read()).sessions.at(-1).variables.map(v => v.name).sort(), ['p', 'x'], 'describing the saved page adds no variables');

    // Read by path, as the file is now: drawn at the size it was saved at, rows by mark.
    const read = await figures.read({ path: 'results/cars.png', form: 'view' });
    assert.deepEqual([read.figure.path, read.figure.sha256, read.figure.cellId], ['results/cars.png', saved.sha256, saving.cell.cellId]);
    assert.deepEqual([read.record.size.width, read.record.size.height], [6, 4]);
    const row = await figures.read({ path: 'results/cars.png', marks: ['0.0'] });
    assert.equal(row.rows[0].key.value, 'Mazda RX4');

    // A selection on the file's figure follows its bytes; a message's brief names the file.
    const { selection } = await figures.select({ sha256: saved.sha256, marks: ['0.0', '0.1'], note: 'Two cars', changeId: 'pick-file' }, 'agent:a');
    assert.deepEqual([selection.cellId, selection.sha256, selection.plot], [saving.cell.cellId, saved.sha256, undefined]);
    assert.deepEqual((await figures.read({ path: 'results/cars.png', selection: selection.selectionId })).rows.map(r => r.mark), ['0.0', '0.1']);
    const brief = await figures.brief({ path: 'results/cars.png' }, selection.selectionId, 5);
    assert.deepEqual([brief.path, brief.sha256, brief.count, brief.plot], ['results/cars.png', saved.sha256, 2, undefined]);
    await assert.rejects(figures.read({ cellId: saving.cell.cellId, plot: 1, path: 'results/cars.png' }), /Name a figure by cellId and plot, or by path/);

    // Saved with path= into a folder, as a PDF of a composition, while also printed in the cell.
    if (patchwork) {
      const both = await run(`library(patchwork); q <- p + (ggplot(mtcars, aes(factor(gear))) + geom_bar()); print(q); ggsave("two.pdf", q, path = "results", width = 20, height = 10, units = "cm")`);
      assert.equal(both.plots.length, 1);
      assert.equal(both.cell.saved[0].path, 'results/two.pdf');
      assert.equal(both.cell.saved[0].figure.kind, 'patchwork');
      const pdf = await figures.read({ path: 'results/two.pdf', form: 'view' });
      assert.ok(Math.abs(pdf.record.size.width - 20 / 2.54) < 0.01, 'the figure is drawn at the size it was saved at');
    }

    // Written again by something else, the file is a picture; the bytes the cell saved still name it.
    await run(`png("results/cars.png"); plot(1:3); invisible(dev.off())`);
    await assert.rejects(figures.read({ path: 'results/cars.png' }), /No Notebook cell saved a figure as this file/);
    assert.equal((await figures.read({ sha256: saved.sha256 })).figure.path, 'results/cars.png');
    await assert.rejects(figures.read({ path: '../outside.png' }), /project-relative path/);
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
