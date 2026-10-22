import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, canonical, digest, now, readJson, requireThat, stateDirectory } from '@rho-workspace/plugin-contracts';
import { isNativeTime } from './contract.js';

export const nativeActivityLimits = { maxRecordBytes: 16384, maxBatchEvents: 64, maxBatchBytes: 262144, maxRetainedEvents: 256, maxRetainedBytes: 4194304, maxSourceEpochs: 128 };
// All writes are invoked under the application's existing project writer lease
// and serializer. This owner neither starts processes nor runs a second worker.
export class NativeActivity {
  limits: typeof nativeActivityLimits;
  constructor(public root: string, public projectId: string, limits: Partial<typeof nativeActivityLimits> = {}) { this.limits = { ...nativeActivityLimits, ...limits }; }
  private async file() { return path.join(await stateDirectory(this.root, '.rho/plugins/agent'), 'native.json'); }
  async initialize() {
    const file = await this.file();
    try { await fs.access(file); await this.state(); }
    catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
      const empty = { format: 1, cursor: 0, entries: [], epochs: [] };
      requireThat(Buffer.byteLength(JSON.stringify(empty) + '\n') <= this.limits.maxRetainedBytes, 'limit', 'Empty native observation storage exceeds maxRetainedBytes.');
      await atomicJson(file, empty);
    }
  }
  private async state() {
    const file = await this.file();
    try { requireThat((await fs.stat(file)).size <= this.limits.maxRetainedBytes, 'limit', 'Native observation storage exceeds maxRetainedBytes.'); }
    catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    let state: any;
    try { state = await readJson<any>(file); }
    catch (e: any) { if (e.code === 'ENOENT') requireThat(false, 'storage', 'Configured native history is missing; preserve unknown, do not initialize on observation.'); throw e; }
    requireThat(state.format === 1 && Number.isSafeInteger(state.cursor) && state.cursor >= 0 && Array.isArray(state.entries) && Array.isArray(state.epochs), 'storage', 'Native observations are unreadable; preserve the store.');
    requireThat(state.entries.length <= this.limits.maxRetainedEvents && state.epochs.length <= this.limits.maxSourceEpochs, 'limit', 'Native observation retention exceeds configured limits.');
    return state;
  }
  async append(body: any) {
    requireThat(body.projectId === this.projectId && body.events.length > 0 && body.events.length <= this.limits.maxBatchEvents && Buffer.byteLength(JSON.stringify(body)) <= this.limits.maxBatchBytes, 'limit', 'Native batch exceeds maxBatchEvents/maxBatchBytes.');
    const state = await this.state(), accepted = [];
    const epochKey = digest(canonical([body.taskId, body.bindingId, body.adapterId, body.adapterEpoch]));
    let epoch = state.epochs.find((x: any) => x.key === epochKey);
    if (!epoch) {
      requireThat(state.epochs.length < this.limits.maxSourceEpochs, 'limit', 'Native source epochs are full; preserve old watermarks.', { limit: 'maxSourceEpochs' });
      epoch = { key: epochKey, maxSeq: -1, gap: false }; state.epochs.push(epoch);
    }
    for (const event of body.events) {
      requireThat(typeof event.at === 'string' && isNativeTime(event.at), 'invalid', 'Native event requires a valid source date-time.');
      requireThat(Buffer.byteLength(JSON.stringify(event)) <= this.limits.maxRecordBytes, 'limit', 'Native event exceeds maxRecordBytes.', { limit: 'maxRecordBytes' });
      const eventId = digest(canonical([this.projectId, epochKey, event.sourceSeq]));
      const old = state.entries.find((x: any) => x.eventId === eventId);
      if (old) {
        requireThat(canonical(old.event) === canonical(event), 'conflict', 'Native source sequence names different bytes.');
        accepted.push({ sourceSeq: event.sourceSeq, cursor: old.cursor, eventId }); continue;
      }
      requireThat(Number.isSafeInteger(event.sourceSeq) && event.sourceSeq > epoch.maxSeq, 'stale', 'Original native observation is outside retention; absence does not authorize replay.', { sourceSeq: event.sourceSeq, retainedAfter: epoch.maxSeq });
      const related = state.entries.filter((x: any) => x.bindingId === body.bindingId && x.adapterId === body.adapterId && x.adapterEpoch === body.adapterEpoch && x.event.nativeToolUseId === event.nativeToolUseId);
      if (['tool.returned', 'tool.rejected'].includes(event.kind)) requireThat(related.some((x: any) => x.event.kind === 'tool.requested' && x.event.tool === event.tool && (x.event.fetchId ?? null) === (event.fetchId ?? null)), 'condition', 'Native result has no matching retained original request/fetch; report observation-lost instead.');
      if (event.fetchId) requireThat(['mcp__rho__rho_feedback_read', 'mcp__rho__rho_call'].includes(event.tool), 'condition', 'Fetch receipts require the selected real feedback tool name.');
      if (event.kind === 'artifact.ready') requireThat(related.some((x: any) => x.event.kind === 'tool.returned'), 'condition', 'Artifact hint needs a retained native tool return association.');
      const record = { cursor: ++state.cursor, eventId, bindingId: body.bindingId, adapterId: body.adapterId, adapterEpoch: body.adapterEpoch, event };
      epoch.gap ||= event.sourceSeq > epoch.maxSeq + 1;
      epoch.maxSeq = event.sourceSeq;
      state.entries.push(record);
      accepted.push({ sourceSeq: event.sourceSeq, cursor: record.cursor, eventId });
    }
    state.entries = state.entries.slice(-this.limits.maxRetainedEvents);
    requireThat(Buffer.byteLength(JSON.stringify(state) + '\n') <= this.limits.maxRetainedBytes, 'limit', 'Native observation store is full; previous observations are preserved.', { limit: 'maxRetainedBytes' });
    await atomicJson(await this.file(), state);
    return { accepted, serverObservedAt: now() };
  }
  async read(query: any) {
    const state = await this.state();
    requireThat(Number.isSafeInteger(query.after) && query.after >= 0 && query.after <= state.cursor && Number.isSafeInteger(query.limit) && query.limit > 0 && query.limit <= 100 && Number.isSafeInteger(query.maxBytes) && query.maxBytes >= 1024 && query.maxBytes <= 65536, 'invalid', 'Native query bounds are invalid.');
    const retainedFrom = state.entries[0]?.cursor ?? state.cursor + 1;
    let after = query.after;
    if (query.cursor) {
      const [version, offset, binding] = query.cursor.split(':');
      requireThat(Number(version) === state.cursor && binding === digest(canonical({ ...query, cursor: null })).slice(0, 32), 'stale', 'Native page cursor expired or its query changed.');
      after = Number(offset);
      requireThat(Number.isSafeInteger(after) && after >= query.after && after <= state.cursor, 'invalid', 'Native page offset is invalid.');
    }
    const remaining = state.entries.filter((x: any) => x.cursor > after), entries: any[] = [];
    const result: any = { cursor: state.cursor, retainedFrom, entries, next: null, complete: true, gap: query.after < retainedFrom - 1 || state.epochs.some((x: any) => x.gap) };
    for (const entry of remaining) {
      const next = `${state.cursor}:${entry.cursor}:${digest(canonical({ ...query, cursor: null })).slice(0, 32)}`;
      const trial = { ...result, entries: [...entries, entry], next, complete: false };
      if (entries.length >= query.limit || Buffer.byteLength(JSON.stringify(trial)) > query.maxBytes) break;
      entries.push(entry);
    }
    requireThat(!remaining.length || entries.length > 0, 'limit', 'A complete native event exceeds the requested page; increase maxBytes.', { requiredBytes: remaining[0] ? Buffer.byteLength(JSON.stringify({ ...result, entries: [remaining[0]], next: 'reserved-page-cursor', complete: false })) + 128 : 0 });
    result.complete = entries.length === remaining.length;
    if (!result.complete) result.next = `${state.cursor}:${entries.at(-1).cursor}:${digest(canonical({ ...query, cursor: null })).slice(0, 32)}`;
    return result;
  }
}
