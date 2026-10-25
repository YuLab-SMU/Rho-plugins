// What a Tables card shows below the full grid: a count, a few rows by key, one
// cell, or a recorded comparison. DOM-free so subset reading and hidden notes are
// checked in Node. Every read is one bounded data.page on a published version.

export interface Column { name: string; type: 'string' | 'number' | 'boolean' }
export interface Filter { column: string; op: 'eq' | 'lt' | 'gt' | 'isNull'; value?: string | number | boolean | null }
export interface Sort { column: string; direction: 'asc' | 'desc' }
export interface ResourceRef { id: string; version: string }
// Which rows a card names: stable keys, or one filter and an optional order.
export type Subset = { keys: string[]; label?: string } | { filter?: Filter; sort?: Sort; label?: string };
export interface Page {
  resource: ResourceRef & { coverage?: Record<string, unknown>; provenance?: Record<string, unknown>; path?: string };
  columns: Column[]; total: number; filtered: number; rows: Record<string, unknown>[];
  entityKey: string | null; namespace: string | null;
}

// Card sizes. The protected resource is the space a card takes in the task view;
// a form parameter may lower or raise each value up to its maximum, and what does
// not fit is named in the hidden note. Keyed reads are one page per key, so the
// row maximum also bounds the number of requests one card makes.
export const tableCardLimits = { cardRows: 3, cardColumns: 3, summaryRows: 12, summaryColumns: 6, maxRows: 50, maxColumns: 12, compareRows: 3, maxSubsets: 6 };
export const tableShows = ['count', 'rows', 'cell'] as const;

export function limit(params: Record<string, unknown>, name: string, fallback: number, maximum: number) {
  const value = params[name];
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}
export function readRef(value: unknown): ResourceRef | null {
  const r = value as Partial<ResourceRef> | null;
  return r && typeof r.id === 'string' && typeof r.version === 'string' ? { id: r.id, version: r.version } : null;
}
const ops = ['eq', 'lt', 'gt', 'isNull'];
export function readFilter(value: unknown): Filter | null {
  const f = value as Partial<Filter> | null;
  if (!f || typeof f.column !== 'string' || !ops.includes(f.op as string)) return null;
  if (f.op === 'isNull') return { column: f.column, op: 'isNull' };
  return ['string', 'number', 'boolean'].includes(typeof f.value) || f.value === null ? { column: f.column, op: f.op!, value: f.value } : null;
}
export function readSort(value: unknown): Sort | null {
  const s = value as Partial<Sort> | null;
  return s && typeof s.column === 'string' && (s.direction === 'asc' || s.direction === 'desc') ? { column: s.column, direction: s.direction } : null;
}
export function readSubset(value: unknown): Subset | null {
  const s = value as Record<string, unknown> | null;
  if (!s || typeof s !== 'object') return null;
  const label = typeof s.label === 'string' ? { label: s.label } : {};
  if (Array.isArray(s.keys)) {
    const keys = [...new Set(s.keys.filter((k): k is string => typeof k === 'string' && k.length > 0))];
    return keys.length ? { keys, ...label } : null;
  }
  const filter = readFilter(s.filter), sort = readSort(s.sort);
  return filter || sort ? { ...(filter ? { filter } : {}), ...(sort ? { sort } : {}), ...label } : null;
}
// The subset a form shows: `subset`, else the one picked from `subsets`.
export function subsetsOf(params: Record<string, unknown>) {
  const list = Array.isArray(params.subsets) ? params.subsets.map(readSubset).filter((s): s is Subset => !!s).slice(0, tableCardLimits.maxSubsets) : [];
  const own = readSubset(params.subset);
  const picked = typeof params.picked === 'number' && list[params.picked] ? params.picked : 0;
  return { list, subset: own ?? list[picked] ?? null, picked: own ? -1 : picked };
}
export function showOf(params: Record<string, unknown>, hasSource: boolean) {
  if (typeof params.show === 'string' && (tableShows as readonly string[]).includes(params.show)) return params.show as typeof tableShows[number];
  return hasSource ? 'count' : 'rows';
}

// The data.page requests that read a subset. Keys read one page per key, so the
// rows come back in the order the Agent named them.
export function subsetRequests(subset: Subset | null, entityKey: string | null, rows: number) {
  if (subset && 'keys' in subset) {
    if (!entityKey) return { requests: [], unreadable: true };
    return { requests: subset.keys.slice(0, rows).map(key => ({ offset: 0, limit: 1, filter: { column: entityKey, op: 'eq' as const, value: key } })), unreadable: false };
  }
  return { requests: [{ offset: 0, limit: rows, ...(subset?.filter ? { filter: subset.filter } : {}), ...(subset?.sort ? { sort: subset.sort } : {}) }], unreadable: false };
}
export function subsetSize(subset: Subset | null, page: Pick<Page, 'total' | 'filtered'>) {
  return subset && 'keys' in subset ? subset.keys.length : subset?.filter ? page.filtered : page.total;
}

const opText = { eq: 'is', lt: '<', gt: '>', isNull: 'is empty' } as const;
export function describeFilter(filter: Filter) {
  return filter.op === 'isNull' ? `${filter.column} is empty` : `${filter.column} ${opText[filter.op]} ${formatValue(filter.value ?? null)}`;
}
export function describeSubset(subset: Subset | null) {
  if (!subset) return 'All rows';
  if (subset.label) return subset.label;
  if ('keys' in subset) return subset.keys.length <= 3 ? subset.keys.join(', ') : `${subset.keys.slice(0, 2).join(', ')} and ${subset.keys.length - 2} more`;
  const parts = [subset.filter && describeFilter(subset.filter), subset.sort && `by ${subset.sort.column} ${subset.sort.direction === 'desc' ? '↓' : '↑'}`].filter(Boolean);
  return parts.join(' · ');
}

// A number in a table cell, as a reader of results expects it: four significant digits,
// and an exponent wherever the magnitude would otherwise be lost, so 2.93e-18 never reads
// as 2.93 (Rho H0 audit P0-1). Integers stay exact; the full value is the cell's title.
const superscript = (n: number) => [...String(n)].map(c => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'.charAt('-0123456789'.indexOf(c))).join('');
export function formatCell(value: number) {
  if (!Number.isFinite(value)) return String(value);
  const sign = value < 0 ? '\u2212' : '', abs = Math.abs(value);
  if (Number.isInteger(value) && abs < 1e7) return sign + String(abs);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e7)) {
    const [mantissa, exponent] = abs.toExponential(2).split('e');
    return `${sign}${mantissa} × 10${superscript(Number(exponent))}`;
  }
  return sign + abs.toPrecision(4);
}

// Numbers keep their precision; only very small or large values use exponents.
export function formatValue(value: unknown) {
  if (value === null || value === undefined) return 'empty';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    const abs = Math.abs(value);
    if (abs !== 0 && (abs < 1e-3 || abs >= 1e7)) return value.toExponential(1).replace('e+', 'e');
    return Number.isInteger(value) ? value.toLocaleString('en-US') : String(Number(value.toPrecision(4)));
  }
  return String(value);
}
export const count = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// Columns a form draws: the key first, then the ones the Agent highlighted or
// that are new against the earlier version, then the rest in table order.
export function columnsFor(columns: Column[], entityKey: string | null, highlight: string[], wanted: number) {
  const names = columns.map(c => c.name);
  const order = [...new Set([...(entityKey ? [entityKey] : []), ...highlight.filter(h => names.includes(h)), ...names])];
  return order.slice(0, wanted).map(name => columns.find(c => c.name === name)!);
}
export function newColumns(now: Column[], before: Column[] | null) {
  if (!before) return [];
  const old = new Set(before.map(c => c.name));
  return now.filter(c => !old.has(c.name)).map(c => c.name);
}
export const highlightOf = (params: Record<string, unknown>) => Array.isArray(params.highlight) ? params.highlight.filter((h): h is string => typeof h === 'string') : [];

// What a form leaves out, counted from the whole table.
export function hiddenNote(form: string, show: string, facts: { total: number; shownRows?: number; inSubset?: number; columns: number; shownColumns?: number; compared?: { total: number; listed: number } }) {
  if (form === 'card' && show === 'count') return 'Not shown: all rows';
  if (form === 'card' && show === 'cell') return 'Not shown: every other cell';
  if (form === 'compare' && facts.compared) {
    const rest = facts.compared.total - facts.compared.listed;
    return rest > 0 ? `Not shown: ${count(rest, 'other compared row')}` : '';
  }
  const parts: string[] = [];
  const outside = facts.total - (facts.inSubset ?? facts.total), unshown = (facts.inSubset ?? facts.total) - (facts.shownRows ?? 0);
  if (outside > 0) parts.push(count(outside, 'row') + ' outside this subset');
  if (unshown > 0) parts.push(count(unshown, 'more row') + (outside > 0 ? ' in it' : ''));
  const columns = facts.columns - (facts.shownColumns ?? facts.columns);
  if (columns > 0) parts.push(count(columns, 'more column'));
  return parts.length ? 'Not shown: ' + parts.join(' · ') : '';
}

// A recorded comparison: what data.compare kept with the comparison table.
export function comparisonCounts(resource: Page['resource']) {
  const c = resource.coverage ?? {};
  const n = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
  const total = n(c.total), missingX = n(c.missingX), missingY = n(c.missingY);
  if (total === null || missingX === null || missingY === null) return null;
  const inputs = Array.isArray(resource.provenance?.inputs) ? (resource.provenance!.inputs as unknown[]).map(readRef) : [];
  const transform = resource.provenance?.transform as Record<string, unknown> | undefined;
  return { total, missingX, missingY, left: inputs[0] ?? null, right: inputs[1] ?? null, leftField: typeof transform?.leftField === 'string' ? transform.leftField : 'x', rightField: typeof transform?.rightField === 'string' ? transform.rightField : 'y', join: typeof transform?.join === 'string' ? transform.join : null };
}
