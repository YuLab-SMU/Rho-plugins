import { useEffect, useMemo, useRef, useState } from 'react';
import { summarizeActivity, type ActivityEntry } from './activity-summary.js';

interface Stream { id: string; producer: string; sessionId: string; nextCursor: number; retainedFrom: number; droppedEvents: number }
interface Page { entries: ActivityEntry[]; nextCursor: number; more: boolean; gap: boolean }
interface Output { path: string; state: string; sha256?: string; bytes?: number; kind_hint?: string }
export interface ActivityFeedProps {
  read: (streamId?: string, after?: number, signal?: AbortSignal) => Promise<{ streams: Stream[]; page: Page | null }>;
  outputs: (directory: string, signal?: AbortSignal) => Promise<{ files: Output[] }>;
  open: (file: Output) => Promise<void>;
  /** The project folder; a path inside it is shown relative to it. Action details keep the original. */
  root?: string;
}
const label = (s: Stream) => (s.producer === 'claude' ? 'Claude Code' : 'dsh') + ' · ' + s.id;
// macOS reports /tmp as /private/tmp, so a project there can be named either way.
const inProject = (path: string, root?: string) => {
  const base = root?.replace(/\/+$/, '');
  if (!base) return path;
  for (const prefix of new Set([base, '/private' + base, base.replace(/^\/private(?=\/)/, '')])) if (path.startsWith(prefix + '/')) return path.slice(prefix.length + 1);
  return path;
};
const outputName = (input: any, root?: string) => typeof input?.command === 'string' ? input.command : typeof input?.file_path === 'string' ? inProject(input.file_path, root) : typeof input?.path === 'string' ? inProject(input.path, root) : typeof input?.description === 'string' ? input.description : '';

// The view's own stylesheet, prefixed, reading the host application's colours when it has them.
const styles = `
.rho-act{display:flex;flex-direction:column;gap:14px;min-width:0;font-size:13px;line-height:1.55;color:var(--color-ink,#1f2a26);overflow-wrap:anywhere}
.rho-act h3{margin:0;font-size:14px;font-weight:600}
.rho-act-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rho-act-dot{width:8px;height:8px;border-radius:50%;background:var(--color-offline,#a7b0ac)}
.rho-act-dot.live{background:var(--color-verified,#2f7d57);box-shadow:0 0 0 3px var(--color-verified-soft,#e3f1ea)}
.rho-act-dot.lost{background:var(--color-amber,#b7791f);box-shadow:0 0 0 3px var(--color-amber-soft,#fbf1de)}
.rho-act-status{color:var(--color-meta,#66716d);font-size:12.5px}
.rho-act button{font:inherit;font-size:12.5px;min-height:30px;padding:4px 12px;white-space:nowrap;border:1px solid var(--color-hairline,#dde2df);border-radius:8px;background:var(--color-surface,#fff);color:inherit;cursor:pointer}
.rho-act button:hover{background:var(--color-hover,#f2f5f3)}
.rho-act button:disabled{opacity:.55;cursor:default}
.rho-act code,.rho-act pre{font-family:var(--font-mono,ui-monospace,monospace);font-size:12px}
.rho-act-card{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border:1px solid var(--color-hairline,#dde2df);border-radius:12px;background:var(--color-surface,#fff)}
.rho-act-card.warn{border-color:var(--color-amber-line,#ecd3a2);background:linear-gradient(var(--color-amber-soft,#fbf1de),var(--color-amber-soft,#fbf1de)) top/100% 3px no-repeat,var(--color-surface,#fff)}
.rho-act-card > svg{flex:none;margin-top:1px;color:var(--color-meta,#66716d)}
.rho-act-card.warn > svg{color:var(--color-amber-text,#8a5a12)}
.rho-act-card > div{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
.rho-act-card strong{font-size:13.5px}
.rho-act-card p{margin:0;color:var(--color-muted,#4f5b56)}
.rho-act-card details{color:var(--color-meta,#66716d);font-size:12px}
.rho-act-card details summary{cursor:pointer;width:max-content}
.rho-act-card .rho-act-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.rho-act-session{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--color-meta,#66716d);font-size:12.5px}
.rho-act-session select{font:inherit;font-size:12.5px;min-height:30px;padding:3px 8px;border:1px solid var(--color-hairline,#dde2df);border-radius:8px;background:var(--color-surface,#fff);color:var(--color-ink,#1f2a26)}
.rho-act-note{margin:0;padding:8px 12px;border-radius:8px;background:var(--color-well,#f3f5f4);color:var(--color-muted,#4f5b56);font-size:12px}
.rho-act-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.rho-act-stat{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:1px solid var(--color-hairline,#dde2df);border-radius:10px;background:var(--color-surface,#fff)}
.rho-act-stat b{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}
.rho-act-stat span{color:var(--color-meta,#66716d);font-size:12px}
.rho-act-stat.bad b{color:var(--color-failed,#b43f34)}
.rho-act-stat.wait b{color:var(--color-amber-text,#8a5a12)}
.rho-act-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:16px;align-items:start}
.rho-act-list{display:flex;flex-direction:column;gap:8px;max-height:460px;margin:0;padding:0;overflow:auto;list-style:none}
.rho-act-item{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--color-hairline,#dde2df);border-left:3px solid var(--color-verified,#2f7d57);border-radius:10px;background:var(--color-surface,#fff)}
.rho-act-item[data-action-state=pending]{border-left-color:var(--color-amber,#b7791f)}
.rho-act-item[data-action-state=error]{border-left-color:var(--color-failed,#b43f34)}
.rho-act-item header{display:flex;align-items:center;justify-content:space-between;gap:10px}
.rho-act-item header strong{font-size:13px}
.rho-act-pill{flex:none;padding:1px 8px;border-radius:999px;background:var(--color-verified-soft,#e3f1ea);color:var(--color-verified-text,#1f6141);font-size:11.5px;font-weight:600}
[data-action-state=pending] .rho-act-pill{background:var(--color-amber-soft,#fbf1de);color:var(--color-amber-text,#8a5a12)}
[data-action-state=error] .rho-act-pill{background:#f9e5e2;color:var(--color-failed,#b43f34)}
.rho-act-item pre{margin:0;padding:6px 9px;max-height:140px;overflow:auto;border-radius:6px;background:var(--color-well,#f3f5f4);white-space:pre-wrap;overflow-wrap:anywhere}
.rho-act-item details{color:var(--color-meta,#66716d);font-size:12px}
.rho-act-item details summary{cursor:pointer;width:max-content}
.rho-act-item details p{margin:4px 0}
.rho-act-outputs{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid var(--color-hairline,#dde2df);border-radius:12px;background:var(--color-surface,#fff)}
.rho-act-outputs header{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.rho-act-outputs form{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.rho-act-outputs label{display:flex;flex-direction:row;align-items:center;gap:6px;margin:0;min-width:0;padding:0 4px 0 10px;border:1px solid var(--color-hairline,#dde2df);border-radius:8px;background:var(--color-well,#f3f5f4);color:var(--color-meta,#66716d);font-size:12px}
.rho-act-outputs input{width:9em;min-width:0;min-height:28px;padding:2px 6px;border:0;border-left:1px solid var(--color-hairline,#dde2df);background:var(--color-surface,#fff);color:var(--color-ink,#1f2a26);font:inherit;font-size:12.5px}
.rho-act-outputs > p{margin:0;color:var(--color-meta,#66716d);font-size:12px}
.rho-act-files{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.rho-act-files li{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--color-divider,#e8ecea)}
.rho-act-files li > span:nth-child(2){display:flex;flex-direction:column;flex:1;min-width:0}
.rho-act-files small{color:var(--color-meta,#66716d);font-size:11.5px}
.rho-act-kind{flex:none;min-width:38px;padding:2px 6px;border-radius:6px;background:var(--color-well,#f3f5f4);color:var(--color-muted,#4f5b56);font-size:10.5px;font-weight:700;letter-spacing:.03em;text-align:center}
.rho-act-empty{display:flex;align-items:center;gap:10px;padding:14px;border:1px dashed var(--color-hairline-strong,#c9d1cd);border-radius:10px;color:var(--color-meta,#66716d);font-size:12.5px}
.rho-act-empty svg{flex:none}
@media (max-width:560px){.rho-act-stats{grid-template-columns:1fr}.rho-act-outputs header{flex-direction:column;align-items:stretch}.rho-act-outputs input{flex:1;width:auto}}
`;
function useStyles() {
  if (typeof document === 'undefined' || document.querySelector('style[data-owner="rho-plugins.agent-activity"]')) return;
  const style = document.createElement('style'); style.dataset.owner = 'rho-plugins.agent-activity'; style.textContent = styles; document.head.append(style);
}
const glyph = (d: string, size = 18) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const glyphs = {
  lost: 'M3 9.3a12.75 12.75 0 0 1 18 0M6.3 12.9a7.95 7.95 0 0 1 11.4 0M9.6 16.5a3.3 3.3 0 0 1 4.8 0M3.75 3.75l16.5 16.5',
  waiting: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 7v5l3 2',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
};
const kindOf = (path: string) => (path.split('.').at(-1) ?? '').slice(0, 4).toUpperCase() || 'FILE';
const bytes = (n?: number) => n === undefined ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

/** Display-only consumer: a view owns its bounded cache and polling, never the
 * native session, collector, Core Host or a second durable action history. */
export function ActivityFeed({ read, outputs, open, root }: ActivityFeedProps) {
  useStyles();
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
  const status = connected ? 'Following recorded activity' : problem ? 'Observation disconnected' : 'Reading activity…';
  const outputsPanel = <section className="rho-act-outputs" aria-label="Observed outputs">
    <header><h3>Outputs</h3>
      <form onSubmit={e => { e.preventDefault(); setDirectory(draft); setRetry(n => n + 1); }}><label>Project folder<input aria-label="Output folder" value={draft} onChange={e => setDraft(e.target.value)} /></label><button>Refresh outputs</button></form>
    </header>
    <p>Files in this folder now. Being here does not show which Agent wrote them. CSV and images open as captured versions and CSV values stay text; text opens in the editor.</p>
    {fileProblem && <p role="alert" className="rho-act-note">Outputs could not be updated: {fileProblem}</p>}
    {!files.length && !fileProblem ? <div className="rho-act-empty">{glyph(glyphs.folder)}<span>No files in <code>{directory}/</code> yet.</span></div>
      : <ul className="rho-act-files">{files.map(f => <li key={f.path}>
        <span className="rho-act-kind">{kindOf(f.path)}</span>
        <span>{f.path}<small>{f.state === 'observed' ? `${bytes(f.bytes)} · ${f.sha256?.slice(0, 12)}` : f.state}</small></span>
        {f.state === 'observed' && <button aria-label={'Open ' + f.path} disabled={!!opening} onClick={async () => { setOpening(f.path); try { await open(f); setFileProblem(''); } catch (e: any) { setFileProblem(e.message); } finally { setOpening(''); } }}>{opening === f.path ? 'Opening…' : 'Open'}</button>}
      </li>)}</ul>}
  </section>;
  return <section className="rho-act" aria-label="Agent activity" data-agent-activity>
    <header className="rho-act-head"><span className={'rho-act-dot' + (connected ? ' live' : problem ? ' lost' : '')} aria-hidden="true" /><h3>Agent activity</h3><span className="rho-act-status" role="status">{status}</span></header>
    {problem && <div role="alert" className="rho-act-card warn">{glyph(glyphs.lost)}<div>
      <strong>The project Host did not answer</strong>
      <p>Actions received earlier stay below. Reconnecting only observes the Host; it never starts or restarts it.</p>
      <details><summary>Connection details</summary><p>{problem}</p></details>
      <div className="rho-act-row"><button onClick={() => setRetry(n => n + 1)}>Reconnect activity</button></div>
    </div></div>}
    {!streams.length && connected && <div className="rho-act-card">{glyph(glyphs.waiting)}<div>
      <strong>No collected activity yet</strong>
      <p>Attach Claude Code or dsh with <code>rho-agent-observe</code>, using this project's Host and caller <code>rho-agent-observe</code>. Keep talking to the Agent in its own window; what it does shows here.</p>
    </div></div>}
    {!!streams.length && <div className="rho-act-session">
      <label>Session <select aria-label="Activity session" value={selected} onChange={e => setSelected(e.target.value)}>{streams.map(s => <option key={s.id} value={s.id}>{label(s)}</option>)}</select></label>
      {selectedStream && <span>Native session {selectedStream.sessionId}{last ? ' · last received ' + new Date(last).toLocaleTimeString() : ''}</span>}
    </div>}
    {(gap || omitted || !!selectedStream?.droppedEvents) && <p role="status" className="rho-act-note">Earlier activity is omitted. This view keeps at most 256 events / 1 MiB; Core may also have a retention gap. Missing results remain unknown.</p>}
    {!!calls.length && <div className="rho-act-stats" aria-label="Observed calls">
      <span className="rho-act-stat"><b>{calls.length}</b><span>observed calls</span></span>
      <span className={'rho-act-stat' + (errors.length ? ' bad' : '')}><b>{errors.length}</b><span>with errors</span></span>
      <span className={'rho-act-stat' + (pending.length ? ' wait' : '')}><b>{pending.length}</b><span>awaiting a result</span></span>
    </div>}
    {!!selected || !!calls.length ? <div className="rho-act-cols"><div>
      {!calls.length && <div className="rho-act-empty">{glyph(glyphs.waiting)}<span>No tool actions received yet.</span></div>}
      <ol className="rho-act-list" aria-label="Observed actions">
      {calls.map(c => {
        const failed = errors.includes(c);
        const state = c.observation === 'rejected' ? 'Tool refused' : c.exit_code !== null && c.exit_code !== 0 ? `Exit ${c.exit_code}` : c.tool_error ? 'Tool error' : !c.returned ? 'Awaiting result' : c.exit_code === 0 ? 'Exit 0' : 'Tool returned';
        return <li key={c.call_id} className="rho-act-item" data-action-state={failed ? 'error' : c.returned ? 'returned' : 'pending'}>
          <header><strong>{c.tool ?? 'Tool result'}{!c.requested ? ' · request not retained' : ''}</strong><span className="rho-act-pill">{state}</span></header>
          {outputName(c.input, root) && <pre>{outputName(c.input, root)}</pre>}
          <details><summary>Action details</summary><p>Call {c.call_id}</p><pre>{JSON.stringify(c.input, null, 2)}</pre>
            {c.returned && <p>Native tool result: {c.observation === 'rejected' ? 'refused' : c.tool_error === true ? 'marked as error' : c.tool_error === false ? 'not marked as error' : 'unknown error flag'}{c.denial_kind ? ' · ' + c.denial_kind : ''}. {c.exit_code !== null ? `Process exit: ${c.exit_code}.` : 'No process exit code observed.'}</p>}
            {c.result_detail !== null ? <pre>{typeof c.result_detail === 'string' ? c.result_detail : JSON.stringify(c.result_detail, null, 2)}</pre> : c.returned && <p>Result body was not captured.</p>}
            {(c.truncated || c.redacted) && <p>{c.truncated ? 'Some captured detail was omitted. ' : ''}{c.redacted ? 'Sensitive fields were redacted.' : ''}</p>}
            <p>Evidence: {c.evidence.map((e: any) => '#' + e.cursor).join(', ')}{c.exit_basis ? ' · ' + c.exit_basis : ''}</p></details>
        </li>;
      })}
      </ol></div>
      {outputsPanel}</div> : outputsPanel}
  </section>;
}
