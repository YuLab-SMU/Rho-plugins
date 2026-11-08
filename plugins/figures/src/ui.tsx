// The browser entry: a plot whose marks are bound to their rows. Pointing at a mark reads its
// row; a click selects it (Shift or ⌘/Ctrl adds), a drag selects the marks it crosses, Esc clears.
// The selected rows show below the plot, and Ask carries them to the Agent. Marks an Agent pointed
// to show with its note. The page that shows a figure supplies the client and, optionally, how to
// name a principal and what Ask does.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { elementMarks, markName, markRow, parseMark, parseRecord, type Cell, type FigureRecord, type MarkRow } from './record.js';
import { ensureFigureStyles } from './ui-styles.js';

export interface UiClient { call(method: string, input: any, signal?: AbortSignal): Promise<any> }
export interface FigureSelection { selectionId: string; by: string; at: string; note: string; count: number; layers: Array<{ layer: number; geom: string; marks: number }>; marks?: string[] }
// A figure saved to a project file, named by the SHA-256 of the bytes shown, with the file's path
// where the page knows it (else the path the cell saved it at is used).
export interface FigureFile { path?: string; sha256: string }
// What Ask hands the page: the kept selection, named so a message can carry it, with the figure as
// it was named: a cell's plot or a saved file.
export interface FigureAsk { selectionId: string; cellId?: string; plot?: number; file?: FigureFile; count: number; label: string }
export interface FigureProps {
  client: UiClient; projectId: string;
  // A plot a Notebook cell drew, or a file a cell saved a plot as. A file that no cell saved with
  // these bytes shows its fallback and says nothing: most pictures are not saved figures.
  cellId?: string; plot?: number; file?: FigureFile;
  // The picture's size in device pixels (drawn at twice the size it is shown at); a saved file's
  // figure takes the width it is given unless told.
  width?: number; height?: number; label: string;
  // A short name for the plot where Ask mentions it: "R cell 4, plot 1".
  name?: string;
  // Fill the view instead of the figure's own width.
  fit?: boolean;
  // Shown while the record is read and when it cannot be.
  fallback?: ReactNode;
  // The page's event cursor: a new one rereads the marks people and Agents pointed to.
  cursor?: number;
  author?: (by: string) => { name: string; mine: boolean };
  onAsk?: (ask: FigureAsk) => void;
}
export const figureViewLimits = { tableRows: 50, tableColumns: 8, tipColumns: 6, brushPx: 4, cachedRecords: 12 };

interface Loaded { record: FigureRecord; selections: FigureSelection[]; svg: SVGSVGElement }
const records = new Map<string, Promise<{ record: FigureRecord; selections: FigureSelection[] }>>();
type Ref = { cellId?: string; plot?: number; path?: string; sha256?: string };
const refOf = (cellId?: string, plot?: number, file?: FigureFile): Ref => file ? { path: file.path, sha256: file.sha256 } : { cellId, plot };
const refKey = (ref: Ref) => ref.sha256 ? 'file:' + ref.sha256 : ref.cellId + ':' + ref.plot;
function readView(client: UiClient, projectId: string, ref: Ref) {
  const key = projectId + ':' + refKey(ref);
  let pending = records.get(key);
  if (!pending) {
    pending = client.call('figure.read', { projectId, ...ref, form: 'view' }).then(v => ({ record: parseRecord(JSON.stringify(v.record)), selections: v.selections ?? [] }));
    records.set(key, pending); pending.catch(() => records.delete(key));
    while (records.size > figureViewLimits.cachedRecords) records.delete(records.keys().next().value!);
  }
  return pending;
}

// The R device's SVG, as elements this page can hold: no scripts, handlers or outside links.
function svgElement(text: string): SVGSVGElement {
  const svgNs = 'http://www.w3.org/2000/svg';
  const head = text.slice(0, text.indexOf('>') + 1);
  const doc = new DOMParser().parseFromString(/xmlns=/.test(head) ? text : text.replace(/<svg\b/, `<svg xmlns="${svgNs}"`), 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.localName !== 'svg' || svg.namespaceURI !== svgNs || doc.querySelector('parsererror')) throw new Error('The figure\'s picture could not be read.');
  doc.querySelectorAll('script, foreignObject').forEach(e => e.remove());
  doc.querySelectorAll('*').forEach(e => {
    for (const a of [...e.attributes]) {
      if (/^on/i.test(a.name)) e.removeAttribute(a.name);
      if (/href$/i.test(a.name) && !/^(#|data:image\/)/.test(a.value)) e.removeAttribute(a.name);
    }
  });
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.setAttribute('role', 'img');
  return document.importNode(svg, true) as unknown as SVGSVGElement;
}

const fmt = (v: Cell): string => {
  if (v === null || v === undefined) return 'NA';
  if (typeof v === 'number') { const a = Math.abs(v); return a !== 0 && (a >= 1e5 || a < 1e-3) ? v.toExponential(2) : Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4))); }
  return String(v);
};
// The source columns a layer's mapping names, in mapping order: what a reader looks for first.
function mappedColumns(record: FigureRecord, layer: number, columns: string[]) {
  const mapping = Object.values(record.figure.layers[layer]?.mapping ?? {});
  return columns.filter(c => mapping.some(expr => new RegExp(`(^|[^A-Za-z0-9_.])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_.])`).test(expr)));
}
function rowFields(record: FigureRecord, row: MarkRow, max: number): Array<[string, Cell]> {
  if (row.values) {
    // Columns a package adds for its own drawing (.ggtangle_id) are left to the Agent. A value the
    // layer maps that its row does not hold (a heatmap cell's column and value) follows the key.
    const names = Object.keys(row.values).filter(n => n === '.rownames' || !n.startsWith('.')), first = mappedColumns(record, row.layer, names);
    const own = Object.values(record.figure.layers[row.layer]?.mapping ?? {}).filter(n => n in row.built && !(n in row.values!) && row.built[n] !== row.key?.value);
    const order = [...(row.key ? [row.key.column] : []), ...first, ...names].filter((n, i, a) => a.indexOf(n) === i);
    const held = (n: string): [string, Cell] => [n === '.rownames' ? 'row' : n, row.values![n] ?? null];
    return [...order.slice(0, row.key ? 1 : 0).map(held), ...own.map((n): [string, Cell] => [n, row.built[n] ?? null]), ...order.slice(row.key ? 1 : 0).map(held)].slice(0, max);
  }
  const preferred = ['label', 'x', 'y', 'count', 'density', 'ymin', 'lower', 'middle', 'upper', 'ymax', 'xmin', 'xmax', 'fill', 'colour'];
  const names = Object.keys(row.built).sort((a, b) => (preferred.indexOf(a) + 1 || 99) - (preferred.indexOf(b) + 1 || 99));
  return names.slice(0, max).map(n => [n, row.built[n] ?? null]);
}
// A mark is titled by its row's key (a gene, a barcode; a number key with its column's name), else
// by its label; a row with neither is told by its fields alone.
const title = (row: MarkRow) => row.key ? (typeof row.key.value === 'number' ? `${row.key.column} ${fmt(row.key.value)}` : fmt(row.key.value))
  : row.built.label !== undefined && row.built.label !== null ? fmt(row.built.label) : null;
const tileGeom = /^(heatmap|tile|raster|image)$/i;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : /(s|x|sh|ch)$/.test(word) ? 'es' : 's'}`;
const markWord = (geom: string) => /text|label|repel/i.test(geom) ? 'label' : /point|circle/i.test(geom) ? 'point' : /heatmap|cell/i.test(geom) ? 'cell' : /bar|col|histogram|rect|tile/i.test(geom) ? 'bar' : /box/i.test(geom) ? 'box' : /line|path|smooth|step/i.test(geom) ? 'line' : /violin|density|area|ribbon|polygon/i.test(geom) ? 'shape' : 'mark';

// Selected marks by layer, largest first. Layers that draw the same keyed rows (every point, a
// highlighted subset, its labels) are one group: told once, by the first layer's word, with its
// rows listed once and the other layers named.
interface MarkGroup { layer: number; rows: MarkRow[]; also: number[]; keys: string | null }
function groupsOf(record: FigureRecord, marks: string[]): MarkGroup[] {
  const byLayer = new Map<number, MarkRow[]>();
  for (const m of marks) { const r = markRow(record, parseMark(m)!); if (r) byLayer.set(r.layer, [...(byLayer.get(r.layer) ?? []), r]); }
  const groups: MarkGroup[] = [];
  for (const [layer, rows] of [...byLayer].sort((a, b) => b[1].length - a[1].length)) {
    const keys = rows.every(r => r.key) ? rows.map(r => String(r.key!.value)).sort().join('\u0000') : null;
    const same = keys !== null && groups.find(g => g.keys === keys);
    if (same) same.also.push(layer); else groups.push({ layer, rows, also: [], keys });
  }
  return groups;
}
// Groups of different rows drawn the same way are counted together: "7 points", not "5 points, 2 points".
function groupsText(record: FigureRecord, groups: MarkGroup[]) {
  const counts = new Map<string, number>();
  for (const g of groups) { const word = markWord(record.figure.layers[g.layer]!.geom); counts.set(word, (counts.get(word) ?? 0) + g.rows.length); }
  return [...counts].map(([word, n]) => plural(n, word)).join(', ');
}

export function SemanticFigure({ client, projectId, cellId, plot, file, width = file ? undefined : 1008, label, name, fit, fallback, cursor, author, onAsk }: FigureProps) {
  ensureFigureStyles();
  const ref = useMemo(() => refOf(cellId, plot, file), [cellId, plot, file?.path, file?.sha256]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = refKey(ref);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState('');
  const [selections, setSelections] = useState<FigureSelection[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState<FigureSelection | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; rows: MarkRow[]; extra: number } | null>(null);
  const [brush, setBrush] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const [arrived, setArrived] = useState(false);
  const canvas = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), waiting = useRef<HTMLElement>(null);
  // A record is read once the figure comes near the screen: a long Notebook reads only those seen.
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (near || !waiting.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) setNear(true); }, { rootMargin: '400px' });
    observer.observe(waiting.current);
    return () => observer.disconnect();
  }, [near]);
  const seen = useRef<Set<string> | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; add: boolean; on: Element | null } | null>(null);
  const show = (s: FigureSelection) => { setSelected(new Set(s.marks ?? [])); setFrom(s); };

  useEffect(() => {
    if (!near) return;
    let live = true;
    setLoaded(null); setProblem(''); setSelected(new Set()); setFrom(null); seen.current = null;
    readView(client, projectId, ref).then(v => {
      if (!live) return;
      try { setLoaded({ record: v.record, selections: v.selections, svg: svgElement(v.record.svg) }); setSelections(v.selections); }
      catch (e) { setProblem((e as Error).message); }
    }, e => { if (live && !(ref.sha256 && e?.error?.kind === 'not_found' && !e?.error?.details?.saved)) setProblem(e?.error?.message ?? e?.message ?? 'The figure could not be read.'); });
    return () => { live = false; };
  }, [client, projectId, key, near]); // eslint-disable-line react-hooks/exhaustive-deps

  // Marks people and Agents pointed to arrive with the page's events.
  useEffect(() => {
    if (!loaded || cursor === undefined) return;
    let live = true;
    client.call('figure.read', { projectId, ...ref, form: 'selections' }).then(v => { if (live) setSelections(v.selections ?? []); }, () => {});
    return () => { live = false; };
  }, [cursor, loaded, client, projectId, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each drawn element and the marks it stands for.
  const elements = useMemo(() => {
    if (!loaded) return [] as Array<{ el: Element; marks: string[] }>;
    // A cell of a heatmap or a tile says its value by its colour: it keeps it while others are
    // selected, and a selection outlines it.
    const tiles = new Set(loaded.record.figure.layers.flatMap((l, i) => tileGeom.test(l.geom) ? [i] : []));
    return [...loaded.svg.querySelectorAll('[data-rho]')].map(el => {
      const refs = elementMarks(loaded.record, el.getAttribute('data-rho')!);
      if (refs.some(r => tiles.has(r.layer))) el.classList.add('fig-tile');
      return { el, marks: refs.map(markName) };
    });
  }, [loaded]);
  const byElement = useMemo(() => new Map(elements.map(e => [e.el, e.marks])), [elements]);

  useEffect(() => {
    if (!loaded || !host.current) return;
    host.current.replaceChildren(loaded.svg);
    loaded.svg.setAttribute('aria-label', label);
  }, [loaded, label]);

  // An Agent's new marks show at once when the person has nothing selected.
  const agentMarks = selections.filter(s => s.marks?.length && !(author?.(s.by).mine ?? false));
  useEffect(() => {
    if (!loaded) return;
    const ids = new Set(agentMarks.map(s => s.selectionId));
    if (seen.current) {
      const fresh = agentMarks.find(s => !seen.current!.has(s.selectionId));
      if (fresh && selected.size === 0) { show(fresh); setArrived(true); setTimeout(() => setArrived(false), 1000); }
    }
    seen.current = ids;
  }, [selections, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const { el, marks } of elements) el.classList.toggle('fig-on', marks.some(m => selected.has(m)));
  }, [elements, selected]);

  if (problem || !loaded) return <figure ref={waiting} className={'fig' + (fit ? ' fit' : '')}>
    {fallback}
    {problem && <p className="fig-note">The plot shows as a picture: {problem}</p>}
  </figure>;
  const { record } = loaded;

  const choose = (marks: string[], add: boolean) => {
    setFrom(null);
    setSelected(previous => {
      if (!add) return new Set(marks);
      const next = new Set(previous), all = marks.every(m => next.has(m));
      for (const m of marks) if (all) next.delete(m); else next.add(m);
      return next;
    });
  };
  const at = (event: { clientX: number; clientY: number }) => { const box = canvas.current!.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top }; };
  const markAt = (target: EventTarget | null) => (target as Element | null)?.closest?.('[data-rho]') ?? null;
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const p = at(event);
    drag.current = { ...p, moved: false, add: event.shiftKey || event.metaKey || event.ctrlKey, on: markAt(event.target) };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const p = at(event), d = drag.current;
    if (d) {
      if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) < figureViewLimits.brushPx) return;
      d.moved = true; setTip(null);
      setBrush({ x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) });
      return;
    }
    const el = markAt(document.elementFromPoint(event.clientX, event.clientY));
    canvas.current?.querySelector('.fig-hover')?.classList.remove('fig-hover');
    if (!el) { setTip(null); return; }
    el.classList.add('fig-hover');
    const marks = byElement.get(el) ?? [];
    const rows = marks.slice(0, 1).map(m => markRow(record, parseMark(m)!)).filter((r): r is MarkRow => !!r);
    setTip({ x: p.x, y: p.y, rows, extra: marks.length - rows.length });
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const d = drag.current; drag.current = null; setBrush(null);
    if (!d) return;
    if (d.moved) {
      const box = canvas.current!.getBoundingClientRect(), p = at(event);
      const left = box.left + Math.min(d.x, p.x), right = box.left + Math.max(d.x, p.x), top = box.top + Math.min(d.y, p.y), bottom = box.top + Math.max(d.y, p.y);
      const hit: string[] = [];
      for (const { el, marks } of elements) {
        const r = el.getBoundingClientRect();
        if (r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom) hit.push(...marks);
      }
      choose([...new Set(hit)], d.add);
    } else if (d.on) choose(byElement.get(d.on) ?? [], d.add);
    else if (!d.add) { setSelected(new Set()); setFrom(null); }
  };
  const onLeave = () => { canvas.current?.querySelector('.fig-hover')?.classList.remove('fig-hover'); setTip(null); };

  const ask = async () => {
    if (!onAsk || !selected.size) return;
    setAsking(true);
    try {
      const { selection } = await client.call('figure.select', { projectId, ...ref, marks: [...selected].slice(0, 5000), changeId: 'ask-' + crypto.randomUUID() });
      onAsk({ selectionId: selection.selectionId, ...(file ? { file } : { cellId, plot }), count: selection.count, label: `${groupsText(record, groupsOf(record, selection.marks ?? [...selected]))} · ${name ?? label}` });
    } catch (e: any) { setProblem(e?.error?.message ?? e?.message ?? 'The selection could not be kept.'); }
    finally { setAsking(false); }
  };

  const bound = record.figure.layers.filter(l => l.bound !== 'none').length;
  const agentShown = !!from && !(author?.(from.by).mine ?? false);
  return <figure className={'fig' + (fit ? ' fit' : '')} style={fit || !width ? undefined : { maxWidth: Math.round(width / 2) }}
    onKeyDown={event => { if (event.key === 'Escape' && selected.size) { event.stopPropagation(); setSelected(new Set()); setFrom(null); } }}>
    {agentMarks.length > 0 && <div className="fig-marks" role="group" aria-label="Marks the Agent pointed to">
      {agentMarks.slice(0, 4).map(s => <button key={s.selectionId} type="button" className="fig-mark-chip" aria-pressed={from?.selectionId === s.selectionId}
        title={s.note || undefined} onClick={() => from?.selectionId === s.selectionId ? (setSelected(new Set()), setFrom(null)) : show(s)}>
        <strong>{author?.(s.by).name ?? 'Agent'}</strong><span>{s.note || plural(s.count, 'mark')}</span>
      </button>)}
    </div>}
    <div ref={canvas} className={'fig-canvas' + (selected.size ? ' has-sel' : '') + (agentShown ? ' agent' : '') + (arrived ? ' arrived' : '')} tabIndex={0}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; setBrush(null); }} onPointerLeave={onLeave}
      aria-describedby={undefined}>
      <div ref={host} style={fit ? { width: '100%', height: '100%' } : undefined} />
      {brush && <div className="fig-brush" style={{ left: brush.x, top: brush.y, width: brush.w, height: brush.h }} />}
      {tip && tip.rows[0] && <Tip record={record} tip={tip} box={canvas.current?.getBoundingClientRect()} />}
    </div>
    {selected.size > 0 ? <Selected record={record} marks={[...selected]} from={from} who={from ? author?.(from.by).name ?? 'Agent' : undefined} agent={agentShown}
      asking={asking} onAsk={onAsk ? ask : undefined} onClear={() => { setSelected(new Set()); setFrom(null); }} />
      : <p className="fig-hint">{bound ? <>Point at a mark to read its row. <b>Click</b> or <b>drag</b> to select{onAsk ? ', then ask the Agent about the selection' : ''}.</> : 'Nothing in this plot could be bound to its rows.'}
        {record.problems.length > 0 && <> {record.problems.join(' ')}</>}</p>}
  </figure>;
}

function Tip({ record, tip, box }: { record: FigureRecord; tip: { x: number; y: number; rows: MarkRow[]; extra: number }; box?: DOMRect }) {
  const row = tip.rows[0]!, facets = Object.entries(row.facets).map(([k, v]) => `${k} ${v}`).join(', ');
  const heading = title(row);
  const fields = rowFields(record, row, figureViewLimits.tipColumns + (row.key ? 1 : 0)).filter(([name, value]) => value !== null && !(row.key && name === (row.key.column === '.rownames' ? 'row' : row.key.column)));
  const right = box && tip.x > box.width - 290, below = box && tip.y < 120;
  return <div className="fig-tip" style={{ left: right ? undefined : tip.x + 14, right: right ? (box!.width - tip.x + 14) : undefined, top: below ? tip.y + 16 : undefined, bottom: below ? undefined : (box ? box.height - tip.y + 12 : undefined) }}>
    <small>{row.geom}{facets ? ' · ' + facets : ''}{tip.extra > 0 ? ` · one of ${tip.extra + 1} rows` : ''}</small>
    {heading && <b>{heading}</b>}
    {fields.length > 0 && <dl>{fields.map(([name, value]) => <div key={name} style={{ display: 'contents' }}><dt>{name}</dt><dd>{fmt(value)}</dd></div>)}</dl>}
  </div>;
}

function Selected({ record, marks, from, who, agent, asking, onAsk, onClear }: {
  record: FigureRecord; marks: string[]; from: FigureSelection | null; who?: string; agent: boolean; asking: boolean; onAsk?: () => void; onClear: () => void;
}) {
  const groups = useMemo(() => groupsOf(record, marks), [record, marks]);
  const what = groupsText(record, groups);
  const origin = (layer: number) => { const l = record.figure.layers[layer]!; return l.source ? `rows of ${l.source === 'data' ? 'the plot\'s data' : l.source}` : `computed by ${l.stat.toLowerCase()}`; };
  const drawnAgain = groups.filter(g => g.also.length).map(g => `the ${plural(g.rows.length, markWord(record.figure.layers[g.layer]!.geom))} ${g.rows.length === 1 ? 'is' : 'are'} also drawn as ${g.also.map(l => markWord(record.figure.layers[l]!.geom) + 's').join(' and ')}`);
  return <section className={'fig-sel' + (agent ? ' agent' : '')} aria-label="Selected marks">
    <div className="fig-sel-head">
      <h4>{agent ? `${who} marked ${what}` : `${what} selected`}</h4>
      <p>{[...groups.map(g => origin(g.layer)).filter((t, i, a) => a.indexOf(t) === i), ...drawnAgain].join(' · ')}</p>
      <div className="fig-sel-actions">
        {onAsk && <button type="button" className="primary" disabled={asking} onClick={onAsk}>{asking ? 'Keeping…' : 'Ask the Agent'}</button>}
        <button type="button" className="secondary" onClick={onClear}>Clear</button>
      </div>
    </div>
    {from?.note && <p className="fig-sel-note">{from.note}</p>}
    {groups.slice(0, 3).map(g => <Rows key={g.layer} record={record} layer={g.layer} rows={g.rows} />)}
  </section>;
}

function Rows({ record, layer, rows }: { record: FigureRecord; layer: number; rows: MarkRow[] }) {
  const shown = rows.slice(0, figureViewLimits.tableRows);
  const fields = rowFields(record, shown[0]!, figureViewLimits.tableColumns).map(([name]) => name);
  const facets = [...new Set(shown.flatMap(r => Object.keys(r.facets)))].filter(f => !fields.includes(f));
  const columns = [...facets, ...fields].slice(0, Math.max(figureViewLimits.tableColumns, facets.length + 1));
  const value = (r: MarkRow, name: string) => { const held = name === 'row' ? '.rownames' : name;
    return facets.includes(name) ? r.facets[name] ?? null : r.values && held in r.values ? r.values[held] ?? null : r.built[name] ?? null; };
  return <>
    <div className="fig-table-wrap">
      <table className="fig-table">
        <thead><tr>{columns.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>{shown.map(r => <tr key={r.mark}>{columns.map(c => { const v = value(r, c); return <td key={c} className={typeof v === 'number' ? 'num' : undefined} title={v === null ? undefined : String(v)}>{fmt(v)}</td>; })}</tr>)}</tbody>
      </table>
    </div>
    {rows.length > shown.length && <p className="fig-more">{rows.length - shown.length} more {plural(rows.length - shown.length, markWord(record.figure.layers[layer]!.geom)).replace(/^\d+ /, '')} {rows.length - shown.length === 1 ? 'is' : 'are'} selected; the Agent reads them all.</p>}
  </>;
}
