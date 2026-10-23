import { skillPresentation, presentation, operationPresentation, viewPresentation } from './presentation.js';
import { operationContracts } from './operations.js';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicBytes, atomicJson, canonical, confined, digest, now, readJson, requireThat, stateDirectory } from '@rho-workspace/plugin-contracts';
import { apply, compose, inverse, snapshot as historySnapshot, statuses, summarize, transport, validateHistory, type Delta, type EditRecord } from './history.js';
export type { Delta, EditRecord } from './history.js';

const declaredSkill = (id: string, content: string, version = '1.0') => ({ id, version, content, digest: digest(content) });

async function fileDigest(file: string, maxBytes = 1024 * 1024): Promise<string | null> {
  try { requireThat((await fs.stat(file)).size <= maxBytes, 'limit', 'Disk document exceeds the bounded digest reader; the acknowledged buffer is retained.', { limit: 'maxBufferBytes', maximum: maxBytes }); return digest(await fs.readFile(file)); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
}

export interface DocumentState {
  id: string; path: string; version: number; content: string; diskDigest: string | null;
  dirty: boolean; author: string; acknowledgedAt: string;
  undo: { content: string; group: string; author: string; changeIds?: string[] }[];
  revision: number;
  receipts: DocumentReceipt[];
  retainedFromRevision: number;
  pendingSave?: PendingSave;
  history: EditRecord[];
  historyRetainedFromVersion: number;
}
export interface DocumentChange { changeId: string; expectedRevision: number }
export interface DocumentReceipt {
  changeId: string; requestDigest: string; kind: 'edit' | 'undo' | 'save' | 'abandon-save' | 'undo-own' | 'revert'; author: string;
  revision: number; version: number; at: string;
}
export interface PendingSave {
  requestDigest: string; author: string; expectedDiskDigest: string | null;
  contentDigest: string; at: string; change?: DocumentChange;
}
export type DocumentResult = DocumentState & { receipt?: DocumentReceipt };
export interface TextEdit { from: number; to: number; insert: string }
export interface DocumentPaths { resolve(relative: string, missing?: boolean): Promise<{ file: string; relative: string }> }
export const documentLimits = { maxBufferBytes: 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024, maxUndoBytes: 8 * 1024 * 1024, maxDocuments: 64, maxReceipts: 256, maxHistoryEntries: 256, maxHistoryEdits: 4096 };
export class Documents {
  limits: typeof documentLimits;
  constructor(public root: string, limits: Partial<typeof documentLimits> = {}, private paths?: DocumentPaths) {
    this.limits = { ...documentLimits, ...limits };
    requireThat(Number.isSafeInteger(this.limits.maxReceipts) && this.limits.maxReceipts > 0, 'invalid', 'Document maxReceipts must be a positive integer.');
    for (const name of ['maxHistoryEntries', 'maxHistoryEdits'] as const) requireThat(Number.isSafeInteger(this.limits[name]) && this.limits[name] > 0, 'invalid', 'Document history limits must be positive integers.', { limit: name });
  }
  private async directory() { return stateDirectory(this.root, '.rho/plugins/documents'); }
  private async source(relative: string, missing = true) {
    requireThat(!/^@[^/]+\//.test(relative) || this.paths, 'unavailable', 'Source-folder access needs its selected file service.');
    if (this.paths) return this.paths.resolve(relative, missing);
    const file = await confined(this.root, relative, missing);
    return { file, relative: path.relative(await fs.realpath(this.root), file) };
  }
  private async record(id: string) {
    requireThat(/^[a-f0-9]{64}$/.test(id), 'invalid', 'Invalid document identity.');
    return path.join(await this.directory(), id + '.json');
  }
  async list(): Promise<DocumentState[]> {
    const d = await this.directory();
    return Promise.all((await fs.readdir(d)).filter(n => /^[a-f0-9]{64}\.json$/.test(n)).map(n => this.read(n.slice(0, -5))));
  }
  private normalize(doc: DocumentState): DocumentState {
    // Earlier buffers/archives have content versions but no mutation revision.
    const { receipt, ...state } = doc as DocumentResult;
    return { ...state, revision: doc.revision ?? doc.version - 1, receipts: doc.receipts ?? [], retainedFromRevision: doc.retainedFromRevision ?? (doc.revision ?? doc.version - 1) + 1, history: doc.history ?? [], historyRetainedFromVersion: doc.historyRetainedFromVersion ?? doc.version + 1 };
  }
  async read(id: string) { return this.normalize(await readJson<DocumentState>(await this.record(id))); }
  async open(relative: string, author: string) {
    requireThat(!relative.split('/').some(p => ['.rho', '.git'].includes(p)), 'scope', 'Internal state is not an editable document.');
    const { file, relative: normalized } = await this.source(relative);
    const id = digest(normalized);
    const existing = await readJson<DocumentState | null>(await this.record(id), null);
    if (existing) return this.normalize(existing);
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
    const doc: DocumentState = { id, path: normalized, content, version: 1, diskDigest, dirty: false, author, acknowledgedAt: now(), undo: [], revision: 0, receipts: [], retainedFromRevision: 1, history: [], historyRetainedFromVersion: 2 };
    await this.persist(doc, all);
    return doc;
  }
  private async persist(doc: DocumentState, all?: DocumentState[]) {
    const bytes = Buffer.byteLength(doc.content);
    requireThat(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(doc.content), 'invalid', 'Document text contains an unpaired Unicode surrogate.');
    requireThat(bytes <= this.limits.maxBufferBytes, 'limit', 'Edit exceeds the buffer byte limit.', { limit: 'maxBufferBytes', maximum: this.limits.maxBufferBytes });
    const others = (all ?? await this.list()).filter(d => d.id !== doc.id);
    requireThat(bytes + others.reduce((n, d) => n + Buffer.byteLength(d.content), 0) <= this.limits.maxTotalBytes, 'limit', 'Acknowledged drafts exhaust the total buffer budget.', { limit: 'maxTotalBytes', maximum: this.limits.maxTotalBytes });
    const historyBytes = doc.history.reduce((n, entry) => n + entry.edits.reduce((n, edit) => n + Buffer.byteLength(edit.insert) + Buffer.byteLength(edit.removed), 0), 0);
    requireThat(doc.undo.reduce((n, u) => n + Buffer.byteLength(u.content), historyBytes) <= this.limits.maxUndoBytes, 'limit', 'Undo/history text budget reached; acknowledged content is retained.', { limit: 'maxUndoBytes', maximum: this.limits.maxUndoBytes });
    requireThat(doc.history.length <= this.limits.maxHistoryEntries && doc.history.reduce((n, e) => n + e.edits.length, 0) <= this.limits.maxHistoryEdits, 'limit', 'Retained document history exceeds configured limits.');
    requireThat(doc.receipts.length <= this.limits.maxReceipts, 'limit', 'Document receipts exceed configured retention; existing state is retained.', { limit: 'maxReceipts', maximum: this.limits.maxReceipts });
    await atomicJson(await this.record(doc.id), doc);
  }
  private async current(id: string, expectedVersion: number) {
    const doc = await this.read(id);
    requireThat(doc.version === expectedVersion, 'stale', 'Read the current buffer before editing.', { documentId: id, expectedVersion, actualVersion: doc.version });
    return doc;
  }
  private async mutation(id: string, expectedVersion: number, kind: DocumentReceipt['kind'], input: unknown, author: string, change?: DocumentChange) {
    const doc = await this.read(id);
    if (change) requireThat(/^[A-Za-z0-9._:@-]{1,128}$/.test(change.changeId) && Number.isSafeInteger(change.expectedRevision) && change.expectedRevision >= 0, 'invalid', 'Supply a stable changeId and expectedRevision together.');
    const requestDigest = digest(canonical({ id, expectedVersion, kind, input, author, change: change ?? null }));
    const receipt = change && doc.receipts.find(r => r.changeId === change.changeId);
    if (receipt) {
      requireThat(receipt.requestDigest === requestDigest, 'conflict', 'Document changeId names different content, conditions or author.');
      return { doc, requestDigest, receipt };
    }
    requireThat(doc.version === expectedVersion && (!change || doc.revision === change.expectedRevision), 'stale', 'Read the current buffer and receipt boundary. Missing receipts do not authorize replay.', { documentId: id, actualVersion: doc.version, actualRevision: doc.revision, retainedFromRevision: doc.retainedFromRevision });
    requireThat(!doc.pendingSave || kind === 'abandon-save' || (kind === 'save' && doc.pendingSave.requestDigest === requestDigest), 'condition', 'Resume the original pending save before changing this buffer.', { documentId: id, pendingSave: doc.pendingSave });
    return { doc, requestDigest, receipt: undefined };
  }
  private acknowledge(doc: DocumentState, kind: DocumentReceipt['kind'], requestDigest: string, author: string, at: string, change?: DocumentChange): DocumentResult {
    doc.revision++; doc.author = author; doc.acknowledgedAt = at;
    const receipt = change ? { changeId: change.changeId, requestDigest, kind, author, revision: doc.revision, version: doc.version, at } : undefined;
    doc.receipts = [...doc.receipts, ...(receipt ? [receipt] : [])].slice(-this.limits.maxReceipts);
    doc.retainedFromRevision = doc.receipts[0]?.revision ?? doc.revision + 1;
    return receipt ? { ...doc, receipt } : doc;
  }
  private recordEdit(doc: DocumentState, before: string, edits: Delta[], kind: EditRecord['kind'], requestDigest: string, changeId: string, undoGroup: string, groupId: string, reverts: string[] = []) {
    requireThat(!doc.history.some(e => e.changeId === changeId), 'conflict', 'Change identity already names retained document history.');
    requireThat(edits.length <= this.limits.maxHistoryEdits, 'limit', 'This edit exceeds retained history work limits.', { limit: 'maxHistoryEdits', maximum: this.limits.maxHistoryEdits });
    doc.history.push({ changeId, requestDigest, author: doc.author, kind, undoGroup, groupId, version: doc.version, revision: doc.revision, at: doc.acknowledgedAt, beforeDigest: digest(before), afterDigest: digest(doc.content), edits, reverts });
    while (doc.history.length > this.limits.maxHistoryEntries || doc.history.reduce((n, e) => n + e.edits.length, 0) > this.limits.maxHistoryEdits) doc.history.shift();
    doc.historyRetainedFromVersion = doc.history[0]?.version ?? doc.version + 1;
  }
  async edit(id: string, expectedVersion: number, edits: TextEdit[], group: string, author: string, change?: DocumentChange): Promise<DocumentResult> {
    const { doc, requestDigest, receipt } = await this.mutation(id, expectedVersion, 'edit', { edits, group }, author, change);
    if (receipt) return { ...doc, receipt };
    const sorted = [...edits].sort((a, b) => a.from - b.from);
    const before = doc.content, changeId = change?.changeId ?? 'legacy:' + randomUUID();
    const deltas = sorted.map(e => ({ ...e, removed: before.slice(e.from, e.to) }));
    let last = -1, priorFrom = -1;
    const boundary = (n: number) => !(n > 0 && n < doc.content.length && /[\uD800-\uDBFF]/.test(doc.content[n - 1]!) && /[\uDC00-\uDFFF]/.test(doc.content[n]!));
    for (const e of sorted) {
      requireThat(Number.isSafeInteger(e.from) && Number.isSafeInteger(e.to) && e.from >= 0 && e.to >= e.from && e.to <= doc.content.length && e.from >= last && e.from !== priorFrom && boundary(e.from) && boundary(e.to), 'invalid', 'Text ranges must be nonoverlapping UTF-16 boundaries in the expected buffer.');
      last = e.to; priorFrom = e.from;
    }
    const prior = doc.undo.at(-1);
    const lastEntry = doc.history.at(-1);
    const joins = prior && prior.group === group && prior.author === author && lastEntry?.kind === 'edit' && lastEntry.undoGroup === group && lastEntry.author === author;
    if (!joins) doc.undo.push({ content: doc.content, group, author, changeIds: [changeId] });
    else prior.changeIds = [...(prior.changeIds ?? []), changeId].slice(-this.limits.maxHistoryEntries);
    for (const e of sorted.reverse()) doc.content = doc.content.slice(0, e.from) + e.insert + doc.content.slice(e.to);
    doc.version++; doc.dirty = true;
    const result = this.acknowledge(doc, 'edit', requestDigest, author, now(), change);
    this.recordEdit(doc, before, deltas, 'edit', requestDigest, changeId, group, joins ? lastEntry!.groupId : changeId);
    await this.persist(doc);
    return { ...doc, ...(result.receipt ? { receipt: result.receipt } : {}) };
  }
  async undo(id: string, expectedVersion: number, author: string, change?: DocumentChange): Promise<DocumentResult> {
    const { doc, requestDigest, receipt } = await this.mutation(id, expectedVersion, 'undo', null, author, change);
    if (receipt) return { ...doc, receipt };
    const previous = doc.undo.pop();
    requireThat(previous, 'condition', 'There is no acknowledged undo group.');
    const before = doc.content;
    doc.content = previous.content; doc.version++; doc.dirty = true;
    const result = this.acknowledge(doc, 'undo', requestDigest, author, now(), change);
    const changeId = change?.changeId ?? 'legacy:' + randomUUID();
    this.recordEdit(doc, before, [{ from: 0, to: before.length, insert: doc.content, removed: before }], 'undo', requestDigest, changeId, 'global-undo', changeId, previous.changeIds ?? []);
    await this.persist(doc); return { ...doc, ...(result.receipt ? { receipt: result.receipt } : {}) };
  }
  async history(id: string) {
    const doc = await this.read(id);
    return { documentId: id, currentVersion: doc.version, currentRevision: doc.revision, retainedFromVersion: doc.historyRetainedFromVersion, entries: summarize(doc.history) };
  }
  async readChange(id: string, targetChangeId: string) {
    const doc = await this.read(id), index = doc.history.findIndex(e => e.changeId === targetChangeId);
    requireThat(index >= 0, 'not_found', 'This change is outside retained history; its before text is unavailable.', { retainedFromVersion: doc.historyRetainedFromVersion });
    const entry = doc.history[index]!, after = historySnapshot(doc.content, doc.history, index, this.limits.maxBufferBytes);
    requireThat(digest(after) === entry.afterDigest, 'condition', 'Historical after text does not match its digest.');
    const before = historySnapshot(doc.content, doc.history, index - 1, this.limits.maxBufferBytes);
    requireThat(digest(before) === entry.beforeDigest, 'condition', 'Historical before text does not match its digest.');
    return { documentId: id, change: summarize(doc.history)[index], before: { version: entry.version - 1, digest: entry.beforeDigest, content: before }, after: { version: entry.version, digest: entry.afterDigest, content: after } };
  }
  async undoOwn(id: string, expectedVersion: number, author: string, change: DocumentChange): Promise<DocumentResult> {
    return this.selective(id, expectedVersion, author, change, 'undo-own');
  }
  async revert(id: string, expectedVersion: number, targetChangeId: string, author: string, change: DocumentChange): Promise<DocumentResult> {
    return this.selective(id, expectedVersion, author, change, 'revert', targetChangeId);
  }
  private async selective(id: string, expectedVersion: number, author: string, change: DocumentChange, kind: 'undo-own' | 'revert', targetChangeId?: string): Promise<DocumentResult> {
    requireThat(change, 'invalid', 'Selective undo requires changeId and expectedRevision.');
    const { doc, requestDigest, receipt } = await this.mutation(id, expectedVersion, kind, { targetChangeId: targetChangeId ?? null }, author, change);
    if (receipt) return { ...doc, receipt };
    const state = statuses(doc.history);
    const target = targetChangeId ? doc.history.find(e => e.changeId === targetChangeId) : [...doc.history].reverse().find(e => e.kind === 'edit' && e.author === author && state.get(e.changeId) === null);
    requireThat(target, 'not_found', 'No requested edit is retained for this caller.', { retainedFromVersion: doc.historyRetainedFromVersion });
    requireThat((kind === 'revert' || target.kind === 'edit') && state.get(target.changeId) === null, 'condition', 'This change is not active.');
    const entries = kind === 'revert' ? [target] : doc.history.filter(e => e.kind === 'edit' && e.groupId === target.groupId);
    requireThat(kind === 'revert' || (entries[0]?.changeId === target.groupId && entries.every(e => e.author === author && state.get(e.changeId) === null)), 'condition', 'The complete active author undo group is not retained; individual retained edits remain inspectable.');
    const index = doc.history.indexOf(entries.at(-1)!);
    const after = historySnapshot(doc.content, doc.history, index, this.limits.maxBufferBytes);
    let before = after;
    for (const entry of [...entries].reverse()) before = apply(before, inverse(entry.edits));
    const forward = entries.length === 1 ? entries[0]!.edits : compose(before, entries);
    const later = doc.history.slice(index + 1);
    const netLater = later.length ? [{ ...later.at(-1)!, edits: compose(after, later) }] : [];
    const reverse = transport(inverse(forward), netLater);
    const current = doc.content;
    doc.content = apply(current, reverse);
    doc.undo.push({ content: current, group: kind + ':' + change.changeId, author, changeIds: [change.changeId] });
    doc.version++; doc.dirty = true;
    const result = this.acknowledge(doc, kind, requestDigest, author, now(), change);
    this.recordEdit(doc, current, reverse, kind, requestDigest, change.changeId, kind, change.changeId, entries.map(e => e.changeId));
    await this.persist(doc); return { ...doc, ...(result.receipt ? { receipt: result.receipt } : {}) };
  }
  async save(id: string, expectedVersion: number, expectedDiskDigest: string | null, author: string, change?: DocumentChange): Promise<DocumentResult> {
    const { doc, requestDigest, receipt } = await this.mutation(id, expectedVersion, 'save', { expectedDiskDigest }, author, change);
    if (receipt) return { ...doc, receipt };
    const { file } = await this.source(doc.path);
    const actual = await fileDigest(file, this.limits.maxBufferBytes);
    const pending = doc.pendingSave;
    const alreadyWritten = pending && actual === pending.contentDigest;
    requireThat(alreadyWritten || (actual === expectedDiskDigest && actual === doc.diskDigest), 'conflict', 'Disk changed; the current buffer and undo are retained.', { documentId: id, actualDiskDigest: actual, expectedDiskDigest });
    if (!pending) {
      // Retain the original save identity before replacing disk bytes. Reads
      // expose this pending fact; only an explicit identical save resumes it.
      doc.pendingSave = { requestDigest, author, expectedDiskDigest, contentDigest: digest(doc.content), at: now(), ...(change ? { change } : {}) };
      await this.persist(doc);
    }
    // Digest checked immediately before atomic replacement; external writers do
    // not participate in the service lease. This is not a filesystem CAS.
    if (!alreadyWritten) {
      requireThat(await fileDigest(file, this.limits.maxBufferBytes) === expectedDiskDigest, 'conflict', 'Disk changed while preparing save; original pending save and buffer are retained.');
      await atomicBytes(file, doc.content);
    }
    delete doc.pendingSave;
    doc.diskDigest = digest(doc.content); doc.dirty = false;
    const result = this.acknowledge(doc, 'save', requestDigest, author, now(), change);
    await this.persist(doc); return result;
  }
  async abandonSave(id: string, expectedVersion: number, pendingRequestDigest: string, author: string, change: DocumentChange): Promise<DocumentResult> {
    requireThat(change, 'invalid', 'Abandoning a pending save requires changeId and expectedRevision.');
    const { doc, requestDigest, receipt } = await this.mutation(id, expectedVersion, 'abandon-save', { pendingRequestDigest }, author, change);
    if (receipt) return { ...doc, receipt };
    const pending = doc.pendingSave;
    requireThat(pending && pending.requestDigest === pendingRequestDigest, 'condition', 'Name the pending save currently retained by this document.', { documentId: id, pendingSave: pending ?? null });
    // Only a save that can no longer complete may be abandoned; a resumable
    // save must be resumed, so its intent is never silently dropped.
    const actual = await fileDigest((await this.source(doc.path)).file, this.limits.maxBufferBytes);
    requireThat(actual !== pending.contentDigest && actual !== pending.expectedDiskDigest, 'condition', 'This pending save can still complete; resume it with the original save request.', { documentId: id, actualDiskDigest: actual });
    // Disk is not touched. The acknowledged buffer, dirty state and undo stay.
    delete doc.pendingSave;
    const result = this.acknowledge(doc, 'abandon-save', requestDigest, author, now(), change);
    await this.persist(doc); return result;
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
    imported = this.normalize(imported);
    requireThat(imported.historyRetainedFromVersion === (imported.history[0]?.version ?? imported.version + 1), 'invalid', 'Invalid document history retention boundary.');
    requireThat(imported.history.length <= this.limits.maxHistoryEntries && imported.history.reduce((n, e) => n + e.edits.length, 0) <= this.limits.maxHistoryEdits, 'limit', 'Archived document history exceeds configured work limits.');
    validateHistory(imported.content, imported.version, imported.revision, imported.history, this.limits.maxBufferBytes);
    requireThat(Number.isSafeInteger(imported.revision) && imported.revision >= 0 && Array.isArray(imported.receipts) && new Set(imported.receipts.map(r => r.changeId)).size === imported.receipts.length && imported.receipts.every((r, i) => /^[A-Za-z0-9._:@-]{1,128}$/.test(r.changeId) && /^[a-f0-9]{64}$/.test(r.requestDigest) && ['edit', 'undo', 'save', 'abandon-save', 'undo-own', 'revert'].includes(r.kind) && typeof r.author === 'string' && r.author.length > 0 && typeof r.at === 'string' && Number.isSafeInteger(r.version) && r.version > 0 && r.version <= imported.version && Number.isSafeInteger(r.revision) && r.revision > 0 && r.revision <= imported.revision && (i === 0 || r.revision > imported.receipts[i - 1]!.revision)) && imported.retainedFromRevision === (imported.receipts[0]?.revision ?? imported.revision + 1), 'invalid', 'Invalid archived document revision or receipt boundary.');
    if (imported.pendingSave) return { documentId: imported.id, state: 'conflict', reason: 'Archive retains an unresolved save; resume it in the source project.', pendingSave: imported.pendingSave };
    requireThat(!imported.path.split('/').some(p => ['.rho', '.git'].includes(p)), 'scope', 'Internal state is not an editable document.');
    const { file: target, relative } = await this.source(imported.path);
    requireThat(digest(relative) === imported.id, 'invalid', 'Restored document identity does not match its project-relative path.');
    const current = await readJson<DocumentState | null>(await this.record(imported.id), null);
    if (current) {
      const retained = this.normalize(current);
      const matches = retained.content === imported.content && retained.version === imported.version && retained.revision === imported.revision && canonical(retained.history) === canonical(imported.history) && canonical(retained.receipts) === canonical(imported.receipts) && canonical(retained.undo) === canonical(imported.undo);
      return { documentId: imported.id, state: matches ? 'available' : 'conflict', retainedVersion: current.version };
    }
    const all = await this.list();
    requireThat(all.length < this.limits.maxDocuments, 'limit', 'Document count limit reached during restoration.', { limit: 'maxDocuments' });
    const actual = await fileDigest(target, this.limits.maxBufferBytes);
    if (actual !== null && actual !== imported.diskDigest) return { documentId: imported.id, state: 'conflict', reason: 'Disk differs from the exported write condition.' };
    const restored = { ...imported, diskDigest: actual, dirty: imported.dirty || actual === null, author, acknowledgedAt: now() };
    await this.persist(restored, all); return { documentId: imported.id, state: 'available', disk: actual === null ? 'missing' : 'available', version: restored.version };
  }
}

const documentSkillContent = [
  'Edit a document buffer with a stable identity, explicit undo and conditional saves.',
  'Use capability.list to discover the document operations this session may call.',
  '',
  '1. document.open takes a project-relative path and returns the buffer with id, version',
  '   and revision. Inside the project, never under .rho or .git: internal state is not',
  '   an editable document.',
  '2. Writes are conditional. document.edit takes expectedVersion and, when changeId is',
  '   given, expectedRevision as well: the two travel together, always. A refused edit',
  '   leaves the buffer and undo untouched; re-read and retry with the current numbers',
  '   rather than replaying the old request under a new identity.',
  '3. Undo has three distinct meanings. document.undoOwn reverses only the caller\'s own',
  '   latest complete retained input group. document.revert reverses one named active',
  '   change, possibly by another author, through targetChangeId. document.undo is the',
  '   legacy global form and is not the human keyboard shortcut.',
  '4. document.save writes disk only when the expected disk digest still matches. After',
  '   a lost reply the save is pending: read the buffer to see pendingSave, and either',
  '   resume the same request or abandon it with document.abandonSave, which never',
  '   writes disk and keeps the buffer.',
  '5. History is author-scoped. document.history lists retained entries;',
  '   document.change.read returns exact before and after text for one change.',
  '',
  'A browser tab may read and edit but never save: saving is an Agent or operator step.',
  'Live editor bindings use {kind:"live-document",documentId}; a pinned binding keeps an',
  'exact version and stays exact.'
].join('\n');
const documentSkill = {
  ...declaredSkill('documents.workspace', documentSkillContent, '1.4'),
  intent: 'Edit a document buffer conditionally, with explicit undo and save conditions.',
  requires: ['document.open', 'document.read', 'document.edit', 'document.save', 'document.undoOwn', 'document.revert'],
  example: {
    method: 'document.edit',
    input: {
      documentId: '5df1e6280c70fa8475dfd6bb1a6165b302443640224c893510eed728058adac0',
      expectedVersion: 1, expectedRevision: 0, changeId: 'edit-intro-1', undoGroup: 'agent-edit',
      edits: [{ from: 0, to: 0, insert: '# Draft\n' }]
    }
  },
  failureRecipes: [
    { kind: 'invalid', message: 'must have property expectedRevision when property changeId is present', next: 'Send changeId and expectedRevision together; read the buffer for its current revision.' },
    { kind: 'stale', message: 'Document version or revision changed.', next: 'Re-read the document and retry with its current version and revision; keep the original changeId only for the same request.' },
    { kind: 'scope', message: 'Internal state is not an editable document.', next: 'Edit a project file, not anything under .rho or .git.' },
    { kind: 'condition', message: 'Resume the original pending save before changing this buffer.', next: 'Read the buffer, then resume that exact save or abandon it with document.abandonSave.' },
    { kind: 'unauthorized', message: 'Only the Agent or operator saves to disk.', next: 'A tab edits the buffer; ask the Agent to save the document.' }
  ],
  verify: { command: 'npm run test:documents', description: 'Author-scoped undo, one-change revert, shared buffers and conditional saves over HTTP.' }
};
export const plugin = {
  entryVersion: '1.0',
  id: 'documents', package: '@rho-workspace/plugin-documents', version: '0.4.2', requires: [], capabilities: ['documents'], presentation,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })),
  skills: [{ ...documentSkill, presentation: skillPresentation }],
  components: [{ id: 'rho.editor', version: '0.2.0', owner: 'rho-plugins.documents', bindings: { document: 'document' }, ui: './ui', presentation: viewPresentation, propsSchema: { type: 'object', additionalProperties: false, properties: { title: { type: 'string', minLength: 1 } }, required: ['title'] } }]
};
