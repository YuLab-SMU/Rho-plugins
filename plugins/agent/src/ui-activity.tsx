import { useEffect, useMemo, useRef, useState } from 'react';
import { summarizeActivity, type ActivityEntry } from './activity-summary.js';

interface Stream { id: string; producer: string; sessionId: string; nextCursor: number; retainedFrom: number; droppedEvents: number }
interface Page { entries: ActivityEntry[]; nextCursor: number; more: boolean; gap: boolean }
interface Output { path: string; state: string; sha256?: string; bytes?: number; kind_hint?: string }
export interface ActivityFeedProps {
  read: (streamId?: string, after?: number, signal?: AbortSignal) => Promise<{ streams: Stream[]; page: Page | null }>;
  outputs: (directory: string, signal?: AbortSignal) => Promise<{ files: Output[] }>;
  open: (file: Output) => Promise<void>;
}
const style = { fontSize: 13, lineHeight: 1.55, minWidth: 0, overflowWrap: 'anywhere' as const };
const muted = { color: 'var(--color-meta,#66716d)' };
const code = { whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const, fontSize: 12, margin: '6px 0', maxHeight: 180, overflow: 'auto' };
const label = (s: Stream) => (s.producer === 'claude' ? 'Claude Code' : 'dsh') + ' · ' + s.id;
const outputName = (input: any) => typeof input?.command === 'string' ? input.command : typeof input?.file_path === 'string' ? input.file_path : typeof input?.path === 'string' ? input.path : typeof input?.description === 'string' ? input.description : '';

/** Display-only consumer: a view owns its bounded cache and polling, never the
 * native session, collector, Core Host or a second durable action history. */
export function ActivityFeed({ read, outputs, open }: ActivityFeedProps) {
  const [streams, setStreams] = useState<Stream[]>([]), [selected, setSelected] = useState('');
  const [entries, setEntries] = useState<ActivityEntry[]>([]), [gap, setGap] = useState(false), [omitted, setOmitted] = useState(false);
  const [problem, setProblem] = useState(''), [connected, setConnected] = useState(false), [retry, setRetry] = useState(0);
  const [directory, setDirectory] = useState('outputs'), [draft, setDraft] = useState('outputs');
  const [files, setFiles] = useState<Output[]>([]), [fileProblem, setFileProblem] = useState(''), [opening, setOpening] = useState('');
  const cursor = useRef(0), cache = useRef<ActivityEntry[]>([]), currentStream = useRef('');
  const currentDirectory = useRef(directory);
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    if (currentStream.current !== selected) {
      currentStream.current = selected; cursor.current = 0; cache.current = [];
      setEntries([]); setGap(false); setOmitted(false);
    }
    const poll = async () => {
      try {
        const result = await read(selected || undefined, cursor.current, abort.signal);
        if (stopped) return;
        setStreams(result.streams); setProblem(''); setConnected(true);
        if (!selected && result.streams.length) { setSelected(result.streams[0]!.id); return; }
        if (result.page) {
          const p = result.page;
          if (p.gap) setGap(true);
          if (p.entries.length) {
            cache.current.push(...p.entries.filter(e => e.cursor > cursor.current));
            // Bound decoded cache as well as event count. Preserve the suffix and
            // disclose loss; a retained return without its request stays partial.
            while (cache.current.length > 256 || new TextEncoder().encode(JSON.stringify(cache.current)).length > 1048576) { cache.current.shift(); setOmitted(true); }
            setEntries([...cache.current]);
          }
          cursor.current = p.nextCursor;
        }
        timer = setTimeout(poll, result.page?.more ? 100 : 1500);
      } catch (e: any) { if (!stopped) { setConnected(false); setProblem(e.message ?? 'Activity could not be read.'); } }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); abort.abort(); };
  }, [selected, read, retry]);
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const poll = async () => {
      try { const result = await outputs(directory, abort.signal); if (stopped) return; setFiles(result.files); setFileProblem(''); timer = setTimeout(poll, 5000); }
      catch (e: any) { if (!stopped) setFileProblem(e.message ?? 'Outputs could not be read.'); }
    };
    if (currentDirectory.current !== directory) { currentDirectory.current = directory; setFiles([]); }
    void poll();
    return () => { stopped = true; clearTimeout(timer); abort.abort(); };
  }, [outputs, directory, retry]);
  const calls = useMemo(() => summarizeActivity(entries).calls.reverse(), [entries]);
  const selectedStream = streams.find(s => s.id === selected);
  const last = entries.at(-1)?.received_at_ms;
  const errors = calls.filter(c => c.tool_error === true || c.observation === 'rejected' || (c.exit_code !== null && c.exit_code !== 0));
  const pending = calls.filter(c => !c.returned);
  return <section style={style} aria-label="Agent activity" data-agent-activity>
    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}><h3 style={{ margin: '0 0 8px' }}>Agent activity</h3><span style={muted} role="status">{connected ? 'Following recorded activity' : problem ? 'Observation disconnected' : 'Connecting…'}</span></div>
    {problem && <div role="alert"><p>Activity could not be updated. Previously received actions remain below.</p><details><summary>Connection details</summary><p>{problem}</p></details><button onClick={() => setRetry(n => n + 1)}>Reconnect activity</button></div>}
    {!!streams.length && <label style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '8px 0' }}>Session<select aria-label="Activity session" style={{ maxWidth: '100%' }} value={selected} onChange={e => setSelected(e.target.value)}>{streams.map(s => <option key={s.id} value={s.id}>{label(s)}</option>)}</select></label>}
    {selectedStream && <p style={muted}>Native session {selectedStream.sessionId}{last ? ' · Last received ' + new Date(last).toLocaleTimeString() : ''}</p>}
    {!streams.length && connected && <p style={muted}>No collected activity yet. Attach Claude Code or dsh with <code>rho-agent-observe</code> using this project's Host and caller <code>rho-agent-observe</code>. Continue talking to the Agent in its original window.</p>}
    {(gap || omitted || !!selectedStream?.droppedEvents) && <p role="status">Earlier activity is omitted. This view keeps at most 256 events / 1 MiB; Core may also have a retention gap. Missing results remain unknown.</p>}
    {!!calls.length && <p>{calls.length} observed calls · {errors.length} with errors · {pending.length} awaiting a result</p>}
    {!calls.length && !!selected && <p style={muted}>No tool actions received yet.</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 28, alignItems: 'start' }}><div>
    <ol style={{ maxHeight: 440, overflow: 'auto', listStyle: 'none', margin: 0, padding: 0 }} aria-label="Observed actions">
      {calls.map(c => {
        const failed = errors.includes(c);
        const state = c.observation === 'rejected' ? 'Tool refused' : c.exit_code !== null && c.exit_code !== 0 ? `Exit ${c.exit_code}` : c.tool_error ? 'Tool error' : !c.returned ? 'Awaiting result' : c.exit_code === 0 ? 'Exit 0' : 'Tool returned';
        return <li key={c.call_id} data-action-state={failed ? 'error' : c.returned ? 'returned' : 'pending'} style={{ borderTop: '1px solid var(--color-divider,#ddd)', padding: '10px 0' }}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}><strong>{c.tool ?? 'Tool result'}{!c.requested ? ' · request not retained' : ''}</strong><strong style={{ color: failed ? 'var(--color-danger,#b43f34)' : undefined }}>{state}</strong></div>
          {outputName(c.input) && <pre style={code}>{outputName(c.input)}</pre>}
          <details><summary>Action details</summary><p style={muted}>Call {c.call_id}</p><pre style={code}>{JSON.stringify(c.input, null, 2)}</pre>
            {c.returned && <p style={muted}>Native tool result: {c.observation === 'rejected' ? 'refused' : c.tool_error === true ? 'marked as error' : c.tool_error === false ? 'not marked as error' : 'unknown error flag'}{c.denial_kind ? ' · ' + c.denial_kind : ''}. {c.exit_code !== null ? `Process exit: ${c.exit_code}.` : 'No process exit code observed.'}</p>}
            {c.result_detail !== null ? <pre style={code}>{typeof c.result_detail === 'string' ? c.result_detail : JSON.stringify(c.result_detail, null, 2)}</pre> : c.returned && <p style={muted}>Result body was not captured.</p>}
            {(c.truncated || c.redacted) && <p style={muted}>{c.truncated ? 'Some captured detail was omitted. ' : ''}{c.redacted ? 'Sensitive fields were redacted.' : ''}</p>}
            <p style={muted}>Evidence: {c.evidence.map((e: any) => '#' + e.cursor).join(', ')}{c.exit_basis ? ' · ' + c.exit_basis : ''}</p></details>
        </li>;
      })}
    </ol></div>
    <section aria-label="Observed outputs" style={{ borderTop: '1px solid var(--color-divider,#ddd)', marginTop: 0, paddingTop: 12 }}>
      <h3 style={{ margin: '0 0 8px' }}>Outputs</h3>
      <form style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }} onSubmit={e => { e.preventDefault(); setDirectory(draft); setRetry(n => n + 1); }}><label style={{ minWidth: 0, flex: 1 }}>Project folder<input style={{ width: '100%', minWidth: 0 }} aria-label="Output folder" value={draft} onChange={e => setDraft(e.target.value)} /></label><button>Refresh outputs</button></form>
      <p style={muted}>Current files in this folder. Their presence does not confirm which Agent produced them. CSV and images open as captured versions; text files open in the editor. CSV values remain text.</p>
      {fileProblem && <p role="alert">Outputs could not be updated: {fileProblem}</p>}
      {!files.length && !fileProblem && <p style={muted}>No output files observed yet.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>{files.map(f => <li key={f.path} style={{ padding: '8px 0', borderTop: '1px solid var(--color-divider,#ddd)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}><span>{f.path}<small style={{ ...muted, display: 'block' }}>{f.state === 'observed' ? `${f.bytes} bytes · ${f.sha256?.slice(0, 12)}` : f.state}</small></span>
          {f.state === 'observed' && <button aria-label={'Open ' + f.path} disabled={!!opening} onClick={async () => { setOpening(f.path); try { await open(f); setFileProblem(''); } catch (e: any) { setFileProblem(e.message); } finally { setOpening(''); } }}>{opening === f.path ? 'Opening…' : 'Open'}</button>}
        </div></li>)}</ul>
    </section></div>
  </section>;
}
