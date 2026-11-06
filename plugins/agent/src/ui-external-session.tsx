import { useEffect, useState, useRef, type ReactNode } from 'react';
import type { ExternalSessionSummary, ExternalTurn, ExternalResult } from './external-session.js';

export interface ExternalConversationProps {
  session: ExternalSessionSummary;
  read: (before?: number) => Promise<{ first: number; turns: ExternalTurn[]; session: ExternalSessionSummary }>;
  renderText: (text: string) => ReactNode;
  renderResult: (result: ExternalResult) => ReactNode;
  openFile: (path: string) => void;
}
/** Read-only conversation entry. Native client owns every input and permission. */
export function ExternalConversation({ session, read, renderText, renderResult, openFile }: ExternalConversationProps) {
  const [kept, setKept] = useState<{ first: number; turns: ExternalTurn[] } | null>(null), [problem, setProblem] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    read().then(value => { if (live) { setKept(value); setProblem(''); } }, error => { if (live) setProblem(error instanceof Error ? error.message : 'Could not read this conversation.'); });
    return () => { live = false; };
  }, [session.id, session.sourceCursor, session.state, read, retry]);
  async function earlier() {
    try { const value = await read(kept?.first); setKept(old => ({ first: value.first, turns: [...value.turns, ...(old?.turns ?? [])] })); setProblem(''); }
    catch (error) { setProblem(error instanceof Error ? error.message : 'Could not read earlier messages.'); }
  }
  return <div className="external-conversation" ref={root}>
    <p className="external-input-owner">Read only · Continue in {session.producer === 'dsh' ? 'DeepSeek Harness' : session.producer}. Input and permission choices stay there.</p>
    {problem && <p role="alert">{problem} <button onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
    {session.omittedTurns > 0 && <p role="status">{session.omittedTurns} earlier turns are outside the retained observation.</p>}
    {session.problem && <p role="status">{session.problem}</p>}
    {!kept && !problem && <p>Reading conversation…</p>}
    {kept?.turns.slice().reverse().map(turn => <article className="external-turn" key={turn.id}>
      <header><h4>{turn.prompt || 'Prompt was not observed'}</h4><small>{new Date(turn.at).toLocaleString()} · {turn.state === 'unknown' ? 'Outcome unknown' : turn.state}</small></header>
      {turn.results.length > 0 && <section className="external-results" aria-label="Results of this turn"><h5>Results</h5>{turn.results.map((result, i) => <div key={i}>{renderResult(result)}{turn.tools.some(t => t.id === result.toolId) && <button className="text-button" onClick={() => {
        const target = root.current?.querySelector<HTMLElement>('#' + CSS.escape('external-tool-' + result.toolId));
        const outer = target?.closest('details'); if (outer) outer.open = true;
        const inner = target?.querySelector('details'); if (inner) inner.open = true;
        target?.scrollIntoView({ block: 'center' });
      }}>Show operation · {turn.tools.find(t => t.id === result.toolId)?.name}</button>}</div>)}</section>}
      {turn.messages.length > 0 && <details className="external-messages"><summary>{turn.messages.length} earlier replies</summary>{turn.messages.map((message, index) => <div key={index}>{renderText(message.text)}</div>)}</details>}
      {turn.reply ? renderText(turn.reply) : <p>No reply was observed.</p>}
      <details className="external-tools"><summary>{turn.tools.length} operations{turn.omittedTools ? ` · ${turn.omittedTools} not retained` : ''}</summary>
        <ol>{turn.tools.map(tool => <li key={tool.id} id={'external-tool-' + tool.id}>
          <details><summary><strong>{tool.name}</strong><span>{tool.outcome === 'requested' ? 'Awaiting result' : tool.outcome === 'unknown' ? 'Outcome unknown' : tool.outcome}{tool.exitCode !== undefined ? ' · exit ' + tool.exitCode : ''}</span></summary>
            <small>{new Date(tool.at).toLocaleString()} · {tool.id}</small>
            {tool.detail && <pre>{tool.detail}</pre>}{tool.output && <pre>{tool.output}</pre>}
            {tool.paths.length > 0 && <div className="external-paths"><small>Files mentioned · opens current content</small>{tool.paths.map(p => <button key={p} onClick={() => openFile(p)}>{p}</button>)}</div>}
          </details>
        </li>)}</ol>
      </details>
      {turn.omittedChars > 0 && <p className="muted">Some text exceeded the observation limit. The original client keeps its full record.</p>}
    </article>)}
    {kept && kept.first > 0 && <button onClick={() => void earlier()}>Earlier turns</button>}
    <details className="external-source"><summary>Source and observation</summary><dl><dt>Native session</dt><dd>{session.sessionId}</dd><dt>Last observed</dt><dd>{new Date(session.observedAt).toLocaleString()}</dd><dt>Native events read</dt><dd>{session.sourceCursor}</dd></dl></details>
  </div>;
}
