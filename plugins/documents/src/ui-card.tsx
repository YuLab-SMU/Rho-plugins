// Documents' bodies inside the application's item frame: a reference, a card, a
// summary and one change compared. The full form is the editor. Every form reads
// the same shared buffer, so what a card shows is the text the editor holds; no
// card writes text, and none shows save state.
import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { acquire, authorLabel, groups, type Buffer, type DocumentSync, type Group, type UiClient } from './ui-model.js';
import { agentSpans, count, describe, documentCardLimits, documentShows, excerpt, findGroup, focusOf, hiddenNote, limit, marksBySection, placedGroups, quote, sectionAt, sectionName, sections, showOf, where, type Span } from './ui-card-model.js';

export interface DocumentCardProps {
  form: string;
  params: Record<string, unknown>;
  projectId: string;
  client: UiClient;
  documentId?: string;
  documentVersion?: number;
  principalId?: string;
  // False when this session may read but not revert.
  editable?: boolean;
  maxUnconfirmedBytes?: number;
  // Present when this tab may change how the item is shown.
  onParams?: (params: Record<string, unknown>) => void;
  // What the drawn form leaves out, counted from the whole document.
  reportHidden?: (note: string) => void;
  // The application's reference to another item.
  Reference?: ComponentType<{ itemId: string }>;
}

// Forms this entry draws below its editor. Compare is reached by naming a change,
// not by zooming, so stepping up from the card arrives at the summary.
export const documentForms = {
  inline: { scale: 0, label: 'Reference' },
  card: { scale: 1, label: 'Card', params: { show: [...documentShows] } },
  summary: { scale: 2, label: 'Summary' },
  compare: { scale: 2, label: 'Compare', zoom: false as const },
  full: { scale: 3, label: 'Editor' },
};

const styles = `
.rho-dc{display:flex;flex-direction:column;gap:8px;min-width:0;font-size:12px;line-height:17px;color:var(--text,#1f2328)}
.rho-dc-crumb{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:11px;line-height:15px;color:var(--text-muted,#5f6873)}
.rho-dc-crumb>.rho-dc-fill{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.rho-dc-text{margin:0;padding:2px 0 2px 10px;border-left:2px solid var(--border,#e4e7eb);font-family:var(--font-display,"Newsreader","Noto Serif SC","Songti SC",serif);font-size:14px;line-height:23px;white-space:pre-wrap;overflow-wrap:anywhere}
.rho-dc-text.rho-dc-agent{border-left-color:var(--agent,#3a68f0)}
.rho-dc-text .rho-dc-agent{background:var(--agent-wash,rgba(58,104,240,.08))}
.rho-dc-text .rho-dc-anchor{text-decoration:underline;text-decoration-color:var(--text-muted,#8b939d);text-underline-offset:3px}
.rho-dc-text del,.rho-dc-pair del{background:rgba(207,34,46,.12);color:#9d2a2a;text-decoration:line-through}
.rho-dc-text ins,.rho-dc-pair ins{background:var(--agent-wash,rgba(58,104,240,.1));text-decoration:none;box-shadow:inset 0 -1px 0 var(--agent,#3a68f0)}
.rho-dc-note{margin:0;font-size:11.5px;color:var(--text-muted,#5f6873)}
.rho-dc-cites{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:11px;color:var(--text-muted,#5f6873)}
.rho-dc-actions{display:flex;flex-wrap:wrap;gap:4px 12px}
.rho-dc button.rho-dc-link{font:inherit;font-size:11.5px;min-height:22px;padding:0;border:0;background:none;color:var(--accent,#3a68f0);cursor:pointer}
.rho-dc button.rho-dc-link:disabled{color:var(--text-muted,#8b939d);cursor:default}
.rho-dc-shows{display:inline-flex;gap:2px;padding:2px;border-radius:7px;background:var(--surface-muted,#f1f3f5)}
.rho-dc-shows button{font:inherit;font-size:10.5px;min-height:20px;padding:0 7px;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--text-muted,#5f6873);cursor:pointer}
.rho-dc-shows button[aria-pressed="true"]{background:var(--surface,#fff);border-color:var(--border,#e4e7eb);color:var(--text,#1f2328);font-weight:600}
.rho-dc-who{display:inline-flex;align-items:center;gap:5px;font-weight:600;color:var(--text,#1f2328)}
.rho-dc-who::before{content:"";width:6px;height:6px;border-radius:999px;border:1px solid var(--text-muted,#8b939d)}
.rho-dc-who.rho-dc-agent::before{background:var(--agent,#3a68f0);border-color:var(--agent,#3a68f0)}
.rho-dc-outline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px}
.rho-dc-outline li{display:flex;align-items:center;gap:8px;min-height:24px;padding:0 6px;border-radius:5px}
.rho-dc-outline li.rho-dc-current{background:var(--surface-muted,#f6f1e4)}
.rho-dc-outline .rho-dc-n{width:18px;flex:none;font-variant-numeric:tabular-nums;color:var(--text-muted,#8b939d);font-size:11px}
.rho-dc-outline .rho-dc-t{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rho-dc-outline li.rho-dc-current .rho-dc-t{font-weight:600}
.rho-dc-outline .rho-dc-m{flex:none;display:inline-flex;gap:8px;font-size:10.5px;color:var(--text-muted,#5f6873)}
.rho-dc-outline .rho-dc-m .rho-dc-agent{color:var(--agent,#3a68f0)}
.rho-dc-summary{display:grid;grid-template-columns:minmax(96px,30%) 1fr;gap:12px}
.rho-dc-summary .rho-dc-outline li{min-height:22px;padding:0 4px}
.rho-dc-summary .rho-dc-outline .rho-dc-n{display:none}
.rho-dc-section{display:flex;flex-direction:column;gap:8px;min-width:0}
.rho-dc-changes{list-style:none;margin:0;padding:8px 0 0;border-top:1px solid var(--border,#e4e7eb);display:flex;flex-direction:column;gap:4px}
.rho-dc-changes li{display:flex;flex-wrap:wrap;align-items:center;gap:2px 10px;min-height:22px}
.rho-dc-changes .rho-dc-what{flex:1 1 140px;min-width:0;color:var(--text-muted,#5f6873)}
.rho-dc-acts{display:inline-flex;align-items:center;gap:10px;margin-left:auto;white-space:nowrap}
.rho-dc-changes pre{flex-basis:100%;margin:2px 0 4px;padding:6px;border-radius:4px;background:var(--surface-muted,#f6f7f9);font-family:var(--font-mono,ui-monospace,monospace);font-variant-ligatures:none;font-size:11px;line-height:16px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:120px;overflow:auto}
.rho-dc-changes del{background:rgba(207,34,46,.12);text-decoration:none}
.rho-dc-changes ins{background:rgba(26,127,55,.12);text-decoration:none}
.rho-dc-pair{display:grid;grid-template-columns:44px 1fr;gap:6px 10px;align-items:baseline}
.rho-dc-pair>span{font-size:11px;color:var(--text-muted,#5f6873)}
.rho-dc-pair>p{margin:0;font-family:var(--font-display,"Newsreader","Noto Serif SC","Songti SC",serif);font-size:13.5px;line-height:22px;white-space:pre-wrap;overflow-wrap:anywhere}
.rho-dc-inline{display:inline-flex;align-items:baseline;gap:6px;min-width:0}
.rho-dc-inline .rho-dc-q{color:var(--text-muted,#5f6873);font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rho-dc-inline .rho-dc-agent{color:var(--agent,#3a68f0);font-weight:400}
@media (max-width:520px){.rho-dc-summary{grid-template-columns:1fr}.rho-dc-summary .rho-dc-outline{flex-direction:row;flex-wrap:wrap;gap:4px}}
`;
let injected = false;
function injectStyles() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style'); style.dataset.owner = 'rho-plugins.documents.card'; style.textContent = styles; document.head.append(style);
}

const time = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fileName = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.(md|markdown|txt)$/i, '');
const isAgent = (author: string) => author.startsWith('agent:');

// The shared buffer, read when no view has read it yet and kept current. Any view of a
// document can read it this way: every view of one document shares one adapter.
export interface DocumentBufferProps { client: UiClient; projectId: string; documentId?: string; documentVersion?: number; principalId?: string; maxUnconfirmedBytes?: number }
export function useDocumentBuffer({ client, projectId, documentId, principalId, documentVersion, maxUnconfirmedBytes = 1024 * 1024 }: DocumentBufferProps) {
  const held = useMemo(() => documentId ? acquire(client, projectId, documentId, principalId, maxUnconfirmedBytes) : null, [client, projectId, documentId, principalId, maxUnconfirmedBytes]);
  useEffect(() => () => held?.release(), [held]);
  useSyncExternalStore(listener => held ? held.sync.subscribe(listener) : () => undefined, () => held?.sync.stateVersion ?? 0);
  const [failure, setFailure] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!held || held.sync.confirmed) return;
    setFailure('');
    held.sync.load().catch(error => setFailure(error?.message ?? 'This document could not be read.'));
  }, [held, attempt]);
  useEffect(() => { if (held && documentVersion !== undefined) void held.sync.observe(documentVersion).catch(() => undefined); }, [held, documentVersion]);
  return { sync: held?.sync, buffer: held?.sync.confirmed ?? null, failure, retry: () => setAttempt(n => n + 1) };
}

function useHidden(note: string, report?: (note: string) => void) {
  useEffect(() => { report?.(note); }, [note, report]);
}

// One paragraph with the Agent's text and the anchored range marked.
function Text({ content, span, agent, anchor }: { content: string; span: Span; agent: Span[]; anchor?: Span }) {
  const cuts = new Set([span.from, span.to]);
  for (const r of [...agent, ...(anchor ? [anchor] : [])]) for (const at of [r.from, r.to]) if (at > span.from && at < span.to) cuts.add(at);
  const points = [...cuts].sort((a, b) => a - b), out: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!, to = points[i + 1]!, inAgent = agent.some(r => r.from <= from && r.to >= to), inAnchor = !!anchor && anchor.to > anchor.from && anchor.from <= from && anchor.to >= to && (anchor.from > span.from || anchor.to < span.to);
    const text = content.slice(from, to), className = [inAgent && 'rho-dc-agent', inAnchor && 'rho-dc-anchor'].filter(Boolean).join(' ');
    out.push(className ? <span key={from} className={className}>{text}</span> : text);
  }
  return <p className={'rho-dc-text' + (agent.some(r => r.from < span.to && r.to > span.from) ? ' rho-dc-agent' : '')}>{out}</p>;
}

function Cites({ params, Reference }: { params: Record<string, unknown>; Reference?: DocumentCardProps['Reference'] }) {
  const cites = Array.isArray(params.cites) ? params.cites.filter((c): c is string => typeof c === 'string').slice(0, 4) : [];
  if (!cites.length || !Reference) return null;
  return <div className="rho-dc-cites"><span>Cites</span>{cites.map(id => <Reference key={id} itemId={id} />)}</div>;
}

function Shows({ show, params, onParams }: { show: string; params: Record<string, unknown>; onParams?: DocumentCardProps['onParams'] }) {
  if (!onParams) return null;
  const options = documentShows.filter(s => s !== 'change' || typeof params.group === 'string');
  return <span className="rho-dc-shows" role="group" aria-label="Show in this card">
    {options.map(s => <button key={s} aria-pressed={s === show} onClick={() => s !== show && onParams({ ...params, show: s })}>{s[0]!.toUpperCase() + s.slice(1)}</button>)}
  </span>;
}

function Passage({ buffer, params, me, props }: { buffer: Buffer; params: Record<string, unknown>; me?: string; props: DocumentCardProps }) {
  const [before, setBefore] = useState(false);
  const { placed, at } = focusOf(buffer, params);
  const lost = placed?.status === 'unknown' && typeof params.section !== 'string';
  const place = where(buffer.content, at), wanted = limit(params, 'paragraphs', documentCardLimits.passageParagraphs, documentCardLimits.maxPassageParagraphs);
  const shown = lost ? [] : place.paragraphs.slice(place.paragraph, place.paragraph + wanted);
  const agent = useMemo(() => agentSpans(buffer), [buffer]);
  useHidden(lost ? '' : hiddenNote('card', 'passage', { paragraphsInSection: place.paragraphs.length, shownParagraphs: shown.length, sections: place.sections.length }), props.reportHidden);
  const anchor = placed && placed.status !== 'unknown' ? placed : undefined;
  return <div className="rho-dc">
    <div className="rho-dc-crumb">
      <span className="rho-dc-fill">{placed?.status === 'rewritten' ? <>Rewritten by {authorLabel(placed.by!, me)} since it was marked</>
        : <>{fileName(buffer.path)} · {sectionName(place.section)}{shown.length ? ` · ¶${place.paragraph + 1}` : ''}{placed?.status === 'edited' ? ` · changed since by ${authorLabel(placed.by!, me)}` : ''}</>}</span>
      {placed?.status === 'rewritten' && placed.before !== undefined && <button className="rho-dc-link" aria-expanded={before} onClick={() => setBefore(v => !v)}>{before ? 'Hide before' : 'Show before'}</button>}
      <Shows show="passage" params={params} onParams={props.onParams} />
    </div>
    {lost && <p className="rho-dc-note">The marked place is no longer known: the edits since it was marked are not all kept.</p>}
    {before && placed?.before !== undefined && <p className="rho-dc-text"><del>{placed.before}</del></p>}
    {!lost && !shown.length && <p className="rho-dc-note">This section has no text yet.</p>}
    {shown.map(p => <Text key={p.from} content={buffer.content} span={p} agent={agent} anchor={anchor} />)}
    <Cites params={params} Reference={props.Reference} />
  </div>;
}

function useExcerpt(sync: DocumentSync, group: Group | undefined) {
  const [shown, setShown] = useState<ReturnType<typeof excerpt> | 'unavailable' | null>(null);
  const key = group ? group.changeIds.join(',') : '';
  useEffect(() => {
    if (!group) return;
    let live = true; setShown(null);
    sync.before(group).then(({ before, after }) => live && setShown(excerpt(before, after)), () => live && setShown('unavailable'));
    return () => { live = false; };
  }, [sync, key]);
  return shown;
}

function Change({ sync, buffer, params, me, props }: { sync: DocumentSync; buffer: Buffer; params: Record<string, unknown>; me?: string; props: DocumentCardProps }) {
  const group = findGroup(buffer, params.group), shown = useExcerpt(sync, group);
  const spans = group ? placedGroups(buffer).find(g => g.changeIds[0] === group.changeIds[0])?.spans ?? [] : [];
  useHidden(group ? hiddenNote('card', 'change', { sections: 0 }) : '', props.reportHidden);
  const section = spans.length ? sectionAt(sections(buffer.content), spans[0]!.from) : undefined;
  const context = spans.length ? { from: Math.min(...spans.map(s => s.from)), to: Math.max(...spans.map(s => s.to)), version: buffer.version } : null;
  return <div className="rho-dc">
    <div className="rho-dc-crumb">
      <span className="rho-dc-fill">{group ? <><span className={'rho-dc-who' + (isAgent(group.author) ? ' rho-dc-agent' : '')}>{authorLabel(group.author, me)}</span>{section ? ' · ' + sectionName(section) : ''} · {describe(group)} · {time(group.at)}</> : 'This change is no longer in the kept history.'}</span>
      <Shows show="change" params={params} onParams={props.onParams} />
    </div>
    {group && (shown === 'unavailable' ? <p className="rho-dc-note">The text before this change is no longer kept.</p>
      : shown ? <p className="rho-dc-text">{shown.lead}<del>{shown.removed}</del><ins>{shown.inserted}</ins>{shown.trail}</p> : <p className="rho-dc-note">Reading the change…</p>)}
    {group && <div className="rho-dc-actions">
      {context && props.onParams && <button className="rho-dc-link" onClick={() => props.onParams!({ ...params, show: 'passage', anchor: context })}>Show context</button>}
      {isAgent(group.author) && group.active && props.editable && <button className="rho-dc-link" onClick={() => void sync.revert(group)}>Revert this</button>}
      {group.author === me && group.kind === 'edit' && <span className="rho-dc-note">Your edit: ⌘Z in the editor undoes it.</span>}
    </div>}
  </div>;
}

function OutlineList({ buffer, current, me, cap }: { buffer: Buffer; current?: number; me?: string; cap: number }) {
  const rows = marksBySection(buffer, me);
  const start = current === undefined ? 0 : Math.max(0, Math.min(current - Math.floor(cap / 2), rows.length - cap));
  return <ol className="rho-dc-outline">{rows.slice(start, start + cap).map(({ section, agent, mine }, i) => <li key={section.from} className={start + i === current ? 'rho-dc-current' : undefined} aria-current={start + i === current || undefined}>
    <span className="rho-dc-n">{start + i + 1}</span><span className="rho-dc-t">{sectionName(section)}</span>
    <span className="rho-dc-m">{agent > 0 && <span className="rho-dc-agent">Claude Code {agent}</span>}{mine > 0 && <span>You {mine}</span>}</span>
  </li>)}</ol>;
}

function Outline({ buffer, params, me, props }: { buffer: Buffer; params: Record<string, unknown>; me?: string; props: DocumentCardProps }) {
  const { at, sections: list } = focusOf(buffer, params);
  const pointed = readCurrent(params, list, at), cap = limit(params, 'sections', documentCardLimits.outlineSections, documentCardLimits.maxOutlineSections);
  useHidden(hiddenNote('card', 'outline', { sections: list.length, shownSections: Math.min(cap, list.length) }), props.reportHidden);
  return <div className="rho-dc">
    <div className="rho-dc-crumb"><span className="rho-dc-fill">{fileName(buffer.path)} · {count(list.length, 'section')}</span><Shows show="outline" params={params} onParams={props.onParams} /></div>
    <OutlineList buffer={buffer} current={pointed} me={me} cap={cap} />
  </div>;
}
// The section an item points at, if it points at one.
function readCurrent(params: Record<string, unknown>, list: ReturnType<typeof sections>, at: number) {
  return params.anchor || typeof params.section === 'string' ? list.indexOf(sectionAt(list, at)!) : undefined;
}

function ChangeRow({ sync, group, me, editable }: { sync: DocumentSync; group: Group; me?: string; editable?: boolean }) {
  const [open, setOpen] = useState(false), shown = useExcerpt(sync, open ? group : undefined);
  return <li>
    <span className={'rho-dc-who' + (isAgent(group.author) ? ' rho-dc-agent' : '')}>{authorLabel(group.author, me)}</span>
    <span className="rho-dc-what">{describe(group)} · {time(group.at)}</span>
    <span className="rho-dc-acts">
      <button className="rho-dc-link" aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? 'Hide before' : 'Show before'}</button>
      {isAgent(group.author) && group.active && editable && <button className="rho-dc-link" onClick={() => void sync.revert(group)}>Revert</button>}
      {group.author === me && <span className="rho-dc-note">⌘Z undoes yours</span>}
    </span>
    {open && (shown === 'unavailable' ? <span className="rho-dc-note">The text before this change is no longer kept.</span> : shown && <pre>{shown.lead}<del>{shown.removed}</del><ins>{shown.inserted}</ins>{shown.trail}</pre>)}
  </li>;
}

function Summary({ sync, buffer, params, me, props }: { sync: DocumentSync; buffer: Buffer; params: Record<string, unknown>; me?: string; props: DocumentCardProps }) {
  const { placed, at } = focusOf(buffer, params);
  const place = where(buffer.content, at), current = place.sections.indexOf(place.section);
  const wanted = limit(params, 'paragraphs', documentCardLimits.summaryParagraphs, documentCardLimits.maxSummaryParagraphs);
  const shown = place.paragraphs.slice(0, wanted);
  const edits = groups(buffer).filter(g => g.kind === 'edit'), changes = limit(params, 'changes', documentCardLimits.summaryChanges, documentCardLimits.maxChanges);
  const recent = edits.slice(-changes).reverse();
  const agent = useMemo(() => agentSpans(buffer), [buffer]);
  useHidden(hiddenNote('summary', '', { paragraphsInSection: place.paragraphs.length, shownParagraphs: shown.length, sections: place.sections.length, olderChanges: edits.length - recent.length }), props.reportHidden);
  return <div className="rho-dc">
    <div className="rho-dc-summary">
      <OutlineList buffer={buffer} current={current} me={me} cap={documentCardLimits.maxOutlineSections} />
      <div className="rho-dc-section">
        {!shown.length && <p className="rho-dc-note">This section has no text yet.</p>}
        {shown.map(p => <Text key={p.from} content={buffer.content} span={p} agent={agent} anchor={placed && placed.status !== 'unknown' ? placed : undefined} />)}
        <Cites params={params} Reference={props.Reference} />
      </div>
    </div>
    {recent.length > 0 && <ul className="rho-dc-changes" aria-label="Recent changes">{recent.map(g => <ChangeRow key={g.changeIds[0]} sync={sync} group={g} me={me} editable={props.editable} />)}</ul>}
  </div>;
}

function Compare({ sync, buffer, params, me, props }: { sync: DocumentSync; buffer: Buffer; params: Record<string, unknown>; me?: string; props: DocumentCardProps }) {
  const group = findGroup(buffer, params.group), shown = useExcerpt(sync, group);
  useHidden(group ? hiddenNote('compare', '', { sections: 0 }) : '', props.reportHidden);
  if (!group) return <div className="rho-dc"><p className="rho-dc-note">{typeof params.group === 'string' ? 'This change is no longer in the kept history.' : 'No change was named to compare.'}</p></div>;
  return <div className="rho-dc">
    <div className="rho-dc-crumb"><span className="rho-dc-fill"><span className={'rho-dc-who' + (isAgent(group.author) ? ' rho-dc-agent' : '')}>{authorLabel(group.author, me)}</span> · {describe(group)} · {time(group.at)}</span><span>View only</span></div>
    {shown === 'unavailable' ? <p className="rho-dc-note">The text before this change is no longer kept.</p> : shown ? <div className="rho-dc-pair">
      <span>Before</span><p>{shown.lead}<del>{shown.removed}</del>{shown.trail}</p>
      <span>After</span><p>{shown.lead}<ins>{shown.inserted}</ins>{shown.trail}</p>
    </div> : <p className="rho-dc-note">Reading the change…</p>}
    {isAgent(group.author) && group.active && props.editable && <div className="rho-dc-actions"><button className="rho-dc-link" onClick={() => void sync.revert(group)}>Revert this</button></div>}
  </div>;
}

// A reference is phrasing content: the application draws it inside its own chip.
function Inline({ buffer, params, me }: { buffer: Buffer; params: Record<string, unknown>; me?: string }) {
  const { placed, at, sections: list } = focusOf(buffer, params);
  if (placed && placed.status !== 'unknown' && params.show !== 'changes') {
    const place = where(buffer.content, at), text = buffer.content.slice(placed.from, Math.max(placed.to, Math.min(buffer.content.length, placed.from + 40)));
    return <span className="rho-dc-inline"><span>{sectionName(place.section)} ¶{place.paragraph + 1}</span><span className="rho-dc-q">“{quote(text)}”</span></span>;
  }
  const section = typeof params.section === 'string' || placed ? sectionAt(list, at) : undefined;
  const marks = marksBySection(buffer, me).filter(m => !section || m.section === section);
  const agent = marks.reduce((n, m) => n + m.agent, 0), mine = marks.reduce((n, m) => n + m.mine, 0);
  return <span className="rho-dc-inline"><span>{section ? sectionName(section) : fileName(buffer.path)}</span>
    {agent > 0 && <span className="rho-dc-agent">Claude Code {agent}</span>}{mine > 0 && <span className="rho-dc-q">You {mine}</span>}{!agent && !mine && <span className="rho-dc-q">no marked changes</span>}</span>;
}

export function DocumentCardBody(props: DocumentCardProps) {
  injectStyles();
  const { sync, buffer, failure, retry } = useDocumentBuffer(props);
  const me = sync?.me ?? props.principalId, params = props.params;
  if (!props.documentId) return props.form === 'inline' ? <span>No document</span> : <p className="rho-dc-note">This item has no document.</p>;
  if (!buffer || !sync) {
    if (props.form === 'inline') return <span>{failure ? 'Unreadable' : 'Reading…'}</span>;
    return <div className="rho-dc">{failure ? <><p className="rho-dc-note" role="alert">{failure}</p><div className="rho-dc-actions"><button className="rho-dc-link" onClick={retry}>Try again</button></div></> : <p className="rho-dc-note">Reading the document…</p>}</div>;
  }
  if (props.form === 'inline') return <Inline buffer={buffer} params={params} me={me} />;
  if (props.form === 'summary') return <Summary sync={sync} buffer={buffer} params={params} me={me} props={props} />;
  if (props.form === 'compare') return <Compare sync={sync} buffer={buffer} params={params} me={me} props={props} />;
  const show = showOf(params);
  if (show === 'change') return <Change sync={sync} buffer={buffer} params={params} me={me} props={props} />;
  if (show === 'outline') return <Outline buffer={buffer} params={params} me={me} props={props} />;
  return <Passage buffer={buffer} params={params} me={me} props={props} />;
}
