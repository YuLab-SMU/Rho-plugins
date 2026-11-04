import assert from 'node:assert/strict';
import test from 'node:test';
import { graphMarks, graphNodeAt, graphPath, graphRows, scriptFlow, scriptGraph, sessionGraph } from '@rho-workspace/plugin-kernel/code';

// Each node as what it comes from, and the functions, constants and helpers it uses.
const shape = graph => [...graph.nodes.values()].map(n => `${n.id} <= ${n.parents.join(' ')}${n.uses.length ? ' | ' + n.uses.join(',') : ''}`);
const lines = made => made.map(m => `${m.cell ? m.cell.number + ':' : ''}${m.from}-${m.to}`);

const r = `library(dplyr)
d <- read.csv("data/plates.csv")
cols <- c(WT = "#333", mut = "#c00")
contrast <- function(df, var) mean(df[[var]])
keep <- d$area > 0
d <- d[keep, ]
area <- contrast(d, "area")
out <- file.path("results", "area.csv")
write.csv(data.frame(area), out)
p <- ggplot(d, aes(genotype, area)) + scale_colour_manual(values = cols)
ggsave("results/area.png", p)
fit <- lm(area ~ genotype, data = d)
u <- read.csv("https://example.org/x.csv")
`;

test('a script: from the file it reads to the files it writes, one node per value', () => {
  const graph = scriptGraph(scriptFlow(r, 'r'), 'r');
  assert.deepEqual(shape(graph), [
    // The row mask is made from d and used only to change it, so it is part of d.
    'v:d <= in:data/plates.csv | keep',
    'in:data/plates.csv <= ',
    // A function, and a constant of literals, are named on what uses them; so is a path kept as a value.
    'v:area <= v:d | contrast',
    'out:results/area.csv <= v:area | out',
    'v:p <= v:d | cols',
    'out:results/area.png <= v:p',
    'v:fit <= v:d',
    // A read from a URL is made from nothing that can be seen, but it is data, not a constant.
    'v:u <= ',
  ]);
  assert.deepEqual(graph.results, ['out:results/area.csv', 'out:results/area.png']);
  assert.deepEqual(graph.others, ['v:fit', 'v:u']);
  assert.deepEqual([...graph.folded.keys()], ['cols', 'contrast', 'out', 'keep']);
  // A value made and changed is made where it was first made and changed where the rest were; a
  // value made beside others in one step is made at its own statement.
  assert.deepEqual(lines(graph.nodes.get('v:d').made), ['2-2', '6-6']);
  assert.equal(graph.nodes.get('v:d').how, 'read.csv("data/plates.csv")');
  assert.equal(graph.nodes.get('v:area').how, 'contrast(d, "area")');
  // Rows from the data down; what leads to no result still has a place.
  assert.deepEqual(graphRows(graph, new Set(graph.nodes.keys())), [['in:data/plates.csv', 'v:u'], ['v:d'], ['v:area', 'v:p', 'v:fit'], ['out:results/area.csv', 'out:results/area.png']]);
});

test('a value\'s path: what it comes from, what comes of it, and the lines behind and in front of it', () => {
  const graph = scriptGraph(scriptFlow(r, 'r'), 'r');
  const { up, down } = graphPath(graph, 'v:area');
  assert.deepEqual([...up].sort(), ['in:data/plates.csv', 'v:area', 'v:d']);
  assert.deepEqual([...down].sort(), ['out:results/area.csv', 'v:area']);
  // The function it uses and the mask d was cut with are lines it comes from.
  assert.deepEqual(graphMarks(graph, 'v:area').map(m => `${m.kind} ${m.from}-${m.to}`), ['here 7-7', 'from 4-4', 'from 2-2', 'from 6-6', 'from 5-5', 'into 9-9']);
  assert.equal(graphNodeAt(graph, 6)?.id, 'v:d');
  assert.equal(graphNodeAt(graph, 7)?.id, 'v:area');
  assert.equal(graphNodeAt(graph, 1), null, 'a library call makes nothing');
});

test('a Python script: a function defined with def is named on what uses it', () => {
  const graph = scriptGraph(scriptFlow(`import pandas as pd
OUT = "results/fit.csv"
aq = pd.read_csv("data/air.csv")
def fit(df, x):
    return df[x].corr(df["Ozone"])
fits = {c: fit(aq, c) for c in ["Temp", "Wind"]}
table = pd.DataFrame(fits, index=[0])
table.to_csv(OUT)
`, 'python'), 'python');
  assert.deepEqual(shape(graph), ['v:aq <= in:data/air.csv', 'in:data/air.csv <= ', 'v:fits <= v:aq | fit', 'v:table <= v:fits', 'out:results/fit.csv <= v:table | OUT']);
  assert.deepEqual(graph.results, ['out:results/fit.csv']);
});

const cell = (number, code, record = {}) => ({ cellId: 'c' + number, number, state: 'ok', code, purpose: null, plots: 0, defined: [], removed: [], used: [], files: [], language: 'r', ...record });

test('a session: what each cell made, from what it read as it is now; the newest results first', () => {
  const graph = sessionGraph([
    cell(1, 'res <- readRDS("res.rds")', { defined: ['res'], files: [{ path: 'res.rds', how: 'read' }] }),
    cell(2, 'ann <- read.csv("ann.csv")', { defined: ['ann'], files: [{ path: 'ann.csv', how: 'read' }] }),
    cell(3, 'df <- as.data.frame(res)', { defined: ['df'], used: ['res'] }),
    cell(4, 'm <- merge(df, ann)', { defined: ['m'], used: ['df', 'ann'] }),
    cell(5, 'm$lfc2 <- m$log2FoldChange * 2', { defined: ['m'], used: ['m'] }),
    cell(6, 'plot(m$lfc2)', { used: ['m'], plots: 1 }),
    cell(7, 'write.csv(m, "out/m.csv")', { used: ['m'], files: [{ path: 'out/m.csv', how: 'wrote' }] }),
    cell(9, 'ann <- ann[1:10, ]', { defined: ['ann'], used: ['ann'] }),
  ], ['res', 'ann', 'df', 'm'].map(name => ({ name })), 'r');
  assert.deepEqual(shape(graph), [
    'v:res <= in:res.rds', 'in:res.rds <= ', 'v:ann <= in:ann.csv', 'in:ann.csv <= ', 'v:df <= v:res',
    // The merge read ann before it was cut down, so no line runs from ann as it is now.
    'v:m <= v:df', 'plot:c6 <= v:m', 'out:out/m.csv <= v:m',
  ]);
  const m = graph.nodes.get('v:m');
  assert.deepEqual(lines(m.made), ['4:1-1', '5:1-1']);
  assert.equal(m.how, 'merge(df, ann)');
  assert.deepEqual(m.stale, ['ann']);
  assert.deepEqual(graph.results, ['out:out/m.csv', 'plot:c6']);
  assert.deepEqual(graph.others, ['v:ann', 'in:ann.csv']);
});

test('a cell that makes its values over several statements is read statement by statement', () => {
  const graph = sessionGraph([
    cell(1, 'd <- read.csv("d.csv")', { defined: ['d'], files: [{ path: 'd.csv', how: 'read' }] }),
    cell(2, 'cut <- 3\ntmp <- d[d$x > cut, ]\nfit <- lm(y ~ x, data = tmp)\nco <- coef(fit)\nrm(tmp)\nplot(fit)', { defined: ['cut', 'tmp', 'fit', 'co'], removed: ['tmp'], used: ['d'], plots: 1 }),
    cell(3, 'ratio <- exp(co)', { defined: ['ratio'], used: ['co'] }),
  ], ['d', 'cut', 'fit', 'co', 'ratio'].map(name => ({ name })), 'r');
  assert.deepEqual(shape(graph), [
    'v:d <= in:d.csv', 'in:d.csv <= ',
    // tmp is gone, so fit comes from what tmp came from; the cut-off is a constant fit uses.
    'v:co <= v:fit', 'v:fit <= v:d | cut',
    // The plot comes from what plot() read, not from rm(tmp).
    'plot:c2 <= v:fit', 'v:ratio <= v:co',
  ]);
  assert.deepEqual(lines(graph.nodes.get('v:fit').made), ['2:3-3']);
  assert.equal(graph.nodes.get('plot:c2').how, 'plot(fit)');
  // A value made from nothing that leads to one other is not a helper of it.
  assert.deepEqual(shape(sessionGraph([
    cell(1, 'fit <- lm(y ~ x, data = d)', { defined: ['fit'], used: [] }),
    cell(2, 'co <- coef(fit)', { defined: ['co'], used: ['fit'] }),
  ], [{ name: 'fit' }, { name: 'co' }], 'r')), ['v:fit <= ', 'v:co <= v:fit']);
});
