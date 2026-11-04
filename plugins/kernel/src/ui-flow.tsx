import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { scriptFlow, scriptFlowLimits } from './script-flow.js';
import { graphPath, graphRows, scriptGraph, sessionGraph, type GraphNode, type Making, type ValueGraph } from './value-graph.js';
import { Icon } from './ui-icons.js';
import { at, Code, languageName, languages, latestSessions, useAuthors, useKernel, usePlot, versionOf, type Cell, type Session } from './ui-notebook.js';
import { whereOf } from './ui-servers.js';
import { withShell, type KernelShell, type UiClient, type UiSnapshot } from './ui-base.js';

type Language = Cell['language'];
// The protected resource is the reader's page: at most `nodes` values and files are drawn at once
// (those nearest the results first; the rest are counted), and the results bar names at most
// `results` results until the reader asks for the rest.
export const lineageViewLimits = { nodes: 80, results: 8, wide: 6 };

// A folder's path ends in /, and keeps it as its name.
const folder = (path: string) => path.endsWith('/');
const fileName = (path: string) => (path.replace(/\/$/, '').split('/').at(-1) ?? path) + (folder(path) ? '/' : '');
const isFile = (n: GraphNode) => n.id.startsWith('in:') || n.id.startsWith('out:');
// A long name keeps its first word and its end, where the files of one analysis differ.
const short = (name: string, most = 24) => {
  if (name.length <= most) return name;
  const head = (name.match(/^[^_\-. ]+/)?.[0] ?? name).slice(0, 10);
  let tail = name.slice(-(most - head.length - 1));
  const cut = tail.search(/[_\-. ]/);
  if (cut > 0 && cut < tail.length - 4) tail = tail.slice(cut);
  return head + '…' + tail;
};
const labelOf = (n: GraphNode) => short(isFile(n) ? fileName(n.name) : n.name);
// What a reader is told a node is: what the code says it is, else its name.
const titleOf = (n: GraphNode) => n.means ?? labelOf(n);
const plural = (count: number, one: string, many = one + 's') => `${count} ${count === 1 ? one : many}`;
const linesText = (m: Making) => m.from === m.to ? 'line ' + m.from : `lines ${m.from}–${m.to}`;
type Facts = Map<string, { type: string; size?: string | null; summary?: string | null }>;

// What is drawn: what leads to the chosen result, or to any result; past the limit, what is nearest
// the results.
function drawnOf(graph: ValueGraph, result: string | null) {
  const behind = result ? [...graphPath(graph, result).up] : [...graph.nodes.keys()].filter(id => !graph.others.includes(id));
  if (behind.length <= lineageViewLimits.nodes) return { ids: new Set(behind), cut: 0 };
  const ids = new Set<string>(), queue = result ? [result] : [...graph.results];
  while (queue.length && ids.size < lineageViewLimits.nodes) {
    const id = queue.shift()!;
    if (ids.has(id)) continue;
    ids.add(id); queue.push(...graph.nodes.get(id)!.parents);
  }
  return { ids, cut: behind.length - ids.size };
}

// How each result came about, as a graph of values read from the top down: the data a script or a
// session reads, the values made from it, and the results (the files written and the plots drawn,
// else the values nothing reads). A node is titled with what the code says it is (a `# means:`
// comment above the statement that makes it), and its name sits under the title; a node with no
// such comment shows its name alone. The bar above names the results; choosing one draws only what
// leads to it, and when every result at once would put more than `wide` values side by side, the
// first is chosen to begin with. What leads to no result is named below, and choosing one of those
// draws what leads to it. Choosing a value names what it comes from, what it uses, what it leads
// to and which results it reaches, and shows its path through the graph: what it comes from in
// one color, what comes of it in another, as a script's editor marks the same lines. Pointing at a
// value shows its path for as long as it is pointed at.
interface LineageProps {
  graph: ValueGraph; language: Language;
  // Given by a page that follows the choice (a script's editor, from its cursor).
  selected?: string | null; onSelect?: (id: string | null) => void;
  // Where a value is made: a script's lines in its editor, or a cell in the Notebook.
  onGo?: (making: Making) => void; canGo?: (making: Making) => boolean;
  onObject?: (name: string) => void; onPath?: (path: string) => void; folders?: boolean;
  // A session's facts about its values; whether the code that makes a value is shown with it.
  facts?: Facts; code?: boolean;
  more?: (node: GraphNode) => ReactNode; hint?: string;
  // The value chosen stays in view as the page scrolls (a view of its own, beside a script).
  pinned?: boolean;
}
function Lineage({ graph, language, selected: given, onSelect, onGo, canGo, onObject, onPath, folders = true, facts, code = true, more, hint, pinned = false }: LineageProps) {
  const [own, setOwn] = useState<string | null>(null);
  const selected = (given !== undefined ? given : own) ?? null, chosen = selected && graph.nodes.has(selected) ? graph.nodes.get(selected)! : null;
  const select = (id: string | null) => { if (given === undefined) setOwn(id); onSelect?.(id); };
  const [result, setResult] = useState<string | null | undefined>(undefined), [everyResult, setEveryResult] = useState(false);
  const wide = useMemo(() => graph.results.length > 1 && graphRows(graph, drawnOf(graph, null).ids).some(row => row.length > lineageViewLimits.wide), [graph]);
  const traced = result === undefined ? (wide ? graph.results[0]! : null) : result && graph.nodes.has(result) ? result : null;
  const drawn = useMemo(() => drawnOf(graph, traced), [graph, traced]);
  const rows = useMemo(() => graphRows(graph, drawn.ids), [graph, drawn]);
  const [pointed, setPointed] = useState<string | null>(null);
  const focus = pointed && graph.nodes.has(pointed) ? pointed : chosen?.id ?? null;
  const path = useMemo(() => focus ? graphPath(graph, focus) : null, [graph, focus]);
  const canvas = useRef<HTMLDivElement>(null);
  const edges = useEdges(canvas, graph, drawn.ids, rows);
  // A value chosen elsewhere (at the cursor) is drawn: the graph shows every result again if the
  // one traced does not lead through it, and the value comes into view.
  useEffect(() => { if (chosen && traced && !drawn.ids.has(chosen.id) && !graph.others.includes(chosen.id)) setResult(null); }, [chosen, traced, drawn, graph]);
  useEffect(() => { if (chosen) canvas.current?.querySelector(`[data-node="${CSS.escape(chosen.id)}"]`)?.scrollIntoView({ block: 'nearest' }); }, [chosen?.id]);
  const choose = (id: string, again = false) => {
    if (id === chosen?.id && !again) { select(null); return; }
    select(id);
    const made = graph.nodes.get(id)?.made[0];
    if (made && onGo && !code && (!canGo || canGo(made))) onGo(made);
  };
  const trace = (id: string | null) => { setResult(id); if (id) choose(id, true); };
  if (graph.tooLong) return <p className="nb-empty-line">This script is larger than {Math.round(scriptFlowLimits.bytes / 1024)} KB, so how its values are made is not read.</p>;
  if (!graph.nodes.size) return <p className="nb-empty-line">Nothing here makes a value or writes a file that can be read from the code.</p>;
  const results = everyResult ? graph.results : graph.results.slice(0, lineageViewLimits.results);
  const state = (id: string) => !path ? '' : id === focus ? ' here' : path.up.has(id) ? ' from' : path.down.has(id) ? ' into' : ' dim';
  return <div className="lin">
    {graph.results.length > 1 && <div className="lin-results" role="group" aria-label="Which result to trace">
      <span>Results</span>
      <button aria-pressed={!traced} onClick={() => trace(null)}>All</button>
      {[...results, ...traced && !results.includes(traced) ? [traced] : []].map(id => { const n = graph.nodes.get(id)!; return <button key={id} aria-pressed={id === traced} className={n.kind} title={n.name} onClick={() => trace(id)}><Icon name={n.kind === 'plot' ? 'chart' : isFile(n) ? 'file' : 'braces'} size={11} stroke={1.8} /><span>{titleOf(n)}</span></button>; })}
      {results.length < graph.results.length && <button className="text-button" onClick={() => setEveryResult(true)}>{graph.results.length - results.length} more</button>}
    </div>}
    <div className={'lin-main' + (pinned ? ' pinned' : '')}>
      <Detail graph={graph} node={chosen} language={language} facts={facts} code={code} onGo={onGo} canGo={canGo} onObject={onObject} onPath={onPath} folders={folders} onChoose={choose} more={more} hint={hint} />
      <div className="lin-canvas" ref={canvas} onPointerLeave={() => setPointed(null)}>
        <svg className="lin-edges" aria-hidden="true">{edges.map(e => <path key={e.key} d={e.d} className={!path ? '' : path.up.has(e.from) && path.up.has(e.to) ? 'from' : path.down.has(e.from) && path.down.has(e.to) ? 'into' : 'off'} />)}</svg>
        {rows.map((row, i) => <div key={i} className="lin-row">{row.map(id => {
          const n = graph.nodes.get(id)!, fact = facts?.get(n.name);
          return <button key={id} data-node={id} className={'lin-node ' + n.kind + state(id) + (id === chosen?.id ? ' chosen' : '')} aria-pressed={id === chosen?.id}
            title={[n.means, n.name, fact && `${fact.type}${fact.size ? ' · ' + fact.size : ''}`].filter(Boolean).join('\n')}
            onClick={() => choose(id)} onPointerEnter={() => setPointed(id)} onFocus={() => setPointed(id)} onBlur={() => setPointed(null)}>
            <Icon name={n.kind === 'plot' ? 'chart' : isFile(n) ? 'file' : 'braces'} size={12} stroke={1.8} />
            <span className="lin-text">{n.means
              ? <><span className="lin-title">{n.means}</span><span className="lin-name lin-sub">{labelOf(n)}</span></>
              : <span className="lin-name">{labelOf(n)}</span>}</span>
          </button>;
        })}</div>)}
      </div>
    </div>
    {drawn.cut > 0 && <p className="nb-note">{plural(drawn.cut, 'value')} further from the results {drawn.cut === 1 ? 'is' : 'are'} not drawn. Choose a result, or a value, to follow it.</p>}
    {graph.others.length > 0 && <p className="nb-note lin-others">Leading to no result: {graph.others.map(id => <button key={id} className={'lin-chip' + (id === traced ? ' chosen' : '')} title={'Draw what leads to ' + graph.nodes.get(id)!.name} onClick={() => trace(id)}><span>{titleOf(graph.nodes.get(id)!)}</span></button>)}</p>}
    {graph.quiet > 0 && <p className="nb-note">{plural(graph.quiet, 'statement makes', 'statements make')} nothing and {graph.quiet === 1 ? 'is' : 'are'} not drawn: prints, checks and library calls.</p>}
    {graph.cut > 0 && <p className="nb-note">The last {plural(graph.cut, 'step is', 'steps are')} not read.</p>}
  </div>;
}

// The value chosen: what it is, how it was made and where, what it comes from and uses, what it
// leads to and which results it reaches. With nothing chosen, how much there is.
function Detail({ graph, node, language, facts, code, onGo, canGo, onObject, onPath, folders, onChoose, more, hint }: Pick<LineageProps, 'graph' | 'language' | 'facts' | 'onGo' | 'canGo' | 'onObject' | 'onPath' | 'more' | 'hint'> & { node: GraphNode | null; code: boolean; folders: boolean; onChoose: (id: string) => void }) {
  if (!node) {
    const values = [...graph.nodes.values()].filter(n => n.kind === 'value').length, sources = graph.inputs.length;
    const explained = [...graph.nodes.values()].filter(n => n.kind === 'value' && n.means).length;
    return <section className="lin-detail empty">
      <p className="lin-sum"><b>{sources}</b> {sources === 1 ? 'source' : 'sources'}<span aria-hidden="true">→</span><b>{values}</b> {values === 1 ? 'value' : 'values'}<span aria-hidden="true">→</span><b>{graph.results.length}</b> {graph.results.length === 1 ? 'result' : 'results'}</p>
      <p>{explained} of {values} {values === 1 ? 'value has' : 'values have'} a meaning written in the code.</p>
      <p>Choose a value to see what it comes from and what comes of it.{hint ? ' ' + hint : ''}</p>
    </section>;
  }
  const { down } = graphPath(graph, node.id), fact = facts?.get(node.name);
  const reaches = graph.results.filter(r => r !== node.id && down.has(r) && !node.children.includes(r));
  const chips = (ids: string[], kind: 'from' | 'into') => ids.map(id => { const n = graph.nodes.get(id)!; return <button key={id} className={'lin-chip ' + kind} title={[n.means, n.name].filter(Boolean).join('\n')} onClick={() => onChoose(id)}><span>{titleOf(n)}</span></button>; });
  const what = node.kind === 'input' ? (isFile(node) ? 'Data file' : 'Value already in the session') : node.kind === 'output' ? 'Written file' : node.kind === 'plot' ? 'Plot' : 'Value';
  const file = isFile(node), openable = file && onPath && !(folder(node.name) && !folders);
  // The statements of one cell that make it are named once, with that cell.
  const groups: Making[][] = [];
  for (const m of node.made) { const last = groups.at(-1); if (m.cell && last?.[0]!.cell?.cellId === m.cell.cellId) last.push(m); else groups.push([m]); }
  const made = groups.map((group, i) => {
    const m = group[0]!, where = m.cell ? `${languageName[language]} ${m.cell.number}` : linesText(m), go = onGo && (!canGo || canGo(m));
    const whole = group.length === 1 && m.from === 1 && m.to === m.code.split('\n').length;
    return <span key={i} className="lin-made">{i === 0 ? (node.kind === 'output' ? 'Written ' : 'Made ') + (m.cell ? 'by ' : 'at ') : 'changed ' + (m.cell ? 'by ' : 'at ')}
      {go ? <button className="text-button" title={m.cell ? 'Show this cell in the Notebook' : 'Go to ' + linesText(m)} onClick={() => onGo!(m)}>{where}</button> : <b>{where}</b>}
      {m.cell && !whole && <span>, {group.map(linesText).join(', ').replace(/, line /g, ', ').replace(/, lines /g, ', ')}</span>}
      {m.cell && m.cell.label && i === groups.length - 1 && <span className="lin-purpose"><span aria-hidden="true"> · </span>{m.cell.label}</span>}</span>;
  });
  return <section className="lin-detail" aria-label={'About ' + titleOf(node)}>
    <header>
      <Icon name={node.kind === 'plot' ? 'chart' : file ? 'file' : 'braces'} size={14} stroke={1.8} />
      <h3 title={node.name} className={node.means ? undefined : 'lin-bare'}>{titleOf(node)}</h3>
      <span className="lin-kind">{what}{fact ? ` · ${fact.type}${fact.size ? ' · ' + fact.size : ''}` : ''}</span>
      {!file && node.kind !== 'plot' && onObject && fact && <button className="text-button" onClick={() => onObject(node.name)}>Look at</button>}
      {openable && <button className="text-button" onClick={() => onPath!(node.name)}>Open</button>}
    </header>
    <p className="lin-said">{node.means || file ? <><code className="lin-ident">{node.name}</code>{node.means ? ' · written in the code' : ' · no meaning written in the code'}</> : 'No meaning written in the code'}</p>
    {made.length > 0 && <p className="lin-made-line">{made}</p>}
    {more?.(node)}
    <dl>
      <dt>From</dt><dd>{node.parents.length ? chips(node.parents, 'from') : <span>{node.kind === 'input' ? (file ? 'Read from the project' : 'Made before Rho kept a record') : 'Nothing read from the code'}</span>}</dd>
      {node.uses.length > 0 && <><dt>Uses</dt><dd className="lin-uses">{node.uses.map(u => { const helper = graph.folded.get(u); return <span key={u} className="lin-use"><code>{u}</code>{helper?.means && <span className="lin-use-means"> — {helper.means}</span>}</span>; })}</dd></>}
      <dt>Leads to</dt><dd>{node.children.length ? chips(node.children, 'into') : <span>{graph.results.includes(node.id) ? 'Nothing yet: this is a result' : 'Nothing'}</span>}</dd>
      {!graph.results.includes(node.id) && (reaches.length > 0 || !node.children.some(c => graph.results.includes(c))) && <><dt>Reaches</dt><dd>{reaches.length ? chips(reaches, 'into') : <span>No result</span>}</dd></>}
    </dl>
    {node.stale && <p className="lin-stale">Its cell also read {node.stale.map(fileName).join(', ')}, made again since.</p>}
    {code && node.made.length > 0 && <details className="lin-code"><summary>The code that made it</summary>{node.made.map((m, i) => <Code key={i} code={m.code} language={language} />)}</details>}
  </section>;
}

// The lines between values, measured from where the page put them, again as the view changes size:
// from the bottom of what a value comes from to its top.
function useEdges(canvas: React.RefObject<HTMLDivElement | null>, graph: ValueGraph, ids: Set<string>, rows: string[][]) {
  const [edges, setEdges] = useState<Array<{ key: string; from: string; to: string; d: string }>>([]);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize(s => s + 1));
    observer.observe(element);
    for (const row of element.querySelectorAll('.lin-row')) observer.observe(row);
    return () => observer.disconnect();
  }, [canvas, rows]);
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const origin = element.getBoundingClientRect(), f = (n: number) => n.toFixed(1), box = new Map<string, DOMRect>();
    for (const node of element.querySelectorAll<HTMLElement>('[data-node]')) box.set(node.dataset.node!, node.getBoundingClientRect());
    const next: typeof edges = [];
    for (const id of ids) {
      const to = box.get(id);
      if (!to) continue;
      const parents = graph.nodes.get(id)!.parents.filter(p => box.has(p));
      parents.forEach((p, i) => {
        const from = box.get(p)!, x1 = from.left + from.width / 2 - origin.left, y1 = from.bottom - origin.top;
        // Lines into one value arrive spread along its top.
        const x2 = to.left + to.width * (parents.length > 1 ? 0.2 + 0.6 * i / (parents.length - 1) : 0.5) - origin.left, y2 = to.top - origin.top;
        const bend = Math.max(14, Math.abs(y2 - y1) / 2);
        next.push({ key: p + '>' + id, from: p, to: id, d: `M${f(x1)} ${f(y1)} C${f(x1)} ${f(y1 + bend)} ${f(x2)} ${f(y2 - bend)} ${f(x2)} ${f(y2)}` });
      });
    }
    setEdges(now => JSON.stringify(now) === JSON.stringify(next) ? now : next);
  }, [canvas, graph, ids, rows, size]);
  return edges;
}

// How the values of a live session came about, as a view beside the Notebook and Variables: from
// what each cell recorded as it ran, the files and values it read and what it made of them. A
// value opens as its own view and a file in its viewer; a cell named on a value is shown in the
// Notebook when the page holds it. A file named in a session on a server is in that server's
// folder, and is shown there. The page that shows it may give it the application's code
// highlighting.
export function FlowPane({ shell, ...props }: Parameters<typeof FlowBody>[0] & { shell?: KernelShell }) { return withShell(shell, <FlowBody {...props} />); }
function FlowBody({ client, snapshot, onObject, onPath, onRemote }: { client: UiClient; snapshot: UiSnapshot; onObject?: (language: Language, name: string) => void; onPath?: (path: string) => void; onRemote?: (placeId: string, path: string) => void }) {
  const projectId = snapshot.project.id;
  const { read, off, problem } = useKernel(client, projectId, snapshot.cursor);
  const latest = useMemo(() => latestSessions(read), [read]);
  const live = languages.filter(l => latest[l] && latest[l]!.state !== 'ended');
  const recent = read?.cells.at(-1)?.language;
  const [chosen, setChosen] = useState<Language | null>(null);
  useEffect(() => setChosen(null), [recent]);
  const shown = chosen && live.includes(chosen) ? chosen : recent && live.includes(recent) ? recent : live.at(-1) ?? null;
  const session = shown ? latest[shown] : undefined;
  const cells = useMemo(() => (read?.cells ?? []).filter(c => c.sessionId === session?.sessionId), [read, session?.sessionId]);
  const graph = useMemo(() => session ? sessionGraph(cells.map(c => ({ ...c, plots: c.outputs.filter(o => o.kind === 'plot').length })), session.variables, session.language) : null, [cells, session]);
  const facts = useMemo(() => new Map(session?.variables.map(v => [v.name, v]) ?? []), [session?.variables]);
  const byCell = useMemo(() => new Map(cells.map(c => [c.cellId, c])), [cells]);
  const who = useAuthors(snapshot);
  const id = useId();
  if (off || (problem && !read)) return <div className="nb-pane"><p className="nb-empty-line">{problem}</p></div>;
  if (!read) return <div className="nb-pane"><p className="nb-empty-line">Reading the live sessions…</p></div>;
  const inNotebook = (m: Making) => !!m.cell && !!document.getElementById('cell-' + m.cell.cellId);
  const toCell = (m: Making) => { const element = m.cell && document.getElementById('cell-' + m.cell.cellId); element?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  // A plot shows with the cell that drew it, and a value with who ran that cell and when.
  const more = (node: GraphNode) => {
    const cell = node.made.at(-1)?.cell && byCell.get(node.made.at(-1)!.cell!.cellId);
    if (!cell) return null;
    const plots = node.kind === 'plot' ? cell.outputs.filter(o => o.kind === 'plot') : [];
    return <>
      {plots.length > 0 && <div className="flow-cell-plots">{plots.map(o => <CellPlot key={o.plot} client={client} projectId={projectId} cellId={cell.cellId} plot={o.plot!} />)}</div>}
      <p className="lin-who">Ran for {who(cell.by).name} at {at(cell.queuedAt)}</p>
    </>;
  };
  const unknown = cells.some(c => c.state !== 'queued' && c.state !== 'running' && c.used === undefined);
  return <div className="nb-pane flow-pane" aria-labelledby={id}>
    <header className="flow-head">
      <h2 id={id} className="nb-pane-state">{session ? <><span className={'nb-dot ' + session.state} aria-hidden="true" />{[versionOf(session), whereOf(session), session.state === 'busy' ? 'running a cell' : session.state === 'starting' ? 'starting' : 'idle'].filter(Boolean).join(' · ')}</> : 'Data flow'}</h2>
      {live.length > 1 && <div className="nb-tabs" role="group" aria-label="Session">{live.map(l => <button key={l} aria-pressed={l === shown} onClick={() => setChosen(l)}>{languageName[l]}</button>)}</div>}
    </header>
    {!session || !graph ? <p className="nb-empty-line">No live session. Once a cell runs in R or Python, this shows how each of its values came about: the files and values it comes from, and what comes of it.</p>
      : !graph.nodes.size ? <p className="nb-empty-line">Nothing made in {languageName[session.language]} yet.</p>
      : <>
          <p className="flow-lede">From the files the session read, at the top, to what it wrote and plotted, at the bottom.</p>
          <Lineage key={session.sessionId} graph={graph} language={session.language} facts={facts} pinned onObject={onObject && (name => onObject(session.language, name))}
            onPath={session.place ? (onRemote && (file => onRemote(session.place!.placeId, file))) : onPath} folders={!!session.place} onGo={toCell} canGo={inNotebook} more={more} />
          {unknown && <p className="nb-note">Cells run before Rho kept what each cell read show what they made, without what it came from.</p>}
          {graph.omitted.values + graph.omitted.plots + graph.omitted.files > 0 && <p className="nb-note">Not drawn: {[graph.omitted.values && `${graph.omitted.values} older ${graph.omitted.values === 1 ? 'value' : 'values'}`, graph.omitted.plots && `${graph.omitted.plots} older ${graph.omitted.plots === 1 ? 'plot' : 'plots'}`, graph.omitted.files && `${graph.omitted.files} older written ${graph.omitted.files === 1 ? 'file' : 'files'}`].filter(Boolean).join(', ')}.</p>}
          {session.variablesOmitted > 0 && <p className="nb-note">{session.variablesOmitted} more {session.variablesOmitted === 1 ? 'value' : 'values'} in the session are not listed.</p>}
        </>}
  </div>;
}
function CellPlot({ client, projectId, cellId, plot }: { client: UiClient; projectId: string; cellId: string; plot: number }) {
  const { src, problem } = usePlot(client, projectId, cellId, plot);
  if (problem) return <p className="nb-note">This plot could not be read. {problem}</p>;
  return src ? <img src={src} alt={`Plot ${plot + 1}`} /> : <span className="nb-plot-wait" aria-label="Reading the plot" />;
}

// A script's values, read from its text, for a page that shows the script: its editor follows
// the value chosen (marking the lines behind it) and goes to where a value is made.
export function ScriptFlowView({ shell, ...props }: Omit<LineageProps, 'code'> & { shell?: KernelShell }) {
  return withShell(shell, <Lineage {...props} code={false} pinned hint="Read from the code; nothing runs. The code marks the same path." />);
}
// A cell that makes its values over several statements shows how, as its script would.
export const innerFlowLimits = { values: 3 };
export function CellScriptFlow({ code, language }: { code: string; language: Language }) {
  const graph = useMemo(() => scriptGraph(scriptFlow(code, language), language), [code, language]);
  if ([...graph.nodes.values()].filter(n => n.kind !== 'input').length < innerFlowLimits.values) return null;
  return <details className="flow-inner"><summary>How its values came about</summary><Lineage graph={graph} language={language} /></details>;
}
