// Browser-only owner entry: typed values from loaded grid nodes, coverage from
// actual DOM cells. No inferred values from a row count or table shell.
export interface TableRenderObservation {
  evidence: 'dom-visible' | 'hidden' | 'unavailable' | 'unmounted'; coverage: any;
  time: { browserObservedAt: string; performanceNowMs: number; clockDomain: string };
}
export function canonicalDom(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalDom).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonicalDom(v)).join(',') + '}';
  return JSON.stringify(value);
}
export async function valuesDigest(value: any) {
  const bytes = new TextEncoder().encode(canonicalDom(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export async function observeTableDom(root: HTMLElement, resource: any, meta: any, grid: any, baseQuery: any, loadedPages: Map<number, number>): Promise<TableRenderObservation> {
  const time = { browserObservedAt: new Date().toISOString(), performanceNowMs: performance.now(), clockDomain: 'browser:' + performance.timeOrigin };
  const invisible = (evidence: 'hidden' | 'unavailable'): TableRenderObservation => ({ evidence, coverage: null, time });
  if (document.visibilityState !== 'visible' || !root.isConnected || !root.getClientRects().length) return invisible('hidden');
  if (!meta?.entityKey || !meta.namespace || !grid) return invisible('unavailable');
  const viewport = root.querySelector('.ag-grid-viewport');
  if (!viewport) return invisible('unavailable');
  const rect = viewport.getBoundingClientRect();
  const rowElements = [...root.querySelectorAll<HTMLElement>('.ag-row[row-index]')];
  const inViewport = (r: DOMRect) => r.width > 0 && r.height > 0 && r.left >= Math.max(0, rect.left) && r.right <= Math.min(innerWidth, rect.right) && r.top >= Math.max(0, rect.top) && r.bottom <= Math.min(innerHeight, rect.bottom);
  const panel = root.getBoundingClientRect();
  const panelWithinViewport = panel.width > 0 && panel.height > 0 && panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight;
  if (!panelWithinViewport) return invisible('hidden');
  const rows: { index: number; entityKey: string; columns: string[]; row: any }[] = [];
  for (const element of rowElements) {
    const index = Number(element.getAttribute('row-index'));
    const row = grid.getDisplayedRowAtIndex(index)?.data;
    if (!row) continue;
    const columns: string[] = [];
    for (const cell of element.querySelectorAll<HTMLElement>('.ag-cell[col-id]')) {
      const column = cell.getAttribute('col-id')!, r = cell.getBoundingClientRect();
      if (!meta.columns.some((c: any) => c.name === column) || !inViewport(r)) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !cell.contains(hit)) continue;
      // Empty cells intentionally render their owner null as the word "empty".
      const expected = row[column] === null ? 'empty' : String(row[column] ?? '');
      if (cell.textContent !== expected) continue;
      columns.push(column);
    }
    if (!columns.includes(meta.entityKey)) continue;
    const entityKey = row[meta.entityKey];
    rows.push({ index, entityKey, columns, row });
  }
  if (!rows.length) return invisible('hidden');
  rows.sort((a, b) => a.index - b.index);
  // Sticky headers may cover a geometrically in-range buffered row at a page
  // boundary. Choose the first key cell that also passed the hit test.
  const offset = Math.floor(rows[0]!.index / baseQuery.limit) * baseQuery.limit;
  const query = { ...baseQuery, offset }, loadedRows = loadedPages.get(offset) ?? 0;
  if (!loadedRows) return invisible('unavailable');
  const selected = rows.filter(r => r.index >= offset && r.index < offset + query.limit);
  const visibleRows = selected.map(({ entityKey, columns }) => ({ entityKey, columns }));
  const values = selected.map(({ entityKey, columns, row }) => [entityKey, columns.map(c => [c, row[c]])]);
  const rowValuesDigest = await valuesDigest([resource, meta.namespace, query, values]);
  return { evidence: 'dom-visible', coverage: { kind: 'table-dom', resource, query, loadedRows, visibleRows, namespace: meta.namespace, rowValuesDigest, documentVisible: true, panelWithinViewport, keyCellsWithinViewport: true, framesAfterData: 2, occlusion: 'element-hit-tested' }, time };
}
