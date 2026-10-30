import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable, Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import * as acp from '@agentclientprotocol/sdk';
import type { AgentConversation, AgentTurn, AgentCompletion, AgentProcessLimits, AgentMcpServer, AgentSessionIdentity, AgentToolKind } from './conversation.js';
import { visibleError, commandOutput } from './conversation.js';
import { SessionObserver, configOptions, type SessionObservation, type ObservationOrigin, type sessionObservationLimits } from './session-observation.js';
import { stopAcpProcess } from './acp-process.js';

const toolKinds: AgentToolKind[] = ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other'];
// A step keeps the meaning of what the Agent is doing, not a transcript of it.
// One bounded line is enough to identify a command, path, pattern or query.
function stepText(value: unknown, max = 512) {
  if (typeof value !== 'string') return undefined;
  const line = value.split(/\r?\n/).map(part => part.trim()).find(Boolean);
  if (!line) return undefined;
  return line.length > max ? line.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, '') + '…' : line;
}
// A command is kept whole, up to this many characters, so a person can read and run exactly what
// ran; a path, pattern or address keeps its first line.
export const commandDetailLimit = 8192;
function toolDetail(input: Record<string, unknown> | undefined) {
  const command = input?.command;
  if (typeof command === 'string' && command.trim()) {
    const whole = command.replace(/\r\n/g, '\n').trim();
    return whole.length > commandDetailLimit ? whole.slice(0, commandDetailLimit - 1).replace(/[\uD800-\uDBFF]$/, '') + '…' : whole;
  }
  for (const key of ['file_path', 'notebook_path', 'path', 'pattern', 'query', 'url', 'description']) {
    const value = stepText(input?.[key]);
    if (value) return value;
  }
  return undefined;
}

export interface AcpConversationOptions {
  cwd: string; mcpServers: AgentMcpServer[]; limits: AgentProcessLimits;
  sessionId?: string;
  // Trusted embedding configuration, never supplied by a model or a prompt.
  command: { file: string; args: string[] }; env?: NodeJS.ProcessEnv;
  model?: string; sessionMeta?: acp.NewSessionRequest['_meta'];
  // What the embedding application tells the Agent about this session, appended to the
  // Agent's own system prompt (ACP systemPrompt, append mode) when the session is created
  // and when it is loaded again. Trusted embedding configuration, like the command.
  instructions?: string;
  // The person's choices among the settings the Agent offers (model, effort, mode…), by
  // ACP setting id. Applied once the session exists and before any message is sent; a
  // setting or value the Agent does not offer fails the message instead of being dropped.
  config?: Record<string, string | boolean>;
  observation?: SessionObservation; observe?: (observation: SessionObservation) => void;
  observationLimits?: Partial<typeof sessionObservationLimits>;
}

/** One selected ACP connection, independent of views and prompt turns. */
export class AcpConversation implements AgentConversation {
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: acp.ClientConnection | null = null;
  private childEnded: Promise<void> = Promise.resolve();
  private exit: AgentCompletion['exit'] = null;
  private active: AgentTurn | null = null;
  private toolTitles = new Map<string,string>();
  private sessionId: string | undefined;
  private identity: AgentSessionIdentity | null = null;
  private canCloseSession = false;
  private canDeleteSession = false;
  private settings: acp.SessionConfigOption[] = [];
  private phase: 'setup' | 'prompt' | 'idle' = 'idle';
  private fault: string | null = null;
  private outputBytes = 0;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private closing: Promise<void> | null = null;
  private observer: SessionObserver;
  private observationOrigin: ObservationOrigin = 'initial';
  constructor(private options: AcpConversationOptions) {
    this.sessionId = options.sessionId;
    this.observer = new SessionObserver(value => options.observe?.(value), options.observation, options.observationLimits);
    if (this.sessionId) this.observer.identity(this.sessionId);
  }
  get connected() { return !!this.connection && !this.connection.signal.aborted && !!this.identity && !this.closing; }
  get pid() { return this.child?.pid ?? null; }

  private observe(params: acp.SessionNotification) {
    if (this.sessionId && params.sessionId !== this.sessionId) {
      this.fault = 'The Agent reported another session; the original message was kept.';
      this.active?.event({ type: 'limit', reason: 'identity' }); void this.close(); return;
    }
    // Session observation outlives a prompt. Replayed history stays distinguishable
    // and never enters the current message's steps.
    this.observer.update(params, this.observationOrigin);
    if (this.phase !== 'prompt' || !this.active) return;
    const u = params.update, at = new Date().toISOString();
    if (u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text') {
      this.active.event({ type: 'step', append: true, step: { kind: 'text', at, id: u.messageId ?? 'message', text: u.content.text } });
    } else if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
      const meta = u._meta?.claudeCode as Record<string, unknown> | undefined;
      const input = u.rawInput as Record<string, unknown> | undefined;
      const name = ('name' in u && typeof u.name === 'string' ? u.name : undefined) ?? (typeof meta?.toolName === 'string' ? meta.toolName : undefined);
      const toolName = name ?? u.title;
      if (toolName && this.toolTitles.size < 512) this.toolTitles.set(u.toolCallId,toolName.slice(0,1024));
      const operation = /^(mcp__rho__|mcp\.rho\.)rho_call$/.test(toolName ?? '') && typeof input?.operation === 'string' ? input.operation : undefined;
      const title = stepText(u.title), detail = toolDetail(input);
      const toolKind = 'kind' in u && toolKinds.includes(u.kind as AgentToolKind) ? u.kind as AgentToolKind : undefined;
      // A command's printed output and exit arrive on the terminal extension this client asks for.
      const terminal = u._meta as { terminal_output?: { data?: unknown }; terminal_exit?: { exit_code?: unknown } } | undefined;
      const printed = typeof terminal?.terminal_output?.data === 'string' ? commandOutput(terminal.terminal_output.data) : undefined;
      const exitCode = Number.isSafeInteger(terminal?.terminal_exit?.exit_code) ? terminal!.terminal_exit!.exit_code as number : undefined;
      this.active.event({ type: 'step', step: { kind: 'tool', at, id: u.toolCallId,
        ...(name || u.title ? { tool: (name ?? u.title)!.slice(0, 512) } : {}), ...(operation ? { operation } : {}),
        ...(title ? { title } : {}), ...(toolKind ? { toolKind } : {}), ...(detail ? { detail } : {}),
        ...(printed ? { output: printed } : {}), ...(exitCode !== undefined ? { exitCode } : {}),
        ...(u.status ? { outcome: u.status === 'completed' ? 'returned' : u.status === 'failed' ? 'rejected' : 'requested' } : {}) } });
    }
    // Thought chunks, other tool content and vendor diagnostics are not retained.
  }

  private async connect(turn: AgentTurn) {
    const o = this.options;
    const env = { ...process.env, ...o.env }, command = o.command;
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
        try { this.observe(params); } catch (error) { this.fault = visibleError(error, env); void this.close(); }
      })
      .onRequest(acp.methods.client.session.requestPermission, async ({ params, signal }) => {
        if (!this.active || this.phase !== 'prompt' || params.sessionId !== this.sessionId || this.active.signal.aborted || signal.aborted) return { outcome: { outcome: 'cancelled' as const } };
        const input = params.toolCall.rawInput as Record<string, unknown> | undefined;
        const details = [input?.command, input?.file_path, input?.path].find(x => typeof x === 'string') as string | undefined;
        const request = { id: randomUUID(), toolCallId: params.toolCall.toolCallId,
          title: (params.toolCall.title ?? this.toolTitles.get(params.toolCall.toolCallId) ?? 'Agent tool').slice(0, 1024),
          ...(details && details !== params.toolCall.title ? { details: details.slice(0, 2048) } : {}),
          options: params.options.slice(0, 8).map(x => ({ id: x.optionId, name: x.name.slice(0, 160), kind: x.kind })) };
        try {
          const option = await this.active.permission(request);
          if (this.active?.signal.aborted || signal.aborted || !request.options.some(x => x.id === option)) return { outcome: { outcome: 'cancelled' as const } };
          return { outcome: { outcome: 'selected' as const, optionId: option! } };
        } catch { return { outcome: { outcome: 'cancelled' as const } }; }
      }).connect(acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(bounded) as unknown as Parameters<typeof acp.ndJsonStream>[1]));
    const connection = this.connection;
    connection.signal.addEventListener('abort', () => this.observer.disconnected(), { once: true });
    const timer = setTimeout(() => { this.fault = 'The Agent did not establish a session within connectTimeoutMs.'; void this.close(); }, o.limits.connectTimeoutMs);
    timer.unref();
    try {
      const initialized = await connection.agent.request(acp.methods.agent.initialize, { protocolVersion: 1, clientInfo: { name: 'rho-agent', version: '0.4.13' }, clientCapabilities: { _meta: { terminal_output: true } } });
      if (initialized.protocolVersion !== 1) throw new Error('The selected Agent does not support ACP v1.');
      this.canCloseSession = initialized.agentCapabilities?.sessionCapabilities?.close != null;
      this.canDeleteSession = initialized.agentCapabilities?.sessionCapabilities?.delete != null;
      const params = { cwd: o.cwd, mcpServers: o.mcpServers, ...(o.sessionMeta ? { _meta: o.sessionMeta } : {}),
        ...(o.instructions ? { systemPrompt: { mode: 'append', content: [{ type: 'text', text: o.instructions }] } } : {}) } as acp.NewSessionRequest;
      let model: string | undefined;
      this.observationOrigin = this.sessionId ? 'history' : 'initial';
      if (this.sessionId) {
        if (!initialized.agentCapabilities?.loadSession) throw new Error('This Agent cannot load the original session. Nothing was resent.');
        const loaded = await connection.agent.request(acp.methods.agent.session.load, { ...params, sessionId: this.sessionId });
        this.settings = (loaded as { configOptions?: acp.SessionConfigOption[] | null }).configOptions ?? [];
      } else {
        const created = await connection.agent.request(acp.methods.agent.session.new, params);
        this.sessionId = created.sessionId; this.settings = created.configOptions ?? [];
      }
      for (const [id, value] of Object.entries(o.config ?? {})) await this.set(id, value);
      model = this.currentModel() ?? o.model;
      this.observer.configured(this.settings, this.observationOrigin === 'history' ? 'history' : 'initial');
      this.identity = { acpSessionId: this.sessionId, protocolVersion: 1,
        ...(initialized.agentInfo ? { adapter: { name: initialized.agentInfo.name, version: initialized.agentInfo.version } } : {}), ...(model ? { model } : {}) };
      this.observationOrigin = 'live';
    } finally { clearTimeout(timer); }
  }

  private currentModel() {
    const option = this.settings.find(x => x.category === 'model' && x.type === 'select');
    return option && typeof option.currentValue === 'string' ? option.currentValue : undefined;
  }
  // One setting on the open session, checked against what the Agent offers.
  private async set(configId: string, value: string | boolean) {
    const option = this.settings.find(x => x.id === configId);
    if (!option) throw new Error(`The Agent does not offer the setting ${configId}. Nothing was sent.`);
    if (option.currentValue === value) return;
    if (option.type === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'string' || !option.options.some(entry => 'group' in entry ? entry.options.some(v => v.value === value) : entry.value === value))
      throw new Error(`The Agent does not offer ${String(value)} for ${option.name}. Nothing was sent.`);
    const changed = await this.connection!.agent.request(acp.methods.agent.session.setConfigOption, option.type === 'boolean'
      ? { sessionId: this.sessionId!, configId, type: 'boolean', value: value as boolean } : { sessionId: this.sessionId!, configId, value: value as string });
    this.settings = changed.configOptions ?? this.settings;
  }
  /** The settings the Agent offers on this session now, bounded as observed. */
  get configuration() { return configOptions(this.settings); }
  /** Changes one setting for the messages that follow. Only between messages, on a connected session. */
  async configure(configId: string, value: string | boolean) {
    if (!this.connected || !this.sessionId) throw new Error('This Agent connection is not open.');
    if (this.phase !== 'idle') throw new Error('The Agent is answering. Change its settings after this message.');
    await this.set(configId, value);
    if (this.identity) { const model = this.currentModel(); this.identity = { ...this.identity, ...(model ? { model } : {}) }; }
    this.observer.configured(this.settings, 'live');
    return this.configuration;
  }
  /** Opens a session only to read the settings the Agent offers, then removes it and ends the
   * process. No message is sent. This starts the Agent, so it is an explicit action, never a read. */
  async inspect() {
    if (this.options.sessionId) throw new Error('Inspect a new session, not a retained one.');
    const quiet: AgentTurn = { text: '', signal: new AbortController().signal, event() {}, async session() {}, async permission() { return null; } };
    try {
      await this.connect(quiet);
      if (this.fault) throw new Error(this.fault);
      return { adapter: this.identity?.adapter ?? null, ...this.configuration };
    } catch (error) { throw new Error(this.fault ?? visibleError(error, this.options.env)); }
    finally {
      if (this.canDeleteSession && this.sessionId && this.connection && !this.connection.signal.aborted)
        await this.connection.agent.request(acp.methods.agent.session.delete, { sessionId: this.sessionId }).then(() => { this.canCloseSession = false; }, () => {});
      await this.close();
    }
  }

  async run(turn: AgentTurn): Promise<AgentCompletion> {
    if (this.active) throw new Error('The Agent is already answering a message.');
    if (this.closing) throw new Error('This Agent connection is closed.');
    this.active = turn; this.toolTitles.clear(); this.phase = 'setup'; this.outputBytes = 0; this.fault = null;
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
      if (this.connection?.signal.aborted) throw new Error('The Agent disconnected while its session was being retained.');
      try { this.observer.attached(this.sessionId!); }
      catch (error) { this.fault = visibleError(error, this.options.env); void this.close(); throw error; }
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
      // Release the native session writer before terminating the transport. Killing
      // Codex first can leave a live-writer lease that prevents immediate reload.
      if (this.canCloseSession && this.identity && this.connection && !this.connection.signal.aborted) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            this.connection.agent.request(acp.methods.agent.session.close, { sessionId: this.identity.acpSessionId }).catch(() => {}),
            new Promise<void>(resolve => { timer = setTimeout(resolve, this.options.limits.stopGraceMs); timer.unref(); })
          ]);
        } finally { if (timer) clearTimeout(timer); }
      }
      this.connection?.close(); const child = this.child;
      if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
      await stopAcpProcess(child.pid, this.options.limits.stopGraceMs);
      await this.childEnded;
    })();
    return this.closing;
  }
}
