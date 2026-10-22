// Tables' bodies inside the application's item frame: a reference, a card, a
// summary and a recorded comparison. The full form is the grid. Each form reads
// bounded pages of published versions and names what it leaves out; none starts
// a computation, and a comparison is only ever read from its record.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { columnsFor, comparisonCounts, count, describeSubset, formatValue, hiddenNote, highlightOf, limit, newColumns, readRef, showOf, subsetRequests, subsetSize, subsetsOf, tableCardLimits, tableShows, type Column, type Page, type ResourceRef, type Subset } from './ui-card-model.js';

export interface UiClient { call(method: string, input: any): Promise<any> }
export interface TableCardProps {
  form: string;
  params: Record<string, unknown>;
  projectId: string;
  client: UiClient;
  // The table the item's view is bound to.
  resource?: ResourceRef;
  // Present when this tab may change how the item is shown.
  onParams?: (params: Record<string, unknown>) => void;
  // What the drawn form leaves out, counted from the whole table.
  reportHidden?: (note: string) => void;
}

// Forms this entry draws below its grid. Compare is reached by naming a recorded
// comparison, not by zooming, so stepping up from the card arrives at the summary.
export const tableForms = {
  inline: { scale: 0, label: 'Reference' },
  card: { scale: 1, label: 'Card', params: { show: [...tableShows] } },
  summary: { scale: 2, label: 'Summary' },
  compare: { scale: 2, label: 'Compare', zoom: false as const },
  full: { scale: 3, label: 'Table' },
};

const styles = `
.rho-tc{display:flex;flex-direction:column;gap:8px;min-width:0;font-size:12px;line-height:17px;color:var(--text,#1f2328)}
.rho-tc-crumb{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:11px;line-height:15px;color:var(--text-muted,#5f6873)}
.rho-tc-crumb>.rho-tc-fill{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.rho-tc-note{margin:0;font-size:11.5px;color:var(--text-muted,#5f6873)}
.rho-tc-num{font-family:var(--font-mono,"JetBrains Mono",ui-monospace,monospace);font-variant-numeric:tabular-nums;font-variant-ligatures:none}
.rho-tc-big{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px}
.rho-tc-big strong{font-family:var(--font-mono,"JetBrains Mono",ui-monospace,monospace);font-size:24px;line-height:30px;font-weight:600}
.rho-tc-big s{font-family:var(--font-mono,"JetBrains Mono",ui-monospace,monospace);color:var(--text-muted,#8b939d)}
.rho-tc-meter{height:3px;border-radius:2px;background:var(--border,#e4e7eb);overflow:hidden}
.rho-tc-meter>span{display:block;height:100%;background:var(--text,#1f2328)}
.rho-tc-scroll{overflow:auto;max-width:100%}
.rho-tc table{border-collapse:collapse;width:100%;font-size:11.5px;line-height:16px}
.rho-tc th{position:sticky;top:0;background:var(--surface,#fff);text-align:left;font-weight:500;font-size:10.5px;letter-spacing:.02em;color:var(--text-muted,#5f6873);padding:4px 8px;border-bottom:1px solid var(--border,#e4e7eb);white-space:nowrap}
.rho-tc td{padding:4px 8px;border-bottom:1px solid var(--divider,#eef0f2);white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}
.rho-tc .rho-tc-n{text-align:right}
.rho-tc .rho-tc-key{position:sticky;left:0;background:var(--surface,#fff);font-weight:500}
.rho-tc th.rho-tc-key{z-index:1}
.rho-tc th.rho-tc-hl{color:var(--agent,#3a68f0);box-shadow:inset 0 -2px 0 var(--agent,#3a68f0)}
.rho-tc td.rho-tc-hl{background:var(--agent-wash,rgba(58,104,240,.06))}
.rho-tc .rho-tc-empty{font-style:italic;color:var(--text-muted,#8b939d)}
.rho-tc .rho-tc-missing td{color:var(--text-muted,#8b939d)}
.rho-tc-subsets{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:11px;color:var(--text-muted,#5f6873)}
.rho-tc button.rho-tc-chip{font:inherit;font-size:11px;min-height:22px;padding:0 8px;border:1px solid var(--border,#e4e7eb);border-radius:6px;background:var(--surface,#fff);color:var(--text,#1f2328);cursor:pointer}
.rho-tc button.rho-tc-chip[aria-pressed="true"]{border-color:var(--text,#1f2328);font-weight:600}
.rho-tc button.rho-tc-chip:disabled{cursor:default}
.rho-tc-chip-static{color:var(--text,#1f2328);font-weight:500}
.rho-tc button.rho-tc-link{font:inherit;font-size:11.5px;min-height:22px;padding:0;border:0;background:none;color:var(--accent,#3a68f0);cursor:pointer}
.rho-tc-shows{display:inline-flex;gap:2px;padding:2px;border-radius:7px;background:var(--surface-muted,#f1f3f5)}
.rho-tc-shows button{font:inherit;font-size:10.5px;min-height:20px;padding:0 7px;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--text-muted,#5f6873);cursor:pointer}
.rho-tc-shows button[aria-pressed="true"]{background:var(--surface,#fff);border-color:var(--border,#e4e7eb);color:var(--text,#1f2328);font-weight:600}
.rho-tc-ruler{position:relative;height:14px;margin:2px 4px 0}
.rho-tc-ruler::before{content:"";position:absolute;left:0;right:0;top:7px;height:1px;background:var(--border,#d6dae0)}
.rho-tc-ruler .rho-tc-tick{position:absolute;top:1px;width:1px;height:12px;background:var(--text,#1f2328)}
.rho-tc-ruler .rho-tc-dot{position:absolute;top:3px;width:8px;height:8px;margin-left:-4px;border-radius:999px;background:var(--waiting,#c98a1b)}
.rho-tc-pair{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.rho-tc-pair>span.rho-tc-side{display:inline-flex;gap:6px;align-items:baseline;padding:2px 8px;border:1px solid var(--border,#e4e7eb);border-radius:6px}
.rho-tc-counts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.rho-tc-counts>div{display:flex;flex-direction:column;gap:2px;min-width:0}
.rho-tc-counts strong{font-family:var(--font-mono,"JetBrains Mono",ui-monospace,monospace);font-size:20px;line-height:26px;font-weight:600}
.rho-tc-counts span{font-size:11px;color:var(--text-muted,#5f6873);overflow-wrap:anywhere}
.rho-tc-inline{display:inline-flex;align-items:baseline;gap:6px;min-width:0}
.rho-tc-inline .rho-tc-q{color:var(--text-muted,#5f6873);font-weight:400}
`;
let injected = false;
function injectStyles() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style'); style.dataset.owner = 'rho-plugins.table.card'; style.textContent = styles; document.head.append(style);
}

type Request = { resource: ResourceRef; offset: number; limit: number; filter?: unknown; sort?: unknown };
// Bounded reads; null waits for the requests to be known.
function usePages(client: UiClient, projectId: string, requests: Request[] | null) {
  const key = requests ? JSON.stringify([projectId, requests]) : '';
  const [state, setState] = useState<{ key: string; pages?: Page[]; failure?: string }>({ key: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!requests) return;
    let live = true;
    Promise.all(requests.map(r => client.call('data.page', { projectId, ...r }) as Promise<Page>)).then(
      pages => { if (live) setState({ key, pages }); },
      error => { if (live) setState({ key, failure: error?.message ?? 'Rows could not be read.' }); });
    return () => { live = false; };
  }, [client, key, attempt]);
  const current = state.key === key ? state : null;
  return { pages: current?.pages ?? null, failure: current?.failure ?? '', retry: () => setAttempt(n => n + 1) };
}
const one = (resource: ResourceRef | null): Request[] | null => resource ? [{ resource, offset: 0, limit: 1 }] : null;

function useHidden(note: string, report?: (note: string) => void) {
  useEffect(() => { report?.(note); }, [note, report]);
}

function Value({ value }: { value: unknown }) {
  return value === null || value === undefined ? <span className="rho-tc-empty">empty</span> : <>{formatValue(value)}</>;
}
function Rows({ columns, rows, entityKey, highlight, keys }: { columns: Column[]; rows: (Record<string, unknown> | null)[]; entityKey: string | null; highlight: string[]; keys?: string[] }) {
  return <div className="rho-tc-scroll"><table>
    <thead><tr>{!entityKey && <th className="rho-tc-n" title="Row position, for reading only">#</th>}{columns.map(c => <th key={c.name} className={[c.name === entityKey && 'rho-tc-key', c.type === 'number' && 'rho-tc-n', highlight.includes(c.name) && 'rho-tc-hl'].filter(Boolean).join(' ') || undefined}>{c.name}{c.name === entityKey ? ' · key' : ''}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => row ? <tr key={entityKey ? String(row[entityKey]) : i}>
      {!entityKey && <td className="rho-tc-n rho-tc-num">{i + 1}</td>}
      {columns.map(c => <td key={c.name} className={[c.name === entityKey && 'rho-tc-key', c.type === 'number' && 'rho-tc-n rho-tc-num', highlight.includes(c.name) && 'rho-tc-hl'].filter(Boolean).join(' ') || undefined}><Value value={row[c.name]} /></td>)}
    </tr> : <tr key={'missing:' + keys?.[i]} className="rho-tc-missing"><td className="rho-tc-key">{keys?.[i]}</td><td colSpan={Math.max(1, columns.length - 1)}>Not in this version</td></tr>)}</tbody>
  </table></div>;
}
function Shows({ show, params, onParams }: { show: string; params: Record<string, unknown>; onParams?: TableCardProps['onParams'] }) {
  if (!onParams) return null;
  const options = tableShows.filter(s => s !== 'cell' || typeof params.key === 'string' && typeof params.column === 'string');
  return <span className="rho-tc-shows" role="group" aria-label="Show in this card">
    {options.map(s => <button key={s} aria-pressed={s === show} onClick={() => s !== show && onParams({ ...params, show: s })}>{s[0]!.toUpperCase() + s.slice(1)}</button>)}
  </span>;
}
function Reading({ failure, retry, inline }: { failure: string; retry: () => void; inline?: boolean }) {
  if (inline) return <span>{failure ? 'Unreadable' : 'Reading…'}</span>;
  return <div className="rho-tc">{failure ? <><p className="rho-tc-note" role="alert">{failure}</p><div><button className="rho-tc-link" onClick={retry}>Try again</button></div></> : <p className="rho-tc-note">Reading rows…</p>}</div>;
}

// The rows of one subset, after the table's key is known.
function useSubset(props: TableCardProps, resource: ResourceRef, subset: Subset | null, wanted: number) {
  const meta = usePages(props.client, props.projectId, one(resource)), head = meta.pages?.[0];
  const plan = useMemo(() => head ? subsetRequests(subset, head.entityKey, wanted) : null, [head, subset, wanted]);
  const read = usePages(props.client, props.projectId, plan ? plan.requests.map(r => ({ resource, ...r })) : null);
  const keyed = !!subset && 'keys' in subset;
  const rows = read.pages ? keyed ? read.pages.map(p => p.rows[0] ?? null) : read.pages[0]?.rows ?? [] : null;
  const size = head && read.pages ? keyed ? subsetSize(subset, head) : subsetSize(subset, read.pages[0] ?? head) : null;
  return { head, rows, size, unreadable: !!plan?.unreadable, failure: meta.failure || read.failure, retry: () => { meta.retry(); read.retry(); }, ready: !!head && (!!plan?.unreadable || !!read.pages) };
}

function CountCard({ props, resource, subset, inline }: { props: TableCardProps; resource: ResourceRef; subset: Subset | null; inline?: boolean }) {
  const before = readRef(props.params.before);
  const now = usePages(props.client, props.projectId, [{ resource, offset: 0, limit: 1, ...(subset && 'filter' in subset && subset.filter ? { filter: subset.filter } : {}) }]);
  const was = usePages(props.client, props.projectId, before ? one(before) : []);
  const page = now.pages?.[0];
  const size = page ? subsetSize(subset, page) : 0;
  useHidden(inline || !page ? '' : hiddenNote('card', 'count', { total: page.total, columns: page.columns.length }), props.reportHidden);
  if (!page || before && !was.pages) return <Reading failure={now.failure || was.failure} retry={() => { now.retry(); was.retry(); }} inline={inline} />;
  // An earlier version compares whole tables; a subset is counted within this one.
  const earlier = was.pages?.[0]?.total, named = !!subset && ('keys' in subset || !!subset.filter);
  const big = earlier !== undefined ? page.total : size;
  const rows = (n: number) => n === 1 ? 'row' : 'rows';
  if (inline) return <span className="rho-tc-inline rho-tc-num">{earlier !== undefined ? <>{earlier.toLocaleString('en-US')} → {big.toLocaleString('en-US')}</> : big.toLocaleString('en-US')}<span className="rho-tc-q">{rows(big)}</span></span>;
  const change = earlier !== undefined ? page.total - earlier : null;
  return <div className="rho-tc">
    <div className="rho-tc-crumb"><span className="rho-tc-fill">{named ? `${describeSubset(subset)} · ${size.toLocaleString('en-US')} of ${count(page.total, 'row')}` : 'All rows'}</span><Shows show="count" params={props.params} onParams={props.onParams} /></div>
    <div className="rho-tc-big">{earlier !== undefined && <s>{earlier.toLocaleString('en-US')}</s>}{earlier !== undefined && <span aria-hidden="true">→</span>}<strong>{big.toLocaleString('en-US')}</strong><span>{rows(big)}</span></div>
    {earlier ? <div className="rho-tc-meter" role="meter" aria-label="Rows compared with the earlier version" aria-valuemin={0} aria-valuemax={earlier} aria-valuenow={Math.min(page.total, earlier)}><span style={{ width: Math.min(100, 100 * page.total / earlier) + '%' }} /></div> : null}
    {change !== null && <p className="rho-tc-note rho-tc-num">{change < 0 ? `${count(-change, 'row')} fewer than before` : change > 0 ? `${count(change, 'row')} more than before` : 'Same number of rows as before'}</p>}
  </div>;
}

function RowsCard({ props, resource, subset }: { props: TableCardProps; resource: ResourceRef; subset: Subset | null }) {
  const rows = limit(props.params, 'rows', tableCardLimits.cardRows, tableCardLimits.maxRows), cols = limit(props.params, 'columns', tableCardLimits.cardColumns, tableCardLimits.maxColumns);
  const read = useSubset(props, resource, subset, rows), head = read.head;
  const columns = head ? columnsFor(head.columns, head.entityKey, highlightOf(props.params), cols) : [];
  const shown = read.rows?.length ?? 0;
  useHidden(head && read.ready ? hiddenNote('card', 'rows', { total: head.total, inSubset: read.unreadable ? head.total : read.size ?? head.total, shownRows: read.unreadable ? 0 : shown, columns: head.columns.length, shownColumns: columns.length }) : '', props.reportHidden);
  if (!head || !read.ready) return <Reading failure={read.failure} retry={read.retry} />;
  return <div className="rho-tc">
    <div className="rho-tc-crumb"><span className="rho-tc-fill">{describeSubset(subset)}</span><Shows show="rows" params={props.params} onParams={props.onParams} /></div>
    {read.unreadable ? <p className="rho-tc-note">These rows are named by key, but this table declares no key.</p>
      : <Rows columns={columns} rows={read.rows!} entityKey={head.entityKey} highlight={highlightOf(props.params)} keys={subset && 'keys' in subset ? subset.keys : undefined} />}
    {!head.entityKey && <p className="rho-tc-note">No declared key: rows can be read here but not referred to elsewhere.</p>}
  </div>;
}

function CellCard({ props, resource, inline }: { props: TableCardProps; resource: ResourceRef; inline?: boolean }) {
  const key = typeof props.params.key === 'string' ? props.params.key : null, column = typeof props.params.column === 'string' ? props.params.column : null;
  const source = readRef(props.params.table) ?? resource;
  const meta = usePages(props.client, props.projectId, one(source)), head = meta.pages?.[0];
  const read = usePages(props.client, props.projectId, head?.entityKey && key ? [{ resource: source, offset: 0, limit: 1, filter: { column: head.entityKey, op: 'eq', value: key } }] : head ? [] : null);
  useHidden(inline ? '' : hiddenNote('card', 'cell', { total: 0, columns: 0 }), props.reportHidden);
  if (!head || !read.pages) return <Reading failure={meta.failure || read.failure} retry={() => { meta.retry(); read.retry(); }} inline={inline} />;
  const row = read.pages[0]?.rows[0], known = !!column && head.columns.some(c => c.name === column);
  const value = row && known ? row[column!] : undefined;
  const problem = !key || !column ? 'This card names no key and column.' : !head.entityKey ? 'This table declares no key, so a cell cannot be found by key.' : !known ? `This version has no column ${column}.` : !row ? `${key} is not in this version.` : '';
  if (inline) return <span className="rho-tc-inline"><span>{key} · {column}</span><span className="rho-tc-num">{problem ? 'not found' : formatValue(value)}</span></span>;
  const threshold = props.params.threshold as { op?: string; value?: unknown } | undefined;
  const t = threshold && (threshold.op === 'lt' || threshold.op === 'gt') && typeof threshold.value === 'number' ? threshold as { op: 'lt' | 'gt'; value: number } : null;
  const scale = t && typeof value === 'number' ? Math.max(Math.abs(value), Math.abs(t.value)) * 1.25 || 1 : 0;
  const at = (v: number) => Math.max(0, Math.min(100, 100 * Math.abs(v) / scale)) + '%';
  return <div className="rho-tc">
    <div className="rho-tc-crumb"><span className="rho-tc-fill rho-tc-num">{key} · {column}{source.id !== resource.id || source.version !== resource.version ? ' · from another version' : ''}</span><Shows show="cell" params={props.params} onParams={props.onParams} /></div>
    {problem ? <p className="rho-tc-note">{problem}</p> : <div className="rho-tc-big"><strong><Value value={value} /></strong>{t && <span className="rho-tc-note rho-tc-num">condition {t.op === 'lt' ? '<' : '>'} {formatValue(t.value)}</span>}</div>}
    {!problem && t && typeof value === 'number' && <div className="rho-tc-ruler" aria-hidden="true"><span className="rho-tc-tick" style={{ left: at(t.value) }} /><span className="rho-tc-dot" style={{ left: at(value) }} /></div>}
  </div>;
}

function Summary({ props, resource }: { props: TableCardProps; resource: ResourceRef }) {
  const { list, subset, picked } = subsetsOf(props.params);
  const rows = limit(props.params, 'rows', tableCardLimits.summaryRows, tableCardLimits.maxRows), cols = limit(props.params, 'columns', tableCardLimits.summaryColumns, tableCardLimits.maxColumns);
  const read = useSubset(props, resource, subset, rows), head = read.head;
  const before = readRef(props.params.before), was = usePages(props.client, props.projectId, before ? one(before) : []);
  const highlight = [...highlightOf(props.params), ...newColumns(head?.columns ?? [], was.pages?.[0]?.columns ?? null)];
  const columns = head ? columnsFor(head.columns, head.entityKey, highlight, cols) : [];
  useHidden(head && read.ready ? hiddenNote('summary', '', { total: head.total, inSubset: read.unreadable ? head.total : read.size ?? head.total, shownRows: read.unreadable ? 0 : read.rows?.length ?? 0, columns: head.columns.length, shownColumns: columns.length }) : '', props.reportHidden);
  if (!head || !read.ready) return <Reading failure={read.failure || was.failure} retry={read.retry} />;
  const sort = subset && !('keys' in subset) ? subset.sort : undefined;
  return <div className="rho-tc">
    <div className="rho-tc-subsets">
      <span>Subset</span>
      {list.length > 1 ? list.map((s, i) => <button key={i} className="rho-tc-chip" aria-pressed={i === picked} disabled={!props.onParams} onClick={() => i !== picked && props.onParams?.({ ...props.params, picked: i })}>{describeSubset(s)}</button>)
        : <span className="rho-tc-chip-static">{describeSubset(subset)}</span>}
      <span style={{ flex: 1 }} />
      {sort && <span className="rho-tc-num">{sort.direction === 'desc' ? '↓' : '↑'} {sort.column}</span>}
      <span className="rho-tc-num">{count(read.size ?? head.total, 'row')}</span>
    </div>
    {read.unreadable ? <p className="rho-tc-note">These rows are named by key, but this table declares no key.</p>
      : <Rows columns={columns} rows={read.rows!} entityKey={head.entityKey} highlight={highlight} keys={subset && 'keys' in subset ? subset.keys : undefined} />}
    {!head.entityKey && <p className="rho-tc-note">No declared key: rows can be read here but not referred to elsewhere.</p>}
  </div>;
}

function Compare({ props }: { props: TableCardProps }) {
  const comparison = readRef(props.params.comparison);
  const record = usePages(props.client, props.projectId, comparison ? one(comparison) : []), head = record.pages?.[0];
  const counts = head ? comparisonCounts(head.resource) : null;
  const sides = usePages(props.client, props.projectId, counts?.left && counts.right ? [...one(counts.left)!, ...one(counts.right)!] : head ? [] : null);
  const picked = Array.isArray(props.params.keys) ? props.params.keys.filter((k): k is string => typeof k === 'string').slice(0, tableCardLimits.maxRows) : [];
  const wanted = limit(props.params, 'rows', tableCardLimits.compareRows, tableCardLimits.maxRows);
  const focus = counts ? counts.missingY > 0 ? 'y' : counts.missingX > 0 ? 'x' : null : null;
  const listRequests = !comparison || !counts ? null : picked.length
    ? picked.slice(0, wanted).map(key => ({ resource: comparison, offset: 0, limit: 1, filter: { column: 'key', op: 'eq', value: key } }))
    : [{ resource: comparison, offset: 0, limit: wanted, ...(focus ? { filter: { column: focus, op: 'isNull' } } : {}) }];
  const listed = usePages(props.client, props.projectId, listRequests);
  const labels = Array.isArray(props.params.labels) ? props.params.labels : [];
  const name = (i: 0 | 1) => typeof labels[i] === 'string' ? labels[i] as string : sides.pages?.[i]?.resource.path?.split(/[\\/]/).pop() ?? (i ? 'Right' : 'Left');
  const rows = listed.pages ? picked.length ? listed.pages.map(p => p.rows[0] ?? null) : listed.pages[0]?.rows ?? [] : null;
  useHidden(counts && rows ? hiddenNote('compare', '', { total: 0, columns: 0, compared: { total: counts.total, listed: rows.filter(Boolean).length } }) : '', props.reportHidden);
  if (!comparison) return <div className="rho-tc"><p className="rho-tc-note">No comparison recorded yet.</p></div>;
  if (!head || !sides.pages || !rows) return <Reading failure={record.failure || sides.failure || listed.failure} retry={() => { record.retry(); sides.retry(); listed.retry(); }} />;
  if (!counts) return <div className="rho-tc"><p className="rho-tc-note">This table is not a recorded comparison.</p></div>;
  const left = name(0), right = name(1), key = (head.resource.provenance?.transform as Record<string, unknown> | undefined)?.leftKey;
  const heading = picked.length ? `${count(picked.length, 'row')} Claude Code picked` : focus === 'y' ? `No ${right} value: first ${rows.length}` : focus === 'x' ? `No ${left} value: first ${rows.length}` : `First ${rows.length}`;
  const keyName = typeof key === 'string' ? key : 'key', same = counts.leftField === counts.rightField;
  const xName = same ? left : counts.leftField, yName = same ? right : counts.rightField;
  const cells: ReactNode = <Rows columns={[{ name: keyName, type: 'string' }, { name: xName, type: 'number' }, { name: yName, type: 'number' }]}
    rows={rows.map(r => r && { [keyName]: r.key, [xName]: r.x, [yName]: r.y })} entityKey={keyName} highlight={[]} keys={picked} />;
  return <div className="rho-tc">
    <div className="rho-tc-crumb"><span className="rho-tc-pair rho-tc-fill">
      <span className="rho-tc-side"><span>{left}</span>{sides.pages[0] && <span className="rho-tc-num">{sides.pages[0].total.toLocaleString('en-US')}</span>}</span><span aria-hidden="true">⟷</span>
      <span className="rho-tc-side"><span>{right}</span>{sides.pages[1] && <span className="rho-tc-num">{sides.pages[1].total.toLocaleString('en-US')}</span>}</span>
    </span>{typeof key === 'string' && <span>Aligned by {key}</span>}</div>
    <div className="rho-tc-counts">
      <div><strong>{counts.total.toLocaleString('en-US')}</strong><span>rows compared</span></div>
      <div><strong>{counts.missingY.toLocaleString('en-US')}</strong><span>no {right} value</span></div>
      <div><strong>{counts.missingX.toLocaleString('en-US')}</strong><span>no {left} value</span></div>
    </div>
    <p className="rho-tc-note">{heading}</p>
    {cells}
  </div>;
}

export function TableCardBody(props: TableCardProps) {
  injectStyles();
  const resource = props.resource, params = props.params;
  const { subset } = subsetsOf(params);
  if (props.form === 'compare') return <Compare props={props} />;
  if (!resource) return props.form === 'inline' ? <span>No table</span> : <p className="rho-tc-note">This item has no table.</p>;
  if (props.form === 'summary') return <Summary props={props} resource={resource} />;
  const hasSource = !!readRef(params.before);
  if (props.form === 'inline') return typeof params.key === 'string' && typeof params.column === 'string' && params.show !== 'count' ? <CellCard props={props} resource={resource} inline /> : <CountCard props={props} resource={resource} subset={subset} inline />;
  const show = showOf(params, hasSource);
  if (show === 'count') return <CountCard props={props} resource={resource} subset={subset} />;
  if (show === 'cell') return <CellCard props={props} resource={resource} />;
  return <RowsCard props={props} resource={resource} subset={subset} />;
}
