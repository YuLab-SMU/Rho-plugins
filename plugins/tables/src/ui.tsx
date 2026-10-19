// Optional browser entry for rho.table. Rows are read in bounded pages from
// the exact bound table version; the shell supplies the scoped client.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { CellStyleModule, InfiniteRowModelModule, ModuleRegistry, RowApiModule, RowSelectionModule, themeQuartz, type ColDef, type GridApi, type IDatasource, type RowSelectedEvent } from 'ag-grid-community';

ModuleRegistry.registerModules([CellStyleModule, InfiniteRowModelModule, RowApiModule, RowSelectionModule]);

export interface UiClient { call(method: string, input: any): Promise<any> }
export interface TableViewProps {
  view: { id: string; props: Record<string, unknown>; bindings: Record<string, unknown> };
  projectId: string;
  client: UiClient;
  active: boolean;
  // False when this session may read rows but not share a selection.
  selectable?: boolean;
}
type Column = { name: string; type: 'string' | 'number' | 'boolean' };
type Filter = { column: string; op: 'eq' | 'lt' | 'gt' | 'isNull'; value?: string | number | boolean | null };

export const pageRows = 200;
const opLabel = { eq: 'is', lt: 'is below', gt: 'is above', isNull: 'is empty' } as const;
const theme = themeQuartz.withParams({ fontFamily: 'inherit', fontSize: 13, headerFontWeight: 600, borderColor: 'var(--border, #e4e7eb)', backgroundColor: 'var(--surface, #fff)', foregroundColor: 'var(--text, #1f2328)', headerBackgroundColor: 'var(--surface-muted, #f6f7f9)', accentColor: 'var(--agent, #2f6fde)', rowHeight: 30, headerHeight: 32, wrapperBorderRadius: 0 });

// Converts a typed filter value; numbers and booleans are compared as typed.
export function typedValue(column: Column, raw: string): Filter['value'] {
  if (column.type === 'number') { const n = Number(raw); return raw.trim() === '' || !Number.isFinite(n) ? undefined : n; }
  if (column.type === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : undefined;
  return raw;
}

const Empty = () => <span style={{ fontStyle: 'italic', color: 'var(--text-muted, #8b939d)' }}>empty</span>;

export function TableView(props: TableViewProps) {
  const resource = props.view.bindings.data as { id?: string; version?: string } | undefined;
  return <BoundTable key={props.projectId + ':' + resource?.id + ':' + resource?.version} {...props} />;
}

function BoundTable({ view, projectId, client, selectable = true }: TableViewProps) {
  const resource = view.bindings.data as { id: string; version: string } | undefined;
  const [meta, setMeta] = useState<{ columns: Column[]; total: number; filtered: number; entityKey: string | null; namespace: string | null } | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [draft, setDraft] = useState<{ column: string; op: Filter['op']; value: string } | null>(null);
  const [failure, setFailure] = useState('');
  const [selected, setSelected] = useState(0);
  const api = useRef<GridApi | null>(null);
  const selection = useRef<{ version: number } | null>(null);
  const entities = useRef(new Set<string>());
  const selectionQueue = useRef<Promise<unknown>>(Promise.resolve());
  const initial = useRef<any>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!resource) return;
    let disposed = false;
    const shared = selectable ? client.call('interaction.selection.read', { projectId, scope: { kind: 'shared', id: view.id } }) : Promise.resolve(null);
    void Promise.all([client.call('data.page', { projectId, resource, offset: 0, limit: pageRows }), shared]).then(([page, picked]) => {
      if (disposed) return;
      if (picked) {
        selection.current = { version: picked.version };
        if (picked.selection?.resource?.id === resource.id && picked.selection.resource.version === resource.version) entities.current = new Set(picked.selection.entities);
        setSelected(entities.current.size);
      }
      initial.current = page; setMeta(page); setFailure('');
    }, error => { if (!disposed) setFailure(error?.message ?? 'Rows could not be read.'); });
    return () => { disposed = true; };
  }, [client, projectId, resource?.id, resource?.version, attempt, selectable, view.id]);
  const filterRef = useRef(filter); filterRef.current = filter;

  const datasource = useMemo<IDatasource>(() => ({
    getRows(params) {
      const sort = params.sortModel[0];
      const first = !sort && !filterRef.current && params.startRow === 0 ? initial.current : null;
      initial.current = null;
      const request = first ? Promise.resolve(first) : client.call('data.page', { projectId, resource, offset: params.startRow, limit: pageRows, ...(sort ? { sort: { column: sort.colId, direction: sort.sort } } : {}), ...(filterRef.current ? { filter: filterRef.current } : {}) });
      request.then(page => {
          setFailure(''); setMeta(previous => previous ? { ...previous, filtered: page.filtered, total: page.total } : page);
          // The backend knows the exact filtered count. Reset an earlier short
          // result when the filter is removed, rather than retaining its end.
          params.successCallback(page.rows, page.filtered);
        }, error => { setFailure(error?.message ?? 'Rows could not be read.'); params.failCallback(); });
    },
  }), [client, projectId, resource?.id, resource?.version]);

  const columnDefs = useMemo<ColDef[]>(() => (meta?.columns ?? []).map(c => ({
    field: c.name, colId: c.name, valueGetter: p => p.data?.[c.name], headerName: c.name + (c.name === meta?.entityKey ? ' · key' : ''), sortable: true,
    type: c.type === 'number' ? 'rightAligned' : undefined,
    cellRenderer: (p: { value: unknown }) => p.value === null ? <Empty /> : String(p.value ?? ''),
  })), [meta?.columns, meta?.entityKey]);

  const applyFilter = (next: Filter | null) => { setFilter(next); filterRef.current = next; api.current?.purgeInfiniteCache(); };
  const submitDraft = () => {
    if (!draft || !meta) return;
    const column = meta.columns.find(c => c.name === draft.column)!;
    if (draft.op === 'isNull') { applyFilter({ column: column.name, op: 'isNull' }); setDraft(null); return; }
    const value = typedValue(column, draft.value);
    if (value === undefined) return;
    applyFilter({ column: column.name, op: draft.op, value }); setDraft(null);
  };

  // Track stable keys independently of loaded grid blocks. Cache eviction,
  // sorting and filtering must not publish a different entity selection.
  const onSelection = useCallback((event: RowSelectedEvent) => {
    const key = meta?.entityKey;
    if (!selectable || !key || !meta?.namespace || !resource || !event.node.data || !['checkboxSelected', 'rowClicked', 'spaceKey', 'uiSelectAll'].includes(event.source)) return;
    const id = String(event.node.data[key]);
    if (event.node.isSelected()) entities.current.add(id); else entities.current.delete(id);
    const chosen = [...entities.current]; setSelected(chosen.length);
    const scope = { kind: 'shared', id: view.id };
    selectionQueue.current = selectionQueue.current.catch(() => undefined).then(async () => {
      const current = selection.current ?? await client.call('interaction.selection.read', { projectId, scope });
      const input = { projectId, scope, expectedVersion: current.version, changeId: 'tab-' + globalThis.crypto.randomUUID(), selection: chosen.length ? { resource, entities: chosen } : null };
      // Preserve the original transaction when transport loses its response.
      for (let retry = 0; ; retry++) {
        try { const result = await client.call('interaction.selection.set', input); selection.current = { version: result.version }; setFailure(''); return; }
        catch (error: any) {
          if (error?.error?.kind || error?.kind || retry >= 2) throw error;
        }
      }
    }).catch(() => { selection.current = null; setFailure('The shared selection could not be confirmed. Your picked rows are kept here.'); });
  }, [client, projectId, resource?.id, resource?.version, meta?.entityKey, meta?.namespace, view.id, selectable]);

  if (!resource) return <p style={{ padding: 12, fontSize: 12 }}>This view has no table.</p>;
  const bar: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 12px', fontSize: 12, borderBottom: '1px solid var(--border, #e4e7eb)', flexWrap: 'wrap' };
  const control: CSSProperties = { font: 'inherit', fontSize: 12, border: '1px solid var(--border, #d6dae0)', borderRadius: 6, padding: '2px 8px', maxWidth: '100%', minWidth: 0, background: 'var(--surface, #fff)', color: 'inherit' };
  const count = meta ? (filter ? `${meta.filtered.toLocaleString()} of ${meta.total.toLocaleString()} rows` : `${meta.total.toLocaleString()} rows`) : 'Reading rows…';
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
    <div style={bar} role="toolbar" aria-label="Table">
      <span>{count}</span>
      {selected > 0 && <span>· {selected} selected</span>}
      {filter && <span style={{ ...control, display: 'inline-flex', gap: 6, alignItems: 'center' }}>{filter.column} {opLabel[filter.op]}{filter.op !== 'isNull' && ' ' + String(filter.value)}
        <button aria-label="Remove filter" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'inherit' }} onClick={() => applyFilter(null)}>×</button></span>}
      {!filter && meta && !draft && <button style={control} onClick={() => setDraft({ column: meta.columns[0]!.name, op: 'eq', value: '' })}>Filter</button>}
      {draft && meta && <form style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: '100%' }} onSubmit={e => { e.preventDefault(); submitDraft(); }}>
        <select aria-label="Column" style={control} value={draft.column} onChange={e => setDraft({ ...draft, column: e.target.value, op: 'eq', value: '' })}>{meta.columns.map(c => <option key={c.name}>{c.name}</option>)}</select>
        <select aria-label="Condition" style={control} value={draft.op} onChange={e => setDraft({ ...draft, op: e.target.value as Filter['op'] })}>
          {(Object.keys(opLabel) as Filter['op'][]).filter(op => !(['lt', 'gt'].includes(op) && meta.columns.find(c => c.name === draft.column)?.type === 'boolean')).map(op => <option key={op} value={op}>{opLabel[op]}</option>)}
        </select>
        {draft.op !== 'isNull' && <input aria-label="Value" style={control} value={draft.value} onChange={e => setDraft({ ...draft, value: e.target.value })} />}
        <button style={control} type="submit">Apply</button><button style={control} type="button" onClick={() => setDraft(null)}>Cancel</button>
      </form>}
      {meta && !meta.entityKey && selectable && <span style={{ color: 'var(--text-muted, #5f6873)' }}>Rows have no key, so they can't be selected for Claude Code.</span>}
    </div>
    {failure && <div role="alert" style={{ ...bar, color: 'var(--danger, #cf222e)' }}>{failure}<button style={control} onClick={() => { setAttempt(n => n + 1); api.current?.purgeInfiniteCache(); }}>Try again</button></div>}
    <div style={{ flex: 1, minHeight: 0 }}>
      {meta && <AgGridReact theme={theme} rowModelType="infinite" datasource={datasource} cacheBlockSize={pageRows} maxBlocksInCache={5} suppressMultiSort maxConcurrentDatasourceRequests={1} columnDefs={columnDefs}
        defaultColDef={{ resizable: true, minWidth: 80, flex: 1 }}
        getRowId={meta?.entityKey && meta.namespace ? p => meta.namespace + ':' + String(p.data[meta.entityKey!]) : undefined}
        rowSelection={meta?.entityKey && meta.namespace && selectable ? { mode: 'multiRow', checkboxes: true, headerCheckbox: false, enableClickSelection: true } : undefined}
        onModelUpdated={e => { if (meta.entityKey) e.api.forEachNode(node => { if (node.data && entities.current.has(String(node.data[meta.entityKey!]))) node.setSelected(true); }); }}
        onRowSelected={onSelection}
        onGridReady={e => { api.current = e.api; }} />}
    </div>
  </div>;
}

export const tableEntry = {
  component: 'rho.table', componentVersion: '0.2.0', owner: 'rho-plugins.table', package: '@rho-workspace/plugin-tables',
  bindings: { data: 'resource' as const },
  requiredOperations: ['data.page'],
  selection: ['table-entities' as const],
  View: TableView,
};
