import assert from 'node:assert/strict';
import test from 'node:test';
import { scriptFlow, scriptGraph, sessionGraph } from '@rho-workspace/plugin-kernel/code';

const cell = (number, code, record = {}) => ({ cellId: 'c' + number, number, state: 'ok', code, purpose: null, plots: 0, defined: [], removed: [], used: [], files: [], language: 'r', ...record });

test('a comment above the statement that makes a value or names a file is its meaning', () => {
  const r = [
    '# means: One measurement per dish',
    '# means data/d.csv: Dish measurements (CSV)',
    'd <- read.csv("data/d.csv")',
    '# A plain comment says nothing about the value.',
    'e <- d',
    '# means: Not attached: a blank line separates it from its statement',
    '',
    'f <- d',
    'x <- d  # means: Not attached: it is not on a line of its own',
    '# means: Attached to the write, which names the file and makes no value',
    'write.csv(d, "out/d.csv")',
  ].join('\n');
  assert.deepEqual([...scriptFlow(r, 'r').means], [
    ['value:d', 'One measurement per dish'],
    ['file:data/d.csv', 'Dish measurements (CSV)'],
    ['file:out/d.csv', 'Attached to the write, which names the file and makes no value'],
  ]);
});

test('the first statement that makes a value decides its meaning; Python defs, assignments and files are read the same way', () => {
  const p = [
    '# means: Plate measurements',
    '# means data/plates.csv: Plate reader export (CSV)',
    'plates = pd.read_csv("data/plates.csv")',
    '# means: Plates cut to the live wells',
    'plates = plates[plates.alive]',
    '',
    '# means: Mean of each well, by plate',
    'def well_mean(df):',
    '    return df.groupby("well").mean()',
    '',
    '# means: Summary per well',
    'summary = well_mean(plates)',
  ].join('\n');
  assert.deepEqual([...scriptFlow(p, 'python').means], [
    ['value:plates', 'Plate measurements'],
    ['file:data/plates.csv', 'Plate reader export (CSV)'],
    ['value:well_mean', 'Mean of each well, by plate'],
    ['value:summary', 'Summary per well'],
  ]);
});

test('a named marker gives one value of a statement that makes several its own meaning', () => {
  const r = [
    '# means v: The measure being checked',
    '# means ps: Holm-adjusted p-values',
    'for (v in c("area", "circularity")) {',
    '  ps <- p.adjust(c(0.01, 0.2), method = "holm")',
    '}',
  ].join('\n');
  const means = scriptFlow(r, 'r').means;
  assert.equal(means.get('value:v'), 'The measure being checked');
  assert.equal(means.get('value:ps'), 'Holm-adjusted p-values');
});

test('a meaning is kept to 200 characters', () => {
  assert.equal(scriptFlow(`# means: ${'a'.repeat(300)}\nx <- 1`, 'r').means.get('value:x').length, 200);
});

test('a script graph shows what the code says about its values, its files and the helpers they use', () => {
  const r = [
    '# means: Dish measurements',
    '# means data/d.csv: Dish export (CSV)',
    'd <- read.csv("data/d.csv")',
    '# means: Mean signal of each strain',
    'contrast <- function(df, var) mean(df[[var]])',
    'area <- contrast(d, "area")',
    '# means: Written table of the strains',
    'write.csv(data.frame(area), "results/area.csv")',
    'fit <- lm(area ~ d)',
  ].join('\n');
  const graph = scriptGraph(scriptFlow(r, 'r'), 'r');
  assert.equal(graph.nodes.get('v:d').means, 'Dish measurements');
  assert.equal(graph.nodes.get('in:data/d.csv').means, 'Dish export (CSV)');
  assert.equal(graph.nodes.get('out:results/area.csv').means, 'Written table of the strains');
  // No comment, no meaning: the value keeps its name only.
  assert.equal(graph.nodes.get('v:area').means, undefined);
  assert.equal(graph.nodes.get('v:fit').means, undefined);
  assert.equal(graph.folded.get('contrast').means, 'Mean signal of each strain');
});

test('a session graph carries the meanings its cells give, and a plot takes the one on the statement that draws it', () => {
  const graph = sessionGraph([
    cell(1, '# means: Dish measurements\n# means data/d.csv: Dish export (CSV)\nd <- read.csv("data/d.csv")\nd <- d[d$ok, ]', { defined: ['d'], files: [{ path: 'data/d.csv', how: 'read' }] }),
    cell(2, '# means: Fit of strain on area\nfit <- lm(area ~ strain, data = d)\n# means: Residual check of the fit\nplot(fit)', { defined: ['fit'], used: ['d'], plots: 1 }),
  ], ['d', 'fit'].map(name => ({ name })), 'r');
  assert.equal(graph.nodes.get('v:d').means, 'Dish measurements');
  assert.equal(graph.nodes.get('in:data/d.csv').means, 'Dish export (CSV)');
  assert.equal(graph.nodes.get('v:fit').means, 'Fit of strain on area');
  assert.equal(graph.nodes.get('plot:c2').means, 'Residual check of the fit');
});
