import { useEffect, useState } from 'react';
import { DocumentEditorView } from '@rho-workspace/plugin-documents/ui';
type Ref = { id: string; version: string };
interface Client {
  call(method: string, input: any): Promise<any>;
}
interface Props {
  client: Client;
  projectId: string;
  principalId?: string;
  threads: any[];
  resources: any[];
  conversations: any[];
  contexts?: any[];
  annotationId?: string;
  initialAnchor?: any;
  onOpenResource?: (ref: Ref) => void;
  onGraphResource?: (ref: Ref) => void;
  renderCodeChanges?: (annotationId: string) => any;
  renderComparison?: (left: Ref, right: Ref) => any;
  onSent?: (id: string) => void;
  renderText?: (text: string) => any;
  onExport?: (annotationId: string) => void;
}
export function ReviewPanel(props: Props) {
  return (
    <ProjectReview key={props.projectId + ':' + props.principalId} {...props} />
  );
}
function ProjectReview({
  client,
  projectId,
  principalId,
  threads,
  resources,
  conversations,
  contexts = [],
  annotationId,
  initialAnchor,
  onOpenResource,
  onGraphResource,
  renderCodeChanges,
  renderComparison,
  onSent,
  renderText,
  onExport
}: Props) {
  const [chosen, setChosen] = useState(
      annotationId ||
        sessionStorage.getItem(
          'rho.review.selected:' + projectId + ':' + principalId
        ) ||
        threads.at(-1)?.annotationId ||
        ''
    ),
    [thread, setThread] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<any>(null),
    [draftState, setDraftState] = useState({
      version: null as number | null,
      ready: false
    }),
    [anchor, setAnchor] = useState<any>(null),
    [compose, setCompose] = useState(false);
  const [target, setTarget] = useState(
      () =>
        sessionStorage.getItem(
          'rho.review.target:' + projectId + ':' + principalId
        ) ?? ''
    ),
    [compare, setCompare] = useState<[Ref, Ref] | null>(null);
  const key = 'rho.review.intent:' + projectId + ':' + principalId;
  const [pending, setPending] = useState<any>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  });
  const remember = (value: any) => {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    setPending(value);
  };
  const read = async (id = chosen) => {
    if (id) {
      const t = await client.call('annotation.read', {
        projectId,
        annotationId: id
      });
      setThread(t);
      return t;
    }
  };
  useEffect(() => {
    if (annotationId) setChosen(annotationId);
  }, [annotationId]);
  useEffect(() => {
    if (!chosen && threads.length && !compose)
      setChosen(threads.at(-1).annotationId);
  }, [chosen, threads.at(-1)?.annotationId, compose]);
  useEffect(() => {
    if (chosen)
      sessionStorage.setItem(
        'rho.review.selected:' + projectId + ':' + principalId,
        chosen
      );
  }, [chosen]);
  useEffect(() => {
    void read().catch((e) => setError(e.message));
  }, [chosen, threads.find((t) => t.annotationId === chosen)?.version]);
  useEffect(() => {
    setCompare(null);
  }, [chosen]);
  const name = (ref: Ref) => {
    const r = resources.find(
      (r) => r.id === ref.id && r.version === ref.version
    );
    return (
      r?.provenance?.originalPath ??
      r?.provenance?.restoredFrom?.path ??
      r?.path ??
      'Result ' + ref.version.slice(0, 8)
    );
  };
  useEffect(() => {
    if (initialAnchor) {
      setAnchor(initialAnchor);
      setCompose(true);
      void openDraft('question').catch((e) => setError(e.message));
    }
  }, [initialAnchor]);
  async function openDraft(prefix: string) {
    const d = await client.call('document.open', {
      projectId,
      path: prefix + '-' + crypto.randomUUID() + '.md'
    });
    setDraft(d);
    setDraftState({ version: null, ready: false });
    return d;
  }
  async function newQuestion(ref: Ref) {
    setError('');
    try {
      await openDraft('question');
      setAnchor({
        kind: 'resource',
        resource: { id: ref.id, version: ref.version }
      });
      setCompose(true);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function perform(input: any) {
    setBusy(true);
    setError('');
    remember(input);
    try {
      if (input.kind === 'question') {
        const t = await client.call('annotation.create', input.body);
        setChosen(t.annotationId);
        setThread(t);
        setCompose(false);
        setDraft(null);
      }
      if (input.kind === 'decision') {
        const t = await client.call('annotation.decide', input.body);
        setThread(t);
        setDraft(null);
      }
      if (input.kind === 'send') {
        const c = await client.call('context.create', input.context);
        const body = {
          projectId,
          changeId: input.changeId,
          text: input.text,
          contexts: [c.contextId]
        };
        if (input.target === 'copy') {
          await navigator.clipboard.writeText(
            'Read context ' +
              c.contextId +
              ' in Rho, answer its original question with annotation.reply, and link exact result resource versions.'
          );
          setError(
            'Copied request. It has not been sent to the external Agent.'
          );
        } else {
          const sent = await client.call(
            input.target === 'new' ? 'conversation.start' : 'conversation.send',
            input.target === 'new'
              ? body
              : { ...body, conversationId: input.target }
          );
          onSent?.(sent.conversation.conversationId);
        }
      }
      remember(null);
    } catch (e: any) {
      setError(
        e.message ?? 'Outcome unknown. Retry keeps the original identity.'
      );
      if (e.error?.kind) remember(null);
    } finally {
      setBusy(false);
    }
  }
  async function ask() {
    if (!draft || !draftState.ready || !draftState.version) return;
    await perform({
      kind: 'question',
      body: {
        projectId,
        annotationId: 'q-' + crypto.randomUUID(),
        expectedVersion: 0,
        changeId: 'ask-' + crypto.randomUUID(),
        anchor,
        draft: { documentId: draft.id, version: draftState.version }
      }
    });
  }
  const delivery = contexts
    .filter((c) =>
      c.annotations?.some((a: any) => a.annotationId === thread?.annotationId)
    )
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .at(-1);
  const reply = thread?.messages
    .filter(
      (m: any) =>
        m.replyTo && m.author.startsWith('agent:') && m.resources?.length
    )
    .at(-1);
  const lastDecision =
    reply &&
    thread.decisions
      ?.filter(
        (d: any) =>
          d.targetMessageId === reply.id &&
          JSON.stringify(d.resources) === JSON.stringify(reply.resources)
      )
      .at(-1);
  async function decide(status: string) {
    if (!reply) return;
    await perform({
      kind: 'decision',
      body: {
        projectId,
        annotationId: thread.annotationId,
        expectedVersion: thread.version,
        changeId: 'decision-' + crypto.randomUUID(),
        targetMessageId: reply.id,
        resources: reply.resources,
        status,
        ...(lastDecision ? { supersedes: lastDecision.id } : {}),
        ...(draft && draftState.ready && draftState.version
          ? { draft: { documentId: draft.id, version: draftState.version } }
          : {})
      }
    });
  }
  async function send() {
    if (!thread || !target) return;
    const id = 'review-' + crypto.randomUUID();
    await perform({
      kind: 'send',
      target,
      changeId: id,
      text: 'Please review and answer the frozen question and human decisions in the attached Rho context. Preserve existing human edits and link any new results.',
      context: {
        projectId,
        changeId: id,
        expectedVersion: 0,
        annotations: [
          { annotationId: thread.annotationId, version: thread.version }
        ]
      }
    });
  }
  const draftView = draft && (
    <div
      className="review-draft"
      inert={draftState.version === null}
      aria-busy={draftState.version === null}
    >
      <DocumentEditorView
        view={{
          id: 'review-draft',
          props: {
            title: compose ? 'Your question' : 'Reason for this decision'
          },
          bindings: {
            document: { kind: 'live-document', documentId: draft.id }
          }
        }}
        projectId={projectId}
        client={client}
        active
        principalId={principalId}
        documentVersion={draft.version}
        onDraftState={setDraftState}
        appearance="message"
        editable
        contextTarget={null}
      />
    </div>
  );
  return (
    <section className="rho-review" aria-label="Result review">
      <header>
        <h1>Review results</h1>
        <p>Questions, changes and your decisions about exact versions.</p>
      </header>
      {error && <p role="alert">{error}</p>}
      {pending && (
        <p>
          Original {pending.kind} retained.{' '}
          <button disabled={busy} onClick={() => void perform(pending)}>
            Retry original {pending.kind}
          </button>
        </p>
      )}
      <div className="review-choose">
        <label>
          Review{' '}
          <select
            aria-label="Review thread"
            value={chosen}
            onChange={(e) => {
              setChosen(e.target.value);
              setDraft(null);
              setCompose(false);
            }}
          >
            <option value="">Choose a question</option>
            {threads.map((t) => (
              <option key={t.annotationId} value={t.annotationId}>
                {t.messages[0]?.draft.text.slice(0, 100)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ask about a result{' '}
          <select
            aria-label="Ask about a result"
            value=""
            onChange={(e) => {
              const r = resources.find((r) => r.id === e.target.value);
              if (r) void newQuestion(r);
            }}
          >
            <option value="">Choose an exact result version</option>
            {resources.slice(-128).map((r) => (
              <option key={r.id} value={r.id}>
                {name(r)} · {r.version.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {compose && (
        <section>
          <h2>Your question</h2>
          {draftView}
          <button
            disabled={busy || !draftState.ready}
            onClick={() => void ask()}
          >
            Keep question
          </button>
          <button onClick={() => setCompose(false)}>Cancel</button>
        </section>
      )}
      {thread && (
        <>
          <article className="review-question">
            <h2>The question</h2>
            <p>{thread.messages[0].draft.text}</p>
            <small>Original {thread.anchor.kind} version retained</small>
          </article>
          {thread.messages.slice(1).map((m: any) => (
            <article key={m.id} className="review-reply">
              <h2>{m.author.startsWith('agent:') ? 'Agent reply' : 'Reply'}</h2>
              {renderText ? (
                renderText(m.draft.text)
              ) : (
                <p style={{ whiteSpace: 'pre-wrap' }}>{m.draft.text}</p>
              )}
              <ul>
                {m.resources?.map((r: Ref) => (
                  <li key={r.id + r.version}>
                    <button onClick={() => onOpenResource?.(r)}>
                      {name(r)}
                    </button>{' '}
                    <small>version {r.version.slice(0, 8)}</small>
                    {onGraphResource && (
                      <button onClick={() => onGraphResource(r)}>
                        View in Graph
                      </button>
                    )}
                    {thread.anchor.kind === 'table' &&
                      resources.some(
                        (x) => x.id === r.id && x.kind === 'table'
                      ) && (
                        <button
                          onClick={() =>
                            setCompare([thread.anchor.resource, r])
                          }
                        >
                          Compare with the original
                        </button>
                      )}
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {compare && renderComparison?.(...compare)}
          {renderCodeChanges?.(thread.annotationId)}
          <section className="review-decision">
            <h2>Your decision</h2>
            {!reply ? (
              <p>
                The Agent has not linked exact result versions in a reply yet.
              </p>
            ) : (
              <>
                <p>
                  Applies to the results linked by this reply. New versions need
                  their own decision.
                </p>
                <button
                  disabled={busy || !!pending}
                  onClick={() => void decide('accepted')}
                >
                  Accept these versions
                </button>{' '}
                <button
                  disabled={busy || !!pending}
                  onClick={() => {
                    setCompose(false);
                    void openDraft('review-reason').catch((e) =>
                      setError(e.message)
                    );
                  }}
                >
                  Write a reason
                </button>
                {draft && !compose && (
                  <>
                    {draftView}
                    <button
                      disabled={busy || !draftState.ready || !!pending}
                      onClick={() => void decide('needs-changes')}
                    >
                      Record needs changes
                    </button>
                  </>
                )}
                {lastDecision && (
                  <button
                    disabled={busy || !!pending}
                    onClick={() => void decide('withdrawn')}
                  >
                    Withdraw decision
                  </button>
                )}
              </>
            )}
            {thread.decisions?.map((d: any) => (
              <article key={d.id} className="review-history">
                <strong>
                  {d.status === 'accepted'
                    ? 'Accepted'
                    : d.status === 'needs-changes'
                      ? 'Needs changes'
                      : 'Decision withdrawn'}
                </strong>
                <p>{d.reason}</p>
                <small>
                  {d.at} ·{' '}
                  {d.resources
                    .map((r: Ref) => r.version.slice(0, 8))
                    .join(', ')}
                  {d.supersedes ? ' · corrects a previous decision' : ''}
                </small>
              </article>
            ))}
          </section>
          <section>
            <h2>Continue with an Agent</h2>
            <p role="status">
              {delivery?.responses?.some(
                (r: any) =>
                  r.annotationId === thread.annotationId &&
                  r.state === 'explicit-linked-response'
              )
                ? 'Explicit Agent reply recorded for the sent context.'
                : delivery?.delivery === 'tool-fetched'
                  ? 'The Agent read the frozen context. No explicit reply is recorded for it yet.'
                  : delivery
                    ? 'Frozen context prepared; no Agent read is recorded yet.'
                    : 'This review has not been sent to an Agent.'}
            </p>
            <label>
              Send to{' '}
              <select
                aria-label="Review target Agent"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  sessionStorage.setItem(
                    'rho.review.target:' + projectId + ':' + principalId,
                    e.target.value
                  );
                }}
              >
                <option value="">Choose a conversation</option>
                {conversations.map((c) => (
                  <option key={c.conversationId} value={c.conversationId}>
                    {c.title}
                    {c.state === 'running' ? ' · answering' : ''}
                  </option>
                ))}
                <option value="new">
                  New conversation with the selected Agent
                </option>
                <option value="copy">External Agent · copy request</option>
              </select>
            </label>
            <button
              disabled={!target || busy || !!pending}
              onClick={() => void send()}
            >
              {target === 'copy' ? 'Copy request' : 'Ask Agent to respond'}
            </button>
            <p>Recording a decision does not send a message or change files.</p>
          </section>
          {onExport && (
            <button onClick={() => onExport(thread.annotationId)}>
              Export evidence…
            </button>
          )}
          <details>
            <summary>Versions and source details</summary>
            <pre>
              {JSON.stringify(
                {
                  annotationId: thread.annotationId,
                  version: thread.version,
                  anchor: thread.anchor,
                  sourceStatus: thread.sourceStatus
                },
                null,
                2
              )}
            </pre>
          </details>
        </>
      )}
      {!thread && !compose && (
        <p>Choose an existing question or a result to begin a review.</p>
      )}
    </section>
  );
}
