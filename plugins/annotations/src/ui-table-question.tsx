// Optional UI: a table question uses the Documents draft, immutable Annotations thread
// and Agent context. There is no browser-owned copy of its text or delivery state.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DocumentEditorView } from '@rho-workspace/plugin-documents/ui';
type Ref = { id: string; version: string };
interface Client { call(method: string, input: any): Promise<any> }
interface Props {
  projectId: string; viewId: string; resource: Ref; client: Client; principalId?: string;
  documents: { id: string; version: number }[]; threads: any[]; contexts: any[];
  onOpenResource?: (ref: Ref) => void; onRoutedQuestion?: () => void; enabled: boolean;
  // Where the host keeps this view's own controls; without one they stay above the thread.
  headerTarget?: HTMLElement | null;
}
interface Intent { id: string; path: string; anchor: { kind: 'table'; resource: Ref; entities: string[] }; input?: any; contextId?: string }
export function TableQuestion({ projectId, viewId, resource, client, principalId, documents, threads, contexts, onOpenResource, onRoutedQuestion, enabled, headerTarget }: Props) {
  const key = ['rho-table-question/1', projectId, principalId, viewId, resource.id, resource.version].join(':');
  const [intent, setIntent] = useState<Intent | null>(() => { try { return JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { return null; } });
  // Open while the person is writing or retrying; a submitted question folds to one status line
  // so the table it is about keeps the screen.
  const [expanded, setExpanded] = useState(!!intent && !intent.contextId), [documentId, setDocumentId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const guard = useRef(false), draft = useRef<{ version: number | null; ready: boolean }>({ version: null, ready: false });
  const [ready, setReady] = useState(false);
  const onDraftState = useCallback((state: { version: number | null; ready: boolean }) => { draft.current = state; setReady(state.ready); }, []);
  function remember(next: Intent) {
    if (new TextEncoder().encode(JSON.stringify(next)).length > 16384) throw new Error('The 16 KiB question intent limit was reached. Select fewer rows; existing drafts are kept.');
    sessionStorage.setItem(key, JSON.stringify(next)); setIntent(next);
  }
  // Opening a known draft is idempotent; a refresh never resubmits a question.
  useEffect(() => {
    if (!intent) return;
    let live = true;
    client.call('document.open', { projectId, path: intent.path }).then(d => { if (live) setDocumentId(d.id); }, e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [client, projectId, intent?.path]);
  async function begin() {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError('');
    try {
      const channel = await client.call('interaction.selection.read', { projectId, scope: { kind: 'shared', id: viewId } });
      const selected = channel.selection;
      if (!selected?.entities?.length || selected.resource?.id !== resource.id || selected.resource.version !== resource.version) throw new Error('Select rows in this table version before asking.');
      const id = 'q-' + crypto.randomUUID();
      remember({ id, path: intent?.path ?? id + '.md', anchor: { kind: 'table', resource: { id: resource.id, version: resource.version }, entities: [...selected.entities] } });
      setExpanded(true);
    } catch (e: any) { setError(e.message); }
    finally { guard.current = false; setBusy(false); }
  }
  async function send() {
    if (guard.current || !intent) return;
    guard.current = true; setBusy(true); setError('');
    try {
      let current = intent;
      if (!current.input) {
        const chosen = { ...draft.current };
        if (!chosen.ready || chosen.version === null) throw new Error('Wait for the draft to be confirmed.');
        const doc = await client.call('document.read', { projectId, documentId });
        if (!draft.current.ready || draft.current.version !== chosen.version || doc.version !== chosen.version || !doc.content.trim()) throw new Error('Write a question and wait for its draft to be confirmed.');
        current = { ...current, input: { projectId, annotationId: current.id, expectedVersion: 0, changeId: current.id, anchor: current.anchor, draft: { documentId, version: chosen.version } } };
        remember(current); // Original identity and exact draft persist before mutation.
      }
      await client.call('annotation.create', current.input);
      const context = await client.call('context.create', { projectId, changeId: current.id, expectedVersion: 0, annotations: [{ annotationId: current.id, version: 1 }] });
      remember({ ...current, contextId: context.contextId }); setExpanded(false);
    } catch (e: any) { setError(e.message ?? 'Outcome unknown. Retry keeps the original question identity.'); }
    finally { guard.current = false; setBusy(false); }
  }
  const relevant = threads.filter(t => t.anchor?.kind === 'table' && t.anchor.resource.id === resource.id && t.anchor.resource.version === resource.version);
  const facts = (thread: any) => {
    const original = thread.messages[0], replies = thread.messages.filter((m: any) => m.replyTo === original.id);
    const context = contexts.find(c => c.responses?.some((r: any) => r.annotationId === thread.annotationId));
    const answered = replies.some((m: any) => m.author.startsWith('agent:'));
    const status = answered ? 'Explicit Agent response' : context?.delivery === 'tool-fetched' && context.fetchedBy?.startsWith('agent:') ? 'Fetched by Agent · no linked response yet' : context ? 'Prepared · not fetched by Agent' : 'Question retained · context not confirmed';
    return { original, replies, context, answered, status };
  };
  const latest = relevant.length ? facts(relevant[relevant.length - 1]) : null;
  const links = (m: any) => m.resources?.map((r: Ref) => <button disabled={!onOpenResource} key={r.id + r.version} onClick={() => onOpenResource?.(r)}>Open linked result · {r.version.slice(0, 8)}</button>);
  const region = useId(), drafting = !!intent && !intent.contextId;
  const actions = <div className="table-question-actions" role="group" aria-label="Questions about this table version">
    {onRoutedQuestion ? <button onClick={onRoutedQuestion}>Ask assigned Agent about selected rows</button> : enabled && <button disabled={busy} aria-expanded={drafting ? expanded : undefined} aria-controls={drafting && expanded ? region : undefined} onClick={() => { if (drafting) setExpanded(v => !v); else void begin(); }}>{drafting ? 'Question draft' : 'Ask about selected rows'}</button>}
    {latest && <button className="table-question-toggle" aria-expanded={expanded} aria-controls={expanded ? region : undefined} aria-live="polite" onClick={() => setExpanded(v => !v)}>{relevant.length > 1 ? `${relevant.length} questions · ${latest.status}` : latest.status}</button>}
    {!expanded && latest?.replies.flatMap(links)}
  </div>;
  return <section id={region} className="table-question" aria-label="Questions about this table version">
    {headerTarget ? createPortal(actions, headerTarget) : actions}
    {error && <p role="alert">{error}</p>}
    {expanded && intent && !intent.contextId && <div className="table-question-compose">
      <p>Question about rows {intent.anchor.entities.join(', ')} · original table version retained</p>
      {intent.input ? <p>Submitted draft version {intent.input.draft.version} retained. Retry sends this exact version.</p> : documentId && <div className="table-question-editor"><DocumentEditorView view={{ id: viewId + ':question', props: { title: 'Your question' }, bindings: { document: { kind: 'live-document', documentId } } }} projectId={projectId} client={client} active principalId={principalId} documentVersion={documents.find(d => d.id === documentId)?.version} onDraftState={onDraftState} appearance="message" editable contextTarget={null} /></div>}
      <button disabled={busy || !intent.input && !ready} onClick={() => void send()}>{busy ? 'Submitting…' : intent.input ? 'Retry original question' : 'Send question'}</button>
      <span role="status">{intent.input ? 'Original submission retained' : ready ? 'Draft confirmed in workspace' : 'Confirming draft…'}</span>
    </div>}
    {expanded && relevant.map(thread => {
      const { original, replies, context, answered, status } = facts(thread);
      return <article key={thread.annotationId} className="table-question-thread">
        <p>{original.draft.text}</p><small>Rows: {thread.anchor.entities.join(', ')}</small>
        <p role="status">{status}</p>
        {context && !onRoutedQuestion && !answered && <p>No session is assigned to this layout. The context reference can be passed to an Agent connected to this project.</p>}
        {context && <details><summary>Context reference</summary><code>{context.contextId}</code></details>}
        {replies.map((m: any) => <div className="table-question-reply" key={m.id}><strong>{m.author.startsWith('agent:') ? 'Agent response' : 'Participant response'}</strong><p>{m.draft.text}</p>{links(m)}</div>)}
        <details><summary>Original source and reply references</summary><p>{thread.anchor.resource.id}@{thread.anchor.resource.version}</p><p>{thread.annotationId} · {original.id}</p><p>{thread.sourceStatus?.state ?? 'Source status not observed'}</p></details>
      </article>;
    })}
  </section>;
}
