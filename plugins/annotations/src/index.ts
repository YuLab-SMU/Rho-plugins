import path from 'node:path';
import { atomicJson, canonical, digest, now, readJson, requireThat, stateDirectory, type DocumentSnapshotSource, type ResourceRef } from '@rho-workspace/plugin-contracts';
import { inputs, outputs } from './contract.js';
export const annotationLimits = { maxThreads: 128, maxMessages: 256, maxAnnotationBytes: 32 * 1024 * 1024, maxReceipts: 256 };
export interface AnnotationSources {
  documents?: DocumentSnapshotSource & { anchor(id: string, version: number, from: number, to: number): Promise<any>; read(id: string): Promise<{ version: number }> };
  tables?: { anchor(ref: ResourceRef, entities: string[]): Promise<any> };
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
      requireThat(b.anchor && ['document', 'table'].includes(b.anchor.kind), 'invalid', 'Select a document or table anchor.');
      if (b.anchor.kind === 'document') source = await documents.anchor(b.anchor.documentId, b.anchor.version, b.anchor.from, b.anchor.to);
      else {
        requireThat(this.sources.tables, 'unavailable', 'Table anchor owner is unavailable.');
        source = await this.sources.tables.anchor(b.anchor.resource, b.anchor.entities);
      }
    }
    const version = (current?.version ?? 0) + 1;
    const receipt = { changeId: b.changeId, requestDigest, version, author, at: now() };
    const message = { id: digest(canonical([b.annotationId, version, requestDigest])), author, at: receipt.at, draft: { source: draft.source, sha256: draft.sha256, text: draft.code }, ...(reply ? { replyTo: b.replyTo } : {}) };
    const receipts = [...(current?.receipts ?? []), receipt].slice(-this.limits.maxReceipts);
    const result = { annotationId: b.annotationId, version, anchor: current?.anchor ?? b.anchor, source, messages: [...(current?.messages ?? []), message], receipts, receipt, retainedFromVersion: receipts[0].version };
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
      requireThat(thread && identity(thread.annotationId) && Number.isSafeInteger(thread.version) && thread.version > 0 && Array.isArray(thread.messages) && thread.messages.length === thread.version && thread.anchor && thread.source && Array.isArray(thread.receipts), 'invalid', 'Invalid archived annotation.');
      const anchor = thread.anchor, source = thread.source;
      if (anchor.kind === 'document') requireThat(hash(anchor.documentId) && Number.isSafeInteger(anchor.version) && anchor.version > 0 && Number.isSafeInteger(anchor.from) && anchor.from >= 0 && Number.isSafeInteger(anchor.to) && anchor.to >= anchor.from && source.kind === 'document' && source.source?.documentId === anchor.documentId && source.source?.version === anchor.version && source.from === anchor.from && source.to === anchor.to && typeof source.text === 'string' && source.text.length === anchor.to - anchor.from && hash(source.sha256), 'invalid', 'Invalid archived document anchor snapshot.');
      else requireThat(anchor.kind === 'table' && hash(anchor.resource?.id) && hash(anchor.resource?.version) && Array.isArray(anchor.entities) && anchor.entities.length > 0 && new Set(anchor.entities).size === anchor.entities.length && source.kind === 'table' && canonical(source.resource) === canonical(anchor.resource) && typeof source.namespace === 'string' && typeof source.entityKey === 'string' && Array.isArray(source.rows) && source.rows.length === anchor.entities.length && new Set(source.rows.map((r: any) => r[source.entityKey])).size === anchor.entities.length && source.rows.every((r: any) => anchor.entities.includes(r[source.entityKey])), 'invalid', 'Invalid archived table anchor snapshot.');
      const messages = new Set<string>();
      for (const [index, message] of thread.messages.entries()) {
        requireThat(hash(message?.id) && !messages.has(message.id) && typeof message.author === 'string' && typeof message.at === 'string' && message.draft?.source?.kind === 'buffer' && typeof message.draft.text === 'string' && digest(message.draft.text) === message.draft.sha256 && (index === 0 ? !message.replyTo : messages.has(message.replyTo)), 'invalid', 'Invalid archived message or explicit reply relationship.');
        messages.add(message.id);
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
const content = 'Discover enabled operations with capability.list and skill.list. Use annotation.create/read/list/reply over versioned Documents drafts. Anchor exact UTF-16 document ranges or stable table entity keys. Submitted messages and source snapshots never rebase. Prepare selected feedback with context.create, read context through the tool, edit the shared artifact with its current version, and submit an explicit replyTo. Tool reads are not understanding or completion. Preserve original changeIds after lost acknowledgements.';
export const plugin = { entryVersion: '1.0', id: 'annotations', package: '@rho-workspace/plugin-annotations', version: '0.4.0', requires: ['documents'], capabilities: ['annotations'],
  operations: Object.entries(inputs).map(([method, inputSchema]) => ({ method, version: '2.0' as const, inputSchema, outputSchema: outputs[method as keyof typeof outputs], requires: ['documents'], effect: method === 'annotation.create' || method === 'annotation.reply' ? 'metadata' as const : 'read' as const })),
  skills: [{ id: 'annotations.workspace', version: '1.0', content, digest: digest(content) }]
};
