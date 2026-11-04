import assert from 'node:assert/strict';
import test from 'node:test';
import { cellRelations, lineage } from '@rho-workspace/plugin-kernel/code';

const cell = (number, code, record = {}) => ({ cellId: 'c' + number, number, state: 'ok', code, purpose: null, plots: 0, defined: [], removed: [], used: [], files: [], ...record });
// A results object and an annotation table, merged, changed in place, drawn and written; then the
// annotation is cut down after the merge used it.
const cells = [
  cell(1, 'res <- readRDS("res.rds")', { defined: ['res'], files: [{ path: 'res.rds', how: 'read' }] }),
  cell(2, 'ann <- read.csv("ann.csv")', { defined: ['ann'], files: [{ path: 'ann.csv', how: 'read' }] }),
  cell(3, 'df <- as.data.frame(res)', { defined: ['df'], used: ['res'] }),
  cell(4, 'm <- merge(df, ann)', { defined: ['m'], used: ['df', 'ann'] }),
  cell(5, 'm$lfc2 <- m$log2FoldChange * 2', { defined: ['m'], used: ['m'] }),
  cell(6, 'plot(m$lfc2)', { used: ['m'], plots: 1 }),
  cell(7, 'write.csv(m, "out/m.csv")', { used: ['m'], files: [{ path: 'out/m.csv', how: 'wrote' }] }),
  cell(8, 'print(m)', { used: ['m'] }),
  cell(9, 'ann <- ann[1:10, ]', { defined: ['ann'], used: ['ann'] }),
];
const values = ['res', 'ann', 'df', 'm'];
const shape = graph => graph.steps.map(s => [s.id, s.layer, s.nodes.map(n => n.id).join(' ')]);

test('each cell that made something still there is a step, linked from what it read as it is now', () => {
  const graph = lineage(cells, values);
  assert.deepEqual(shape(graph), [
    ['cell:c1', 0, 'value:res'],
    ['cell:c9', 0, 'value:ann'],
    ['cell:c3', 1, 'value:df'],
    ['cell:c5', 2, 'value:m'],
    ['cell:c6', 3, 'plot:c6'],
    ['cell:c7', 3, 'wrote:out/m.csv'],
  ]);
  assert.deepEqual(graph.links.map(l => l.from + '>' + l.to).sort(), [
    'value:df>cell:c5', 'value:m>cell:c6', 'value:m>cell:c7', 'value:res>cell:c3',
  ]);
  // The files a cell read are named in its box; cutting the annotation continues reading it.
  assert.deepEqual(graph.steps.map(s => s.reads.join(' ')), ['res.rds', 'ann.csv', '', '', '', '']);
  const step = id => graph.steps.find(s => s.id === id);
  // Changing m in place continues the merge, and reads what it read; cutting ann continues reading it.
  assert.deepEqual(step('cell:c5').earlier.map(c => c.number), [4]);
  assert.deepEqual(step('cell:c9').earlier.map(c => c.number), [2]);
  // The merge read the annotation before it was cut.
  assert.deepEqual(step('cell:c5').stale, ['ann']);
  assert.equal(step('cell:c9').latest, true);
  assert.equal(graph.steps.filter(s => s.latest).length, 1);
  assert.equal(graph.layers, 4);
});

test('a file read before a cell wrote it again is named as read in an earlier version', () => {
  const graph = lineage([
    cell(1, 'd <- read.csv("d.csv")', { defined: ['d'], files: [{ path: 'd.csv', how: 'read' }] }),
    cell(2, 'write.csv(d[1:2, ], "d.csv")', { used: ['d'], files: [{ path: 'd.csv', how: 'wrote' }] }),
    cell(3, 'e <- read.csv("d.csv")', { defined: ['e'], files: [{ path: 'd.csv', how: 'read' }] }),
  ], ['d', 'e']);
  const step = id => graph.steps.find(s => s.id === id);
  assert.deepEqual(step('cell:c1').stale, ['d.csv']);
  assert.deepEqual(graph.links.map(l => l.from + '>' + l.to).sort(), ['value:d>cell:c2', 'wrote:d.csv>cell:c3']);
  assert.equal(step('cell:c3').layer, 2);
  assert.deepEqual(step('cell:c1').reads, [], 'the file it read is not there as it read it');
});

test('values made before the kept cells, cells recorded without reads and the limits are said', () => {
  const graph = lineage([
    cell(1, 'x <- 1', { defined: ['x'], used: undefined }),
    cell(2, 'y <- x + 1', { defined: ['y'], used: ['x'] }),
    cell(3, 'z <- y + old', { defined: ['z'], used: ['y', 'old'] }),
  ], ['old', 'x', 'y', 'z'], { values: 3, plots: 8, files: 24 });
  assert.deepEqual(shape(graph), [['cell:c1', 0, 'value:x'], ['cell:c2', 1, 'value:y'], ['cell:c3', 2, 'value:z']]);
  assert.equal(graph.omitted.values, 1);
  assert.equal(graph.steps[0].unknownInputs, true);
  assert.equal(graph.steps[1].unknownInputs, false);
  const all = lineage([cell(1, 'z <- old', { defined: ['z'], used: ['old'] })], ['old', 'z']);
  assert.deepEqual(shape(all), [['earlier', 0, 'value:old'], ['cell:c1', 1, 'value:z']]);
  // A cell still running has made nothing yet.
  assert.deepEqual(lineage([cell(1, 'q <- 1', { state: 'running', defined: ['q'] })], ['q']).steps.map(s => s.id), ['earlier']);
});

test('what a changed value came from goes with the value, to the cell that has it now', () => {
  const graph = lineage([
    cell(1, 'raw = load("alignments")', { defined: ['raw'], files: [{ path: 'alignments/', how: 'read' }] }),
    cell(2, 'lengths = table(raw)', { defined: ['lengths'], used: ['raw'] }),
    cell(3, 'own = load("clipkit")\nlengths["clipkit"] = 1', { defined: ['lengths', 'own'], used: ['lengths'], files: [{ path: 'clipkit/', how: 'read' }] }),
    cell(4, 'lengths["r"] = f(own)', { defined: ['lengths'], used: ['lengths', 'own'] }),
  ], ['raw', 'lengths', 'own']);
  const step = id => graph.steps.find(s => s.id === id);
  assert.deepEqual(step('cell:c3').nodes.map(n => n.id), ['value:own']);
  assert.deepEqual(step('cell:c3').earlier, [], 'the box no longer holds the value it changed');
  assert.deepEqual(step('cell:c3').reads, ['clipkit/']);
  assert.deepEqual(step('cell:c4').earlier.map(c => c.number), [2, 3]);
  assert.deepEqual(graph.links.map(l => l.from + '>' + l.to).sort(), ['value:own>cell:c4', 'value:raw>cell:c4']);
  assert.deepEqual(step('cell:c4').reads, ['clipkit/'], 'what the change in 3 read goes with lengths');
});

test('each cell reads the version a cell made, and each value lists the later cells that read it', () => {
  const r = cellRelations(cells);
  const reads = id => r.reads.get(id).map(x => x.name + '@' + (x.from?.number ?? '-'));
  assert.deepEqual(reads('c3'), ['res@1']);
  assert.deepEqual(reads('c4'), ['df@3', 'ann@2']);
  // m changed in place: c5 read the merge's m; later cells read c5's.
  assert.deepEqual(reads('c5'), ['m@4']);
  assert.deepEqual([...r.readers.get('c5').get('m')].map(c => c.number), [6, 7, 8]);
  assert.deepEqual(r.readers.get('c4').get('m').map(c => c.number), [5]);
  // Cutting ann down read the one c2 made; ann is now c9's.
  assert.deepEqual(r.readers.get('c2').get('ann').map(c => c.number), [4, 9]);
  assert.equal(r.maker.get('ann').number, 9);
  assert.equal(r.maker.get('m').number, 5);
});
