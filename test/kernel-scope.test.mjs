import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopedCells } from '../plugins/kernel/dist/session-scope.js';

test('native conversation receipts select exact cells even when conversations share a grant and R session', () => {
  const cell = (cellId, second, by = 'shared-grant') => ({ cellId, by, sessionId: 'r-session', queuedAt: new Date(second * 1000).toISOString() });
  const all = [cell('older', 1), cell('mine', 3), cell('another-conversation', 4), cell('person-before', 1, 'browser:local'), cell('person-after', 5, 'browser:local')];
  const scope = { principal: 'shared-grant', cellIds: ['mine'], since: 2000, at: null };
  assert.deepEqual(scopedCells(all, scope).map(c => c.cellId), ['mine', 'person-after']);
  assert.deepEqual(scopedCells(all, { ...scope, at: 4000 }).map(c => c.cellId), ['mine']);
  assert.deepEqual(scopedCells(all, { ...scope, cellIds: [], at: 4000 }), [], 'missing receipts do not claim the grant\'s other cells');
  assert.equal(scopedCells(all), all, 'the project Notebook keeps its existing full-session view');
});
