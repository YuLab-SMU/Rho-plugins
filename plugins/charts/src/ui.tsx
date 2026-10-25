import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

// A scatter of two declared numeric columns of one table version. Every point carries its
// stable entity key, so a selection made here and a selection made in a table of the same
// version are the same selection: the host assigns both views one shared channel, and each
// view applies what the other wrote without publishing it again.
export interface UiClient { call(method: string, input: any): Promise<any> }
type Ref = { id: string; version: string };
type Point = { key: string; x: number | null; y: number | null };
type Plot = { points: Point[]; originalPoints: number; downsampled: boolean; spec: { entityKey: string; namespace: string; x: string; y: string } };
export interface SharedSelection { version: number; resource: Ref | null; entities: string[] }
export interface ScatterViewProps {
  view: { id: string; props: Record<string, unknown>; bindings: Record<string, unknown> };
  projectId: string;
  client: UiClient;
  // False when this session may read points but not share a selection.
  selectable?: boolean;
  // The channel the host assigns; views of one table version share it.
  selectionScope?: { kind: 'shared'; id: string };
  // That channel as the host last read it.
  sharedSelection?: SharedSelection | null;
}
// Margins in pixels; the plot takes the rest of whatever space the view is given.
const margin = { left: 56, right: 16, top: 12, bottom: 40 };
const format = (value: number) => Math.abs(value) >= 1e4 || (value !== 0 && Math.abs(value) < 1e-2) ? value.toExponential(1) : String(Math.round(value * 100) / 100);
function extent(values: number[]): [number, number] {
  const low = Math.min(...values), high = Math.max(...values);
  return low === high ? [low - 1, high + 1] : [low, high];
}

export function ScatterView({ view, projectId, client, selectable = true, selectionScope, sharedSelection }: ScatterViewProps) {
  const resource = view.bindings.data as Ref | undefined;
  const x = String(view.props.x ?? ''), y = String(view.props.y ?? '');
  const scope = selectionScope ?? { kind: 'shared' as const, id: view.id };
  const [plot, setPlot] = useState<Plot | null>(null), [failure, setFailure] = useState(''), [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const known = useRef<number | null>(null), queue = useRef<Promise<unknown>>(Promise.resolve());
  const frame = useRef<HTMLDivElement | null>(null), [size, setSize] = useState({ width: 640, height: 400 });
  useEffect(() => {
    const element = frame.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => { const { width, height } = entry!.contentRect; if (width > 0 && height > 0) setSize({ width: Math.round(width), height: Math.round(height) }); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [!!plot]);
  const box = { ...margin, width: Math.max(size.width, margin.left + margin.right + 40), height: Math.max(size.height, margin.top + margin.bottom + 40) };
  useEffect(() => {
    if (!resource) return;
    let current = true;
    client.call('data.plot', { projectId, resource, x, y }).then(value => { if (current) { setPlot(value); setFailure(''); } }, (error: any) => { if (current) setFailure(error?.error?.message ?? error?.message ?? 'Points could not be read.'); });
    return () => { current = false; };
  }, [client, projectId, resource?.id, resource?.version, x, y, attempt]);
  // Apply what another view of this version wrote; a write of our own is already shown.
  useEffect(() => {
    if (!sharedSelection || sharedSelection.version === known.current) return;
    known.current = sharedSelection.version;
    const same = sharedSelection.resource?.id === resource?.id && sharedSelection.resource?.version === resource?.version;
    setChosen(new Set(same ? sharedSelection.entities : []));
  }, [sharedSelection?.version, resource?.id, resource?.version]);
  function publish(next: Set<string>) {
    setChosen(next);
    if (!selectable || !resource) return;
    const entities = [...next];
    queue.current = queue.current.catch(() => undefined).then(async () => {
      const expectedVersion = known.current ?? (await client.call('interaction.selection.read', { projectId, scope })).version;
      const result = await client.call('interaction.selection.set', { projectId, scope, expectedVersion, changeId: 'chart-' + globalThis.crypto.randomUUID(), selection: entities.length ? { resource, entities } : null });
      known.current = result.version; setFailure('');
    }).catch(() => { known.current = null; setFailure('The shared selection could not be confirmed. Your picked points are kept here.'); });
  }
  const placed = useMemo(() => {
    if (!plot) return null;
    const complete = plot.points.filter((p): p is Point & { x: number; y: number } => typeof p.x === 'number' && typeof p.y === 'number');
    if (!complete.length) return { complete, missing: plot.points.length, sx: () => 0, sy: () => 0, xs: [0, 1] as [number, number], ys: [0, 1] as [number, number] };
    const xs = extent(complete.map(p => p.x)), ys = extent(complete.map(p => p.y));
    const sx = (v: number) => box.left + (v - xs[0]) / (xs[1] - xs[0]) * (box.width - box.left - box.right);
    const sy = (v: number) => box.height - box.bottom - (v - ys[0]) / (ys[1] - ys[0]) * (box.height - box.top - box.bottom);
    return { complete, missing: plot.points.length - complete.length, sx, sy, xs, ys };
  }, [plot, box.width, box.height]);
  if (!resource) return <p style={{ padding: 12, fontSize: 12 }}>This view has no table.</p>;
  const bar: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 12px', fontSize: 12, borderBottom: '1px solid var(--color-divider, #e8ebe9)', flexWrap: 'wrap' };
  const control: CSSProperties = { font: 'inherit', fontSize: 12, border: '1px solid var(--color-control-border, #c3c9c6)', borderRadius: 6, padding: '2px 8px', background: 'var(--color-surface, #fff)', color: 'inherit' };
  const count = !plot ? 'Reading points…' : plot.downsampled ? `${plot.points.length.toLocaleString()} of ${plot.originalPoints.toLocaleString()} points, every ${Math.ceil(plot.originalPoints / plot.points.length)}th` : `${plot.points.length.toLocaleString()} points`;
  const any = chosen.size > 0;
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
    <div style={bar} role="toolbar" aria-label="Scatter">
      <span>{count}{placed?.missing ? ` · ${placed.missing} without both values` : ''}</span>
      {any && <span>· {chosen.size} selected</span>}
      {any && selectable && <button style={control} onClick={() => publish(new Set())}>Clear selection</button>}
    </div>
    {failure && <div role="alert" style={{ ...bar, color: 'var(--color-failed, #b23b37)' }}>{failure}<button style={control} onClick={() => setAttempt(n => n + 1)}>Try again</button></div>}
    {placed && <div ref={frame} style={{ flex: 1, minHeight: 0, position: 'relative' }}><svg viewBox={`0 0 ${box.width} ${box.height}`} width={box.width} height={box.height} style={{ position: 'absolute', inset: 0, display: 'block' }} role="img"
      aria-label={`${y} by ${x}: ${placed.complete.length} points${any ? `, ${chosen.size} selected` : ''}`}>
      <line x1={box.left} y1={box.height - box.bottom} x2={box.width - box.right} y2={box.height - box.bottom} stroke="var(--color-control-border, #c3c9c6)" />
      <line x1={box.left} y1={box.top} x2={box.left} y2={box.height - box.bottom} stroke="var(--color-control-border, #c3c9c6)" />
      {placed.complete.length > 0 && <g fontSize={11} fill="var(--color-muted, #545e63)">
        <text x={box.left} y={box.height - box.bottom + 16} textAnchor="start">{format(placed.xs[0])}</text>
        <text x={box.width - box.right} y={box.height - box.bottom + 16} textAnchor="end">{format(placed.xs[1])}</text>
        <text x={box.left - 6} y={box.height - box.bottom} textAnchor="end">{format(placed.ys[0])}</text>
        <text x={box.left - 6} y={box.top + 10} textAnchor="end">{format(placed.ys[1])}</text>
        <text x={(box.left + box.width - box.right) / 2} y={box.height - 6} textAnchor="middle">{x}</text>
        <text x={14} y={(box.top + box.height - box.bottom) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(box.top + box.height - box.bottom) / 2})`}>{y}</text>
      </g>}
      {placed.complete.map(p => {
        const on = chosen.has(p.key);
        return <g key={p.key} data-entity={p.key} data-selected={on || undefined} style={{ cursor: selectable ? 'pointer' : 'default' }}
          onClick={() => { if (!selectable) return; const next = new Set(chosen); if (on) next.delete(p.key); else next.add(p.key); publish(next); }}>
          <circle cx={placed.sx(p.x)} cy={placed.sy(p.y)} r={9} fill="transparent" />
          <circle cx={placed.sx(p.x)} cy={placed.sy(p.y)} r={on ? 5.5 : 3.5} fill={on ? 'var(--color-accent-strong, #2347b8)' : 'var(--color-accent, #3a68f0)'} fillOpacity={any && !on ? 0.3 : 0.8} stroke={on ? 'var(--color-surface, #fff)' : 'none'} strokeWidth={1.5} />
        </g>;
      })}
    </svg></div>}
  </div>;
}

export const scatterEntry = {
  component: 'rho.scatter', componentVersion: '0.2.0', owner: 'rho-plugins.scatter', package: '@rho-workspace/plugin-charts',
  bindings: { data: 'resource' as const },
  requiredOperations: ['data.plot'],
  selection: ['table-entities' as const],
  View: ScatterView,
};
