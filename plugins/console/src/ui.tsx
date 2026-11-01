// The browser entry for the person's command line: a line to run a command in the project folder
// with their shell, and the record of each command they ran there, its output read as it arrives.
// The page that shows them places the records among its own, such as the Agent's commands, and
// supplies the scoped client.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ConsoleRecord } from './index.js';

export interface UiClient { call(method: string, input: any, signal?: AbortSignal): Promise<any> }
export type ConsoleCommand = ConsoleRecord;
// The protected resource is this tab: it shows at most this much of one command's output, reads a
// running command again this often, and lists this many of the newest commands.
export const consoleViewLimits = { shownBytes: 256 * 1024, pollMs: 700, listed: 50 };
const failure = (error: unknown) => error instanceof Error ? error.message : 'The Console could not be reached.';
const refused = (error: unknown) => ['unavailable', 'unauthorized'].includes((error as { error?: { kind?: string } } | null)?.error?.kind ?? '');
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function durationText(ms: number) {
  if (ms < 10_000) return (Math.max(ms, 100) / 1000).toFixed(1) + ' s';
  if (ms < 60_000) return Math.round(ms / 1000) + ' s';
  const minutes = Math.floor(ms / 60_000), seconds = Math.round((ms % 60_000) / 1000);
  return minutes + ' min' + (seconds ? ' ' + seconds + ' s' : '');
}

// The person's commands in the project, read again each time the page's cursor moves. `off` says
// the Console is off for this project or this page may not use it.
export function useCommands(client: UiClient, projectId: string, cursor: number) {
  ensureStyles();
  const [commands, setCommands] = useState<ConsoleCommand[] | null>(null);
  const [state, setState] = useState<{ off: boolean; problem: string }>({ off: false, problem: '' });
  const read = useCallback(() => client.call('console.list', { projectId, limit: consoleViewLimits.listed }).then((value: { commands: ConsoleCommand[] }) => { setCommands(value.commands); setState({ off: false, problem: '' }); },
    error => setState({ off: refused(error), problem: failure(error) })), [client, projectId]);
  useEffect(() => { void read(); }, [read, cursor]);
  return { commands, ...state, read };
}

// The person's own line. A request that failed keeps its identity, so pressing Run again for the
// same words never runs the command twice.
export function useCommandLine(client: UiClient, projectId: string, { onRan, center = false }: { onRan?: () => void; center?: boolean } = {}) {
  const [draft, setDraft] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [problem, setProblem] = useState('');
  const pending = useRef<{ command: string; changeId: string } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  async function start(command: string) {
    if (!command.trim() || busy) return;
    if (pending.current?.command !== command) pending.current = { command, changeId: 'console-' + crypto.randomUUID() };
    setBusy(true); setProblem('');
    try { await client.call('console.run', { projectId, command, changeId: pending.current.changeId }); pending.current = null; setDraft(''); setNote(''); onRan?.(); }
    catch (error) { setProblem(failure(error)); }
    finally { setBusy(false); }
  }
  async function stop(record: ConsoleCommand) {
    try { await client.call('console.stop', { projectId, commandId: record.commandId, changeId: 'stop-' + record.commandId }); onRan?.(); }
    catch (error) { setProblem(failure(error)); }
  }
  // A command from elsewhere waits in the line for the person to check and run.
  function prepare(command: string, from: string) {
    setDraft(command); setNote('From ' + from + '. Check it, then press Run.'); setProblem('');
    if (center) input.current?.scrollIntoView({ block: 'center' });
    input.current?.focus();
  }
  return { draft, setDraft: (text: string) => { setDraft(text); if (!text) setNote(''); }, note, busy, problem, input, start, stop, prepare };
}
export type CommandLineState = ReturnType<typeof useCommandLine>;

export function CommandLine({ folder, line, problem }: { folder: string; line: CommandLineState; problem?: string }) {
  ensureStyles();
  const { draft, setDraft, note, busy, input } = line, lines = Math.min(8, draft.split('\n').length), id = useId(), shown = line.problem || problem;
  return <form className="console-prompt" onSubmit={event => { event.preventDefault(); void line.start(draft); }}>
    <label htmlFor={id} className="console-prompt-label">Run a command in <strong>{folder}</strong></label>
    <div className="console-line">
      <span aria-hidden="true">$</span>
      <textarea id={id} ref={input} rows={lines} value={draft} spellCheck={false} autoComplete="off" autoCapitalize="off" placeholder="python3 analysis.py"
        onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void line.start(draft); } }} />
      <button type="submit" className="primary" disabled={busy || !draft.trim()}>{busy ? 'Starting…' : 'Run'}</button>
    </div>
    {note && <p className="console-note">{note}</p>}
    {shown && <p className="inline-error" role="alert">{shown}</p>}
  </form>;
}

// A command's output as it arrives: pages from where the last read stopped, again while it runs.
function useOutput(client: UiClient, projectId: string, record: ConsoleCommand, open: boolean) {
  const [out, setOut] = useState({ text: '', more: false, problem: '' });
  const at = useRef(0);
  useEffect(() => {
    if (!open) return;
    let live = true, timer: ReturnType<typeof setTimeout> | undefined;
    const pull = async () => {
      try {
        for (;;) {
          if (at.current >= consoleViewLimits.shownBytes) { setOut(o => ({ ...o, more: true })); return; }
          const page: { text: string; nextOffset: number; more: boolean } = await client.call('console.output', { projectId, commandId: record.commandId, offset: at.current, maxBytes: 65536 });
          if (!live) return;
          at.current = page.nextOffset;
          setOut(o => ({ text: o.text + page.text, more: false, problem: '' }));
          if (!page.more) break;
        }
      } catch (error) { if (live) setOut(o => ({ ...o, problem: failure(error) })); }
      if (live && record.state === 'running') timer = setTimeout(pull, consoleViewLimits.pollMs);
    };
    void pull();
    return () => { live = false; clearTimeout(timer); };
  }, [client, projectId, record.commandId, record.state, open]);
  return out;
}

const ended = (r: ConsoleCommand) => r.state === 'running' ? 'Running' : r.state === 'stopped' ? 'Stopped' : r.state === 'continuing' ? 'Still running outside Rho' : r.state === 'unknown' ? 'Outcome unknown' : r.state === 'not-started' ? 'Did not start'
  : r.exit?.signal ? 'Ended by ' + r.exit.signal : 'Exit ' + (r.exit?.code ?? '?');
// One command the person ran: when, the words, and how it ended when that was not a clean exit;
// opened, its output. `after` is what the page shows under it, such as the files that changed
// while it ran; `made` marks a record that made something.
export function CommandRecord({ record, client, projectId, made, after, onRunAgain, onStop }: { record: ConsoleCommand; client: UiClient; projectId: string; made?: boolean; after?: ReactNode; onRunAgain: (record: ConsoleCommand) => void; onStop: (record: ConsoleCommand) => void }) {
  ensureStyles();
  const [open, setOpen] = useState(record.state === 'running');
  const [now, setNow] = useState(Date.now());
  const out = useOutput(client, projectId, record, open);
  const running = record.state === 'running';
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);
  const took = (record.endedAt ? Date.parse(record.endedAt) : now) - Date.parse(record.startedAt);
  const clean = record.state === 'exited' && record.exit?.code === 0;
  const ending = [clean ? '' : ended(record), took >= 1000 ? durationText(took) : ''].filter(Boolean).join(' · ');
  return <li className={'console-command mine' + (made || running ? ' made' : '') + (!clean && !running ? ' problem' : '')}>
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="console-time">{clock(Date.parse(record.startedAt))}</span>
        <span className="console-what" title={record.command}><code className="alone">{record.command}</code></span>
        <span className={'console-end' + (running ? ' running' : clean ? '' : ' problem')}>{ending}</span>
      </summary>
      <div className="console-detail">
      {record.cwd && <p className="console-note">In {record.cwd}/</p>}
      {out.text ? <pre className="console-output" ref={e => { if (e && running) e.scrollTop = e.scrollHeight; }}>{out.text}</pre> : <p className="console-note">{running ? 'Waiting for output…' : out.problem ? '' : 'It printed nothing.'}</p>}
      {out.more && <p className="console-note">Showing the first {(consoleViewLimits.shownBytes / 1024).toFixed(0)} KiB of {record.kept.toLocaleString('en-US')} kept bytes.</p>}
      {record.cut && !running && <p className="console-note">It printed {record.bytes.toLocaleString('en-US')} bytes; the middle was not kept.</p>}
      {record.problem && <p className="console-note">{record.problem}</p>}
      {out.problem && <p className="inline-error" role="alert">{out.problem}</p>}
      {!running && record.state !== 'continuing' && <div className="console-actions"><button className="text-button console-again" onClick={() => onRunAgain(record)}>Run again</button></div>}
      </div>
    </details>
    {after}
    {running && <div className="console-actions"><button className="text-button console-again" disabled={!!record.stop} onClick={() => onStop(record)}>{record.stop ? 'Stopping…' : 'Stop'}</button></div>}
  </li>;
}

// The command line's and the records' own styles, in the application's tokens.
const styles = `.console-command { border-top: 1px solid var(--color-divider); }
.console-command summary { display: grid; grid-template-columns: 4.6em minmax(0, 1fr) auto; gap: 12px; align-items: baseline; padding: 8px 6px; margin: 0 -6px; border-radius: 6px; cursor: pointer; list-style: none; }
.console-command summary:hover { background: var(--color-hover); }
.console-command summary::-webkit-details-marker { display: none; }
.console-time { color: var(--color-meta); font-size: 12px; font-variant-numeric: tabular-nums; }
.console-what { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.console-what code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-meta); font-family: var(--font-mono); font-size: 12px; }
.console-what code.alone { color: var(--color-ink); font-size: 13px; }
.console-end { color: var(--color-meta); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.console-end.problem { color: var(--color-failed); font-weight: 600; }
.console-end.running { color: var(--color-accent); font-weight: 600; }
.console-detail { display: flex; flex-direction: column; gap: 6px; margin: 0 0 10px calc(4.6em + 12px); }
.console-output { margin: 0; padding: 8px 10px; max-height: 22em; overflow: auto; border-radius: 6px; background: var(--color-well); font: 11.5px/1.45 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.console-note { color: var(--color-meta); font-size: 12px; }
.console-actions { display: flex; }
.console-command > .console-actions { margin: 0 0 8px calc(4.6em + 12px); }
.console-again { min-height: 0; padding: 2px 0; color: var(--color-accent-strong); font-size: 13px; font-weight: 600; }
.console-again:hover { color: var(--color-accent); text-decoration: underline; }
.console-prompt { display: flex; flex-direction: column; gap: 6px; }
.console-prompt .console-prompt-label { display: block; color: var(--color-meta); font-size: 12px; font-weight: 400; }
.console-prompt label strong { color: var(--color-ink); font-weight: 600; }
.console-line { display: flex; align-items: flex-start; gap: 8px; padding: 6px 6px 6px 12px; border: 1px solid var(--color-hairline-strong); border-radius: 10px; background: var(--color-surface); }
.console-line:focus-within { border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.console-line > span { padding-top: 6px; color: var(--color-meta); font: 13px/1.45 var(--font-mono); }
.console-line textarea { flex: 1; min-width: 0; min-height: 0; padding: 6px 0; border: 0; outline: 0; resize: none; background: none; box-shadow: none; font: 13px/1.45 var(--font-mono); color: var(--color-ink); }
.console-line button { flex: none; }
@container (max-width: 560px) {
  .console-command summary { grid-template-columns: minmax(0, 1fr) auto; }
  .console-time { display: none; }
  .console-detail, .console-command > .console-actions { margin-left: 0; }
}
`;
function ensureStyles() {
  if (typeof document === 'undefined' || document.querySelector('style[data-owner="rho-plugins.console"]')) return;
  const style = document.createElement('style'); style.dataset.owner = 'rho-plugins.console'; style.textContent = styles; document.head.append(style);
}
