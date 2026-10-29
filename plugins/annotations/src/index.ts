import { skillPresentation, presentation, operationPresentation } from './presentation.js';
import path from 'node:path';
import { atomicJson, canonical, digest, now, readJson, requireThat, stateDirectory, type DocumentSnapshotSource, type ResourceRef } from '@rho-workspace/plugin-contracts';
import { inputs, outputs, feedbackComposerPropsSchema } from './contract.js';
export const annotationLimits = { maxThreads: 128, maxMessages: 256, maxAnnotationBytes: 32 * 1024 * 1024, maxReceipts: 256, maxDecisions: 256 };
export interface AnnotationSources {
  documents?: DocumentSnapshotSource & { anchor(id: string, version: number, from: number, to: number): Promise<any>; read(id: string): Promise<{ version: number }> };
  tables?: { anchor(ref: ResourceRef, entities: string[]): Promise<any> };
  files?: { resolve(ref: ResourceRef): Promise<unknown> };
}
export class Annotations {
  limits: typeof annotationLimits;
  constructor(public root: string, public sources: AnnotationSources, limits: Partial<typeof annotationLimits> = {}) { this.limits = { ...annotationLimits, ...limits }; }
  private async file() { return path.join(await stateDirectory(this.root, '.rho/plugins/annotations'), 'state.json'); }
  async state(): Promise<any[]> { return readJson<any[]>(await this.file(), []); }
  async list() { return Promise.all((await this.state()).map(thread => this.read(thread.annotationId))); }
  async read(annotationId: string) {
    const thread = (await this.state()).find(t => t.annotationId === annotationId);
    requireThat(thread, 'not_found', 'Annotation thread is missing.');
    let sourceStatus: any = { state: 'snapshot-retained' };
    try {
      if (thread.anchor.kind === 'document') {
        requireThat(this.sources.documents, 'unavailable', 'Document owner is absent.');
        const current = await this.sources.documents.read(thread.anchor.documentId);
        sourceStatus = { state: current.version === thread.anchor.version ? 'same-version' : 'version-differs', currentVersion: current.version, anchoredVersion: thread.anchor.version };
      } else if (thread.anchor.kind === 'resource') {
        requireThat(this.sources.files, 'unavailable', 'Files owner is absent.');
        await this.sources.files.resolve(thread.anchor.resource);
        sourceStatus = { state: 'same-version' };
      } else {
        requireThat(this.sources.tables, 'unavailable', 'Table owner is absent.');
        await this.sources.tables.anchor(thread.anchor.resource, thread.anchor.entities);
        sourceStatus = { state: 'same-version' };
      }
    } catch { sourceStatus = { state: 'source-unavailable', snapshot: 'retained' }; }
    return { ...thread, sourceStatus };
  }
  async create(b: any, author: string) { return this.submit(b, author, false); }
  async reply(b: any, author: string) { return this.submit(b, author, true); }
  async decide(b: any, author: string, human = false) {
    requireThat(/^[A-Za-z0-9._:@-]{1,128}$/.test(b.changeId) && Number.isSafeInteger(b.expectedVersion) && b.expectedVersion > 0, 'invalid', 'Invalid decision identity or version.');
    requireThat(human, 'unauthorized', 'Only an authenticated browser person records a review decision.');
    const all = await this.state(), current = all.find(t => t.annotationId === b.annotationId);
    requireThat(current, 'not_found', 'Review thread is missing.');
    const requestDigest = digest(canonical({ b, author, decision: true }));
    const old = current.receipts.find((r: any) => r.changeId === b.changeId);
    if (old) { requireThat(old.requestDigest === requestDigest, 'conflict', 'This decision identity names different content.'); return { ...current, receipt: old }; }
    requireThat(current.version === b.expectedVersion, 'stale', 'Review advanced; read the current thread before deciding.');
    const target = current.messages.find((m: any) => m.id === b.targetMessageId);
    requireThat(target?.replyTo && target.author.startsWith('agent:'), 'condition', 'Decide on an explicit Agent reply.');
    requireThat(Array.isArray(b.resources) && b.resources.length > 0 && b.resources.length <= 16 && b.resources.every((r: any) => target.resources?.some((t: any) => t.id === r.id && t.version === r.version)), 'condition', 'Choose exact results linked by this reply.');
    const ordered = (refs: any[]) => [...refs].sort((a,b) => (a.id + a.version).localeCompare(b.id + b.version));
    const decisions = current.decisions ?? [], sameTarget = (d: any) => d.targetMessageId === b.targetMessageId && canonical(ordered(d.resources)) === canonical(ordered(b.resources));
    const previous = decisions.filter(sameTarget).at(-1);
    requireThat(!previous || b.supersedes === previous.id && previous.author === author, 'stale', 'Name your latest decision when correcting it.');
    requireThat(!b.supersedes || previous?.id === b.supersedes, 'condition', 'The decision being corrected does not match these result versions.');
    requireThat(['accepted', 'needs-changes', 'withdrawn'].includes(b.status) && (b.status !== 'withdrawn' || previous), 'invalid', 'Choose a review decision; withdrawal needs a previous decision.');
    const draft = b.draft ? await this.sources.documents!.snapshot(b.draft.documentId, b.draft.version) : null;
    requireThat(b.status !== 'needs-changes' || draft?.code.trim(), 'invalid', 'Explain what needs to change.');
    requireThat(decisions.length < this.limits.maxDecisions, 'limit', 'Review decision budget reached; earlier decisions are retained.', { limit: 'maxDecisions' });
    const version = current.version + 1, at = now();
    const record = { id: digest(canonical([b.annotationId, requestDigest])), version, author, at, targetMessageId: b.targetMessageId, resources: b.resources, status: b.status, reason: draft?.code ?? '', ...(draft ? { draft: { source: draft.source, sha256: draft.sha256 } } : {}), ...(b.supersedes ? { supersedes: b.supersedes } : {}) };
    const receipt = { changeId: b.changeId, requestDigest, version, author, at };
    const receipts = [...current.receipts, receipt].slice(-this.limits.maxReceipts);
    const next = { ...current, version, decisions: [...decisions, record], receipts, receipt, retainedFromVersion: receipts[0].version };
    const state = all.map(t => t === current ? next : t);
    requireThat(Buffer.byteLength(JSON.stringify(state)) <= this.limits.maxAnnotationBytes, 'limit', 'Annotation metadata budget reached.');
    await atomicJson(await this.file(), state); return next;
  }
  private async submit(b: any, author: string, reply: boolean) {
    requireThat(/^[A-Za-z0-9._:@-]{1,128}$/.test(b.annotationId) && /^[A-Za-z0-9._:@-]{1,128}$/.test(b.changeId) && Number.isSafeInteger(b.expectedVersion), 'invalid', 'Invalid annotation identity or conditional version.');
    const all = await this.state(), current = all.find(t => t.annotationId === b.annotationId);
    const requestDigest = digest(canonical({ b, author, reply }));
    const old = current?.receipts.find((r: any) => r.changeId === b.changeId);
    if (old) { requireThat(old.requestDigest === requestDigest, 'conflict', 'Annotation changeId names different content or author.'); return { ...current, receipt: old }; }
    requireThat((current?.version ?? 0) === b.expectedVersion, 'stale', 'Annotation version changed; reconcile missing receipts without replay.', { actualVersion: current?.version ?? 0 });
    requireThat(reply ? current && current.messages.some((m: any) => m.id === b.replyTo) : !current && b.expectedVersion === 0, 'condition', 'Creation requires a new thread; replies require an explicit existing message.');
    requireThat(current || all.length < this.limits.maxThreads, 'limit', 'Annotation thread budget reached; submitted content is retained.', { limit: 'maxThreads', maximum: this.limits.maxThreads });
    requireThat(all.reduce((n, t) => n + t.messages.length, 0) < this.limits.maxMessages, 'limit', 'Annotation message budget reached; submitted content is retained.', { limit: 'maxMessages', maximum: this.limits.maxMessages });
    const documents = this.sources.documents;
    requireThat(documents && b.draft, 'unavailable', 'A versioned Documents draft is required.');
    const draft = await documents.snapshot(b.draft.documentId, b.draft.version);
    requireThat(draft.code.trim().length, 'invalid', 'Submitted draft must not be empty.');
    let source = current?.source;
    if (!reply) {
      requireThat(b.anchor && ['document', 'table', 'resource'].includes(b.anchor.kind), 'invalid', 'Select a document, table or resource anchor.');
      if (b.anchor.kind === 'document') source = await documents.anchor(b.anchor.documentId, b.anchor.version, b.anchor.from, b.anchor.to);
      else if (b.anchor.kind === 'resource') {
        requireThat(this.sources.files, 'unavailable', 'Files owner is required.');
        const { storage, ...metadata } = await this.sources.files.resolve(b.anchor.resource) as any;
        source = { kind: 'resource', resource: b.anchor.resource, metadata };
      } else {
        requireThat(this.sources.tables, 'unavailable', 'Table anchor owner is unavailable.');
        source = await this.sources.tables.anchor(b.anchor.resource, b.anchor.entities);
      }
    }
    // These are explicit references supplied by the reply author, not inferred
    // from a later run or matching filename. Resolution checks project containment.
    if (b.resources?.length) {
      requireThat(reply && this.sources.files, 'unavailable', 'Reply resources require their Files owner.');
      for (const resource of b.resources) await this.sources.files!.resolve(resource);
    }
    const version = (current?.version ?? 0) + 1;
    const receipt = { changeId: b.changeId, requestDigest, version, author, at: now() };
    const message = { id: digest(canonical([b.annotationId, version, requestDigest])), author, at: receipt.at, draft: { source: draft.source, sha256: draft.sha256, text: draft.code }, ...(reply ? { replyTo: b.replyTo } : {}), ...(b.resources ? { resources: b.resources.map((r: ResourceRef) => ({ id: r.id, version: r.version })) } : {}) };
    const receipts = [...(current?.receipts ?? []), receipt].slice(-this.limits.maxReceipts);
    const result = { annotationId: b.annotationId, version, anchor: current?.anchor ?? b.anchor, source, messages: [...(current?.messages ?? []), message], ...(current?.decisions ? { decisions: current.decisions } : {}), receipts, receipt, retainedFromVersion: receipts[0].version };
    const next = [...all.filter(t => t.annotationId !== b.annotationId), result];
    requireThat(Buffer.byteLength(JSON.stringify(next)) <= this.limits.maxAnnotationBytes, 'limit', 'Annotation metadata byte budget reached.', { limit: 'maxAnnotationBytes', maximum: this.limits.maxAnnotationBytes });
    await atomicJson(await this.file(), next); return result;
  }
  async prepareRestore(threads: any[]) {
    const current = await this.state(), report = [];
    const hash = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
    const identity = (s: unknown) => typeof s === 'string' && /^[A-Za-z0-9._:@-]{1,128}$/.test(s);
    requireThat(Array.isArray(threads) && new Set(threads.map(t => t?.annotationId)).size === threads.length, 'invalid', 'Archived annotation identities must be unique.');
    for (const thread of threads) {
      requireThat(thread && identity(thread.annotationId) && Number.isSafeInteger(thread.version) && thread.version > 0 && Array.isArray(thread.messages) && thread.messages.length + (thread.decisions?.length ?? 0) === thread.version && thread.anchor && thread.source && Array.isArray(thread.receipts), 'invalid', 'Invalid archived annotation.');
      const anchor = thread.anchor, source = thread.source;
      if (anchor.kind === 'document') requireThat(hash(anchor.documentId) && Number.isSafeInteger(anchor.version) && anchor.version > 0 && Number.isSafeInteger(anchor.from) && anchor.from >= 0 && Number.isSafeInteger(anchor.to) && anchor.to >= anchor.from && source.kind === 'document' && source.source?.documentId === anchor.documentId && source.source?.version === anchor.version && source.from === anchor.from && source.to === anchor.to && typeof source.text === 'string' && source.text.length === anchor.to - anchor.from && hash(source.sha256), 'invalid', 'Invalid archived document anchor snapshot.');
      else if (anchor.kind === 'resource') requireThat(hash(anchor.resource?.id) && hash(anchor.resource?.version) && source.kind === 'resource' && canonical(source.resource) === canonical(anchor.resource), 'invalid', 'Invalid archived resource anchor.');
      else requireThat(anchor.kind === 'table' && hash(anchor.resource?.id) && hash(anchor.resource?.version) && Array.isArray(anchor.entities) && anchor.entities.length > 0 && new Set(anchor.entities).size === anchor.entities.length && source.kind === 'table' && canonical(source.resource) === canonical(anchor.resource) && typeof source.namespace === 'string' && typeof source.entityKey === 'string' && Array.isArray(source.rows) && source.rows.length === anchor.entities.length && new Set(source.rows.map((r: any) => r[source.entityKey])).size === anchor.entities.length && source.rows.every((r: any) => anchor.entities.includes(r[source.entityKey])), 'invalid', 'Invalid archived table anchor snapshot.');
      const messages = new Set<string>();
      for (const [index, message] of thread.messages.entries()) {
        requireThat(hash(message?.id) && !messages.has(message.id) && typeof message.author === 'string' && typeof message.at === 'string' && message.draft?.source?.kind === 'buffer' && typeof message.draft.text === 'string' && digest(message.draft.text) === message.draft.sha256 && (index === 0 ? !message.replyTo : messages.has(message.replyTo)), 'invalid', 'Invalid archived message or explicit reply relationship.');
        messages.add(message.id);
        requireThat(message.resources === undefined || index > 0 && Array.isArray(message.resources) && message.resources.length <= 16 && message.resources.every((r: any) => hash(r?.id) && hash(r?.version)) && new Set(message.resources.map((r: any) => r.id + '@' + r.version)).size === message.resources.length, 'invalid', 'Invalid archived reply resource references.');
      }
      const decisionIds = new Set<string>();
      requireThat(!thread.decisions || Array.isArray(thread.decisions) && thread.decisions.length <= this.limits.maxDecisions, 'invalid', 'Invalid archived decisions.');
      for (const d of thread.decisions ?? []) {
        const target = thread.messages.find((m: any) => m.id === d.targetMessageId);
        requireThat(hash(d.id) && !decisionIds.has(d.id) && typeof d.author === 'string' && typeof d.at === 'string' && ['accepted', 'needs-changes', 'withdrawn'].includes(d.status) && typeof d.reason === 'string' && (d.status !== 'needs-changes' || d.reason.trim()) && Number.isSafeInteger(d.version) && d.version <= thread.version && target?.author.startsWith('agent:') && Array.isArray(d.resources) && d.resources.length > 0 && d.resources.every((r: any) => target.resources?.some((t: any) => t.id === r.id && t.version === r.version)) && (!d.supersedes || decisionIds.has(d.supersedes)), 'invalid', 'Invalid archived review decision.');
        decisionIds.add(d.id);
      }
      requireThat(thread.receipts.length > 0 && thread.receipts.length <= this.limits.maxReceipts && new Set(thread.receipts.map((r: any) => r?.changeId)).size === thread.receipts.length && thread.receipts.every((r: any, index: number) => identity(r?.changeId) && hash(r.requestDigest) && r.version === thread.version - thread.receipts.length + index + 1 && typeof r.author === 'string' && typeof r.at === 'string') && thread.retainedFromVersion === thread.receipts[0].version, 'invalid', 'Invalid archived annotation receipt boundaries.');
      const old = current.find(t => t.annotationId === thread.annotationId);
      if (old) { report.push({ annotationId: thread.annotationId, state: canonical(old) === canonical(thread) ? 'available' : 'conflict' }); continue; }
      requireThat(current.length < this.limits.maxThreads && current.reduce((n, t) => n + t.messages.length, 0) + thread.messages.length <= this.limits.maxMessages, 'limit', 'Annotation restore exceeds retained state budgets.');
      current.push(thread); report.push({ annotationId: thread.annotationId, state: 'available' });
    }
    requireThat(Buffer.byteLength(JSON.stringify(current)) <= this.limits.maxAnnotationBytes, 'limit', 'Annotation restore exceeds byte budget.');
    return { state: current, report };
  }
  async restore(threads: any[]) {
    const prepared = await this.prepareRestore(threads);
    await atomicJson(await this.file(), prepared.state); return prepared.report;
  }
}
const content = [
  'Ask about a selected object and follow the answer without rebasing what was submitted.',
  'Discover enabled operations with capability.list and skill.list.',
  '',
  '1. An annotation anchors to an exact version: a UTF-16 document range or a stable table',
  '   entity key at that resource version. A submitted message and its source snapshot stay',
  '   exactly as submitted; a later edit does not silently move them.',
  '2. annotation.create submits; annotation.read and annotation.list observe; annotation.reply',
  '   answers and must name replyTo explicitly. Threads advance conditionally. Include',
  '   resources: [{id, version}] for outputs that your reply refers to; these are explicit',
  '   author links, not proof of scientific correctness. Preserve the original anchor.',
  '3. To hand chosen feedback to an agent, build it with context.create and read it back',
  '   through the tool with context.read. Prepared, read and explicitly replied are three',
  '   different facts: reading is not understanding and not completion.',
  'Human decisions are separate version-bound facts. Agents read them with annotation.read; only the authenticated person records annotation.decide. A later result never inherits an earlier decision.',
  '4. Keep the original changeId after a lost acknowledgement and query the receipt boundary;',
  '   never resubmit the same feedback under a new identity.'
].join('\n');
export const plugin = { entryVersion: '1.0', id: 'annotations', package: '@rho-workspace/plugin-annotations', version: '0.5.2', requires: ['documents'], capabilities: ['annotations'], presentation,
  components: [{ id: 'rho.feedback', version: '0.2.0', owner: 'rho-plugins.annotations', bindings: { draft: 'document' }, propsSchema: feedbackComposerPropsSchema, ui: './ui', presentation: { displayName: 'Feedback', description: 'Asks about selected objects and follows original delivery and linked replies.', readOnly: false, runsCode: false } }],
  operations: Object.entries(inputs).map(([method, inputSchema]) => ({ method, presentation: method === 'annotation.decide' ? { displayName: 'Record decision', description: 'Records the person’s decision about exact result versions.', readOnly: false, runsCode: false } : operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, inputSchema, outputSchema: outputs[method as keyof typeof outputs], requires: ['documents'], effect: method === 'annotation.create' || method === 'annotation.reply' || method === 'annotation.decide' ? 'metadata' as const : 'read' as const })),
  skills: [{
    id: 'annotations.workspace', version: '1.1', content, digest: digest(content), presentation: skillPresentation,
    intent: 'Submit and follow anchored feedback without rebasing the original message.',
    requires: ['annotation.create', 'annotation.read', 'annotation.list', 'annotation.reply', 'context.create', 'context.read'],
    example: {
      method: 'annotation.list',
      input: { projectId: 'the-open-project' }
    },
    failureRecipes: [
      { kind: 'stale', message: 'Anchor or thread advanced past the submitted version.', next: 'Read the thread, then reply with an explicit replyTo instead of moving the original anchor.' },
      { kind: 'scope', message: 'Selection or anchor is outside this binding.', next: 'Anchor inside the document or table the binding owns.' },
      { kind: 'invalid', message: 'Anchor range or entity key is malformed.', next: 'Use UTF-16 offsets for documents and a declared entity key for tables.' }
    ],
    verify: { command: 'npm run test:annotations', description: 'Submits anchored messages over versioned drafts, advances threads conditionally and keeps original snapshots.' }
  }]
};
