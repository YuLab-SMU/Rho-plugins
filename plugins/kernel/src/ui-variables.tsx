import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui-icons.js';
import { languageName, languages, latestSessions, useKernel, useRelations, type Cell, type NotebookNames, type Session } from './ui-notebook.js';
import { useShownNotebook } from './ui-notebook-target.js';
import { NotebookPick, notebookName } from './ui-notebook-pick.js';
import { call, clock, versionOf, type UiClient, type UiSnapshot, type KernelOutputs } from './ui-base.js';
import { whereOf } from './ui-servers.js';

// What a live session holds, as an environment pane lists it: by kind (tables and matrices, other
// values, functions), each with its value at a glance, its type, its size and the memory it takes.
// It shows the sessions of the notebook the person last worked in, and can show another's.
// A name opens the value in a view of its own; the arrow beside it lists a table's columns or a
// list's parts in place, and says which cell made it and which read it. Reading never starts a
// session, runs nothing and waits for no cell.
type Language = Session['language'];
type Variable = Session['variables'][number];
type Inspected = KernelOutputs['kernel.inspect'];
// A view narrower than typedPx leaves the type to the value's own words and its tooltip.
export const variablesPaneLimits = { columns: 40, values: 6, parts: 40, typedPx: 440 };
const none: Cell[] = [];

const functionTypes = new Set(['function', 'builtin_function_or_method', 'method', 'partial', 'method-wrapper', 'ufunc']);
type Kind = 'data' | 'values' | 'functions';
const kindOf = (v: Variable): Kind => functionTypes.has(v.type) ? 'functions' : /\d\s*×\s*\d/.test(v.size) ? 'data' : 'values';
const kindNames: Record<Kind, string> = { data: 'Data', values: 'Values', functions: 'Functions' };
const frames = /^(data\.frame|tbl_df|tbl|data\.table|tibble|DataFrame|DFrame|DataTable)$/;

// The size the way the language's own environment pane says it: a data frame's observations and
// variables, a matrix's dimensions, a vector's length.
function sizeText(v: Variable, language: Language) {
  const dims = v.size.split('×').map(part => part.trim()).filter(Boolean);
  if (dims.length === 2 && frames.test(v.type)) return language === 'r' ? `${Number(dims[0]).toLocaleString()} obs. of ${Number(dims[1]).toLocaleString()} variables` : `${Number(dims[0]).toLocaleString()} rows × ${Number(dims[1]).toLocaleString()} columns`;
  if (dims.length > 1) return dims.map(d => Number(d).toLocaleString()).join(' × ');
  return v.size && v.size !== '1' && !functionTypes.has(v.type) ? 'length ' + Number(v.size).toLocaleString() : '';
}
export const bytesText = (bytes: number) => !bytes ? '' : bytes < 1024 ? bytes + ' B' : bytes < 1024 ** 2 ? (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' KB' : bytes < 1024 ** 3 ? (bytes / 1024 ** 2).toFixed(1) + ' MB' : (bytes / 1024 ** 3).toFixed(2) + ' GB';
type Sort = { by: 'name' | 'type' | 'bytes'; descending: boolean };

export function VariablesPane({ client, snapshot, onObject, onCell, onSessions, notebooks }: { client: UiClient; snapshot: UiSnapshot; onObject?: (language: Language, name: string, notebook?: string) => void; onCell?: (cellId: string, notebook?: string | null) => void; onSessions?: () => void; notebooks?: NotebookNames }) {
  const { read, off, problem } = useKernel(client, snapshot.project.id, snapshot.cursor);
  const notebook = useShownNotebook();
  const latest = useMemo(() => latestSessions(read, notebook), [read, notebook]);
  const relations = useRelations(read?.cells ?? none);
  const live = languages.filter(l => latest[l] && latest[l]!.state !== 'ended');
  const [chosen, setChosen] = useState<Language | null>(null);
  const recent = read?.cells.filter(c => (c.notebook ?? null) === notebook).at(-1)?.language;
  const shown = chosen && live.includes(chosen) ? chosen : recent && live.includes(recent) ? recent : live[0] ?? null;
  const session = shown ? latest[shown] : undefined;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>({ by: 'name', descending: false });
  const [open, setOpen] = useState<string[]>([]);
  useEffect(() => setOpen([]), [session?.sessionId]);
  const pane = useRef<HTMLDivElement>(null), [typed, setTyped] = useState(true);
  useLayoutEffect(() => {
    const element = pane.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { const width = entry?.contentRect.width ?? 0; if (width) setTyped(width >= variablesPaneLimits.typedPx); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [!!read]);
  const columns = typed ? 4 : 3;
  if (off || (problem && !read)) return <div className="nb-pane nb-env"><p className="nb-empty-line">{problem}</p></div>;
  if (!read) return <div className="nb-pane nb-env"><p className="nb-empty-line">Reading the live sessions…</p></div>;
  const words = query.trim().toLocaleLowerCase();
  const all = session?.variables ?? [];
  const listed = all.filter(v => !words || v.name.toLocaleLowerCase().includes(words));
  const order = (a: Variable, b: Variable) => {
    const by = sort.by === 'bytes' ? a.bytes - b.bytes : sort.by === 'type' ? a.type.localeCompare(b.type) : 0;
    return (sort.descending ? -1 : 1) * (by || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  };
  const groups = (['data', 'values', 'functions'] as Kind[]).map(kind => [kind, listed.filter(v => kindOf(v) === kind).sort(order)] as const).filter(([, list]) => list.length);
  const total = all.reduce((sum, v) => sum + v.bytes, 0);
  const head = (by: Sort['by'], label: string) => <button className={'nb-env-sort' + (sort.by === by ? ' on' : '')} aria-label={`Sort by ${label.toLowerCase()}`} onClick={() => setSort(now => ({ by, descending: now.by === by ? !now.descending : by === 'bytes' }))}>
    {label}{sort.by === by && <Icon name="updown" size={10} stroke={2.2} />}</button>;
  const state = session ? [versionOf(session), whereOf(session), session.state === 'busy' ? 'running a cell' : session.state === 'starting' ? 'starting' : 'idle'].filter(Boolean).join(' · ') : '';
  return <div className="nb-pane nb-env" ref={pane}>
    <header className="nb-env-head">
      <NotebookPick sessions={read.sessions} shown={notebook} names={notebooks} />
      {live.length > 1 && <div className="nb-tabs" role="group" aria-label="Session">{live.map(l => <button key={l} aria-pressed={l === shown} onClick={() => setChosen(l)}>{languageName[l]}</button>)}</div>}
      {session && (onSessions
        ? <button className={'nb-env-state ' + session.state} title="Show the sessions" onClick={onSessions}><span className="nb-dot" aria-hidden="true" />{state}</button>
        : <span className={'nb-env-state ' + session.state}><span className="nb-dot" aria-hidden="true" />{state}</span>)}
      {session && <div className="nb-env-find" role="search"><Icon name="search" size={13} /><input type="search" placeholder="Find" aria-label="Find a value by name" value={query} spellCheck={false} onChange={event => setQuery(event.target.value)} /></div>}
    </header>
    {!session ? <p className="nb-empty-line">{notebook ? `No live session in ${notebookName(notebook, notebooks)}.` : 'No live session.'} Values show here once a cell runs in R or Python, from a notebook or a script's line.{onSessions && <> <button className="text-button" onClick={onSessions}>Show the sessions</button></>}</p>
      : !all.length ? <p className="nb-empty-line">Nothing defined in {languageName[session.language]} yet.</p>
      : <>
        <p className="nb-env-total">{all.length + session.variablesOmitted} {all.length + session.variablesOmitted === 1 ? 'value' : 'values'}{total ? ' · ' + bytesText(total) + ' in memory' : ''}{session.variablesAt ? ' · listed at ' + clock(Date.parse(session.variablesAt), true) : ''}{session.state === 'busy' ? ', before the running cell' : ''}</p>
        {!listed.length ? <p className="nb-empty-line">No value is named “{query.trim()}”. <button className="text-button" onClick={() => setQuery('')}>Clear</button></p>
          : <table className="nb-env-table">
            <thead><tr><th scope="col" className="nb-env-name-head">{head('name', 'Name')}</th><th scope="col"><span className="nb-env-sort">Value</span></th>{typed && <th scope="col" className="nb-env-type">{head('type', 'Type')}</th>}<th scope="col" className="nb-env-bytes">{head('bytes', 'Size')}</th></tr></thead>
            {groups.map(([kind, list]) => <tbody key={kind}>
              <tr className="nb-env-group"><th colSpan={columns} scope="rowgroup">{kindNames[kind]}</th></tr>
              {list.map(v => {
                const unfolded = open.includes(v.name);
                return <Fragment key={v.name}>
                  <tr className={'nb-env-row' + (unfolded ? ' open' : '')} title={v.type + (v.summary ? ': ' + v.summary : '')}>
                    <td className="nb-env-name">
                      <button className="nb-env-twisty" aria-expanded={unfolded} aria-label={(unfolded ? 'Fold ' : 'Unfold ') + v.name} onClick={() => setOpen(unfolded ? open.filter(n => n !== v.name) : [...open, v.name])}><Icon name="chevron" size={10} stroke={2.2} /></button>
                      {onObject ? <button className="nb-env-open" title={'Open ' + v.name} onClick={() => onObject(session.language, v.name, notebook ?? undefined)}>{v.name}</button> : <span className="nb-env-open">{v.name}</span>}
                    </td>
                    <td className="nb-env-value">{kind === 'data' ? <span className="nb-env-dims">{sizeText(v, session.language)}</span> : <><code>{v.summary}</code>{sizeText(v, session.language) && <small> · {sizeText(v, session.language)}</small>}</>}</td>
                    {typed && <td className="nb-env-type">{v.type}</td>}
                    <td className="nb-env-bytes">{bytesText(v.bytes)}</td>
                  </tr>
                  {unfolded && <tr className="nb-env-detail"><td colSpan={columns}>
                    <Detail client={client} projectId={snapshot.project.id} cursor={snapshot.cursor} language={session.language} notebook={notebook} variable={v} kind={kind}
                      made={relations.bySession.get(session.sessionId)} onCell={onCell && (cellId => onCell(cellId, notebook))} />
                  </td></tr>}
                </Fragment>;
              })}
            </tbody>)}
          </table>}
        {session.variablesOmitted > 0 && <p className="nb-note">{session.variablesOmitted} more not listed by the session.</p>}
      </>}
  </div>;
}

// What a value holds, unfolded in place: a table's columns with their first values, a list's
// parts, and the cell that made the value and those that read it.
function Detail({ client, projectId, cursor, language, notebook, variable, kind, made, onCell }: {
  client: UiClient; projectId: string; cursor: number; language: Language; notebook: string | null; variable: Variable; kind: Kind;
  made?: ReturnType<typeof useRelations>['all']; onCell?: (cellId: string) => void;
}) {
  const [reading, setReading] = useState<Inspected | null>(null), [problem, setProblem] = useState('');
  const looks = kind === 'data' || /^(list|dict|tuple|namedtuple|lm|glm|S4|environment)$/.test(variable.type) || variable.type.startsWith('list');
  useEffect(() => {
    if (!looks) return;
    let live = true;
    call(client, 'kernel.inspect', { projectId, language, ...(notebook ? { notebook } : {}), name: variable.name, limit: kind === 'data' ? variablesPaneLimits.values : variablesPaneLimits.parts }).then(answer => { if (live) { setReading(answer); setProblem(''); } },
      error => { if (live) setProblem(error instanceof Error ? error.message : 'The value could not be read.'); });
    return () => { live = false; };
  }, [variable.name, variable.summary, variable.size, cursor]);
  const maker = made?.maker.get(variable.name);
  const readers = maker ? made!.readers.get(maker.cellId)?.get(variable.name) ?? [] : [];
  const cellLink = (cell: { cellId: string; number: number }) => onCell ? <button key={cell.cellId} className="nb-cell-link" title={`Show ${languageName[language]} ${cell.number} in its notebook`} onClick={() => onCell(cell.cellId)}>{languageName[language]} {cell.number}</button> : <span key={cell.cellId} className="nb-cell-link">{languageName[language]} {cell.number}</span>;
  const object = reading?.state === 'shown' ? reading.object : null;
  const columns = object?.table?.columns.slice(0, variablesPaneLimits.columns) ?? [];
  const parts = object?.children?.items ?? [];
  return <div className="nb-env-inside" role="group" aria-label={'Inside ' + variable.name}>
    {looks && (problem ? <p className="nb-note">{problem}</p>
      : !reading ? <p className="nb-note">Reading {variable.name}…</p>
      : reading.state !== 'shown' ? <p className="nb-note">{reading.problem ?? (reading.state === 'busy' ? 'A cell is running; it shows when the cell ends.' : 'It could not be read now.')}</p>
      : columns.length ? <ul className="nb-env-parts">{columns.map(c => <li key={c.name}><code className="nb-env-part">$ {c.name}</code><span className="nb-env-part-type">{c.type}</span><code className="nb-env-part-values">{c.values.join(' ')}{object!.table!.rows > c.values.length ? ' …' : ''}</code></li>)}
          {object!.table!.columnsTotal > columns.length && <li className="nb-note">and {object!.table!.columnsTotal - columns.length} more columns</li>}</ul>
      : parts.length ? <ul className="nb-env-parts">{parts.map(p => <li key={p.index}><code className="nb-env-part">$ {p.name}</code><span className="nb-env-part-type">{p.type}{p.size ? ' · ' + p.size : ''}</span><code className="nb-env-part-values">{p.summary}</code></li>)}
          {object!.children!.total > parts.length && <li className="nb-note">and {object!.children!.total - parts.length} more parts</li>}</ul>
      : object?.facts.length ? <ul className="nb-env-parts">{object.facts.map(f => <li key={f.label}><span className="nb-env-part-type">{f.label}</span><code className="nb-env-part-values">{f.value}</code></li>)}</ul>
      : null)}
    {!looks && <code className="nb-env-summary">{variable.summary}</code>}
    {maker ? <p className="nb-env-made">Made in {cellLink(maker)}{readers.length > 0 && <> · read in {readers.slice(0, 4).map((c, i) => <Fragment key={c.cellId}>{i > 0 && ', '}{cellLink(c)}</Fragment>)}{readers.length > 4 && ` and ${readers.length - 4} more`}</>}</p>
      : <p className="nb-env-made">The cell that made it is not among those read.</p>}
  </div>;
}
