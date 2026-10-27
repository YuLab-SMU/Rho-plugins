import type { SessionNotification } from '@agentclientprotocol/sdk';

export const sessionObservationLimits = { maxPlanEntries: 32, maxTools: 32, maxLocations: 4, maxTextChars: 1024 };
export type ObservationOrigin = 'initial' | 'history' | 'live';
export interface Stamp { at: string; origin: ObservationOrigin }
export interface SessionTool extends Stamp {
  id: string; tool?: string; operation?: string;
  outcome?: 'requested' | 'returned' | 'rejected' | 'unknown';
  locations: Array<{ path: string; line?: number }>;
}
export interface SessionObservation {
  source: 'acp'; sessionId: string; sequence: number; at: string; connected: boolean;
  updates: number; historyUpdates: number; omitted: number; unrepresented: number;
  plan: (Stamp & { entries: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; priority: 'high' | 'medium' | 'low' }>; omitted: number }) | null;
  usage: (Stamp & { used: number; size: number; cost?: { amount: number; currency: string } | null }) | null;
  info: (Stamp & { title?: string | null; updatedAt?: string | null }) | null;
  tools: SessionTool[];
}

/** A bounded session projection. History may refresh it but never creates a turn.
 * No transcript, reasoning, raw tool input/output or vendor diagnostics are kept. */
export class SessionObserver {
  private value: SessionObservation;
  private ready = false;
  readonly limits: typeof sessionObservationLimits;
  constructor(private publish: (value: SessionObservation) => void, previous?: SessionObservation, limits: Partial<typeof sessionObservationLimits> = {}) {
    this.limits = { ...sessionObservationLimits, ...limits };
    for (const [key, n] of Object.entries(this.limits)) if (!Number.isSafeInteger(n) || n < 1 || n > sessionObservationLimits[key as keyof typeof sessionObservationLimits]) throw new Error(`Invalid session observation limit: ${key}`);
    this.value = previous ? structuredClone(previous) : { source: 'acp', sessionId: '', sequence: 0, at: new Date().toISOString(), connected: false, updates: 0, historyUpdates: 0, omitted: 0, unrepresented: 0, plan: null, usage: null, info: null, tools: [] };
    this.value.connected = false;
  }
  private text(text: string) {
    if (text.length <= this.limits.maxTextChars) return text;
    this.value.omitted++; return text.slice(0, this.limits.maxTextChars).replace(/[\uD800-\uDBFF]$/, '') + '…';
  }
  private changed() {
    this.value.at = new Date().toISOString(); this.value.sequence++;
    if (this.ready) {
      try { this.publish(structuredClone(this.value)); }
      catch (error) { this.ready = false; throw error; }
    }
  }
  identity(sessionId: string) {
    if (this.value.sessionId && this.value.sessionId !== sessionId) throw new Error('The Agent reported another session.');
    this.value.sessionId = sessionId;
  }
  // Called only after the embedding application has durably acknowledged identity.
  attached(sessionId: string) { this.identity(sessionId); this.ready = true; this.value.connected = true; this.changed(); }
  disconnected() {
    if (!this.value.connected) return;
    this.value.connected = false;
    for (const tool of this.value.tools) if (tool.outcome === 'requested') tool.outcome = 'unknown';
    this.changed();
  }
  update(params: SessionNotification, origin: ObservationOrigin) {
    this.identity(params.sessionId);
    const u = params.update, stamp = { at: new Date().toISOString(), origin };
    this.value.updates++; if (origin === 'history') this.value.historyUpdates++;
    if (u.sessionUpdate === 'plan') {
      this.value.plan = { ...stamp, entries: u.entries.slice(0, this.limits.maxPlanEntries).map(e => ({ content: this.text(e.content), status: e.status, priority: e.priority })), omitted: Math.max(0, u.entries.length - this.limits.maxPlanEntries) };
      this.value.omitted += this.value.plan.omitted;
    } else if (u.sessionUpdate === 'usage_update') {
      this.value.usage = { ...stamp, used: u.used, size: u.size, ...(u.cost !== undefined ? { cost: u.cost === null ? null : { amount: u.cost.amount, currency: this.text(u.cost.currency) } } : {}) };
    } else if (u.sessionUpdate === 'session_info_update') {
      this.value.info = { ...this.value.info, ...stamp, ...(u.title !== undefined ? { title: u.title === null ? null : this.text(u.title) } : {}), ...(u.updatedAt !== undefined ? { updatedAt: u.updatedAt === null ? null : this.text(u.updatedAt) } : {}) };
    } else if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
      const meta = u._meta?.claudeCode as Record<string, unknown> | undefined;
      const input = u.rawInput as Record<string, unknown> | undefined;
      const name = ('name' in u && typeof u.name === 'string' ? u.name : undefined) ?? (typeof meta?.toolName === 'string' ? meta.toolName : undefined);
      const old = this.value.tools.find(t => t.id === u.toolCallId);
      const tool: SessionTool = { ...old, ...stamp, id: u.toolCallId, locations: old?.locations ?? [],
        ...(name || u.title ? { tool: this.text(name ?? u.title!) } : {}),
        ...(name === 'mcp__rho__rho_call' && typeof input?.operation === 'string' ? { operation: this.text(input.operation) } : {}),
        ...(u.status ? { outcome: u.status === 'completed' ? 'returned' : u.status === 'failed' ? 'rejected' : 'requested' } : {}) };
      const diffLocations: SessionTool['locations'] = (u.content ?? []).flatMap(c => c.type === 'diff' ? [{ path: c.path }] : []);
      if (u.locations != null || diffLocations.length) {
        // ACP file edits can name their path in a standard diff content block
        // without a separate locations field (as Codex does). Retain only the ref.
        const locations = [...new Map([...(u.locations ?? old?.locations ?? []), ...diffLocations]
          .map(l => [l.path + ':' + ('line' in l ? l.line ?? '' : ''), l])).values()];
        tool.locations = locations.filter(l => Buffer.byteLength(l.path) <= 1024).slice(0, this.limits.maxLocations)
          .map(l => ({ path: l.path, ...('line' in l && l.line != null ? { line: l.line } : {}) }));
        this.value.omitted += locations.length - tool.locations.length;
      }
      if (old) this.value.tools[this.value.tools.indexOf(old)] = tool;
      else { this.value.tools.push(tool); if (this.value.tools.length > this.limits.maxTools) { this.value.tools.shift(); this.value.omitted++; } }
    } else if (u.sessionUpdate !== 'agent_message_chunk') {
      // The remaining v1 variants are deliberately not rendered by this projection.
      // Count coverage instead of silently implying that it is a complete transcript.
      this.value.unrepresented++;
    }
    this.changed();
  }
}
