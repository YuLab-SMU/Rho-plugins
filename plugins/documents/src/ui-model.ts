// Browser adapter for one Documents buffer. It has no DOM dependency so its
// identity, retry and conflict rules are checked in Node. Documents remains the
// only buffer and undo owner; this keeps unconfirmed input until acknowledged.

export interface UiClient { call(method: string, input: any): Promise<any> }
export interface Delta { from: number; to: number; insert: string; removed: string }
export interface HistoryEntry {
  changeId: string; author: string; kind: 'edit' | 'undo' | 'undo-own' | 'revert';
  groupId: string; version: number; at: string; edits: Delta[]; reverts: string[];
}
export interface Buffer { id: string; path: string; content: string; version: number; revision: number; dirty?: boolean; diskDigest?: string | null; history?: HistoryEntry[]; historyRetainedFromVersion?: number; receipt?: { author: string } }
export interface Port { text(): string; replace(next: string): void; composing(): boolean }
export interface Group { groupId: string; author: string; kind: HistoryEntry['kind']; at: string; changeIds: string[]; active: boolean; lines: [number, number] | null; reverts: string[] }

// Exact bindings never subscribe to, or borrow text from, the live adapter.
export async function readVersion(client: UiClient, projectId: string, documentId: string, version: number): Promise<string> {
  const input = { projectId, documentId };
  const current: Buffer = await client.call('document.read', input);
  if (current.version === version) return current.content;
  const entry = current.history?.find(e => e.version === version || e.version === version + 1);
  if (entry) {
    const change = await client.call('document.change.read', { ...input, targetChangeId: entry.changeId });
    if (change.after.version === version) return change.after.content;
    if (change.before.version === version) return change.before.content;
  }
  throw new Error(`Version ${version} is no longer available. This view keeps its original reference.`);
}

export function authorLabel(author: string, me?: string) {
  if (me && author === me) return 'You';
  if (author.startsWith('agent:')) return 'Claude Code';
  if (author === 'operator') return 'Rho';
  if (author === 'disk') return 'File on disk';
  if (author.startsWith('browser:')) return 'Another tab';
  return 'Someone else';
}

const kindOf = (error: any): string | undefined => error?.error?.kind ?? error?.kind;
export const browserDocumentLimits = { maxUnconfirmedBytes: 1024 * 1024 };
const identity = () => 'tab-' + globalThis.crypto.randomUUID();
const surrogate = (text: string, at: number) => at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]!) && /[\uDC00-\uDFFF]/.test(text[at]!);

// One contiguous edit turning `a` into `b`, never splitting a surrogate pair.
export function diff(a: string, b: string): Delta | null {
  if (a === b) return null;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (surrogate(a, start) || surrogate(b, start)) start--;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  while (surrogate(a, a.length - end) || surrogate(b, b.length - end)) end--;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end), removed: a.slice(start, a.length - end) };
}

// Where text written by retained changes sits in the current buffer. Later
// edits shift or trim earlier ranges; overwritten text no longer counts.
export function currentRanges(history: HistoryEntry[], pick: (entry: HistoryEntry) => boolean) {
  const ranges: { from: number; to: number; changeId: string }[] = [];
  for (const entry of history) {
    for (const range of ranges) {
      for (const edit of [...entry.edits].reverse()) {
        const delta = edit.insert.length - (edit.to - edit.from);
        if (edit.to <= range.from) { range.from += delta; range.to += delta; }
        else if (edit.from < range.to) {
          // Keep the parts outside the overwritten span.
          range.from = edit.from <= range.from ? edit.from + edit.insert.length : range.from;
          range.to = edit.to >= range.to ? edit.from : range.to + delta;
          if (range.to < range.from) range.to = range.from;
        }
      }
    }
    if (pick(entry)) {
      let shift = 0;
      for (const edit of entry.edits) {
        const from = edit.from + shift;
        if (edit.insert) ranges.push({ from, to: from + edit.insert.length, changeId: entry.changeId });
        shift += edit.insert.length - (edit.to - edit.from);
      }
    }
  }
  return ranges.filter(r => r.to > r.from);
}

export function lineOf(text: string, at: number) { let line = 1; for (let i = 0; i < at && i < text.length; i++) if (text[i] === '\n') line++; return line; }

// Changes grouped the way people made them: one typing burst, one Agent edit.
export function groups(buffer: Buffer): Group[] {
  const history = buffer.history ?? [];
  const reverted = new Map<string, string | null>(history.map(e => [e.changeId, null]));
  for (const entry of [...history].reverse()) {
    if (reverted.get(entry.changeId) !== null) continue;
    for (const id of entry.reverts) if (reverted.has(id)) reverted.set(id, reverted.get(id) === null ? entry.changeId : null);
  }
  const out: Group[] = [];
  for (const entry of history) {
    const prior = out.at(-1);
    const group = !entry.author.startsWith('agent:') && prior && prior.groupId === entry.groupId && prior.author === entry.author ? prior : undefined;
    const target = group ?? { groupId: entry.groupId, author: entry.author, kind: entry.kind, at: entry.at, changeIds: [], active: true, lines: null, reverts: [] };
    target.changeIds.push(entry.changeId); target.at = entry.at; target.reverts.push(...entry.reverts);
    if (!group) out.push(target);
  }
  for (const group of out) {
    group.active = group.kind === 'edit' && group.changeIds.every(id => reverted.get(id) === null);
    const ranges = currentRanges(history, e => group.changeIds.includes(e.changeId));
    if (ranges.length) group.lines = [lineOf(buffer.content, Math.min(...ranges.map(r => r.from))), lineOf(buffer.content, Math.max(...ranges.map(r => r.to - 1)))];
  }
  return out;
}

export class DocumentSync {
  confirmed: Buffer | null = null;
  sent = '';
  aside: { text: string; at: string } | null = null;
  notice = '';
  // A change the owner has not confirmed because its reply did not arrive: it stays here and is
  // sent again unchanged, so it is applied once, but until then it is not in the shared buffer.
  unconfirmed = false;
  stateVersion = 0;
  private ports = new Set<Port>();
  private source: Port | null = null;
  private draft = '';
  private inflight = false;
  private pending = false;
  private group = identity();
  private lastEdit = 0;
  private seen = 0;
  private seenRevision = 0;
  private idle: (() => void)[] = [];
  private listeners = new Set<() => void>();
  private loading?: Promise<Buffer>;
  private commands: Promise<unknown> = Promise.resolve();
  private readonly retryDelays = [200, 500, 1000, 2000, 4000];
  constructor(public client: UiClient, public projectId: string, public documentId: string, public readonly me?: string, public readonly limits = browserDocumentLimits) {}
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { this.stateVersion++; for (const listener of this.listeners) listener(); }
  attach(port: Port) {
    this.ports.add(port);
    return () => {
      this.ports.delete(port);
      if (this.source !== port) return;
      const text = port.text();
      const replacement = [...this.ports].find(p => !p.composing() && p.text() === text);
      if (!port.composing() && replacement) { this.source = replacement; return; }
      // A detached editor cannot later finish its composition. Keep the full
      // unsent draft explicitly; do not depend on reading a destroyed editor.
      if ((this.pending || port.composing()) && diff(this.confirmed?.content ?? this.sent, text)) {
        this.aside ??= { text, at: new Date().toISOString() };
        this.pending = false; this.changed();
      }
      this.source = null;
    };
  }
  get busy() { return this.inflight || this.pending; }
  refuseInput() { this.notice = 'This document reached its input byte limit. Existing text is kept.'; this.changed(); }

  load(): Promise<Buffer> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const buffer: Buffer = await this.client.call('document.read', { projectId: this.projectId, documentId: this.documentId });
      if (this.busy || [...this.ports].some(p => p.composing())) return buffer;
      if (this.confirmed && buffer.revision < this.confirmed.revision) return this.confirmed;
      this.accept(buffer); this.sent = buffer.content; this.draft = buffer.content;
      for (const port of this.ports) port.replace(buffer.content);
      this.changed(); return buffer;
    })().finally(() => { this.loading = undefined; });
    return this.loading;
  }
  private accept(buffer: Buffer) {
    this.confirmed = buffer;
  }
  // Retain the exact request; a lost reply resends it unchanged.
  private async deliver(method: string, input: any) {
    for (let attempt = 0; ; attempt++) {
      try { const result = await this.client.call(method, input); if (this.unconfirmed) { this.unconfirmed = false; this.changed(); } return result; }
      catch (error) {
        if (kindOf(error) !== undefined) { if (this.unconfirmed) { this.unconfirmed = false; this.changed(); } throw error; }
        if (!this.unconfirmed) { this.unconfirmed = true; this.changed(); }
        await new Promise(resolve => setTimeout(resolve, this.retryDelays[Math.min(attempt, this.retryDelays.length - 1)]));
      }
    }
  }

  // A view reports that its text changed because of local input.
  local(port: Port) {
    if (this.aside) { if (!port.composing()) port.replace(this.sent); return; }
    // Budget the unconfirmed document, not just the last inserted fragment.
    if (new TextEncoder().encode(port.text()).length > this.limits.maxUnconfirmedBytes) {
      port.replace(this.draft);
      this.refuseInput(); return;
    }
    this.source = port; this.pending = true;
    const text = port.text(); this.draft = text;
    for (const other of this.ports) if (other !== port && !other.composing()) other.replace(text);
    this.flush();
  }
  flush() {
    if (this.aside) {
      if (!this.busy && ![...this.ports].some(p => p.composing())) void this.load().catch(() => undefined);
      return;
    }
    const source = this.source;
    if (this.inflight || !this.confirmed || !source || source.composing()) return;
    const text = source.text(), edit = diff(this.sent, text);
    if (!edit) { this.pending = false; this.settle(); return; }
    if (Date.now() - this.lastEdit > 1000) this.group = identity();
    this.lastEdit = Date.now();
    const base = this.confirmed;
    const input = { projectId: this.projectId, documentId: this.documentId, expectedVersion: base.version, expectedRevision: base.revision, changeId: identity(), undoGroup: this.group, edits: [{ from: edit.from, to: edit.to, insert: edit.insert }] };
    this.inflight = true; this.pending = false; this.sent = text;
    this.deliver('document.edit', input).then(result => {
      this.inflight = false; this.accept(result);
      if (result.content !== text) {
        if (this.source && this.source.text() !== text) return this.keepAside(this.source.text());
        this.sent = result.content; this.draft = result.content;
        for (const port of this.ports) if (!port.composing()) port.replace(result.content);
        this.pending = false;
      }
      this.changed();
      if (this.pending || this.source && this.source.text() !== this.sent) { this.pending = true; this.flush(); } else this.settle();
    }, error => {
      this.inflight = false;
      return this.keepAside(this.source?.text() ?? source.text(), kindOf(error));
    });
  }
  // Stale or conflicting input is not rebased. It is kept aside and the views
  // show the acknowledged buffer.
  private async keepAside(text: string, kind?: string) {
    const unconfirmed = diff(this.confirmed?.content ?? '', text);
    if (unconfirmed) this.aside ??= { text, at: new Date().toISOString() };
    this.notice = kind && !['stale', 'conflict', 'condition'].includes(kind) ? 'Your last edit could not be applied.' : '';
    this.pending = false;
    this.changed();
    try { await this.load(); } catch { this.notice = 'Your input is kept aside. Reconnect to read the current text.'; this.changed(); }
    this.settle();
  }
  private settle() {
    if (this.busy) return;
    const waiting = this.idle; this.idle = []; for (const resolve of waiting) resolve();
    if (this.seen > (this.confirmed?.version ?? 0) || this.seenRevision > (this.confirmed?.revision ?? 0)) void this.observe(this.seen, this.seenRevision).catch(() => undefined);
  }
  private whenIdle() { this.flush(); return this.busy ? new Promise<void>(resolve => this.idle.push(resolve)) : Promise.resolve(); }

  // Another author changed the buffer. Apply it only when no local input waits.
  async observe(version: number, revision = 0) {
    this.seen = Math.max(this.seen, version);
    this.seenRevision = Math.max(this.seenRevision, revision);
    if (!this.confirmed || version <= this.confirmed.version && revision <= this.confirmed.revision || this.busy) return;
    const buffer: Buffer = await this.client.call('document.read', { projectId: this.projectId, documentId: this.documentId });
    if (buffer.version <= this.confirmed.version && buffer.revision <= this.confirmed.revision || this.busy || [...this.ports].some(p => p.composing() || p.text() !== this.sent)) return;
    this.accept(buffer); this.sent = buffer.content; this.draft = buffer.content;
    for (const port of this.ports) port.replace(buffer.content);
    this.changed();
  }

  private async selective(method: 'document.undoOwn' | 'document.revert', extra: Record<string, string>) {
    await this.whenIdle();
    if (!this.confirmed || [...this.ports].some(p => p.composing())) return false;
    const base = this.confirmed!;
    const text = this.sent;
    this.inflight = true;
    try {
      const result: Buffer = await this.deliver(method, { projectId: this.projectId, documentId: this.documentId, expectedVersion: base.version, expectedRevision: base.revision, changeId: identity(), ...extra });
      this.inflight = false;
      this.accept(result);
      if (this.pending && this.source && this.source.text() !== text) { await this.keepAside(this.source.text()); return true; }
      this.sent = result.content; this.draft = result.content; this.notice = '';
      for (const port of this.ports) if (!port.composing()) port.replace(result.content);
      this.changed(); return true;
    } catch (error) {
      this.inflight = false;
      if (this.pending && this.source) { await this.keepAside(this.source.text(), kindOf(error)); return false; }
      const kind = kindOf(error);
      this.notice = kind === 'not_found' ? '' : kind === 'conflict' ? 'Later edits overlap that change, so it was left as it is.' : kind === 'stale' ? 'The text changed meanwhile; nothing was undone.' : 'That change could not be undone.';
      if (kind === 'stale') await this.load(); else this.changed();
      return false;
    } finally {
      this.settle();
    }
  }
  private command(run: () => Promise<boolean>) {
    const next = this.commands.then(run); this.commands = next.catch(() => undefined); return next;
  }
  undo() { return this.command(() => this.selective('document.undoOwn', {})); }
  save() {
    return this.command(async () => {
      await this.whenIdle();
      if (!this.confirmed || this.aside || [...this.ports].some(p => p.composing()) || this.confirmed.diskDigest === undefined) return false;
      const base = this.confirmed;
      this.inflight = true; this.changed();
      try {
        // A missing acknowledgement retries these exact conditions and identity.
        // Typing during the save remains pending against this acknowledged buffer.
        const saved: Buffer = await this.deliver('document.save', { projectId: this.projectId, documentId: this.documentId,
          expectedVersion: base.version, expectedRevision: base.revision, expectedDiskDigest: base.diskDigest, changeId: identity() });
        this.accept(saved); this.notice = ''; return true;
      } catch (error) {
        if (kindOf(error) === 'stale') this.seenRevision = Math.max(this.seenRevision, base.revision + 1);
        this.notice = kindOf(error) === 'conflict' ? 'The file changed on disk. Your buffer is kept; review the disk change before saving.'
          : kindOf(error) === 'stale' ? 'The shared document changed before saving. Read its current version and save again.' : 'The document could not be saved. Your buffer is kept.';
        return false;
      } finally {
        this.inflight = false; this.changed();
        if (this.pending) this.flush(); else this.settle();
      }
    });
  }
  revert(group: Group) {
    return this.command(async () => {
      for (const changeId of [...group.changeIds].reverse()) if (!await this.selective('document.revert', { targetChangeId: changeId })) return false;
      return true;
    });
  }
  async before(group: Group) {
    const read = (id: string) => this.client.call('document.change.read', { projectId: this.projectId, documentId: this.documentId, targetChangeId: id });
    const [first, last] = await Promise.all([read(group.changeIds[0]!), read(group.changeIds.at(-1)!)]);
    return { before: first.before.content as string, after: last.after.content as string };
  }
  async discardAside() {
    if ([...this.ports].some(p => p.composing())) return;
    try { await this.load(); } catch { return; }
    this.aside = null; this.changed();
  }
}

const syncs = new Map<string, { sync: DocumentSync; users: number }>();
// Several views of one document share a single adapter.
export function acquire(client: UiClient, projectId: string, documentId: string, me?: string, maxUnconfirmedBytes = browserDocumentLimits.maxUnconfirmedBytes) {
  const key = projectId + '\0' + documentId;
  let entry = syncs.get(key);
  if (!entry || entry.sync.client !== client) { entry = { sync: new DocumentSync(client, projectId, documentId, me, { maxUnconfirmedBytes }), users: 0 }; syncs.set(key, entry); }
  entry.sync.limits.maxUnconfirmedBytes = maxUnconfirmedBytes;
  entry.users++;
  const held = entry;
  return { sync: held.sync, release() { if (--held.users === 0 && !held.sync.busy && !held.sync.aside && syncs.get(key) === held) syncs.delete(key); } };
}
