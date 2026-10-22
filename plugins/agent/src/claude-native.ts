import { requireThat } from '@rho-workspace/plugin-contracts';

export interface ClaudeNativePorts {
  sessionId: string;
  onInit(sessionId: string): Promise<void>;
  append(event: Record<string, unknown>): Promise<void>;
  outputs?(nativeToolUseId: string): Promise<Record<string, unknown>[]>;
}
// Adapter for the selected real Claude Code stream-json client. It observes
// native envelopes, never model prose/reasoning, and starts no model or tool.
// The caller owns the CLI process and its transport/output/time budgets.
export class ClaudeCodeObserver {
  private initialized = false;
  private finished = false;
  private sourceSeq = 0;
  private tools = new Map<string, { tool: string; returned: boolean; fetchId?: string }>();
  constructor(public ports: ClaudeNativePorts, public maxTools = 2048) {}
  private async append(event: Record<string, unknown>) { await this.ports.append({ sourceSeq: this.sourceSeq++, ...event }); }
  async observe(record: any) {
    requireThat(!this.finished, 'condition', 'Native stream observation is already closed.');
    if (record.session_id) requireThat(record.session_id === this.ports.sessionId, 'scope', 'CLI stream changed native session identity.');
    if (record.type === 'system' && record.subtype === 'init') {
      requireThat(record.session_id === this.ports.sessionId, 'condition', 'CLI init did not confirm the selected native session.');
      if (!this.initialized) { await this.ports.onInit(record.session_id); this.initialized = true; }
      return;
    }
    if (!['assistant', 'user'].includes(record.type)) return;
    for (const block of record.message?.content ?? []) {
      if (block.type === 'tool_use' && record.type === 'assistant' && !this.tools.has(block.id)) {
        requireThat(this.initialized, 'condition', 'Native tool event preceded confirmed CLI initialization.');
        requireThat(this.tools.size < this.maxTools, 'limit', 'CLI observer reached maxTools; retain observed events and stop this observation.');
        const selectedInput = block.name === 'mcp__rho__rho_feedback_read' ? block.input : block.name === 'mcp__rho__rho_call' && block.input?.operation === 'feedback.read' ? block.input.input : null;
        const fetchId = typeof selectedInput?.fetchId === 'string' ? selectedInput.fetchId : undefined;
        this.tools.set(block.id, { tool: block.name, returned: false, fetchId });
        await this.append({ kind: 'tool.requested', nativeToolUseId: block.id, tool: block.name, at: new Date().toISOString(), detailsRef: null, outcome: 'requested', ...(fetchId ? { fetchId } : {}) });
      }
      if (block.type === 'tool_result' && record.type === 'user') {
        const tool = this.tools.get(block.tool_use_id);
        requireThat(tool, 'condition', 'Native result has no observed original tool request.');
        if (tool.returned) continue;
        tool.returned = true;
        await this.append({ kind: block.is_error ? 'tool.rejected' : 'tool.returned', nativeToolUseId: block.tool_use_id, tool: tool.tool, at: new Date().toISOString(), detailsRef: null, outcome: block.is_error ? 'rejected' : 'returned', ...(tool.fetchId ? { fetchId: tool.fetchId } : {}) });
        if (!block.is_error) for (const output of await this.ports.outputs?.(block.tool_use_id) ?? []) await this.append({ kind: 'artifact.ready', nativeToolUseId: block.tool_use_id, at: new Date().toISOString(), output });
      }
    }
  }
  async finish() {
    if (this.finished) return;
    this.finished = true;
    for (const [id, state] of this.tools) if (!state.returned) {
      await this.append({ kind: 'tool.observation-lost', nativeToolUseId: id, tool: state.tool, at: new Date().toISOString(), detailsRef: null, outcome: 'unknown' });
      state.returned = true;
    }
  }
}
