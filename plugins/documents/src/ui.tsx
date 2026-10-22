// Optional browser entry for rho.editor. The application supplies a scoped
// client and a place in its context panel; this entry never imports the shell.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Annotation, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { acquire, authorLabel, currentRanges, diff, groups, readVersion, type DocumentSync, type Group, type UiClient } from './ui-model.js';

export interface EditorViewProps {
  view: { id: string; props: Record<string, unknown>; bindings: Record<string, unknown> };
  projectId: string;
  client: UiClient;
  active: boolean;
  documentVersion?: number;
  principalId?: string;
  contextTarget?: HTMLElement | null;
  headerTarget?: HTMLElement | null;
  maxUnconfirmedBytes?: number;
  // False when this session may read but not edit; the view stays readable.
  editable?: boolean;
  appearance?: 'document' | 'message';
  onDraftState?: (state: { documentId: string; version: number | null; ready: boolean }) => void;
}

const remote = Annotation.define<boolean>();
const marks = StateEffect.define<{ from: number; to: number }[]>();
const agentLine = Decoration.line({ class: 'rho-doc-agent-line' });
const agentMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(marks)) {
      const builder = new RangeSetBuilder<Decoration>(), doc = tr.state.doc, seen = new Set<number>();
      const lines = effect.value.flatMap(r => { const out: number[] = []; for (let n = doc.lineAt(Math.min(r.from, doc.length)).number; n <= doc.lineAt(Math.min(Math.max(r.to - 1, r.from), doc.length)).number; n++) out.push(n); return out; });
      for (const n of [...new Set(lines)].sort((a, b) => a - b)) if (!seen.has(n)) { seen.add(n); const line = doc.line(n); builder.add(line.from, line.from, agentLine); }
      value = builder.finish();
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', color: 'var(--text, #1f2328)', backgroundColor: 'var(--surface, #fff)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, "JetBrains Mono", ui-monospace, monospace)', fontVariantLigatures: 'none', fontFeatureSettings: '"liga" 0, "calt" 0', lineHeight: '20px' },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--text, #1f2328)' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted, #8b939d)' },
  '.cm-line': { padding: '0 12px', borderLeft: '2px solid transparent' },
  '.rho-doc-agent-line': { borderLeftColor: 'var(--agent, #2f6fde)', backgroundColor: 'var(--agent-wash, rgba(47,111,222,0.06))' },
  '&.cm-focused': { outline: 'none' },
});

const styles = `
.rho-doc{display:flex;flex-direction:column;height:100%;min-height:0}
.rho-doc-editor{flex:1;min-height:0;overflow:hidden}
.rho-doc-message .cm-scroller{font-family:inherit;line-height:19px}
.rho-doc-band{display:flex;gap:8px;align-items:center;padding:6px 12px;font-size:12px;border-bottom:1px solid var(--border,#e4e7eb);background:var(--surface-muted,#f6f7f9);color:var(--text,#1f2328)}
.rho-doc-band button,.rho-doc-changes button{font:inherit;font-size:12px;border:1px solid var(--border,#d6dae0);background:var(--surface,#fff);color:inherit;border-radius:6px;padding:2px 8px;cursor:pointer}
.rho-doc-band .rho-doc-fill{flex:1}
.rho-doc-exact{padding:4px 12px;font-size:12px;color:var(--text-muted,#5f6873);border-bottom:1px solid var(--border,#e4e7eb)}
.rho-doc-changes{padding:12px 16px;font-size:12px;color:var(--text,#1f2328)}
.rho-doc-changes h3{font-size:12px;font-weight:600;margin:0 0 6px}
.rho-doc-changes ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.rho-doc-changes li{display:flex;flex-direction:column;gap:3px;padding:6px 8px;border-radius:6px;background:var(--surface-muted,#f6f7f9)}
.rho-doc-changes li.agent{box-shadow:inset 2px 0 0 var(--agent,#2f6fde)}
.rho-doc-changes .who{font-weight:600}
.rho-doc-changes .what{color:var(--text-muted,#5f6873)}
.rho-doc-changes .row{display:flex;gap:6px}
.rho-doc-highlight{display:flex;flex-direction:row;gap:6px;align-items:center;padding:0 12px;font-size:12px;font-weight:400;white-space:nowrap;color:var(--text-muted,#545e63)}
.rho-doc-highlight input{width:14px;height:14px;min-width:14px;min-height:0;margin:0;padding:0;accent-color:var(--accent,#3a68f0)}
.rho-doc-changes pre{margin:4px 0 0;white-space:pre-wrap;font-family:var(--font-mono,ui-monospace,monospace);font-variant-ligatures:none;font-size:11px;max-height:160px;overflow:auto;padding:6px;border-radius:4px;background:var(--surface,#fff)}
.rho-doc-changes del{background:rgba(207,34,46,.12);text-decoration:none}
.rho-doc-changes ins{background:rgba(26,127,55,.12);text-decoration:none}
`;
let injected = false;
function injectStyles() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style'); style.dataset.owner = 'rho-plugins.documents'; style.textContent = styles; document.head.append(style);
}

function describe(group: Group) {
  if (group.kind === 'undo-own') return 'Undid their edit';
  if (group.kind === 'revert') return 'Reverted a change';
  if (group.kind === 'undo') return 'Undid the last edit';
  if (!group.active) return 'Edit, since reverted';
  if (!group.lines) return 'Edit, since overwritten';
  return group.lines[0] === group.lines[1] ? `Changed line ${group.lines[0]}` : `Changed lines ${group.lines[0]}–${group.lines[1]}`;
}
const ago = (at: string) => { const s = Math.max(0, (Date.now() - Date.parse(at)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };

function excerpt(before: string, after: string) {
  const edit = diff(before, after);
  const start = edit?.from ?? 0, end = edit ? before.length - edit.to : before.length;
  const lineStart = before.lastIndexOf('\n', start - 1) + 1;
  const tailA = before.indexOf('\n', before.length - end);
  return { lead: before.slice(lineStart, start), removed: before.slice(start, before.length - end), inserted: after.slice(start, after.length - end), trail: before.slice(before.length - end, tailA < 0 ? before.length : tailA) };
}

function Changes({ sync, me, canRevert }: { sync: DocumentSync; me?: string; canRevert: boolean }) {
  const buffer = sync.confirmed;
  const list = useMemo(() => buffer ? groups(buffer).reverse().slice(0, 30) : [], [buffer]);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState<ReturnType<typeof excerpt> | 'unavailable' | null>(null);
  const toggle = async (group: Group) => {
    if (open === group.groupId) { setOpen(null); return; }
    setOpen(group.groupId); setShown(null);
    try { const { before, after } = await sync.before(group); setShown(excerpt(before, after)); } catch { setShown('unavailable'); }
  };
  return <section className="rho-doc-changes" aria-label="Changes">
    <h3>Changes</h3>
    {list.length === 0 ? <p className="what">No edits yet.</p> : <ul>{list.map(group => {
      const agent = group.author.startsWith('agent:');
      return <li key={group.groupId + group.changeIds[0]} className={agent ? 'agent' : undefined}>
        <span><span className="who">{authorLabel(group.author, me)}</span> · <span className="what">{describe(group)} · {ago(group.at)}{group.author === me && group.kind === 'edit' ? ' · ⌘Z undoes only your edits' : ''}</span></span>
        {group.kind === 'edit' && <span className="row">
          <button aria-expanded={open === group.groupId} onClick={() => void toggle(group)}>{open === group.groupId ? 'Hide before' : 'Show before'}</button>
          {agent && group.active && canRevert && <button onClick={() => void sync.revert(group)}>Revert</button>}
        </span>}
        {open === group.groupId && (shown === 'unavailable' ? <span className="what">The text before this change is no longer kept.</span> : shown && <pre>{shown.lead}<del>{shown.removed}</del><ins>{shown.inserted}</ins>{shown.trail}</pre>)}
      </li>;
    })}</ul>}
  </section>;
}

export function DocumentEditorView(props: EditorViewProps) {
  const binding = props.view.bindings.document as { documentId: string; version?: number; kind?: string } | undefined;
  return binding?.kind !== 'live-document' && typeof binding?.version === 'number'
    ? <PinnedDocumentView key={binding.documentId + ':' + binding.version} {...props} documentId={binding.documentId} version={binding.version} />
    : <LiveDocumentView {...props} />;
}

function PinnedDocumentView({ view, projectId, client, documentId, version }: EditorViewProps & { documentId: string; version: number }) {
  injectStyles();
  const host = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false, editor: EditorView | undefined;
    setFailure('');
    void readVersion(client, projectId, documentId, version).then(content => {
      if (disposed || !host.current) return;
      editor = new EditorView({ parent: host.current, doc: content, extensions: [lineNumbers(), EditorView.lineWrapping, theme, EditorView.editable.of(false),
        EditorView.contentAttributes.of({ 'aria-label': String(view.props.title ?? 'Document'), 'aria-readonly': 'true' })] });
    }, error => { if (!disposed) setFailure(error.message); });
    return () => { disposed = true; editor?.destroy(); };
  }, [client, projectId, documentId, version, attempt]);
  return <div className="rho-doc"><p className="rho-doc-exact">Showing version {version}. This view is pinned and can’t be edited here.</p>
    {failure && <div className="rho-doc-band" role="alert"><span className="rho-doc-fill">{failure}</span><button onClick={() => setAttempt(n => n + 1)}>Try again</button></div>}
    <div className="rho-doc-editor" ref={host} />
  </div>;
}

function LiveDocumentView({ view, projectId, client, active, documentVersion, principalId, contextTarget, headerTarget, maxUnconfirmedBytes = 1024 * 1024, editable = true, appearance = 'document', onDraftState }: EditorViewProps) {
  injectStyles();
  const binding = view.bindings.document as { documentId: string; version?: number; kind?: string } | undefined;
  const documentId = binding?.documentId ?? '';
  const readOnly = !editable;
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const [showAgent, setShowAgent] = useState(true);
  const [failure, setFailure] = useState('');
  const [composing, setComposing] = useState(false);
  const held = useMemo(() => acquire(client, projectId, documentId, principalId, maxUnconfirmedBytes), [client, projectId, documentId, principalId, maxUnconfirmedBytes]);
  const sync = held.sync;
  const draftStateCallback = useRef(onDraftState);
  draftStateCallback.current = onDraftState;
  useEffect(() => () => held.release(), [held]);
  const tick = useSyncExternalStore(listener => sync.subscribe(listener), () => sync.stateVersion);
  useEffect(() => { onDraftState?.({ documentId, version: sync.confirmed?.version ?? null, ready: !!sync.confirmed && !sync.busy && !sync.aside && !composing }); }, [sync, tick, documentId, composing, onDraftState]);

  useEffect(() => {
    if (!host.current || !documentId) return;
    const extensions: Extension[] = [...(appearance === 'message' ? [] : [lineNumbers()]), EditorView.lineWrapping, theme, agentMarks,
      EditorView.contentAttributes.of({ 'aria-label': String(view.props.title ?? 'Document'), spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      EditorView.editable.of(!readOnly),
      EditorState.transactionFilter.of(tr => {
        if (!tr.docChanged || tr.annotation(remote)) return tr;
        if (!sync.confirmed || sync.aside || readOnly) return [];
        if (new TextEncoder().encode(tr.newDoc.toString()).length > sync.limits.maxUnconfirmedBytes) { queueMicrotask(() => sync.refuseInput()); return []; }
        return tr;
      }),
      keymap.of([
        { key: 'Mod-z', preventDefault: true, run: () => { if (!readOnly) void sync.undo(); return true; } },
        { key: 'Mod-Shift-z', preventDefault: true, run: () => true },
        { key: 'Mod-y', preventDefault: true, run: () => true },
      ]),
      EditorView.domEventHandlers({ compositionstart: () => { draftStateCallback.current?.({ documentId, version: sync.confirmed?.version ?? null, ready: false }); setComposing(true); return false; }, compositionend: () => { setComposing(false); setTimeout(() => sync.flush(), 0); return false; } }),
      EditorView.updateListener.of(update => {
        if (update.docChanged && !update.transactions.some(t => t.annotation(remote))) {
          draftStateCallback.current?.({ documentId, version: sync.confirmed?.version ?? null, ready: false });
          sync.local(port);
        }
      })];
    const cm = new EditorView({ parent: host.current, doc: sync.sent, extensions });
    editor.current = cm;
    const port = {
      text: () => cm.state.doc.toString(),
      composing: () => cm.composing,
      replace(next: string) {
        const current = cm.state.doc.toString();
        if (current === next) return;
        const edit = diff(current, next)!;
        cm.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, annotations: remote.of(true) });
      },
    };
    const detach = sync.attach(port);
    if (!sync.confirmed) sync.load().catch(error => setFailure(error?.message ?? 'This document could not be read.'));
    else port.replace(sync.sent);
    return () => { detach(); cm.destroy(); editor.current = null; };
  }, [sync, documentId, readOnly, appearance]);

  useEffect(() => { if (documentVersion !== undefined) void sync.observe(documentVersion).catch(() => undefined); }, [sync, documentVersion]);

  useEffect(() => {
    const cm = editor.current, buffer = sync.confirmed;
    if (!cm || !buffer) return;
    const ranges = showAgent ? currentRanges(buffer.history ?? [], e => e.kind === 'edit' && e.author.startsWith('agent:')) : [];
    const live = (buffer.history ?? []).length ? groupsActive(buffer) : new Set<string>();
    cm.dispatch({ effects: marks.of(ranges.filter(r => live.has(r.changeId))) });
  }, [sync, tick, showAgent]);

  if (!documentId) return <div className="rho-doc"><p className="rho-doc-exact">This view has no document.</p></div>;
  const changes = <Changes sync={sync} me={sync.me} canRevert={!readOnly} />;
  return <div className={'rho-doc' + (appearance === 'message' ? ' rho-doc-message' : '')} data-active={active || undefined}>
    {!editable && <p className="rho-doc-exact">This tab can read this document but not edit it.</p>}
    {failure && <div className="rho-doc-band" role="alert"><span className="rho-doc-fill">{failure}</span><button onClick={() => { setFailure(''); void sync.load().catch(e => setFailure(e?.message ?? 'This document could not be read.')); }}>Try again</button></div>}
    {sync.aside && <div className="rho-doc-band" role="status"><span className="rho-doc-fill">The text changed while you were typing. Your last keystrokes were kept aside.</span>
      <button onClick={() => void navigator.clipboard?.writeText(sync.aside!.text)}>Copy them</button><button onClick={() => sync.discardAside()}>Dismiss</button></div>}
    {sync.notice && <div className="rho-doc-band" role="status"><span className="rho-doc-fill">{sync.notice}</span></div>}
    <div className="rho-doc-editor" ref={host} />
    {active && headerTarget && createPortal(<label className="rho-doc-highlight"><input type="checkbox" checked={showAgent} onChange={e => setShowAgent(e.target.checked)} />Claude Code's edits</label>, headerTarget)}
    {active && (contextTarget ? createPortal(changes, contextTarget) : contextTarget === null ? null : <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border,#e4e7eb)', maxHeight: '40%', overflow: 'auto' }}>{changes}</div>)}
  </div>;
}

function groupsActive(buffer: NonNullable<DocumentSync['confirmed']>) {
  return new Set(groups(buffer).filter(g => g.active).flatMap(g => g.changeIds));
}

export const editorEntry = {
  component: 'rho.editor', componentVersion: '0.2.0', owner: 'rho-plugins.documents', package: '@rho-workspace/plugin-documents',
  bindings: { document: 'document' as const },
  requiredOperations: ['document.read', 'document.edit', 'document.undoOwn', 'document.revert', 'document.change.read'],
  selection: ['document-utf16' as const],
  View: DocumentEditorView,
};
