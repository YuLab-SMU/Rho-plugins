import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { KernelHost } from '@rho-workspace/plugin-kernel';
import { Figures, rExtension, pythonExtension, parseRecord, elementMarks, markRow, plugin } from '@rho-workspace/plugin-figures';

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

    // A position drawn through a transform of a column is bound through it; a p-value of 0 (drawn at
    // Inf, so not drawn) is not near every value.
    const volcano = await run(`res$padj <- 10^-runif(300, 0, 20); res$padj[5] <- 0; plot(res$lfc, -log10(res$padj), pch = 20)`);
    const volFig = await record(host, volcano.cell.cellId);
    assert.deepEqual([volFig.figure.layers[0].marks, volFig.figure.layers[0].source, volFig.figure.layers[0].mapping], [299, 'res', { x: 'lfc', y: '-log10(padj)' }]);
    for (let m = 0; m < 299; m++) {
      const row = markRow(volFig, { layer: 0, mark: m });
      assert.ok(Math.abs(row.built.y + Math.log10(row.values.padj)) <= 1e-6 * Math.abs(row.built.y), 'each point is its own row\'s -log10(padj), to the 7 digits a record keeps');
    }
    // Drawn over an MA plot at log2 of the column the plot draws on its log axis, the overlay is
    // bound, and its note says the two layers place their marks on different scales.
    const overlay = await run(`plot(res$baseMean, res$lfc, log = "x"); up <- res$baseMean > 2 & res$lfc > 1; points(log2(res$baseMean[up]), res$lfc[up], col = "red")`);
    const overFig = await record(host, overlay.cell.cellId);
    const over = overFig.figure.layers[1];
    assert.deepEqual([over.source, over.mapping, over.notes], ['res', { x: 'log2(baseMean)', y: 'lfc' }, ['Its x is log2(baseMean), while layer 0 of this plot draws x as baseMean on the same axis.']]);
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
    await run(`writeBin(charToRaw("written by something else"), "results/cars.png")`);
    await assert.rejects(figures.read({ path: 'results/cars.png' }), /No Notebook cell saved a figure as this file/);
    assert.equal((await figures.read({ sha256: saved.sha256 })).figure.path, 'results/cars.png');
    await assert.rejects(figures.read({ path: '../outside.png' }), /project-relative path/);
  } finally { await host.close(); }
});

test('a page drawn on a file the cell opened is a figure of that file: base graphics, a ggplot, a heatmap, numbered pages and a device left open', { skip: skip || (!gridGraphics && 'gridGraphics is not available'), timeout: 180000 }, async () => {
  const { root, host, figures, run } = await session();
  const sha = async relative => createHash('sha256').update(await fs.readFile(path.join(root, relative))).digest('hex');
  try {
    await run(`set.seed(4); dir.create("results"); res <- data.frame(baseMean = 10^runif(300, 0, 4), lfc = rnorm(300), row.names = sprintf("G%03d", 1:300))`);
    // Opened, drawn and closed as a script does, also inside a function; a file outside the project is not kept.
    const ma = await run(`png("results/ma.png", width = 7, height = 5, units = "in", res = 100)
plot(res$baseMean, res$lfc, log = "x"); abline(h = 0)
invisible(dev.off())
save_ma <- function(f) { pdf(f, width = 6, height = 4); plot(res$baseMean, res$lfc, log = "x"); invisible(dev.off()) }
save_ma("results/ma.pdf")
png(tempfile(fileext = ".png")); plot(1:3); invisible(dev.off())`);
    assert.equal(ma.plots.length, 0, 'drawing to files draws nothing in the cell');
    assert.deepEqual(ma.cell.saved.map(s => [s.path, s.figure?.describer, s.figure?.marks, s.figure?.bound]), [['results/ma.png', 'graphics', 301, 301], ['results/ma.pdf', 'graphics', 300, 300]]);
    assert.equal(ma.cell.saved[0].sha256, await sha('results/ma.png'));
    const read = await figures.read({ path: 'results/ma.png', form: 'view' });
    assert.deepEqual([read.figure.cellId, read.record.size.width, read.record.size.height], [ma.cell.cellId, 7, 5]);
    assert.deepEqual([read.record.figure.layers[0].source, read.record.figure.layers[0].mapping], ['res', { x: 'baseMean', y: 'lfc' }]);
    assert.equal((await figures.read({ path: 'results/ma.png', marks: ['0.0'] })).rows[0].key.value, 'G001');

    // A name numbered with %d holds each page; a PDF of several pages says why it is not described.
    const pages = await run(`png("results/page%02d.png"); plot(1:3); plot(res$baseMean, res$lfc); invisible(dev.off())
pdf("results/two.pdf"); plot(1:3); plot(4:6); invisible(dev.off())`);
    assert.deepEqual(pages.cell.saved.map(s => [s.path, s.figure?.marks ?? s.figureProblem]),
      [['results/page01.png', 3], ['results/page02.png', 300], ['results/two.pdf', 'The file holds 2 pages; only a file of one page is described.']]);

    // A ggplot printed to a file is described from its object; a lattice page no describer knows stays a picture.
    const gg = await run(`library(ggplot2); p <- ggplot(res, aes(baseMean, lfc)) + geom_point()
png("results/gg.png", 600, 400); print(p); invisible(dev.off())
png("results/lattice.png"); print(lattice::xyplot(lfc ~ baseMean, res)); invisible(dev.off())`);
    assert.deepEqual(gg.cell.saved.map(s => [s.path, s.figure.describer, s.figure.bound]), [['results/gg.png', 'ggplot', 300]]);

    // A device left open keeps drawing in the next cell, as in the R console; its file is described when it closes.
    assert.equal((await run(`svg("results/later.svg", 5, 4)`)).cell.saved, undefined);
    assert.equal((await run(`plot(res$baseMean, res$lfc, log = "x")`)).plots.length, 0, 'the open file is still where the session draws');
    const closing = await run(`invisible(dev.off())`);
    assert.deepEqual(closing.cell.saved.map(s => [s.path, s.figure.marks]), [['results/later.svg', 300]]);
    assert.equal((await run(`plot(1:5)`)).plots.length, 1, 'once it is closed, plots are shown in the cell again');

    if (complexHeatmap) {
      const heat = await run(`suppressPackageStartupMessages(library(ComplexHeatmap)); set.seed(1)
mat <- matrix(rnorm(48), 12, dimnames = list(paste0("g", 1:12), paste0("s", 1:4)))
png("results/heat.png", 6, 5, units = "in", res = 100); draw(Heatmap(mat, name = "z")); invisible(dev.off())`);
      assert.deepEqual(heat.cell.saved.map(s => [s.path, s.figure.describer, s.figure.marks, s.figure.bound]), [['results/heat.png', 'ComplexHeatmap', 48, 48]]);
      assert.equal((await figures.read({ path: 'results/heat.png', form: 'view' })).record.figure.layers[0].source, 'mat');
    }
    const names = (await host.read()).sessions.at(-1).variables.map(v => v.name).sort();
    assert.deepEqual(names, [...(complexHeatmap ? ['mat'] : []), 'p', 'res', 'save_ma'], 'noting the files adds no variables');
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

// Python sessions describe matplotlib figures with py/figures.py; seaborn is used where present.
const python = process.env.RHO_PYTHON ?? 'python3';
const pyProbe = spawnSync(python, ['-c', 'import importlib.util as u; print(*[u.find_spec(m) is not None for m in ("matplotlib", "numpy", "pandas", "seaborn")])'], { encoding: 'utf8' });
const pyHave = pyProbe.status === 0 ? pyProbe.stdout.trim().split(/\s+/).map(v => v === 'True') : [];
const pySkip = pyHave.slice(0, 3).every(Boolean) ? false : 'Python with matplotlib, numpy and pandas is not available';
const seaborn = pyHave[3] === true;
async function pySession() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'rho-figures-py-'));
  const host = new KernelHost(root, { python, extensions: { python: [pythonExtension] } });
  const figures = new Figures(root, { record: (cellId, plot) => host.figureRecord(cellId, plot), saved: sha256 => host.savedFigure(sha256) });
  let n = 0;
  const run = async (code, by = 'browser:local') => {
    const { cell } = await host.run({ language: 'python', code, changeId: 'p' + ++n, by, waitMs: 120000 });
    assert.equal(cell.state, 'done', cell.outputs.map(o => o.text ?? '').join(''));
    return { cell, plots: cell.outputs.filter(o => o.kind === 'plot') };
  };
  return { root, host, figures, run };
}
const pyTable = `import numpy as np, pandas as pd, matplotlib.pyplot as plt
rng = np.random.default_rng(1); n = 400
res = pd.DataFrame({'baseMean': 10 ** rng.uniform(0, 4, n), 'log2FoldChange': rng.normal(0, 2, n), 'padj': 10 ** -rng.uniform(0, 12, n)}, index=pd.Index([f'G{i:03d}' for i in range(1, n + 1)], name='gene'))
res.loc['G005', 'padj'] = np.nan`;

test('a matplotlib figure is described: points drawn at -log10 of a column are bound to its rows, and labels by their text', { skip: pySkip, timeout: 180000 }, async () => {
  const { host, figures, run } = await pySession();
  try {
    await run(pyTable);
    const { cell, plots } = await run(`fig, ax = plt.subplots()
ax.scatter(res.log2FoldChange, -np.log10(res.padj), s=4, c=np.where(res.padj < 0.01, 'tab:red', 'grey'))
for g, r in res.nsmallest(3, 'padj').iterrows(): ax.annotate(g, (r.log2FoldChange, -np.log10(r.padj)), xytext=(4, 4), textcoords='offset points')
ax.axhline(2, ls='--', color='black'); ax.set_title('Volcano'); ax.set_xlabel('log2 fold change')
ax.text(0.02, 0.97, 'FDR 0.01', transform=ax.transAxes)
fig.tight_layout()`);
    assert.equal(plots.length, 1);
    const summary = plots[0].figure;
    assert.ok(summary, plots[0].figureProblem ?? 'the plot output names its figure');
    assert.deepEqual([summary.describer, summary.geoms, summary.marks, summary.bound], ['matplotlib', ['points', 'abline', 'text', 'text'], 404, 404]);
    assert.equal(cell.outputs.filter(o => o.kind === 'stdout' || o.kind === 'stderr').length, 0, 'describing prints nothing');
    const fig = await record(host, cell.cellId);
    const [points, line, labels, note] = fig.figure.layers;
    assert.deepEqual([points.marks, points.source, points.mapping, points.bound], [399, 'res', { x: 'log2FoldChange', y: '-log10(padj)' }, 'mark']);
    assert.equal(markRow(fig, { layer: 0, mark: 4 }).key.value, 'G006', 'the row whose padj is missing was not drawn and is skipped');
    assert.deepEqual(markRow(fig, { layer: 0, mark: 4 }).key.column, 'gene', 'a DataFrame is keyed by its named index');
    assert.equal(line.geom, 'abline');
    assert.equal(markRow(fig, { layer: 1, mark: 0 }).built.yintercept, 2);
    // Labels drawn at their points, in another order than the table's, name those points' rows; a
    // note placed in the axes' corner has no position in the data.
    assert.deepEqual([labels.source, labels.mapping], ['res', { x: 'log2FoldChange', y: '-log10(padj)' }]);
    for (let m = 0; m < 3; m++) assert.equal(markRow(fig, { layer: 2, mark: m }).key.value, markRow(fig, { layer: 2, mark: m }).built.label);
    assert.deepEqual([note.source, markRow(fig, { layer: 3, mark: 0 }).built], [null, { label: 'FDR 0.01' }]);
    assert.deepEqual([fig.figure.plots[0].title, fig.figure.plots[0].labels.x], ['Volcano', 'log2 fold change']);

    const covered = new Set([...fig.svg.matchAll(/data-rho="(\d+\.\d+)"/g)].flatMap(m => elementMarks(fig, m[1])).map(m => `${m.layer}.${m.mark}`));
    assert.equal(covered.size, 404, 'every point, the line and the labels are drawn by elements that name them');
    assert.match(fig.svg, /^(<\?xml[^>]*>\s*)?<svg[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.doesNotMatch(fig.svg, /<style|<script/i, 'no style sheet reaches the page the figure is shown in');

    const strong = await figures.read({ cellId: cell.cellId, plot: 1, where: [{ layer: 0, column: 'padj', op: 'lt', value: 1e-11 }], limit: 500 });
    assert.ok(strong.matched.total > 0);
    for (const row of strong.rows) assert.ok(row.values.padj < 1e-11);
    const { selection } = await figures.select({ cellId: cell.cellId, plot: 1, marks: strong.matched.marks.slice(0, 3), note: 'Strongest', changeId: 'py-pick' }, 'agent:a');
    assert.equal(selection.count, 3);

    // A position on a log axis is read in the data's units; markers of a line are its points.
    const ma = await run(`fig, ax = plt.subplots(); ax.plot(res.baseMean, res.log2FoldChange, 'o', ms=2); ax.set_xscale('log')`);
    const maFig = await record(host, ma.cell.cellId);
    assert.deepEqual([maFig.figure.layers[0].geom, maFig.figure.layers[0].mapping, maFig.figure.layers[0].marks], ['points', { x: 'baseMean', y: 'log2FoldChange' }, 400]);
    assert.equal(maFig.figure.plots[0].positions.x.transform, 'log-10');
    const first = markRow(maFig, { layer: 0, mark: 0 });
    assert.ok(Math.abs(first.built.x - first.values.baseMean) <= 1e-9 * first.built.x);

    // Rasterized points are drawn as points for the figure, and left rasterized. Genes not tested
    // are drawn at 0 and bound by their fold change. A count of 0 is not "near" every value through
    // -log10(0) = inf, and a table with fewer rows than the marks (samples × genes) is not compared.
    const tested = await run(`res2 = res.copy(); res2.iloc[::20, res2.columns.get_loc('padj')] = np.nan
counts = pd.DataFrame(rng.integers(0, 3, size=(n, 4)), index=res.index, columns=list('abcd'))
wide = pd.DataFrame(rng.normal(size=(8, 5000)))
ok = res2.padj.notna()
fig, ax = plt.subplots()
ax.scatter(res2.log2FoldChange[ok], -np.log10(res2.padj[ok]), s=3, rasterized=True)
ax.scatter(res2.log2FoldChange[~ok], np.zeros((~ok).sum()), s=3, rasterized=True)
fig.savefig('tested.png')
print(ax.collections[0].get_rasterized(), ax.collections[0].get_gid())`);
    assert.equal(tested.cell.outputs.filter(o => o.kind === 'stdout').map(o => o.text).join(''), 'True None\n', 'the figure is left as the code made it');
    const tfig = await record(host, tested.cell.cellId);
    assert.deepEqual(tfig.figure.layers.map(l => [l.marks, l.bound, l.source, l.mapping, l.notes ?? null]), [
      [379, 'mark', 'res2', { x: 'log2FoldChange', y: '-log10(padj)' }, null],
      [21, 'mark', 'res2', { x: 'log2FoldChange' }, ['All 21 marks are drawn at y = 0.']]], 'every 20th gene and G005 were not tested');
    assert.ok(tfig.seconds < 5, `describing took ${tfig.seconds} s`);
  } finally { await host.close(); }
});

test('seaborn heatmaps and bars are figures: a cell names its row, column and value, also when clustered; a bar its category', { skip: pySkip || (!seaborn && 'seaborn is not available'), timeout: 180000 }, async () => {
  const { host, run } = await pySession();
  try {
    const heat = await run(`import numpy as np, pandas as pd, matplotlib.pyplot as plt, seaborn as sns
mat = pd.DataFrame(np.random.default_rng(2).normal(size=(12, 4)), index=[f'g{i}' for i in range(1, 13)], columns=['s1', 's2', 's3', 's4'])
sns.heatmap(mat, cmap='vlag', cbar_kws={'label': 'z-score'})`);
    assert.ok(heat.plots[0].figure, heat.plots[0].figureProblem);
    const fig = await record(host, heat.cell.cellId);
    assert.deepEqual([fig.figure.layers[0].geom, fig.figure.layers[0].source, fig.figure.layers[0].marks], ['heatmap', 'mat', 48]);
    for (let m = 0; m < 48; m++) {
      const row = markRow(fig, { layer: 0, mark: m });
      assert.equal(row.key.value, row.built.row);
      assert.ok(Math.abs(row.values[row.built.column] - row.built.value) <= 1e-6 * Math.max(1, Math.abs(row.built.value)), 'a cell\'s value is its row\'s value in its column');
    }
    assert.deepEqual(fig.figure.plots[0].scales.map(s => [s.aesthetic, s.title]), [['fill', 'z-score']]);

    // Row labels set in the table's order on a clustered heatmap name other rows than they sit beside.
    const wrong = await run(`g = sns.clustermap(mat); g.ax_heatmap.set_yticks(np.arange(12) + 0.5, mat.index, rotation=0)`);
    assert.match(wrong.plots[0].figure.notes?.[0] ?? '', /^\d+ of 12 rows are labelled with another row of mat: row \d+ is labelled g\d+ and draws the values of g\d+\.$/);
    // Labels set on the cells' edges, one for each row, are read in their order, and noted.
    const edges = await run(`plt.figure(); ax = sns.heatmap(mat.to_numpy()); ax.set_yticks(range(12), mat.index); ax.set_xticks(range(4), mat.columns)`);
    const efig = await record(host, edges.cell.cellId);
    assert.deepEqual([0, 5].map(m => markRow(efig, { layer: 0, mark: m }).built.row), ['g1', 'g2']);
    assert.deepEqual(efig.figure.layers[0].notes, ["Its row labels sit on the rows' edges, not their middles; label k is read as naming row k.", "Its column labels sit on the columns' edges, not their middles; label k is read as naming column k."]);
    const clustered = await run(`g = sns.clustermap(mat)`);
    assert.equal(clustered.plots[0].figure.notes, undefined, 'labels seaborn placed name their rows');
    const cfig = await record(host, clustered.cell.cellId);
    const layer = cfig.figure.layers.findIndex(l => l.geom === 'heatmap');
    assert.equal(cfig.figure.layers[layer].source, 'mat', 'a clustered heatmap is matched to its table with rows and columns reordered');
    for (let m = 0; m < 48; m++) {
      const row = markRow(cfig, { layer, mark: m });
      assert.ok(Math.abs(row.values[row.built.column] - row.built.value) <= 1e-6 * Math.max(1, Math.abs(row.built.value)));
    }

    const bars = await run(`tips = pd.DataFrame({'day': ['Thu', 'Fri', 'Sat', 'Sun'] * 5, 'total': np.arange(20.)}); plt.figure(); sns.barplot(tips, x='day', y='total', errorbar=None)`);
    const bfig = await record(host, bars.cell.cellId);
    const rect = bfig.figure.layers.findIndex(l => l.geom === 'rect');
    assert.deepEqual([0, 1, 2, 3].map(m => markRow(bfig, { layer: rect, mark: m }).built.label), ['Thu', 'Fri', 'Sat', 'Sun']);
    assert.deepEqual([0, 3].map(m => markRow(bfig, { layer: rect, mark: m }).built.ymax), [8, 11]);
    assert.deepEqual(bfig.figure.plots[0].positions.x, { discrete: true, levels: ['Thu', 'Fri', 'Sat', 'Sun'] });
  } finally { await host.close(); }
});

test('a matplotlib figure saved with savefig is a figure of the file while the file keeps the bytes the cell saved', { skip: pySkip, timeout: 180000 }, async () => {
  const { root, host, figures, run } = await pySession();
  const sha = async relative => createHash('sha256').update(await fs.readFile(path.join(root, relative))).digest('hex');
  try {
    await run(pyTable);
    const saving = await run(`import os, tempfile; os.makedirs('results', exist_ok=True)
fig, ax = plt.subplots(figsize=(6, 4)); ax.scatter(res.log2FoldChange, -np.log10(res.padj), s=3)
fig.savefig('results/volcano.png', dpi=100, bbox_inches='tight')
fig.savefig(os.path.join(tempfile.mkdtemp(), 'outside.png'))
plt.savefig('results/again')
plt.close(fig)`);
    assert.equal(saving.plots.length, 0, 'a closed figure draws nothing in the cell');
    assert.deepEqual(saving.cell.saved?.map(s => s.path), ['results/volcano.png', 'results/again.png'], 'a file outside the project is not kept; a name without an extension is saved with one');
    const [saved] = saving.cell.saved;
    assert.equal(saved.sha256, await sha('results/volcano.png'));
    assert.ok(saved.figure, saved.figureProblem);
    assert.equal(saved.figure.marks, 399);
    const read = await figures.read({ path: 'results/volcano.png', form: 'view' });
    assert.deepEqual([read.figure.cellId, read.record.size.width, read.record.size.height], [saving.cell.cellId, 6, 4]);
    assert.equal((await figures.read({ path: 'results/volcano.png', marks: ['0.0'] })).rows[0].key.value, 'G001');
    const vars = (await host.read()).sessions.at(-1).variables.map(v => v.name);
    assert.ok(!vars.some(v => /rho|describ/i.test(v)), 'describing the saved figure adds no variables');

    // Written again by something else, the file is a picture; the bytes the cell saved still name it.
    await run(`open('results/volcano.png', 'wb').write(b'not a figure')`);
    await assert.rejects(figures.read({ path: 'results/volcano.png' }), /No Notebook cell saved a figure as this file/);
    assert.equal((await figures.read({ sha256: saved.sha256 })).figure.path, 'results/volcano.png');
  } finally { await host.close(); }
});

test('the plugin declares its operations and a skill that names them', () => {
  assert.equal(plugin.id, 'figures');
  assert.deepEqual(plugin.requires, ['kernel']);
  assert.deepEqual(plugin.operations.map(o => o.method).sort(), ['figure.read', 'figure.select']);
  assert.deepEqual(plugin.skills[0].requires, ['figure.read', 'figure.select']);
  assert.equal(plugin.skills[0].verify.command, 'npm run test:figures');
});
