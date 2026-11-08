// A figure record as an R describer wrote it (r/figures.R): the picture as SVG whose drawn
// elements name the marks they stand for, each layer's built marks, and the rows of the plot's
// data those marks came from. Nothing here interprets a plot; it reads what was bound.
//
// A mark is named "L.M": layer L of the figure (counted from 0 over every plot of a
// composition) and built row M of that layer (from 0). A drawn element of unit U names itself
// data-rho="U.E": element E of the unit stands for the marks the unit lists at E (one row, or a
// group such as one box or one line).

export type Cell = string | number | boolean | null;
export interface FigureColumn { name: string; type: 'number' | 'integer' | 'text' | 'logical' | 'list'; values: Cell[] }
export interface FigureSource { id: string; rows: number; columnsTotal: number; key: string | null; index: number[]; columns: FigureColumn[] }
export interface FigureLayer {
  plot: number; layer: number; geom: string; stat: string; position: string; mapping: Record<string, string>;
  constants: Record<string, string | number>; source: string | null; marks: number; units: number; bound: 'mark' | 'group' | 'none'; unbound?: string[]; notes?: string[];
}
export interface FigureMarks { panel: number[]; group: number[]; row: number[] | null; columns: FigureColumn[] }
export interface FigureUnit { layer: number; panel: number; marks: number[][] }
export interface FigureScale { aesthetic: string; title: string; breaks: string[]; values: string[] }
export interface FigurePlot {
  plot: number; title?: string | null; subtitle?: string | null; caption?: string | null; labels: Record<string, string>;
  panels: Array<{ panel: number; facets: Record<string, string> }>; facet: string; coord: string; scales: FigureScale[];
  positions: Partial<Record<'x' | 'y', { discrete: boolean; levels?: string[]; range?: number[] }>>;
}
export interface FigureRecord {
  schema: 'rho.figure/1'; describer: string; size: { width: number; height: number; units: string }; versions: Record<string, string>; seconds: number;
  svg: string; problems: string[]; units: FigureUnit[];
  figure: { kind: string; title?: string | null; plots: FigurePlot[]; layers: FigureLayer[] };
  marks: FigureMarks[]; sources: FigureSource[];
}

// jsonlite writes a list or an empty named list as [], and some vectors of one as a scalar.
const list = <T>(v: unknown): T[] => Array.isArray(v) ? v as T[] : v === null || v === undefined ? [] : [v as T];
const named = <T>(v: unknown): Record<string, T> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, T> : {};
const columns = (v: unknown): FigureColumn[] => list<any>(v).map(c => ({ name: String(c.name), type: c.type, values: list<Cell>(c.values) }));

export function parseRecord(bytes: Uint8Array | string): FigureRecord {
  const raw = JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes));
  if (raw?.schema !== 'rho.figure/1' || typeof raw.svg !== 'string') throw new Error('This is not a figure record this version reads.');
  return {
    ...raw, problems: list<string>(raw.problems),
    units: list<any>(raw.units).map(u => ({ layer: u.layer, panel: u.panel, marks: list<unknown>(u.marks).map(m => list<number>(m)) })),
    figure: {
      ...raw.figure,
      plots: list<any>(raw.figure?.plots).map(p => ({ ...p, labels: named<string>(p.labels), panels: list<any>(p.panels).map(x => ({ panel: x.panel, facets: named<string>(x.facets) })),
        scales: list<any>(p.scales).map(s => ({ ...s, breaks: list<string>(s.breaks), values: list<string>(s.values) })), positions: named<any>(p.positions) })),
      layers: list<any>(raw.figure?.layers).map(l => ({ ...l, mapping: named<string>(l.mapping), constants: named<string | number>(l.constants), unbound: l.unbound ? list<string>(l.unbound) : undefined, notes: l.notes ? list<string>(l.notes) : undefined })),
    },
    marks: list<any>(raw.marks).map(m => ({ panel: list<number>(m.panel), group: list<number>(m.group), row: m.row === null || m.row === undefined ? null : list<number>(m.row), columns: columns(m.columns) })),
    sources: list<any>(raw.sources).map(s => ({ ...s, key: s.key ?? null, index: list<number>(s.index), columns: columns(s.columns) })),
  };
}

export interface MarkRef { layer: number; mark: number }
export const markName = (m: MarkRef) => `${m.layer}.${m.mark}`;
export function parseMark(name: string): MarkRef | null {
  const m = /^(\d{1,4})\.(\d{1,7})$/.exec(name);
  return m ? { layer: Number(m[1]), mark: Number(m[2]) } : null;
}
// The marks one drawn element stands for.
export function elementMarks(record: FigureRecord, attribute: string): MarkRef[] {
  const m = /^(\d+)\.(\d+)$/.exec(attribute);
  if (!m) return [];
  const unit = record.units[Number(m[1])];
  return (unit?.marks[Number(m[2])] ?? []).map(mark => ({ layer: unit!.layer, mark }));
}

// The source row a mark came from, as its position in the source and in the kept rows.
function sourceRow(record: FigureRecord, ref: MarkRef) {
  const layer = record.figure.layers[ref.layer], marks = record.marks[ref.layer];
  if (!layer?.source || !marks?.row) return null;
  const source = record.sources.find(s => s.id === layer.source);
  const row = marks.row[ref.mark];
  if (!source || row === undefined) return null;
  // index is sorted: the rows of the source that some mark stands for.
  let lo = 0, hi = source.index.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1, v = source.index[mid]!; if (v === row) return { source, row, at: mid }; if (v < row) lo = mid + 1; else hi = mid - 1; }
  return { source, row, at: -1 };
}
const valueAt = (column: FigureColumn, at: number) => at >= 0 ? column.values[at] ?? null : null;

// What a mark shows: its layer, its panel's facets, its own built values (a computed count, a box's
// quartiles, a position on a discrete axis by its level) and, when it came from a row of the
// plot's data, that row.
export interface MarkRow {
  mark: string; layer: number; geom: string; plot: number; facets: Record<string, string>;
  built: Record<string, Cell>; source?: string; row?: number; key?: { column: string; value: Cell }; values?: Record<string, Cell>;
}
export function markRow(record: FigureRecord, ref: MarkRef): MarkRow | null {
  const layer = record.figure.layers[ref.layer], marks = record.marks[ref.layer];
  if (!layer || !marks || ref.mark < 0 || ref.mark >= layer.marks) return null;
  const plot = record.figure.plots.find(p => p.plot === layer.plot);
  const panel = marks.panel[ref.mark];
  const facets = plot?.panels.find(p => p.panel === panel)?.facets ?? {};
  const built: Record<string, Cell> = {};
  for (const c of marks.columns) {
    let v = c.values[ref.mark] ?? null;
    const axis = c.name === 'x' || c.name === 'y' ? plot?.positions[c.name] : undefined;
    if (axis?.discrete && typeof v === 'number' && Number.isInteger(v) && axis.levels?.[v - 1] !== undefined) v = axis.levels[v - 1]!;
    built[c.name] = v;
  }
  const out: MarkRow = { mark: markName(ref), layer: ref.layer, geom: layer.geom, plot: layer.plot, facets, built };
  const found = sourceRow(record, ref);
  if (found) {
    out.source = found.source.id; out.row = found.row;
    out.values = Object.fromEntries(found.source.columns.map(c => [c.name, valueAt(c, found.at)]));
    if (found.source.key) out.key = { column: found.source.key, value: out.values[found.source.key] ?? null };
  }
  return out;
}

// Marks whose row (or built value) satisfies a condition: column op value. A column of the source
// row is used when the mark has one, else the mark's own built value.
export type Op = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'in' | 'contains';
export interface Where { column: string; op: Op; value: Cell | Cell[]; layer?: number }
export function matchMarks(record: FigureRecord, where: Where[], maximum: number) {
  const test = (v: Cell, w: Where) => {
    if (w.op === 'in') return Array.isArray(w.value) && w.value.some(x => x === v || String(x) === String(v));
    const target = w.value as Cell;
    if (w.op === 'contains') return v !== null && String(v).toLowerCase().includes(String(target).toLowerCase());
    if (w.op === 'eq') return v === target || (v !== null && target !== null && String(v) === String(target));
    if (w.op === 'ne') return !(v === target || (v !== null && target !== null && String(v) === String(target)));
    if (v === null || target === null) return false;
    const a = typeof v === 'number' ? v : Number(v), b = typeof target === 'number' ? target : Number(target);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return w.op === 'lt' ? a < b : w.op === 'le' ? a <= b : w.op === 'gt' ? a > b : a >= b;
  };
  const found: MarkRef[] = []; let total = 0;
  const layers = record.figure.layers.map((_, i) => i).filter(i => where.every(w => w.layer === undefined || w.layer === i));
  for (const layer of layers) {
    const n = record.figure.layers[layer]!.marks;
    for (let mark = 0; mark < n; mark++) {
      const row = markRow(record, { layer, mark });
      if (!row) continue;
      const read = (column: string): Cell | undefined => row.values && column in row.values ? row.values[column] : column in row.built ? row.built[column] : undefined;
      if (where.every(w => { const v = read(w.column); return v !== undefined && test(v, w); })) { total++; if (found.length < maximum) found.push({ layer, mark }); }
    }
  }
  return { marks: found, total };
}

// The figure as an Agent reads it first: what was drawn, from which data, and what was not bound.
export function figureSummary(record: FigureRecord) {
  return {
    describer: record.describer, kind: record.figure.kind, title: record.figure.title ?? null, size: record.size, versions: record.versions,
    plots: record.figure.plots.map(p => ({ plot: p.plot, title: p.title ?? null, subtitle: p.subtitle ?? null, labels: p.labels, facet: p.facet, coord: p.coord,
      panels: p.panels.length, facets: p.panels.length > 1 ? p.panels.slice(0, 24).map(x => x.facets) : undefined,
      scales: p.scales.map(s => ({ aesthetic: s.aesthetic, title: s.title, breaks: s.breaks.slice(0, 24) })),
      positions: Object.fromEntries(Object.entries(p.positions).map(([k, v]) => [k, v?.discrete ? { discrete: true, levels: v.levels?.slice(0, 48), levelCount: v.levels?.length } : { discrete: false, range: v?.range }])) })),
    layers: record.figure.layers.map((l, i) => ({ layer: i, plot: l.plot, geom: l.geom, stat: l.stat, position: l.position, mapping: l.mapping, constants: l.constants,
      source: l.source, marks: l.marks, bound: l.bound, ...(l.unbound?.length ? { notBound: l.unbound } : {}), ...(l.notes?.length ? { notes: l.notes } : {}),
      builtColumns: record.marks[i]?.columns.map(c => c.name) ?? [] })),
    sources: record.sources.map(s => ({ id: s.id, rows: s.rows, rowsWithMarks: s.index.length, key: s.key, columns: s.columns.map(c => ({ name: c.name, type: c.type })), columnsTotal: s.columnsTotal })),
    problems: record.problems,
  };
}
