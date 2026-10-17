import { presentation, operationPresentation, viewPresentation } from './presentation.js';
import { operationContracts } from './operations.js';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { atomicBytes, atomicJson, confined, digest, now, readJson, requireThat, stateDirectory, objectSchema as obj, text } from '@rho-workspace/plugin-contracts';

const declaredSkill = (id: string, content: string, version = '1.0') => ({ id, version, content, digest: digest(content) });

async function fileDigest(file: string, maxBytes = 1024 * 1024): Promise<string | null> {
  try { requireThat((await fs.stat(file)).size <= maxBytes, 'limit', 'Disk document exceeds the bounded digest reader; the acknowledged buffer is retained.', { limit: 'maxBufferBytes', maximum: maxBytes }); return digest(await fs.readFile(file)); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
}

export interface DocumentState {
  id: string; path: string; version: number; content: string; diskDigest: string | null;
  dirty: boolean; author: string; acknowledgedAt: string;
  undo: { content: string; group: string; author: string }[];
}
export interface TextEdit { from: number; to: number; insert: string }
export const documentLimits = { maxBufferBytes: 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024, maxUndoBytes: 8 * 1024 * 1024, maxDocuments: 64 };
export class Documents {
  limits: typeof documentLimits;
  constructor(public root: string, limits: Partial<typeof documentLimits> = {}) { this.limits = { ...documentLimits, ...limits }; }
  private async directory() { return stateDirectory(this.root, '.rho/plugins/documents'); }
  private async record(id: string) {
    requireThat(/^[a-f0-9]{64}$/.test(id), 'invalid', 'Invalid document identity.');
    return path.join(await this.directory(), id + '.json');
  }
  async list(): Promise<DocumentState[]> {
    const d = await this.directory();
    return Promise.all((await fs.readdir(d)).filter(n => /^[a-f0-9]{64}\.json$/.test(n)).map(n => readJson<DocumentState>(path.join(d, n))));
  }
  async read(id: string) { return readJson<DocumentState>(await this.record(id)); }
  async open(relative: string, author: string) {
    requireThat(!relative.split('/').some(p => ['.rho', '.git'].includes(p)), 'scope', 'Internal state is not an editable document.');
    const file = await confined(this.root, relative, true);
    const normalized = path.relative(await fs.realpath(this.root), file);
    const id = digest(normalized);
    const existing = await readJson<DocumentState | null>(await this.record(id), null);
    if (existing) return existing;
    const all = await this.list();
    requireThat(all.length < this.limits.maxDocuments, 'limit', 'Document count limit reached.', { limit: 'maxDocuments', maximum: this.limits.maxDocuments });
    let content = '';
    let diskDigest: string | null = null;
    try {
      requireThat((await fs.stat(file)).size <= this.limits.maxBufferBytes, 'limit', 'Document exceeds the buffer byte limit.', { limit: 'maxBufferBytes' });
      const bytes = await fs.readFile(file);
      diskDigest = digest(bytes);
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { requireThat(false, 'invalid', 'The document is not valid UTF-8; its original bytes are retained.'); }
    } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    const doc: DocumentState = { id, path: normalized, content, version: 1, diskDigest, dirty: false, author, acknowledgedAt: now(), undo: [] };
    await this.persist(doc, all);
    return doc;
  }
  private async persist(doc: DocumentState, all?: DocumentState[]) {
    const bytes = Buffer.byteLength(doc.content);
    requireThat(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(doc.content), 'invalid', 'Document text contains an unpaired Unicode surrogate.');
    requireThat(bytes <= this.limits.maxBufferBytes, 'limit', 'Edit exceeds the buffer byte limit.', { limit: 'maxBufferBytes', maximum: this.limits.maxBufferBytes });
    const others = (all ?? await this.list()).filter(d => d.id !== doc.id);
    requireThat(bytes + others.reduce((n, d) => n + Buffer.byteLength(d.content), 0) <= this.limits.maxTotalBytes, 'limit', 'Acknowledged drafts exhaust the total buffer budget.', { limit: 'maxTotalBytes', maximum: this.limits.maxTotalBytes });
    requireThat(doc.undo.reduce((n, u) => n + Buffer.byteLength(u.content), 0) <= this.limits.maxUndoBytes, 'limit', 'Undo budget reached; acknowledged content is retained.', { limit: 'maxUndoBytes', maximum: this.limits.maxUndoBytes });
    await atomicJson(await this.record(doc.id), doc);
  }
  private async current(id: string, expectedVersion: number) {
    const doc = await this.read(id);
    requireThat(doc.version === expectedVersion, 'stale', 'Read the current buffer before editing.', { documentId: id, expectedVersion, actualVersion: doc.version });
    return doc;
  }
  async edit(id: string, expectedVersion: number, edits: TextEdit[], group: string, author: string) {
    const doc = await this.current(id, expectedVersion);
    const sorted = [...edits].sort((a, b) => a.from - b.from);
    let last = -1, priorFrom = -1;
    const boundary = (n: number) => !(n > 0 && n < doc.content.length && /[\uD800-\uDBFF]/.test(doc.content[n - 1]!) && /[\uDC00-\uDFFF]/.test(doc.content[n]!));
    for (const e of sorted) {
      requireThat(Number.isSafeInteger(e.from) && Number.isSafeInteger(e.to) && e.from >= 0 && e.to >= e.from && e.to <= doc.content.length && e.from >= last && e.from !== priorFrom && boundary(e.from) && boundary(e.to), 'invalid', 'Text ranges must be nonoverlapping UTF-16 boundaries in the expected buffer.');
      last = e.to; priorFrom = e.from;
    }
    const prior = doc.undo.at(-1);
    if (!prior || prior.group !== group || prior.author !== author) doc.undo.push({ content: doc.content, group, author });
    for (const e of sorted.reverse()) doc.content = doc.content.slice(0, e.from) + e.insert + doc.content.slice(e.to);
    doc.version++; doc.dirty = true; doc.author = author; doc.acknowledgedAt = now();
    await this.persist(doc);
    return doc;
  }
  async undo(id: string, expectedVersion: number, author: string) {
    const doc = await this.current(id, expectedVersion);
    const previous = doc.undo.pop();
    requireThat(previous, 'condition', 'There is no acknowledged undo group.');
    doc.content = previous.content; doc.version++; doc.dirty = true; doc.author = author; doc.acknowledgedAt = now();
    await this.persist(doc); return doc;
  }
  async save(id: string, expectedVersion: number, expectedDiskDigest: string | null, author: string) {
    const doc = await this.current(id, expectedVersion);
    const file = await confined(this.root, doc.path, true);
    const actual = await fileDigest(file, this.limits.maxBufferBytes);
    requireThat(actual === expectedDiskDigest && actual === doc.diskDigest, 'conflict', 'Disk changed; the current buffer and undo are retained.', { documentId: id, actualDiskDigest: actual, expectedDiskDigest });
    // Digest checked immediately before atomic replacement; external writers do
    // not participate in the service lease. This is not a filesystem CAS.
    await atomicBytes(file, doc.content);
    doc.diskDigest = digest(doc.content); doc.dirty = false; doc.author = author; doc.acknowledgedAt = now();
    await this.persist(doc); return doc;
  }
  async snapshot(id: string, expectedVersion: number) {
    const doc = await this.current(id, expectedVersion);
    return { code: doc.content, sha256: digest(doc.content), source: { kind: 'buffer', documentId: id, version: doc.version, path: doc.path, dirty: doc.dirty } };
  }
  async anchor(id: string, expectedVersion: number, from: number, to: number) {
    const snapshot = await this.snapshot(id, expectedVersion);
    const boundary = (n: number) => !(n > 0 && n < snapshot.code.length && /[\uD800-\uDBFF]/.test(snapshot.code[n - 1]!) && /[\uDC00-\uDFFF]/.test(snapshot.code[n]!));
    requireThat(Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && to >= from && to <= snapshot.code.length && boundary(from) && boundary(to), 'invalid', 'Anchor must use complete UTF-16 character boundaries.');
    return { kind: 'document', source: snapshot.source, sha256: snapshot.sha256, from, to, text: snapshot.code.slice(from, to) };
  }
  async restore(imported: DocumentState, author: string) {
    requireThat(!imported.path.split('/').some(p => ['.rho', '.git'].includes(p)), 'scope', 'Internal state is not an editable document.');
    const target = await confined(this.root, imported.path, true);
    requireThat(digest(path.relative(await fs.realpath(this.root), target)) === imported.id, 'invalid', 'Restored document identity does not match its project-relative path.');
    const current = await readJson<DocumentState | null>(await this.record(imported.id), null);
    if (current) return { documentId: imported.id, state: current.content === imported.content && current.version === imported.version ? 'available' : 'conflict', retainedVersion: current.version };
    const all = await this.list();
    requireThat(all.length < this.limits.maxDocuments, 'limit', 'Document count limit reached during restoration.', { limit: 'maxDocuments' });
    const actual = await fileDigest(target, this.limits.maxBufferBytes);
    if (actual !== null && actual !== imported.diskDigest) return { documentId: imported.id, state: 'conflict', reason: 'Disk differs from the exported write condition.' };
    const restored = { ...imported, diskDigest: actual, dirty: imported.dirty || actual === null, author, acknowledgedAt: now() };
    await this.persist(restored, all); return { documentId: imported.id, state: 'available', disk: actual === null ? 'missing' : 'available', version: restored.version };
  }
}

const documentRef = obj({ documentId: text });
const documentSkill = declaredSkill('documents.workspace', 'Use capability.list to discover document.open, document.read, document.edit, document.undo and document.save. Preserve UTF-16 ranges, expected versions, undo groups and disk write conditions.');
export const plugin = {
  entryVersion: '1.0',
  id: 'documents', package: '@rho-workspace/plugin-documents', version: '0.4.0', requires: [], capabilities: ['documents'], presentation,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })),
  skills: [documentSkill],
  components: [{ id: 'rho.editor', version: '0.2.0', owner: 'rho-plugins.documents', bindings: { document: 'document' }, ui: 'unavailable', presentation: viewPresentation, propsSchema: { type: 'object', additionalProperties: false, properties: { title: { type: 'string', minLength: 1 } }, required: ['title'] } }]
};
