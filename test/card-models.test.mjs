import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Documents } from '@rho-workspace/plugin-documents';
import { Files } from '@rho-workspace/plugin-files';
import { Tables, declarationValidator } from '@rho-workspace/plugin-tables';
import { placeAnchor, sections, paragraphs, where, hiddenNote, showOf, findGroup, marksBySection, limit, documentCardLimits, quote, focusOf } from '../plugins/documents/dist/ui-card-model.js';
import * as tableCard from '../plugins/tables/dist/ui-card-model.js';

const report = '前言一句。\n\n# 方法\n阈值是 p < 0.05。\n\n# 结论\n收缩估计后，应答者的上调基因全部成立。\n\n第二段。\n';

async function opened(text) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'rho-card-'));
  await fs.writeFile(path.join(root, 'report.md'), text);
  const docs = new Documents(root), doc = await docs.open('report.md', 'agent:a');
  return { docs, doc };
}

test('document sections and paragraphs follow headings and blank lines, keeping Unicode', () => {
  const list = sections(report);
  assert.deepEqual(list.map(s => s.title), ['', '方法', '结论']);
  const conclusion = list[2];
  const ps = paragraphs(report, conclusion);
  assert.deepEqual(ps.map(p => report.slice(p.from, p.to)), ['收缩估计后，应答者的上调基因全部成立。', '第二段。']);
  const at = report.indexOf('全部');
  assert.equal(where(report, at).paragraph, 0);
  assert.equal(where(report, report.indexOf('第二段')).paragraph, 1);
  assert.equal(quote('收缩估计后，应答者的上调基因全部成立。'), '收缩估计后，应答者的上调基因…');
});

test('an anchor follows edits before it, marks partial edits and names who rewrote it', async () => {
  const { docs, doc } = await opened(report);
  const from = report.indexOf('全部成立'), anchor = { from, to: from + 4, version: doc.version };
  // An edit before the anchor shifts it.
  let now = await docs.edit(doc.id, doc.version, [{ from: 0, to: 0, insert: '注：' }], 'g1', 'user:me');
  let placed = placeAnchor(now, anchor);
  assert.equal(placed.status, 'current');
  assert.equal(now.content.slice(placed.from, placed.to), '全部成立');
  // A partial edit inside it keeps the place and says it changed.
  const inside = now.content.indexOf('成立');
  now = await docs.edit(doc.id, now.version, [{ from: inside, to: inside + 2, insert: '成立了' }], 'g2', 'agent:a');
  placed = placeAnchor(now, anchor);
  assert.equal(placed.status, 'edited'); assert.equal(placed.by, 'agent:a');
  assert.equal(now.content.slice(placed.from, placed.to), '全部成立了');
  // Replacing the whole anchored text points at the replacement and keeps the original.
  const whole = now.content.indexOf('全部成立了');
  now = await docs.edit(doc.id, now.version, [{ from: whole - 2, to: whole + 5, insert: '大多仍成立' }], 'g3', 'agent:a');
  placed = placeAnchor(now, anchor);
  assert.equal(placed.status, 'rewritten'); assert.equal(placed.by, 'agent:a');
  assert.equal(now.content.slice(placed.from, placed.to), '大多仍成立');
  assert.equal(placed.before, '全部成立了');
  // A version beyond the buffer, or a gap in retained history, is not guessed.
  assert.equal(placeAnchor(now, { ...anchor, version: now.version + 1 }).status, 'unknown');
  assert.equal(placeAnchor({ ...now, history: now.history.slice(1) }, anchor).status, 'unknown');
});

test('the card picks its show from what the Agent named, and changes are found by group or change', async () => {
  assert.equal(showOf({}), 'outline');
  assert.equal(showOf({ anchor: { from: 0, to: 1, version: 1 } }), 'passage');
  assert.equal(showOf({ group: 'g' }), 'change');
  assert.equal(showOf({ group: 'g', show: 'outline' }), 'outline');
  assert.equal(showOf({ show: 'bogus', group: 'g' }), 'change');
  const { docs, doc } = await opened(report);
  const at = report.indexOf('0.05');
  const now = await docs.edit(doc.id, doc.version, [{ from: at, to: at + 4, insert: '0.01' }], 'agent-group', 'agent:a', { changeId: 'agent-1', expectedRevision: doc.revision });
  assert.equal(findGroup(now, 'agent-1')?.author, 'agent:a');
  assert.equal(findGroup(now, now.history[0].groupId)?.changeIds[0], 'agent-1');
  assert.equal(findGroup(now, 'missing'), undefined);
  const marks = marksBySection(now, 'user:me');
  assert.deepEqual(marks.map(m => [m.section.title, m.agent, m.mine]), [['', 0, 0], ['方法', 1, 0], ['结论', 0, 0]]);
  // A named section is the focus when there is no anchor.
  assert.equal(focusOf(now, { section: '结论' }).at, now.content.indexOf('# 结论'));
});

test('document hidden notes count from the whole document and caps are form parameters', () => {
  assert.equal(hiddenNote('card', 'passage', { paragraphsInSection: 2, shownParagraphs: 1, sections: 3 }), 'Not shown: 1 more paragraph in this section · 2 other sections');
  assert.equal(hiddenNote('summary', '', { paragraphsInSection: 2, shownParagraphs: 2, sections: 1, olderChanges: 4 }), 'Not shown: 4 earlier changes');
  assert.equal(hiddenNote('card', 'outline', { sections: 10, shownSections: 8 }), 'Not shown: all text · 2 more sections');
  assert.equal(hiddenNote('card', 'change', { sections: 3 }), 'Not shown: the text around this change');
  assert.equal(hiddenNote('summary', '', { paragraphsInSection: 1, shownParagraphs: 1, sections: 1 }), '');
  assert.equal(limit({ changes: 5 }, 'changes', documentCardLimits.summaryChanges, documentCardLimits.maxChanges), 5);
  assert.equal(limit({ changes: 50 }, 'changes', 3, documentCardLimits.maxChanges), documentCardLimits.maxChanges);
  assert.equal(limit({ changes: -1 }, 'changes', 3, 10), 3);
});

test('table subsets read by key one page each, by filter in one page, and never by row position', () => {
  const keys = tableCard.subsetRequests({ keys: ['FOXP3', 'LAG3'] }, 'gene', 12);
  assert.deepEqual(keys.requests, [{ offset: 0, limit: 1, filter: { column: 'gene', op: 'eq', value: 'FOXP3' } }, { offset: 0, limit: 1, filter: { column: 'gene', op: 'eq', value: 'LAG3' } }]);
  assert.equal(tableCard.subsetRequests({ keys: ['a'] }, null, 3).unreadable, true);
  assert.equal(tableCard.subsetRequests({ keys: Array.from({ length: 80 }, (_, i) => 'k' + i) }, 'gene', 50).requests.length, 50);
  const filtered = tableCard.subsetRequests({ filter: { column: 'p_adj', op: 'lt', value: 0.05 }, sort: { column: 'log2fc', direction: 'desc' } }, 'gene', 3);
  assert.deepEqual(filtered.requests, [{ offset: 0, limit: 3, filter: { column: 'p_adj', op: 'lt', value: 0.05 }, sort: { column: 'log2fc', direction: 'desc' } }]);
  assert.equal(tableCard.readSubset({ keys: [] }), null);
  assert.equal(tableCard.readSubset({ filter: { column: 'x', op: 'drop' } }), null);
  const { subset, picked, list } = tableCard.subsetsOf({ subsets: [{ keys: ['A'], label: 'Top 4' }, { filter: { column: 'x', op: 'isNull' } }], picked: 1 });
  assert.equal(list.length, 2); assert.equal(picked, 1); assert.deepEqual(subset, { filter: { column: 'x', op: 'isNull' } });
  assert.equal(tableCard.describeSubset(subset), 'x is empty');
  assert.equal(tableCard.describeSubset(list[0]), 'Top 4');
  assert.equal(tableCard.showOf({}, false), 'rows');
  assert.equal(tableCard.showOf({}, true), 'count');
  assert.equal(tableCard.showOf({ show: 'cell' }, true), 'cell');
});

test('table columns pin the key, then highlighted and new columns; values keep NA as empty', () => {
  const columns = [{ name: 'gene', type: 'string' }, { name: 'log2fc', type: 'number' }, { name: 'p_adj', type: 'number' }, { name: 'shrunk', type: 'number' }];
  assert.deepEqual(tableCard.columnsFor(columns, 'gene', ['shrunk'], 3).map(c => c.name), ['gene', 'shrunk', 'log2fc']);
  assert.deepEqual(tableCard.newColumns(columns, columns.slice(0, 3)), ['shrunk']);
  assert.deepEqual(tableCard.newColumns(columns, null), []);
  assert.equal(tableCard.formatValue(null), 'empty');
  assert.equal(tableCard.formatValue(0.0871), '0.0871');
  assert.equal(tableCard.formatValue(5.1e-11), '5.1e-11');
  assert.equal(tableCard.formatValue(2627), '2,627');
  assert.equal(tableCard.hiddenNote('card', 'rows', { total: 2627, inSubset: 3, shownRows: 3, columns: 8, shownColumns: 3 }), 'Not shown: 2,624 rows outside this subset · 5 more columns');
  assert.equal(tableCard.hiddenNote('summary', '', { total: 40, shownRows: 12, columns: 4, shownColumns: 4 }), 'Not shown: 28 more rows');
  assert.equal(tableCard.hiddenNote('card', 'count', { total: 1, columns: 1 }), 'Not shown: all rows');
});

test('a recorded comparison carries its counts and inputs, so the card never runs compare', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'rho-card-table-'));
  const files = new Files(root, 'test', {}, [declarationValidator]), tables = new Tables(files);
  const declaration = file => ({ path: file, kind: 'table', format: { encoding: 'csv', columns: [{ name: 'gene', type: 'string', nullValues: [] }, { name: 'p_adj', type: 'number', nullValues: ['NA'] }], key: { column: 'gene', namespace: 'genes' } } });
  await fs.writeFile(path.join(root, 'before.csv'), 'gene,p_adj\nFOXP3,0.087\nLAG3,0.01\nCD8A,NA\n');
  await fs.writeFile(path.join(root, 'after.csv'), 'gene,p_adj\nLAG3,0.01\n');
  const before = await files.register('before.csv', { operationId: 'before' }, 'available', {}, declaration('before.csv'));
  const after = await files.register('after.csv', { operationId: 'after' }, 'available', {}, declaration('after.csv'));
  const ref = r => ({ id: r.id, version: r.version });
  const c = await tables.compare(ref(before), ref(after), { leftKey: 'gene', rightKey: 'gene', leftNamespace: 'genes', rightNamespace: 'genes', mapping: 'equal-string', leftField: 'p_adj', rightField: 'p_adj', join: 'left' });
  const page = await tables.page(ref(c), 0, 1);
  const counts = tableCard.comparisonCounts(page.resource);
  assert.deepEqual({ total: counts.total, missingX: counts.missingX, missingY: counts.missingY }, { total: 3, missingX: 1, missingY: 2 });
  assert.deepEqual(counts.left, ref(before)); assert.deepEqual(counts.right, ref(after));
  assert.equal(counts.leftField, 'p_adj'); assert.equal(counts.join, 'left');
  const without = await tables.page(ref(c), 0, 3, undefined, { column: 'y', op: 'isNull' });
  assert.deepEqual(without.rows.map(r => r.key), ['FOXP3', 'CD8A']);
  assert.equal(tableCard.comparisonCounts({ coverage: {} }), null);
  assert.equal(tableCard.hiddenNote('compare', '', { total: 0, columns: 0, compared: { total: 3, listed: 2 } }), 'Not shown: 1 other compared row');
});
