import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable, Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as acp from '@agentclientprotocol/sdk';
import type { AgentConversation, AgentTurn, AgentCompletion, AgentProcessLimits, AgentMcpServer, AgentSessionIdentity } from './conversation.js';
import { visibleError } from './conversation.js';

export interface ClaudeAcpOptions {
  cwd: string; mcpServers: AgentMcpServer[]; limits: AgentProcessLimits;
  sessionId?: string; claude?: string;
  // Trusted embedding configuration, never supplied by a model or a prompt.
  command?: { file: string; args: string[] }; env?: NodeJS.ProcessEnv;
  model?: string; allowedTools?: string[]; settingSources?: Array<'user' | 'project' | 'local'>;
}

/** One selected Claude ACP connection, independent of views and prompt turns. */
export class ClaudeAcpConversation implements AgentConversation {
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: acp.ClientConnection | null = null;
  private childEnded: Promise<void> = Promise.resolve();
  private exit: AgentCompletion['exit'] = null;
  private active: AgentTurn | null = null;
  private sessionId: string | undefined;
  private identity: AgentSessionIdentity | null = null;
  private phase: 'setup' | 'prompt' | 'idle' = 'idle';
  private fault: string | null = null;
  private outputBytes = 0;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private closing: Promise<void> | null = null;
  constructor(private options: ClaudeAcpOptions) { this.sessionId = options.sessionId; }
  get connected() { return !!this.connection && !this.connection.signal.aborted && !!this.identity && !this.closing; }
  get pid() { return this.child?.pid ?? null; }

  private observe(params: acp.SessionNotification) {
    // Loading history is not new execution and must not duplicate the Rho ledger.
    if (this.phase !== 'prompt' || !this.active) return;
    if (params.sessionId !== this.sessionId) {
      this.fault = 'The Agent reported another session; the original message was kept.';
      this.active.event({ type: 'limit', reason: 'identity' }); void this.close(); return;
    }
    const u = params.update, at = new Date().toISOString();
    if (u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text') {
      this.active.event({ type: 'step', append: true, step: { kind: 'text', at, id: u.messageId ?? 'message', text: u.content.text } });
    } else if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
      const meta = u._meta?.claudeCode as Record<string, unknown> | undefined;
      const input = u.rawInput as Record<string, unknown> | undefined;
      const name = ('name' in u && typeof u.name === 'string' ? u.name : undefined) ?? (typeof meta?.toolName === 'string' ? meta.toolName : undefined);
      const operation = name === 'mcp__rho__rho_call' && typeof input?.operation === 'string' ? input.operation : undefined;
      this.active.event({ type: 'step', step: { kind: 'tool', at, id: u.toolCallId,
        ...(name || u.title ? { tool: (name ?? u.title)!.slice(0, 512) } : {}), ...(operation ? { operation } : {}),
        ...(u.status ? { outcome: u.status === 'completed' ? 'returned' : u.status === 'failed' ? 'rejected' : 'requested' } : {}) } });
    }
    // Thought chunks, arbitrary raw tool content and vendor diagnostics are not retained.
  }

  private async connect(turn: AgentTurn) {
    const o = this.options;
    const env = { ...process.env, ...o.env, ...(o.claude ? { CLAUDE_CODE_EXECUTABLE: o.claude } : {}) };
    const command = o.command ?? { file: process.execPath, args: [fileURLToPath(import.meta.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js'))] };
    const child = spawn(command.file, command.args, { cwd: o.cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child; this.exit = null;
    this.childEnded = new Promise(resolve => {
      child.once('error', error => { this.fault = visibleError(error, env); this.connection?.close(); resolve(); });
      child.once('close', (code, signal) => { this.exit = { code, signal }; this.connection?.close(); resolve(); });
    });
    child.stdin.on('error', () => {});
    turn.event({ type: 'started', pid: child.pid ?? null });
    let lineBytes = 0;
    const overflow = (reason: 'line-limit' | 'output-limit') => {
      this.fault = `The Agent connection exceeded ${reason === 'line-limit' ? 'maxLineBytes' : 'maxOutputBytes'}; received output was kept.`;
      this.active?.event({ type: 'limit', reason }); void this.close();
    };
    const bounded = new Transform({ transform: (chunk: Buffer, _encoding, callback) => {
      this.outputBytes += chunk.length;
      if (this.outputBytes > o.limits.maxOutputBytes) { overflow('output-limit'); callback(new Error('Agent output limit')); return; }
      for (const byte of chunk) { lineBytes = byte === 10 ? 0 : lineBytes + 1; if (lineBytes > o.limits.maxLineBytes) { overflow('line-limit'); callback(new Error('Agent line limit')); return; } }
      callback(null, chunk);
    } });
    bounded.on('error', () => {});
    child.stdout.pipe(bounded);
    // Drain diagnostics without storing credentials, URLs or native reasoning.
    child.stderr.on('data', (chunk: Buffer) => { this.outputBytes += chunk.length; if (this.outputBytes > o.limits.maxOutputBytes) overflow('output-limit'); });
    this.connection = acp.client({ name: 'rho-agent' })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        try { this.observe(params); } catch { this.fault = 'Rho could not retain an Agent update.'; void this.close(); }
      })
      .onRequest(acp.methods.client.session.requestPermission, async ({ params, signal }) => {
        if (!this.active || this.phase !== 'prompt' || params.sessionId !== this.sessionId || this.active.signal.aborted || signal.aborted) return { outcome: { outcome: 'cancelled' as const } };
        const input = params.toolCall.rawInput as Record<string, unknown> | undefined;
        const details = [input?.command, input?.file_path, input?.path].find(x => typeof x === 'string') as string | undefined;
        const request = { id: randomUUID(), toolCallId: params.toolCall.toolCallId,
          title: (params.toolCall.title ?? 'Agent tool').slice(0, 1024),
          ...(details && details !== params.toolCall.title ? { details: details.slice(0, 2048) } : {}),
          options: params.options.slice(0, 8).map(x => ({ id: x.optionId, name: x.name.slice(0, 160), kind: x.kind })) };
        try {
          const option = await this.active.permission(request);
          if (this.active?.signal.aborted || signal.aborted || !request.options.some(x => x.id === option)) return { outcome: { outcome: 'cancelled' as const } };
          return { outcome: { outcome: 'selected' as const, optionId: option! } };
        } catch { return { outcome: { outcome: 'cancelled' as const } }; }
      }).connect(acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(bounded) as unknown as Parameters<typeof acp.ndJsonStream>[1]));
    const connection = this.connection;
    const timer = setTimeout(() => { this.fault = 'The Agent did not establish a session within connectTimeoutMs.'; void this.close(); }, o.limits.connectTimeoutMs);
    timer.unref();
    try {
      const initialized = await connection.agent.request(acp.methods.agent.initialize, { protocolVersion: 1, clientInfo: { name: 'rho-agent', version: '0.4.8' }, clientCapabilities: {} });
      if (initialized.protocolVersion !== 1) throw new Error('The selected Agent does not support ACP v1.');
      const params: acp.NewSessionRequest = { cwd: o.cwd, mcpServers: o.mcpServers, _meta: { claudeCode: { options: {
        maxTurns: o.limits.maxAgentTurns, promptSuggestions: false,
        ...(o.model ? { model: o.model } : {}), ...(o.settingSources ? { settingSources: o.settingSources } : {}),
        allowedTools: [...new Set([...['rho_index', 'rho_resolve', 'rho_call', 'rho_read'].map(x => 'mcp__rho__' + x), ...(o.allowedTools ?? [])])]
      } } } };
      let model: string | undefined;
      if (this.sessionId) {
        if (!initialized.agentCapabilities?.loadSession) throw new Error('This Agent cannot load the original session. Nothing was resent.');
        await connection.agent.request(acp.methods.agent.session.load, { ...params, sessionId: this.sessionId });
        model = o.model;
      } else {
        const created = await connection.agent.request(acp.methods.agent.session.new, params);
        this.sessionId = created.sessionId; model = o.model;
      }
      this.identity = { acpSessionId: this.sessionId, protocolVersion: 1,
        ...(initialized.agentInfo ? { adapter: { name: initialized.agentInfo.name, version: initialized.agentInfo.version } } : {}), ...(model ? { model } : {}) };
    } finally { clearTimeout(timer); }
  }

  async run(turn: AgentTurn): Promise<AgentCompletion> {
    if (this.active) throw new Error('The Agent is already answering a message.');
    if (this.closing) throw new Error('This Agent connection is closed.');
    this.active = turn; this.phase = 'setup'; this.outputBytes = 0; this.fault = null;
    let sent = false; const started = Date.now();
    const stop = () => {
      if (this.phase === 'prompt' && this.connection && this.sessionId) {
        void this.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId }).catch(() => {});
        this.stopTimer = setTimeout(() => { this.fault = 'The Agent did not confirm cancellation. The outcome of unfinished work is unknown.'; void this.close(); }, this.options.limits.stopGraceMs);
        this.stopTimer.unref();
      } else void this.close();
    };
    turn.signal.addEventListener('abort', stop, { once: true });
    try {
      if (turn.signal.aborted) return { state: 'stopped', result: null, exit: null, problem: null };
      if (!this.connected) await this.connect(turn);
      else turn.event({ type: 'started', pid: this.pid });
      await turn.session(this.identity!);
      if (turn.signal.aborted) return { state: 'stopped', result: null, exit: this.exit, problem: null };
      if (this.identity?.model) turn.event({ type: 'model', model: this.identity.model });
      this.phase = 'prompt'; sent = true;
      const response = await this.connection!.agent.request(acp.methods.agent.session.prompt, { sessionId: this.sessionId!, prompt: [{ type: 'text', text: turn.text }] });
      const reason = response.stopReason;
      const state = reason === 'end_turn' ? 'completed' : reason === 'cancelled' ? 'stopped' : 'failed';
      return { state, exit: null, problem: null, result: { isError: state === 'failed', kind: 'acp', reason, steps: null,
        durationMs: Date.now() - started, costUsd: null,
        message: state === 'failed' ? `The Agent ended this message: ${reason}.` : null } };
    } catch (error) {
      const lost = this.connection?.signal.aborted || this.closing || this.fault;
      return { state: sent && lost ? 'unknown' : turn.signal.aborted && !sent ? 'stopped' : 'failed', exit: this.exit, result: null,
        problem: this.fault ?? (sent && lost ? 'The Agent connection was lost. Received steps were kept; this message was not sent again.' : visibleError(error, this.options.env)) };
    } finally {
      turn.signal.removeEventListener('abort', stop); if (this.stopTimer) clearTimeout(this.stopTimer);
      this.stopTimer = undefined; this.phase = 'idle'; this.active = null;
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      this.connection?.close(); const child = this.child;
      if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
      const signal = (name: NodeJS.Signals) => { try { process.kill(-child.pid!, name); } catch {} };
      signal('SIGTERM'); const timer = setTimeout(() => signal('SIGKILL'), this.options.limits.stopGraceMs); timer.unref();
      try { await this.childEnded; } finally { clearTimeout(timer); }
    })();
    return this.closing;
  }
}
