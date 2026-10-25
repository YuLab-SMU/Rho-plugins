// Optional browser entry for rho.editor. The application supplies a scoped
// client and a place in its context panel; this entry never imports the shell.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Annotation, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { acquire, authorLabel, currentRanges, diff, groups, readVersion, type DocumentSync, type Group, type UiClient } from './ui-model.js';
import { describe, excerpt } from './ui-card-model.js';

export interface EditorViewProps {
  view: { id: string; props: Record<string, unknown>; bindings: Record<string, unknown> };
  projectId: string;
  client: UiClient;
  active: boolean;
  documentVersion?: number;
  documentRevision?: number;
  principalId?: string;
  contextTarget?: HTMLElement | null;
  headerTarget?: HTMLElement | null;
  maxUnconfirmedBytes?: number;
  // False when this session may read but not edit; the view stays readable.
  editable?: boolean;
  saveable?: boolean;
  appearance?: 'document' | 'message';
  onDraftState?: (state: { documentId: string; version: number | null; ready: boolean }) => void;
  // True when this session may prepare context for the Agent (context.create).
  askable?: boolean;
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
.rho-doc-problem{font-size:12px;color:var(--color-failed,#b23b37);white-space:normal}
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

const ago = (at: string) => { const s = Math.max(0, (Date.now() - Date.parse(at)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };

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

function LiveDocumentView({ view, projectId, client, active, documentVersion, documentRevision, principalId, contextTarget, headerTarget, maxUnconfirmedBytes = 1024 * 1024, editable = true, saveable = false, appearance = 'document', onDraftState, askable = false }: EditorViewProps) {
  injectStyles();
  const binding = view.bindings.document as { documentId: string; version?: number; kind?: string } | undefined;
  const documentId = binding?.documentId ?? '';
  const readOnly = !editable;
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const [showAgent, setShowAgent] = useState(true);
  const [failure, setFailure] = useState('');
  const [composing, setComposing] = useState(false);
  const [range, setRange] = useState<{ from: number; to: number; lines: [number, number] } | null>(null);
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
        { key: 'Mod-s', preventDefault: true, run: () => { if (saveable) void sync.save(); return true; } },
        { key: 'Mod-z', preventDefault: true, run: () => { if (!readOnly) void sync.undo(); return true; } },
        { key: 'Mod-Shift-z', preventDefault: true, run: () => true },
        { key: 'Mod-y', preventDefault: true, run: () => true },
      ]),
      EditorView.domEventHandlers({ compositionstart: () => { draftStateCallback.current?.({ documentId, version: sync.confirmed?.version ?? null, ready: false }); setComposing(true); return false; }, compositionend: () => { setComposing(false); setTimeout(() => sync.flush(), 0); return false; } }),
      EditorView.updateListener.of(update => {
        if (update.selectionSet || update.docChanged) {
          const main = update.state.selection.main;
          setRange(main.empty ? null : { from: main.from, to: main.to, lines: [update.state.doc.lineAt(main.from).number, update.state.doc.lineAt(main.to).number] });
        }
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
  }, [sync, documentId, readOnly, saveable, appearance]);

  useEffect(() => { if (documentVersion !== undefined) void sync.observe(documentVersion, documentRevision).catch(() => undefined); }, [sync, documentVersion, documentRevision]);

  useEffect(() => {
    const cm = editor.current, buffer = sync.confirmed;
    if (!cm || !buffer) return;
    const ranges = showAgent ? currentRanges(buffer.history ?? [], e => e.kind === 'edit' && e.author.startsWith('agent:')) : [];
    const live = (buffer.history ?? []).length ? groupsActive(buffer) : new Set<string>();
    cm.dispatch({ effects: marks.of(ranges.filter(r => live.has(r.changeId))) });
  }, [sync, tick, showAgent]);

  if (!documentId) return <div className="rho-doc"><p className="rho-doc-exact">This view has no document.</p></div>;
  const changes = <Changes sync={sync} me={sync.me} canRevert={!readOnly} />;
  const save = saveable && <button type="button" aria-label="Save document" disabled={!sync.confirmed || !!sync.aside || composing || !sync.confirmed.dirty && !sync.busy}
    onClick={() => void sync.save()}>Save</button>;
  return <div className={'rho-doc' + (appearance === 'message' ? ' rho-doc-message' : '')} data-active={active || undefined}>
    {!editable && <p className="rho-doc-exact">This tab can read this document but not edit it.</p>}
    {failure && <div className="rho-doc-band" role="alert"><span className="rho-doc-fill">{failure}</span><button onClick={() => { setFailure(''); void sync.load().catch(e => setFailure(e?.message ?? 'This document could not be read.')); }}>Try again</button></div>}
    {sync.aside && <div className="rho-doc-band" role="status"><span className="rho-doc-fill">The text changed while you were typing. Your last keystrokes were kept aside.</span>
      <button onClick={() => void navigator.clipboard?.writeText(sync.aside!.text)}>Copy them</button><button onClick={() => sync.discardAside()}>Dismiss</button></div>}
    {sync.notice && <div className="rho-doc-band" role="status"><span className="rho-doc-fill">{sync.notice}</span></div>}
    {sync.unconfirmed && <div className="rho-doc-band" role="status" data-rho-unconfirmed=""><span className="rho-doc-fill">Your last change is not confirmed yet. It stays here and is sent again until Rho answers.</span></div>}
    <div className="rho-doc-editor" ref={host} />
    {active && headerTarget && createPortal(<>{save}{askable && appearance === 'document' && <AskAboutSelection client={client} projectId={projectId} documentId={documentId} range={range} version={sync.confirmed && !sync.busy && !sync.aside && !composing && sync.sent === sync.confirmed.content ? sync.confirmed.version : null} />}<label className="rho-doc-highlight"><input type="checkbox" checked={showAgent} onChange={e => setShowAgent(e.target.checked)} />Claude Code's edits</label></>, headerTarget)}
    {active && !headerTarget && save && <div className="rho-doc-band">{save}</div>}
    {active && (contextTarget ? createPortal(changes, contextTarget) : contextTarget === null ? null : <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border,#e4e7eb)', maxHeight: '40%', overflow: 'auto' }}>{changes}</div>)}
  </div>;
}

// Handing a selection to the Agent: the exact UTF-16 range of one buffer version, which the
// owner freezes with its path and whether that text is saved. Only settled text is handed
// over; a selection the buffer has since moved past is refused, and the person selects again.
function AskAboutSelection({ client, projectId, documentId, range, version }: { client: UiClient; projectId: string; documentId: string; range: { from: number; to: number; lines: [number, number] } | null; version: number | null }) {
  const [prepared, setPrepared] = useState<{ request: string; unsaved: boolean } | null>(null), [problem, setProblem] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
  useEffect(() => { setPrepared(null); setCopied(false); setProblem(''); }, [range?.from, range?.to, version]);
  if (!range && !prepared) return null;
  async function ask() {
    if (!range || version === null) return;
    setBusy(true); setProblem('');
    try {
      const context = await client.call('context.create', { projectId, changeId: 'select-' + globalThis.crypto.randomUUID(), expectedVersion: 0, document: { documentId, version, from: range.from, to: range.to } });
      const source = context.document.source as { path: string; version: number; dirty: boolean };
      const lines = range.lines[0] === range.lines[1] ? `line ${range.lines[0]}` : `lines ${range.lines[0]}–${range.lines[1]}`;
      setPrepared({ unsaved: source.dirty, request: `Read Rho context ${context.contextId}: ${lines} of ${source.path} at buffer version ${source.version}, ${source.dirty ? 'unsaved text that differs from the file on disk' : 'the same as the saved file'}.` });
    } catch (error: any) {
      setProblem(error?.error?.kind === 'stale' || error?.kind === 'stale' ? 'The text changed after you selected it. Select it again.' : error?.error?.message ?? error?.message ?? 'The selection could not be prepared.');
    } finally { setBusy(false); }
  }
  async function copy() {
    if (!prepared) return;
    try { await navigator.clipboard.writeText(prepared.request); setCopied(true); } catch { setProblem('Could not copy. Try again.'); }
  }
  return <>{prepared
    ? <button type="button" onClick={copy} title={prepared.unsaved ? 'The selected text is unsaved' : 'The selected text matches the saved file'}>{copied ? 'Copied' : 'Copy request for the Agent'}</button>
    : <button type="button" disabled={busy || version === null} title={version === null ? 'Wait until your typing is saved to the shared buffer' : undefined} onClick={ask}>{busy ? 'Preparing…' : 'Ask the Agent about this'}</button>}
    {problem && <span role="alert" className="rho-doc-problem">{problem}</span>}</>;
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

export { DocumentCardBody, documentForms, type DocumentCardProps } from './ui-card.js';
