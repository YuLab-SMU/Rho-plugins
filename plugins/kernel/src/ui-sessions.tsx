import { useEffect, useMemo, useState } from 'react';
import { endedHow, languageName, languages, latestSessions, useAuthors, useKernel, type Cell, type NotebookNames, type Session } from './ui-notebook.js';
import { showNotebook, useShownNotebook } from './ui-notebook-target.js';
import { notebookName } from './ui-notebook-pick.js';
import { PlaceChip, usePlaces } from './ui-servers.js';
import { bytesText } from './ui-variables.js';
import { call, clock, durationText, environmentOf, type UiClient, type UiSnapshot } from './ui-base.js';

// The processes behind the live sessions: each notebook has an R and a Python session of its own,
// which its cells run in (the project's own notebook is the one the Agent and a script's line use
// unless they name another). They are listed by notebook. Each says where it runs and with what
// program, its process, who started it and when, what it is doing and what it holds, with
// Interrupt for the running cell and Stop for the session; one that is not running says where the
// next starts, and Start starts it now. Restart ends a session and starts a new one for the same
// notebook where the next would start. A notebook whose view was closed keeps its sessions until
// they are stopped here. The sessions that ended are listed after them, with how each ended.
// Reading the sessions never starts one.
type Language = Session['language'];
export const sessionsPaneLimits = { ended: 12 };
const failure = (error: unknown) => error instanceof Error ? error.message : 'The live session could not be reached.';
const stateWords: Record<Session['state'], string> = { starting: 'Starting', idle: 'Idle', busy: 'Running a cell', ended: 'Ended' };
const live = (s?: Session) => s && s.state !== 'ended' ? s : undefined;

export function SessionsPane({ client, snapshot, onCell, notebooks }: { client: UiClient; snapshot: UiSnapshot; onCell?: (cellId: string, notebook?: string | null) => void; notebooks?: NotebookNames }) {
  const projectId = snapshot.project.id;
  const { read, off, problem, again } = useKernel(client, projectId, snapshot.cursor);
  const { places, setPlaces } = usePlaces(client, projectId, snapshot.cursor);
  const who = useAuthors(snapshot);
  const shownNotebook = useShownNotebook();
  // The project's notebook, then each notebook on the project's pages or with a live session.
  const books = useMemo(() => [...new Set<string | null>([null, ...Object.keys(notebooks ?? {}), ...(read?.sessions ?? []).filter(s => s.state !== 'ended').map(s => s.notebook ?? null)])], [read, notebooks]);
  const latest = useMemo(() => new Map(books.map(book => [book, latestSessions(read, book)])), [read, books]);
  const [asking, setAsking] = useState(''), [askProblem, setAskProblem] = useState('');
  const [now, setNow] = useState(Date.now());
  const busy = (read?.sessions ?? []).some(s => s.state === 'busy' || s.state === 'starting');
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), busy ? 1000 : 30000); return () => clearInterval(t); }, [busy]);
  if (off) return <div className="nb-pane nb-procs"><p className="nb-empty-line">{problem}</p></div>;
  if (!read) return <div className="nb-pane nb-procs"><p className="nb-empty-line">{problem || 'Reading the live sessions…'}</p></div>;
  const cells = read.cells, several = books.length > 1;
  const named = (book: string | null) => notebookName(book, notebooks);
  const of = (book: string | null) => several ? ' of ' + named(book) : '';
  async function interrupt(cell: Cell) {
    setAsking('interrupt:' + cell.cellId); setAskProblem('');
    try { await call(client, 'kernel.interrupt', { projectId, cellId: cell.cellId }); void again(); }
    catch (error) { setAskProblem(failure(error)); }
    finally { setAsking(''); }
  }
  async function stop(session: Session, restart = false) {
    const name = languageName[session.language] + ' session' + of(session.notebook ?? null);
    if (!window.confirm(restart ? `Restart the ${name}? The values defined in it are gone, and a new ${languageName[session.language]} session starts.` : `Stop the ${name}${session.place ? ' on ' + session.place.label : ''}? The values defined in it are gone; the next ${languageName[session.language]} cell there starts a new session.`)) return;
    setAsking((restart ? 'restart:' : 'stop:') + session.sessionId); setAskProblem('');
    try {
      await call(client, 'kernel.stop', { projectId, sessionId: session.sessionId });
      if (restart) await call(client, 'kernel.start', { projectId, language: session.language, ...(session.notebook ? { notebook: session.notebook } : {}) });
      void again();
    }
    catch (error) { setAskProblem(failure(error)); }
    finally { setAsking(''); }
  }
  async function start(language: Language, book: string | null) {
    setAsking('start:' + language + ':' + (book ?? '')); setAskProblem('');
    try { await call(client, 'kernel.start', { projectId, language, ...(book ? { notebook: book } : {}) }); showNotebook(book); void again(); }
    catch (error) { setAskProblem(failure(error)); }
    finally { setAsking(''); }
  }
  // The newest of a notebook's language that ended says so in its own place; the ones before it are listed.
  const ended = read.sessions.filter(s => s.state === 'ended' && latest.get(s.notebook ?? null)?.[s.language] !== s).sort((a, b) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt));
  const by = (principal: string) => { const name = who(principal).name; return name === 'You' ? 'you' : name; };
  const startButton = (language: Language, book: string | null, words: string) => <button key={language} className="secondary" disabled={!!asking} title={`Start the ${languageName[language]} session${of(book)} now, without running a cell`} onClick={() => void start(language, book)}>{asking === 'start:' + language + ':' + (book ?? '') ? 'Starting…' : words}</button>;
  const card = (language: Language, book: string | null) => {
    const session = latest.get(book)?.[language], active = live(session);
    const mine = active ? cells.filter(c => c.sessionId === active.sessionId) : [];
    const running = mine.find(c => c.state === 'running'), waiting = mine.filter(c => c.state === 'queued').length;
    const held = active ? active.variables.reduce((sum, v) => sum + v.bytes, 0) : 0;
    // Where the next session of the language starts, when the project names a server.
    const where = places?.places.length ? <span className="nb-proc-where"><PlaceChip client={client} projectId={projectId} language={language} session={session} places={places} onChanged={setPlaces} /></span> : null;
    return <section key={language} className={'nb-proc ' + (active?.state ?? 'off')} aria-label={languageName[language] + ' session' + of(book)}>
      <header className="nb-proc-head">
        <span className={'nb-lang ' + language}>{languageName[language]}</span>
        <h3>{active?.version ? active.version.replace(/^R version (\S+).*$/, 'R $1') : languageName[language]}</h3>
        <span className="nb-proc-state"><span className="nb-dot" aria-hidden="true" />{active ? stateWords[active.state] : 'Not running'}</span>
        <span className="nb-proc-actions">
          {running && <button className="secondary" disabled={asking === 'interrupt:' + running.cellId} onClick={() => void interrupt(running)}>Interrupt</button>}
          {active && <button className="text-button" disabled={!!asking} title={`End the ${languageName[language]} session and start a new one; its values are gone`} onClick={() => void stop(active, true)}>{asking === 'restart:' + active.sessionId ? 'Restarting…' : 'Restart'}</button>}
          {active && <button className="text-button nb-proc-stop" disabled={!!asking} title={`End the ${languageName[language]} session; its values are gone`} onClick={() => void stop(active)}>Stop</button>}
          {!active && startButton(language, book, 'Start')}
        </span>
      </header>
      {active ? <>
        <dl className="nb-proc-facts">
          <div><dt>Runs</dt><dd>{active.place ? <>on {active.place.label} <small>in {active.place.folder}</small></> : <>on this machine{active.host ? <small> {active.host}</small> : null}</>}{where}</dd></div>
          {active.program && <div><dt>Program</dt><dd><code>{active.program}</code>{environmentOf(active) && <small> · the project's {environmentOf(active)}</small>}</dd></div>}
          <div><dt>Process</dt><dd>{active.pid ? <code>{active.pid}</code> : 'not reported yet'}</dd></div>
          <div><dt>Started</dt><dd>by {by(active.startedBy)} at {clock(Date.parse(active.startedAt))} <small>· {durationText(Math.max(now, Date.now()) - Date.parse(active.startedAt))} ago</small></dd></div>
          <div><dt>Cells</dt><dd>{active.cells} run{waiting ? ` · ${waiting} waiting` : ''}</dd></div>
          <div><dt>Holds</dt><dd>{active.variables.length + active.variablesOmitted} {active.variables.length + active.variablesOmitted === 1 ? 'value' : 'values'}{held ? <small> · {bytesText(held)} as the session measures them</small> : null}</dd></div>
        </dl>
        {running && <p className="nb-proc-running"><span className="pulse-dot" aria-hidden="true" />
          {onCell ? <button className="text-button" title="Show the cell in its notebook" onClick={() => { showNotebook(book); onCell(running.cellId, book); }}>{languageName[language]} {running.number}</button> : <span>{languageName[language]} {running.number}</span>}
          <span>{running.purpose ?? running.code.split('\n').find(line => line.trim())?.trim()}</span>
          <small>{by(running.by)} · running {durationText(Math.max(now, Date.now()) - Date.parse(running.startedAt ?? running.queuedAt))}</small></p>}
        {active.problem && <p className="nb-note">{active.problem}</p>}
      </> : <p className="nb-proc-off">{session ? `Ended at ${clock(Date.parse(session.endedAt!))}: ${endedHow(session, who)}. ` : ''}The next {languageName[language]} cell{several ? ' in ' + named(book) : ''} starts a session{places?.places.length ? '' : ' on this machine'}.{where}</p>}
    </section>;
  };
  return <div className="nb-pane nb-procs">
    {problem && <p className="inline-error" role="alert">{problem}</p>}
    {askProblem && <p className="inline-error" role="alert">{askProblem}</p>}
    {books.map(book => {
      const any = languages.some(l => live(latest.get(book)?.[l]));
      // A notebook of the person's with nothing running says so in one line.
      if (several && book !== null && !any) return <section key={book} className="nb-proc-book quiet" aria-label={named(book)}>
        <h2 className="nb-proc-book-name">{named(book)}</h2>
        <p className="nb-proc-off">No session running; its first cell of each language starts one. {languages.map(l => startButton(l, book, 'Start ' + languageName[l]))}</p>
      </section>;
      return <section key={book ?? ''} className={'nb-proc-book' + (several && book === shownNotebook ? ' shown' : '')} aria-label={several ? named(book) : undefined}>
        {several && <h2 className="nb-proc-book-name">{named(book)}{book === null && <small> · where an Agent's cells run unless it names a notebook</small>}</h2>}
        {languages.map(language => card(language, book))}
      </section>;
    })}
    {ended.length > 0 && <details className="nb-proc-ended">
      <summary>{ended.length} {ended.length === 1 ? 'session' : 'sessions'} ended</summary>
      <ul>{ended.slice(0, sessionsPaneLimits.ended).map(s => <li key={s.sessionId}>
        <span className={'nb-lang ' + s.language}>{languageName[s.language]}</span>
        <span className="nb-proc-ended-what"><strong>{s.version ? s.version.replace(/^R version (\S+).*$/, 'R $1') : languageName[s.language]}</strong>{of(s.notebook ?? null)}{s.place ? ' on ' + s.place.label : ''} · {s.cells} {s.cells === 1 ? 'cell' : 'cells'}
          <small>{clock(Date.parse(s.startedAt))}–{s.endedAt ? clock(Date.parse(s.endedAt)) : '?'} · {endedHow(s, who).split('.')[0]}</small></span>
      </li>)}</ul>
      {ended.length > sessionsPaneLimits.ended && <p className="nb-note">The {sessionsPaneLimits.ended} newest are listed.</p>}
    </details>}
  </div>;
}
