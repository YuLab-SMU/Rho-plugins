// A conversation's share of live sessions. Native clients can share one connection principal,
// so their retained cell receipts, when supplied, select exact cells instead of that principal.
export interface SessionScope {
  principal: string | null;
  since: number | null;
  at: number | null;
  cellIds?: readonly string[];
}
type ScopedCell = { cellId: string; sessionId: string; by: string; queuedAt: string };
export function scopedCells<T extends ScopedCell>(all: T[], scope?: SessionScope): T[] {
  if (!scope) return all;
  const exact = scope.cellIds === undefined ? null : new Set(scope.cellIds);
  const sessions = new Set(all.filter(c => scope.principal !== null && c.by === scope.principal).map(c => c.sessionId));
  return all.filter(c => ((exact ? exact.has(c.cellId) : sessions.has(c.sessionId))
    || (c.by === 'browser:local' && scope.since !== null && Date.parse(c.queuedAt) >= scope.since))
    && (scope.at === null || Date.parse(c.queuedAt) <= scope.at));
}
