import { useEffect, useMemo, useState } from 'react';
import { endedHow, languageName, languages, latestSessions, useAuthors, useKernel, type Cell, type Session } from './ui-notebook.js';
import { PlaceChip, usePlaces } from './ui-servers.js';
import { bytesText } from './ui-variables.js';
import { call, clock, durationText, environmentOf, type UiClient, type UiSnapshot } from './ui-base.js';

// The processes behind the live sessions: one R and one Python per project, which every notebook,
// script line and Agent of the project runs its cells in. Each says where it runs and with what
// program, its process, who started it and when, what it is doing and what it holds, with
// Interrupt for the running cell and Stop for the session; one that is not running says where the
// next starts, and Start starts it now. Restart ends a session and starts a new one where the next
// would start. The sessions that ended are listed after them, with how each ended. Reading the
// sessions never starts one.
type Language = Session['language'];
export const sessionsPaneLimits = { ended: 12 };
const failure = (error: unknown) => error instanceof Error ? error.message : 'The live session could not be reached.';
const stateWords: Record<Session['state'], string> = { starting: 'Starting', idle: 'Idle', busy: 'Running a cell', ended: 'Ended' };

export function SessionsPane({ client, snapshot, onCell }: { client: UiClient; snapshot: UiSnapshot; onCell?: (cellId: string) => void }) {
  const projectId = snapshot.project.id;
  const { read, off, problem, again } = useKernel(client, projectId, snapshot.cursor);
  const { places, setPlaces } = usePlaces(client, projectId, snapshot.cursor);
  const who = useAuthors(snapshot);
  const latest = useMemo(() => latestSessions(read), [read]);
  const [asking, setAsking] = useState(''), [askProblem, setAskProblem] = useState('');
  const [now, setNow] = useState(Date.now());
  const busy = languages.some(l => latest[l]?.state === 'busy' || latest[l]?.state === 'starting');
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), busy ? 1000 : 30000); return () => clearInterval(t); }, [busy]);
  if (off) return <div className="nb-pane nb-procs"><p className="nb-empty-line">{problem}</p></div>;
  if (!read) return <div className="nb-pane nb-procs"><p className="nb-empty-line">{problem || 'Reading the live sessions…'}</p></div>;
  const cells = read.cells;
  async function interrupt(cell: Cell) {
    setAsking('interrupt:' + cell.cellId); setAskProblem('');
    try { await call(client, 'kernel.interrupt', { projectId, cellId: cell.cellId }); void again(); }
    catch (error) { setAskProblem(failure(error)); }
    finally { setAsking(''); }
  }
  async function stop(session: Session, restart = false) {
    const name = languageName[session.language];
    if (!window.confirm(restart ? `Restart the ${name} session? The values defined in it are gone, and a new ${name} session starts.` : `Stop the ${name} session${session.place ? ' on ' + session.place.label : ''}? The values defined in it are gone; the next ${name} cell starts a new session.`)) return;
    setAsking((restart ? 'restart:' : 'stop:') + session.sessionId); setAskProblem('');
    try {
      await call(client, 'kernel.stop', { projectId, sessionId: session.sessionId });
      if (restart) await call(client, 'kernel.start', { projectId, language: session.language });
      void again();
    }
    catch (error) { setAskProblem(failure(error)); }
    finally { setAsking(''); }
  }
  async function start(language: Language) {
    setAsking('start:' + language); setAskProblem('');
    try { await call(client, 'kernel.start', { projectId, language }); void again(); }
    catch (error) { setAskProblem(failure(error)); }
    finally { setAsking(''); }
  }
  // The newest of a language that ended says so in its own place; the ones before it are listed.
  const ended = read.sessions.filter(s => s.state === 'ended' && latest[s.language] !== s).sort((a, b) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt));
  const by = (principal: string) => { const name = who(principal).name; return name === 'You' ? 'you' : name; };
  return <div className="nb-pane nb-procs">
    {problem && <p className="inline-error" role="alert">{problem}</p>}
    {askProblem && <p className="inline-error" role="alert">{askProblem}</p>}
    {languages.map(language => {
      const session = latest[language], live = session && session.state !== 'ended' ? session : undefined;
      const mine = live ? cells.filter(c => c.sessionId === live.sessionId) : [];
      const running = mine.find(c => c.state === 'running'), waiting = mine.filter(c => c.state === 'queued').length;
      const held = live ? live.variables.reduce((sum, v) => sum + v.bytes, 0) : 0;
      // Where the next session of the language starts, when the project names a server.
      const where = places?.places.length ? <span className="nb-proc-where"><PlaceChip client={client} projectId={projectId} language={language} session={session} places={places} onChanged={setPlaces} /></span> : null;
      return <section key={language} className={'nb-proc ' + (live?.state ?? 'off')} aria-label={languageName[language] + ' session'}>
        <header className="nb-proc-head">
          <span className={'nb-lang ' + language}>{languageName[language]}</span>
          <h2>{live?.version ? live.version.replace(/^R version (\S+).*$/, 'R $1') : languageName[language]}</h2>
          <span className="nb-proc-state"><span className="nb-dot" aria-hidden="true" />{live ? stateWords[live.state] : 'Not running'}</span>
          <span className="nb-proc-actions">
            {running && <button className="secondary" disabled={asking === 'interrupt:' + running.cellId} onClick={() => void interrupt(running)}>Interrupt</button>}
            {live && <button className="text-button" disabled={!!asking} title={`End the ${languageName[language]} session and start a new one; its values are gone`} onClick={() => void stop(live, true)}>{asking === 'restart:' + live.sessionId ? 'Restarting…' : 'Restart'}</button>}
            {live && <button className="text-button nb-proc-stop" disabled={!!asking} title={`End the ${languageName[language]} session; its values are gone`} onClick={() => void stop(live)}>Stop</button>}
            {!live && <button className="secondary" disabled={!!asking} title={`Start the ${languageName[language]} session now, without running a cell`} onClick={() => void start(language)}>{asking === 'start:' + language ? 'Starting…' : 'Start'}</button>}
          </span>
        </header>
        {live ? <>
          <dl className="nb-proc-facts">
            <div><dt>Runs</dt><dd>{live.place ? <>on {live.place.label} <small>in {live.place.folder}</small></> : <>on this machine{live.host ? <small> {live.host}</small> : null}</>}{where}</dd></div>
            {live.program && <div><dt>Program</dt><dd><code>{live.program}</code>{environmentOf(live) && <small> · the project's {environmentOf(live)}</small>}</dd></div>}
            <div><dt>Process</dt><dd>{live.pid ? <code>{live.pid}</code> : 'not reported yet'}</dd></div>
            <div><dt>Started</dt><dd>by {by(live.startedBy)} at {clock(Date.parse(live.startedAt))} <small>· {durationText(Math.max(now, Date.now()) - Date.parse(live.startedAt))} ago</small></dd></div>
            <div><dt>Cells</dt><dd>{live.cells} run{waiting ? ` · ${waiting} waiting` : ''}</dd></div>
            <div><dt>Holds</dt><dd>{live.variables.length + live.variablesOmitted} {live.variables.length + live.variablesOmitted === 1 ? 'value' : 'values'}{held ? <small> · {bytesText(held)} as the session measures them</small> : null}</dd></div>
          </dl>
          {running && <p className="nb-proc-running"><span className="pulse-dot" aria-hidden="true" />
            {onCell ? <button className="text-button" title="Show the cell in its notebook" onClick={() => onCell(running.cellId)}>{languageName[language]} {running.number}</button> : <span>{languageName[language]} {running.number}</span>}
            <span>{running.purpose ?? running.code.split('\n').find(line => line.trim())?.trim()}</span>
            <small>{by(running.by)} · running {durationText(Math.max(now, Date.now()) - Date.parse(running.startedAt ?? running.queuedAt))}</small></p>}
          {live.problem && <p className="nb-note">{live.problem}</p>}
        </> : <p className="nb-proc-off">{session ? `Ended at ${clock(Date.parse(session.endedAt!))}: ${endedHow(session, who)}. ` : ''}The next {languageName[language]} cell starts a session{places?.places.length ? '' : ' on this machine'}.{where}</p>}
      </section>;
    })}
    {ended.length > 0 && <details className="nb-proc-ended">
      <summary>{ended.length} {ended.length === 1 ? 'session' : 'sessions'} ended</summary>
      <ul>{ended.slice(0, sessionsPaneLimits.ended).map(s => <li key={s.sessionId}>
        <span className={'nb-lang ' + s.language}>{languageName[s.language]}</span>
        <span className="nb-proc-ended-what"><strong>{s.version ? s.version.replace(/^R version (\S+).*$/, 'R $1') : languageName[s.language]}</strong>{s.place ? ' on ' + s.place.label : ''} · {s.cells} {s.cells === 1 ? 'cell' : 'cells'}
          <small>{clock(Date.parse(s.startedAt))}–{s.endedAt ? clock(Date.parse(s.endedAt)) : '?'} · {endedHow(s, who).split('.')[0]}</small></span>
      </li>)}</ul>
      {ended.length > sessionsPaneLimits.ended && <p className="nb-note">The {sessionsPaneLimits.ended} newest are listed.</p>}
    </details>}
  </div>;
}

