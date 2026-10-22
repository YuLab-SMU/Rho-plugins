// Optional contextual entry. Documents owns the live question buffer and undo;
// Agent owns submission/delivery, and Annotations owns the immutable message.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DocumentEditorView } from '@rho-workspace/plugin-documents/ui';
import { feedbackComposerPropsSchema } from './contract.js';
interface Client { call(method: string, input: any): Promise<any> }
interface Props {
  view: { id: string; props: Record<string, any>; bindings: Record<string, any> };
  projectId: string; client: Client; active: boolean; principalId?: string;
  configuration: { compositionId: string; taskId: string; taskVersion: number; targetBindingId: string | null; draftDocumentId: string; relatedDocumentId: string | null };
  documentVersion?: number; observationCursor: number;
}
const query = { after: 0, cursor: null, limit: 100, maxBytes: 16384 };
const styles = `.rho-feedback{padding:16px 22px 18px;background:var(--surface,#fcfcfd);font-size:13px;line-height:19px;overflow-wrap:anywhere}.rho-feedback h3{font-size:13px;font-weight:600;margin:0 0 9px}.rho-feedback p{margin:8px 0}.rho-feedback button{font:inherit;font-size:12px;border:1px solid var(--border,#d6dae0);background:var(--surface,#fff);border-radius:6px;padding:5px 10px;color:inherit;cursor:pointer}.rho-feedback button:disabled{opacity:.55;cursor:default}.rho-feedback-editor{height:160px;border:1px solid var(--amber,#e9a23b);border-radius:10px;overflow:hidden;background:white;margin:9px 0}.rho-feedback-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.rho-feedback-trail{padding:12px 0;margin:12px 0 0;border-top:1px solid var(--border,#eef0f2)}.rho-feedback-trail li{margin:7px 0}.rho-feedback-reply{white-space:pre-wrap;padding:12px 0;border-top:1px solid var(--border,#eef0f2)}.rho-feedback details{font-size:12px;color:var(--text-muted,#545e63)}.rho-feedback .feedback-primary{background:var(--agent,#3a68f0);color:white;border-color:transparent}`;
export function FeedbackComposer({ view, projectId, client, active, principalId, configuration, documentVersion, observationCursor }: Props) {
  const storageKey = ['rho-feedback', projectId, configuration.taskId, view.props.sourceSelectionScope.id, principalId].join(':');
  const [intent, setIntent] = useState<any>(() => { try { return JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'); } catch { return null; } });
  const [anchor, setAnchor] = useState<any>(intent?.anchor ?? null), [status, setStatus] = useState<any>(null), [thread, setThread] = useState<any>(null);
  const [failure, setFailure] = useState(''), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ documentId: string; version: number | null; ready: boolean }>({ documentId: configuration.draftDocumentId, version: null, ready: false });
  const draftState = useRef(draft);
  const onDraftState = useCallback((next: typeof draft) => { draftState.current = next; setDraft(next); }, []);
  const heading = useRef<HTMLHeadingElement>(null), readGeneration = useRef(0);
  useEffect(() => { heading.current?.focus(); }, []);
  const readStatus = useCallback(async (input: any) => {
    const generation = ++readGeneration.current;
    const value = await client.call('feedback.status', { projectId, taskId: input.taskId, submissionId: input.submissionId, query });
    const currentThread = value.submission.annotation ? await client.call('annotation.read', { projectId, annotationId: value.submission.annotation.annotationId }) : null;
    if (generation === readGeneration.current) { setStatus(value); setThread(currentThread?.version === value.snapshot.annotationVersion ? currentThread : null); }
    return value;
  }, [client, projectId]);
  useEffect(() => {
    let stopped = false;
    if (intent) { void readStatus(intent).catch(error => { if (!stopped && error?.error?.kind !== 'not_found') setFailure('The original delivery status could not be read. Your question and identity are kept.'); }); return () => { stopped = true; }; }
    if (anchor) return;
    void client.call('interaction.selection.read', { projectId, scope: view.props.sourceSelectionScope }).then(value => {
      if (!stopped) setAnchor(value.selection?.resource ? { kind: 'table', resource: value.selection.resource, entities: value.selection.entities } : null);
    }, () => { if (!stopped) setFailure('The selected rows could not be confirmed. Your draft is kept.'); });
    return () => { stopped = true; };
  }, [client, projectId, view.props.sourceSelectionScope.id, intent?.submissionId, observationCursor, readStatus]);
  async function submit() {
    setBusy(true); setFailure('');
    try {
      let input = intent;
      if (!input) {
        const selectedDraft = draftState.current;
        if (!selectedDraft.ready || selectedDraft.version === null || !anchor) throw new Error('Wait for the draft and selected rows to be confirmed.');
        const current = await client.call('document.read', { projectId, documentId: selectedDraft.documentId });
        if (!draftState.current.ready || draftState.current.version !== selectedDraft.version || current.version !== selectedDraft.version || !current.content.trim()) throw new Error('Write a question and wait for its current draft to be confirmed.');
        input = { projectId, taskId: configuration.taskId, compositionId: configuration.compositionId, submissionId: 'question:' + crypto.randomUUID(), draft: { documentId: selectedDraft.documentId, version: selectedDraft.version }, anchor, relatedDocumentId: configuration.relatedDocumentId, routeExpectation: { taskVersion: configuration.taskVersion, targetBindingId: configuration.targetBindingId } };
        if (new TextEncoder().encode(JSON.stringify(input)).length > 16384) throw new Error('This selection exceeds the 16 KiB browser intent limit. Your draft is kept; select fewer rows.');
        sessionStorage.setItem(storageKey, JSON.stringify(input)); setIntent(input);
      }
      await client.call('feedback.submit', input);
      await readStatus(input);
    } catch (error: any) { setFailure(error?.message ?? 'The original question could not be confirmed. Retrying keeps its original identity.'); }
    finally { setBusy(false); }
  }
  const submission = status?.submission;
  const facts = status ? [
    submission.stages.annotation === 'committed' ? 'Question submitted with its original source' : 'Original question still needs confirmation',
    status.queue.transport === 'unknown' ? 'Delivery outcome unknown; original identity retained' : status.queue.inboxReceipt?.emission === 'attempt-recorded' ? 'Emission attempt recorded; emission is unconfirmed' : status.queue.inboxReceipt?.emission === 'emitted' ? 'Hook context emitted; consumption is not acknowledged' : status.queue.transport === 'accepted' ? 'Accepted by the original session inbox' : 'Waiting for the original business session',
    status.fetches.some((r: any) => r.observation === 'client-tool-returned') ? 'Claude Code tool returned the feedback' : status.fetches.some((r: any) => r.observation === 'owner-served') ? 'Rho served the feedback; client return is not confirmed' : 'Feedback has not been fetched',
    status.responses.some((r: any) => r.fromAssignedBusiness) ? 'Linked response from the original Agent' : status.snapshot.annotationVersion === null ? 'Reply owner is unavailable' : 'No linked response from the original Agent yet',
  ] : [];
  const originalMessageId = submission?.annotation?.messageId;
  const replies = thread?.messages.filter((message: any) => message.replyTo === originalMessageId) ?? [];
  const editorView = { id: view.id + ':draft', props: { title: 'Question draft' }, bindings: { document: { kind: 'live-document', documentId: configuration.draftDocumentId } } };
  return <section className="rho-feedback" aria-label="Ask Claude Code">
    <style>{styles}</style>
    <h3 ref={heading} tabIndex={-1}>Your question</h3>
    <p>{anchor?.entities?.join(', ') ?? 'Select rows in the table to ask about them.'}</p>
    {anchor && <details><summary>Source reference</summary><p>{anchor.resource.id}@{anchor.resource.version}</p></details>}
    <div className="rho-feedback-editor"><DocumentEditorView view={editorView} projectId={projectId} client={client} active={active} principalId={principalId} documentVersion={documentVersion} appearance="message" onDraftState={onDraftState} contextTarget={null} editable /></div>
    <div className="rho-feedback-actions">
      <button className="feedback-primary" disabled={busy || !intent && (!draft.ready || !anchor)} onClick={() => { if (intent && status?.submission.stages.queue === 'queued') void readStatus(intent).catch(() => setFailure('The original status is unavailable; your question is kept.')); else void submit(); }}>{busy ? 'Submitting…' : intent && status?.submission.stages.queue === 'queued' ? 'Refresh status' : intent ? 'Retry original question' : 'Send question'}</button>
      {intent && <button disabled={busy} onClick={() => { readGeneration.current++; sessionStorage.removeItem(storageKey); setIntent(null); setAnchor(null); setStatus(null); setThread(null); setFailure(''); }}>New question</button>}
      <span role="status">{draft.ready ? 'Draft saved in workspace' : 'Confirming draft…'}</span>
    </div>
    {failure && <p role="alert">{failure}</p>}
    {status && <div className="rho-feedback-trail"><h3>Where your question is</h3><ol>{facts.map(f => <li key={f}>{f}</li>)}</ol>{status.next && <p>Additional delivery history is retained by the owner.</p>}
      {submission.reason && <p role="status">Question retained: {submission.reason}. Retry uses its original source and target.</p>}
    </div>}
    {replies.map((reply: any) => <div key={reply.id} className="rho-feedback-reply"><h3>{status.responses.find((r: any) => r.messageId === reply.id)?.fromAssignedBusiness ? 'Agent response' : 'Participant response'}</h3><p>{reply.draft.text}</p></div>)}
  </section>;
}
export const feedbackEntry = { component: 'rho.feedback', componentVersion: '0.2.0', owner: 'rho-plugins.annotations', package: '@rho-workspace/plugin-annotations', propsSchema: feedbackComposerPropsSchema, bindings: { draft: 'document' as const }, requiredOperations: ['feedback.submit', 'feedback.status', 'interaction.selection.read', 'annotation.read', 'document.read', 'document.edit', 'document.undoOwn', 'document.revert', 'document.history', 'document.change.read'], selection: ['table-entities' as const] };
