import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cellLabel, lanes, lineage, related, type Lineage, type LineageNode, type LineageStep } from './lineage.js';
import { scriptFlow, scriptFlowLimits, scriptStepAt, type ScriptFlow, type ScriptStep } from './script-flow.js';
import { Icon } from './ui-icons.js';
import { at, Code, languageName, languages, latestSessions, useAuthors, useKernel, usePlot, versionOf, type Cell, type Session } from './ui-notebook.js';
import { whereOf } from './ui-servers.js';
import { withShell, type KernelShell, type UiClient, type UiSnapshot } from './ui-base.js';

type Language = Cell['language'];
// How the values of a live session were made, as a view beside the Notebook and Variables: each
// cell that made something still there, as a box in the order the cells ran, holding what it made
// one to a line. A line in the margin runs from a value (or a written file) to each box that read
// it. A value opens as its own view and a file in its viewer; a box opens to show its cell's code.
// Pointing at a box keeps its path in view: what it came from and what came of it. A file named in
// a session on a server is in that server's folder, and is shown there.
// The page that shows it may give it the application's code highlighting.
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
  const graph = useMemo(() => session ? lineage(cells.map(c => ({ ...c, plots: c.outputs.filter(o => o.kind === 'plot').length })), session.variables.map(v => v.name)) : null, [cells, session]);
  const id = useId();
  if (off || (problem && !read)) return <div className="nb-pane"><p className="nb-empty-line">{problem}</p></div>;
  if (!read) return <div className="nb-pane"><p className="nb-empty-line">Reading the live sessions…</p></div>;
  return <div className="nb-pane flow-pane" aria-labelledby={id}>
    <header className="flow-head">
      <h2 id={id} className="nb-pane-state">{session ? <><span className={'nb-dot ' + session.state} aria-hidden="true" />{[versionOf(session), whereOf(session), session.state === 'busy' ? 'running a cell' : session.state === 'starting' ? 'starting' : 'idle'].filter(Boolean).join(' · ')}</> : 'Data flow'}</h2>
      {live.length > 1 && <div className="nb-tabs" role="group" aria-label="Session">{live.map(l => <button key={l} aria-pressed={l === shown} onClick={() => setChosen(l)}>{languageName[l]}</button>)}</div>}
    </header>
    {!session || !graph ? <p className="nb-empty-line">No live session. Once a cell runs in R or Python, this shows how its values were made: the files and values each cell read, and what it made of them.</p>
      : !graph.steps.length ? <p className="nb-empty-line">Nothing made in {languageName[session.language]} yet.</p>
      : <Flow key={session.sessionId} graph={graph} session={session} cells={cells} client={client} snapshot={snapshot} onObject={onObject} onPath={session.place ? (onRemote && (file => onRemote(session.place!.placeId, file))) : onPath} />}
  </div>;
}

// The margin holds at most this many lanes; past them, lanes share places. A box names at most
// this many of the files its cell read; the rest are counted.
export const flowLimits = { lanes: 8, reads: 4 };
const lanePx = 9;
function Flow({ graph, session, cells, client, snapshot, onObject, onPath }: { graph: Lineage; session: Session; cells: Cell[]; client: UiClient; snapshot: UiSnapshot; onObject?: (language: Language, name: string) => void; onPath?: (path: string) => void }) {
  const byCell = useMemo(() => new Map(cells.map(c => [c.cellId, c])), [cells]);
  const values = useMemo(() => new Map(session.variables.map(v => [v.name, v])), [session.variables]);
  const laid = useMemo(() => lanes(graph), [graph]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pointed, setPointed] = useState<string | null>(null);
  const focus = pointed ?? selected, path = useMemo(() => focus && graph.steps.some(s => s.id === focus) ? related(graph, focus) : null, [graph, focus]);
  const stepOfNode = useMemo(() => new Map(graph.steps.flatMap(s => s.nodes.map(n => [n.id, s.id] as const))), [graph]);
  const canvas = useRef<HTMLDivElement>(null);
  const gutter = 12 + Math.min(laid.count, flowLimits.lanes) * lanePx;
  const lines = useLinks(canvas, graph, laid.lane, gutter);
  // The newest cell's box comes into view as it is made.
  const newest = graph.steps.find(s => s.latest)?.id;
  useEffect(() => { if (newest) canvas.current?.querySelector(`[data-step="${CSS.escape(newest)}"]`)?.scrollIntoView({ block: 'nearest' }); }, [newest]);
  const unknown = graph.steps.some(s => s.unknownInputs), omitted = graph.omitted;
  return <>
    <p className="flow-lede">Each box is a cell, in the order they ran, with what it made. A line joins a value to each cell that read it.</p>
    <div className="flow-canvas" ref={canvas} style={{ paddingLeft: gutter }} onPointerLeave={() => setPointed(null)}>
      <Links lines={lines} path={path} stepOfNode={stepOfNode} />
      {laid.order.map(s => {
        const cell = s.cell ? byCell.get(s.cell.cellId) : undefined;
        return <StepBox key={s.id} step={s} cell={cell} values={values} faded={!!path && !path.has(s.id)} onPoint={setPointed}
          open={s.id === selected} onOpen={() => setSelected(selected === s.id ? null : s.id)}
          onNode={node => node.kind === 'value' ? onObject?.(session.language, node.name) : node.kind === 'file' ? onPath?.(node.name) : setSelected(s.id)} onFile={file => onPath?.(file)} folders={!!session.place}>
          {s.id === selected && cell && <StepCell step={s} cell={cell} byCell={byCell} client={client} snapshot={snapshot} />}
        </StepBox>;
      })}
    </div>
    {unknown && <p className="nb-note">Cells run before Rho kept what each cell read show what they made, without lines into them.</p>}
    {omitted.values + omitted.plots + omitted.files > 0 && <p className="nb-note">Not drawn: {[omitted.values && `${omitted.values} older ${omitted.values === 1 ? 'value' : 'values'}`, omitted.plots && `${omitted.plots} older ${omitted.plots === 1 ? 'plot' : 'plots'}`, omitted.files && `${omitted.files} older written ${omitted.files === 1 ? 'file' : 'files'}`].filter(Boolean).join(', ')}.</p>}
    {session.variablesOmitted > 0 && <p className="nb-note">{session.variablesOmitted} more {session.variablesOmitted === 1 ? 'value' : 'values'} in the session are not listed.</p>}
  </>;
}

// A folder's path ends in /, and keeps it as its name.
const folder = (path: string) => path.endsWith('/');
const fileName = (path: string) => (path.replace(/\/$/, '').split('/').at(-1) ?? path) + (folder(path) ? '/' : '');
const and = (items: string[]) => items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items.at(-1);
// A folder opens where it can be listed: in a session on a server, in the Servers view.
function StepBox({ step, cell, values, faded, open, onPoint, onOpen, onNode, onFile, folders = false, children }: { step: LineageStep; cell?: Cell; values: Map<string, Session['variables'][number]>; faded: boolean; open: boolean; onPoint: (id: string | null) => void; onOpen: () => void; onNode: (node: LineageNode) => void; onFile: (path: string) => void; folders?: boolean; children?: React.ReactNode }) {
  const reads = step.reads.slice(0, flowLimits.reads), name = cell ? languageName[cell.language] : '';
  return <section className={'flow-step ' + step.kind + (step.latest ? ' latest' : '') + (open ? ' open' : '') + (faded ? ' faded' : '')} data-step={step.id} onPointerEnter={() => onPoint(step.id)}>
    {step.cell && cell
      ? <button className="flow-step-head" aria-expanded={open} title={open ? 'Hide the code' : 'Show the code that made this'} onClick={onOpen}>
          <span className={'nb-lang ' + cell.language}>{name} {cell.number}</span><code>{cellLabel(step.cell)}</code>{step.latest && <span className="flow-newest">Newest</span>}
          <Icon name="chevron" size={12} />
        </button>
      : <p className="flow-step-head">Already in the session</p>}
    {reads.length > 0 && <p className="flow-reads">Reads {reads.map(file => folder(file) && !folders
      ? <span key={file} className="flow-file" title={file}><Icon name="folder" size={11} stroke={1.8} />{fileName(file)}</span>
      : <button key={file} className="flow-file" title={'Open ' + file} onClick={() => onFile(file)}><Icon name={folder(file) ? 'folder' : 'file'} size={11} stroke={1.8} />{fileName(file)}</button>)}{step.reads.length > reads.length && <span>and {step.reads.length - reads.length} more</span>}</p>}
    {step.earlier.length > 0 && <p className="flow-step-note">Changes what {and(step.earlier.map(c => `${name} ${c.number}`))} made</p>}
    <ul className="flow-outs">{step.nodes.map(node => {
      const value = node.kind === 'value' ? values.get(node.name) : undefined, wrote = node.id.startsWith('wrote:'), into = node.kind === 'file' && folder(node.name);
      return <li key={node.id}><button data-node={node.id} className={'flow-out ' + node.kind + (wrote ? ' wrote' : '')} disabled={into && !folders}
        title={node.kind === 'value' ? `Look at ${node.name}${value?.summary ? ' · ' + value.summary : ''}` : into ? `Wrote into ${node.name}` : node.kind === 'file' ? `Open ${node.name}` : 'Show the code that drew it'} onClick={() => onNode(node)}>
        <Icon name={node.kind === 'value' ? 'braces' : node.kind === 'plot' ? 'chart' : into ? 'folder' : 'file'} size={12} stroke={1.8} />
        <span>{node.kind === 'file' ? fileName(node.name) : node.name}</span>
        <small>{value ? `${value.type}${value.size ? ' · ' + value.size : ''}` : into ? 'written into' : wrote ? 'written' : ''}</small>
      </button></li>;
    })}</ul>
    {step.stale.length > 0 && <p className="flow-step-note stale">Read before {step.stale.length === 1 ? 'it was' : 'they were'} made again: {step.stale.map(fileName).join(', ')}</p>}
    {step.unknownInputs && <p className="flow-step-note">What it read was not recorded</p>}
    {children}
  </section>;
}

// The cell a box stands for, opened in place: the cells whose values it changed, its code, who ran
// it and when, and the plots it drew.
function StepCell({ step, cell, byCell, client, snapshot }: { step: LineageStep; cell: Cell; byCell: Map<string, Cell>; client: UiClient; snapshot: UiSnapshot }) {
  const who = useAuthors(snapshot);
  const earlier = step.earlier.map(c => byCell.get(c.cellId)).filter((c): c is Cell => !!c);
  const inNotebook = document.getElementById('cell-' + cell.cellId) ? cell.cellId : null;
  const plots = cell.outputs.filter(o => o.kind === 'plot');
  return <div className="flow-cell">
    {earlier.map(c => <div key={c.cellId} className="flow-cell-earlier"><span className={'nb-lang ' + c.language}>{languageName[c.language]} {c.number}</span><Code code={c.code} language={c.language} /></div>)}
    <CellScriptFlow code={cell.code} language={cell.language} />
    <Code code={cell.code} language={cell.language} />
    {plots.length > 0 && <div className="flow-cell-plots">{plots.map(o => <CellPlot key={o.plot} client={client} projectId={snapshot.project.id} cellId={cell.cellId} plot={o.plot!} />)}</div>}
    <footer>
      <span>{who(cell.by).name} · {at(cell.queuedAt)}</span>
      {inNotebook && <button className="text-button" onClick={() => document.getElementById('cell-' + inNotebook)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>Show in the Notebook</button>}
    </footer>
  </div>;
}
function CellPlot({ client, projectId, cellId, plot }: { client: UiClient; projectId: string; cellId: string; plot: number }) {
  const { src, problem } = usePlot(client, projectId, cellId, plot);
  if (problem) return <p className="nb-note">This plot could not be read. {problem}</p>;
  return src ? <img src={src} alt={`Plot ${plot + 1}`} /> : <span className="nb-plot-wait" aria-label="Reading the plot" />;
}

// The lines in the margin, each ending in an arrow; on a path, those along it stand out.
function Links({ lines, path, stepOfNode }: { lines: Array<{ key: string; from: string; to: string; d: string }>; path: Set<string> | null; stepOfNode: Map<string, string> }) {
  const arrow = useId().replace(/:/g, '');
  return <svg className="flow-links" aria-hidden="true">
    <defs><marker id={arrow} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 8 4 0 8z" /></marker></defs>
    {lines.map(line => <path key={line.key} d={line.d} markerEnd={`url(#${arrow})`} className={path ? (path.has(stepOfNode.get(line.from)!) && path.has(line.to) ? 'on' : 'off') : ''} />)}
  </svg>;
}

// A script's values, read from its text as the Data flow reads a session's cells: each step (the
// statements that make a value, change it or write a file) is a box in script order with what it
// makes, and a line joins a value to each step that reads it. The step at the reader's line (an
// editor's cursor) keeps its path in view, as pointing at a box does. Choosing a step goes to its
// lines where the page can (a script's editor); elsewhere the box opens to show them.
export function ScriptFlowView({ shell, ...props }: Parameters<typeof ScriptFlowBody>[0] & { shell?: KernelShell }) { return withShell(shell, <ScriptFlowBody {...props} />); }
function ScriptFlowBody({ flow, language, current = null, onStep, onPath }: { flow: ScriptFlow; language: Language; current?: number | null; onStep?: (step: ScriptStep) => void; onPath?: (path: string) => void }) {
  const laid = useMemo(() => lanes(flow), [flow]);
  const [open, setOpen] = useState<string | null>(null);
  const [pointed, setPointed] = useState<string | null>(null);
  const here = current === null ? null : scriptStepAt(flow, current)?.id ?? null;
  const focus = pointed ?? open ?? here, path = useMemo(() => focus && flow.steps.some(s => s.id === focus) ? related(flow, focus) : null, [flow, focus]);
  const stepOfNode = useMemo(() => new Map(flow.steps.flatMap(s => s.nodes.map(n => [n.id, s.id] as const))), [flow]);
  const canvas = useRef<HTMLDivElement>(null);
  const gutter = 12 + Math.min(laid.count, flowLimits.lanes) * lanePx;
  const lines = useLinks(canvas, flow, laid.lane, gutter);
  useEffect(() => { if (here) canvas.current?.querySelector(`[data-step="${CSS.escape(here)}"]`)?.scrollIntoView({ block: 'nearest' }); }, [here]);
  if (flow.tooLong) return <p className="nb-empty-line">This script is larger than {Math.round(scriptFlowLimits.bytes / 1024)} KB, so how its values are made is not read.</p>;
  if (!flow.steps.length) return <p className="nb-empty-line">Nothing here makes a value or writes a file that can be read from the code.</p>;
  return <>
    <div className="flow-canvas" ref={canvas} style={{ paddingLeft: gutter }} onPointerLeave={() => setPointed(null)}>
      <Links lines={lines} path={path} stepOfNode={stepOfNode} />
      {laid.order.map(s => {
        const step = s as ScriptStep, choose = () => onStep ? onStep(step) : setOpen(open === step.id ? null : step.id);
        return <ScriptStepBox key={step.id} step={step} language={language} here={step.id === here} open={!onStep && step.id === open} faded={!!path && !path.has(step.id)}
          goes={!!onStep} onPoint={setPointed} onChoose={choose} onPath={onPath} />;
      })}
    </div>
    {flow.quiet > 0 && <p className="nb-note">{flow.quiet} {flow.quiet === 1 ? 'statement makes' : 'statements make'} nothing and {flow.quiet === 1 ? 'is' : 'are'} not drawn: prints, checks and library calls.</p>}
    {flow.cut > 0 && <p className="nb-note">{flow.cut} more {flow.cut === 1 ? 'step is' : 'steps are'} not drawn.</p>}
  </>;
}
const linesOf = (step: ScriptStep) => step.from === step.to ? String(step.from) : `${step.from}–${step.to}`;
function ScriptStepBox({ step, language, here, open, faded, goes, onPoint, onChoose, onPath }: { step: ScriptStep; language: Language; here: boolean; open: boolean; faded: boolean; goes: boolean; onPoint: (id: string | null) => void; onChoose: () => void; onPath?: (path: string) => void }) {
  const first = step.cell.code.split('\n').find(line => line.trim())?.trim() ?? '', reads = step.reads.slice(0, flowLimits.reads);
  const where = (step.from === step.to ? 'line ' : 'lines ') + linesOf(step);
  return <section className={'flow-step script' + (here ? ' here' : '') + (open ? ' open' : '') + (faded ? ' faded' : '')} data-step={step.id} onPointerEnter={() => onPoint(step.id)}>
    <button className="flow-step-head" aria-expanded={goes ? undefined : open} title={goes ? 'Go to ' + where : (open ? 'Hide ' : 'Show ') + where} onClick={onChoose}>
      <span className="flow-lines">{linesOf(step)}</span><code>{first}</code>{!goes && <Icon name="chevron" size={12} />}
    </button>
    {reads.length > 0 && <p className="flow-reads">Reads {reads.map(file => onPath
      ? <button key={file} className="flow-file" title={'Open ' + file} onClick={() => onPath(file)}><Icon name="file" size={11} stroke={1.8} />{fileName(file)}</button>
      : <span key={file} className="flow-file" title={file}><Icon name="file" size={11} stroke={1.8} />{fileName(file)}</span>)}{step.reads.length > reads.length && <span>and {step.reads.length - reads.length} more</span>}</p>}
    <ul className="flow-outs">{step.nodes.map(node => {
      const file = node.kind === 'file';
      return <li key={node.id}><button data-node={node.id} className={'flow-out ' + (file ? 'file wrote' : 'value')} disabled={file && !onPath}
        title={file ? (onPath ? 'Open ' + node.name : node.name) : 'Go to ' + where} onClick={() => file ? onPath?.(node.name) : onChoose()}>
        <Icon name={file ? 'file' : 'braces'} size={12} stroke={1.8} />
        <span>{file ? fileName(node.name) : node.name}</span>
        <small>{file ? 'written' : step.functions.includes(node.name) ? 'function' : step.changed.includes(node.name) ? 'changed' : ''}</small>
      </button></li>;
    })}</ul>
    {open && <div className="flow-cell"><Code code={step.cell.code} language={language} /></div>}
  </section>;
}
// A cell that makes its values over several steps shows them, as its script would.
export const innerFlowLimits = { steps: 3 };
export function CellScriptFlow({ code, language }: { code: string; language: Language }) {
  const flow = useMemo(() => scriptFlow(code, language), [code, language]);
  if (flow.steps.length < innerFlowLimits.steps) return null;
  return <details className="flow-inner"><summary>How its values were made, step by step</summary><ScriptFlowBody flow={flow} language={language} /></details>;
}

// The lines in the margin, measured from where the page put the boxes, again as the view or a box
// changes size: out of the box at the line that made a value, along its lane, and into the head of
// each box that read it.
function useLinks(canvas: React.RefObject<HTMLDivElement | null>, graph: Lineage, lane: Map<string, number>, gutter: number) {
  const [lines, setLines] = useState<Array<{ key: string; from: string; to: string; d: string }>>([]);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize(s => s + 1));
    observer.observe(element);
    for (const child of element.querySelectorAll('.flow-step')) observer.observe(child);
    return () => observer.disconnect();
  }, [canvas, graph]);
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const origin = element.getBoundingClientRect(), r = 5, f = (n: number) => n.toFixed(1);
    const next = graph.links.flatMap(link => {
      const out = element.querySelector(`[data-node="${CSS.escape(link.from)}"]`), box = out?.closest('.flow-step');
      const into = element.querySelector(`[data-step="${CSS.escape(link.to)}"]`), head = into?.querySelector('.flow-step-head');
      if (!out || !box || !into || !head) return [];
      const sy = out.getBoundingClientRect().top + out.getBoundingClientRect().height / 2 - origin.top, sx = box.getBoundingClientRect().left - origin.left;
      const ty = head.getBoundingClientRect().top + head.getBoundingClientRect().height / 2 - origin.top, tx = into.getBoundingClientRect().left - origin.left - 1;
      const x = gutter - 8 - (lane.get(link.from)! % flowLimits.lanes) * lanePx;
      return [{ key: link.from + '>' + link.to, from: link.from, to: link.to, d: `M${f(sx)} ${f(sy)} H${f(x + r)} Q${f(x)} ${f(sy)} ${f(x)} ${f(sy + r)} V${f(ty - r)} Q${f(x)} ${f(ty)} ${f(x + r)} ${f(ty)} H${f(tx)}` }];
    });
    setLines(now => JSON.stringify(now) === JSON.stringify(next) ? now : next);
  }, [canvas, graph, lane, gutter, size]);
  return lines;
}
