import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentConversation, AgentTurn, AgentCompletion, AgentProcessLimits, AgentMcpServer, ConversationResult } from './conversation.js';
import { visibleError } from './conversation.js';

/** Compatibility entry for conversations originally created with Claude CLI. */
export class ClaudeCliConversation implements AgentConversation {
  private child: ChildProcess | null = null;
  private ended: Promise<void> = Promise.resolve();
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private options: { cwd: string; binary: string; sessionId: string; confirmed: boolean; projectName: string; mcpServers: AgentMcpServer[]; limits: AgentProcessLimits }) {}
  get connected() { return false; }
  get pid() { return this.child?.pid ?? null; }
  async run(turn: AgentTurn): Promise<AgentCompletion> {
    const o = this.options, now = () => new Date().toISOString();
    let result: ConversationResult | null = null, problem: string | null = null, stopped = false;
    const sessionWrites: Promise<void>[] = [];
    if (turn.signal.aborted) return { state: 'stopped', exit: null, result: null, problem: null };
    const mcp = JSON.stringify({ mcpServers: Object.fromEntries(o.mcpServers.map(s => [s.name, { command: s.command, args: s.args, env: Object.fromEntries(s.env.map(x => [x.name, x.value])) }])) });
    const args = ['-p', '--output-format', 'stream-json', '--verbose', ...(o.confirmed ? ['--resume', o.sessionId] : ['--session-id', o.sessionId]),
      '--strict-mcp-config', '--mcp-config', mcp, '--tools', '', '--allowedTools', ...['rho_index', 'rho_resolve', 'rho_call', 'rho_read'].map(name => 'mcp__rho__' + name),
      '--permission-mode', 'dontAsk', '--max-turns', String(o.limits.maxAgentTurns),
      '--append-system-prompt', `You were started from Rho by the person working in the Rho project "${o.projectName}". They read your replies in Rho's Agent panel, next to the project's files, documents, tables, figures and runs. Work on the project through the rho tools: rho_index finds operations, rho_resolve gives their contracts, rho_call calls one and rho_read reads a large result. Keep results in this project and say what you changed or ran.`];
    const child = spawn(o.binary, args, { cwd: o.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    this.child = child;
    const ended = new Promise<{ code: number | null; signal: string | null; error?: Error }>(resolve => {
      child.once('error', error => resolve({ code: null, signal: null, error }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    this.ended = ended.then(() => {});
    turn.event({ type: 'started', pid: child.pid ?? null });
    const stop = () => { stopped = true; this.stop(); };
    turn.signal.addEventListener('abort', stop, { once: true });
    child.stdin.on('error', () => {}); child.stdin.end(turn.text);
    let bytes = 0, lineBytes = 0;
    child.stderr.resume();
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      let reason: 'line-limit' | 'output-limit' | null = bytes > o.limits.maxOutputBytes ? 'output-limit' : null;
      for (const byte of chunk) { lineBytes = byte === 10 ? 0 : lineBytes + 1; if (lineBytes > o.limits.maxLineBytes) { reason = 'line-limit'; break; } }
      if (reason) { turn.event({ type: 'limit', reason }); stop(); child.stdout.destroy(); }
    });
    const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
    const word = (v: unknown) => typeof v === 'string' && v ? v : null;
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', line => {
      let record: any; try { record = JSON.parse(line); } catch { return; }
      if (typeof record?.session_id === 'string' && record.session_id !== o.sessionId) {
        problem = 'Claude Code reported another session. The original conversation was kept.';
        turn.event({ type: 'limit', reason: 'identity' }); stop(); return;
      }
      if (record?.type === 'system' && record.subtype === 'init') {
        sessionWrites.push(turn.session({ nativeSessionId: o.sessionId }).catch(() => { problem = 'The native session confirmation could not be kept.'; stop(); }));
        if (word(record.model)) turn.event({ type: 'model', model: record.model });
      }
      if (record?.type === 'system' && record.subtype === 'api_retry') turn.event({ type: 'retry', retry: { attempt: number(record.attempt), of: number(record.max_retries), status: number(record.error_status), at: now() } });
      const content: any[] = Array.isArray(record?.message?.content) ? record.message.content : [];
      if (record?.type === 'assistant') {
        if (record.is_api_error_message || record.message?.model === '<synthetic>') {
          for (const b of content) if (b?.type === 'text') turn.event({ type: 'step', step: { kind: 'error', at: now(), text: visibleError(new Error(String(b.text))) } });
          return;
        }
        turn.event({ type: 'retry', retry: null });
        for (const b of content) {
          if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) turn.event({ type: 'step', step: { kind: 'text', at: now(), text: b.text } });
          if (b?.type === 'tool_use') turn.event({ type: 'step', step: { kind: 'tool', at: now(), id: String(b.id), tool: String(b.name), ...(b.name === 'mcp__rho__rho_call' && typeof b.input?.operation === 'string' ? { operation: b.input.operation } : {}), outcome: 'requested' } });
        }
      }
      if (record?.type === 'user') for (const b of content) if (b?.type === 'tool_result') turn.event({ type: 'step', step: { kind: 'tool', at: now(), id: b.tool_use_id, outcome: b.is_error ? 'rejected' : 'returned' } });
      if (record?.type === 'result') result = { isError: record.is_error === true, kind: word(record.subtype), reason: word(record.terminal_reason), steps: number(record.num_turns), durationMs: number(record.duration_ms), costUsd: number(record.total_cost_usd), message: record.is_error ? visibleError(new Error(String(record.result ?? ''))) : null };
    });
    const end = await ended; await Promise.all(sessionWrites); lines.close();
    turn.signal.removeEventListener('abort', stop); if (this.stopTimer) clearTimeout(this.stopTimer);
    // Assignments occur in stream callbacks rather than this control-flow branch.
    const final = result as ConversationResult | null;
    return { state: final ? final.isError ? 'failed' : 'completed' : stopped ? 'stopped' : 'failed', result: final,
      exit: { code: end.code, signal: end.signal }, problem: problem ?? (!final && !stopped ? end.error ? visibleError(end.error) : `Claude Code ended (${end.signal ?? 'exit ' + end.code}) without finishing this message.` : null) };
  }
  private stop() {
    const child = this.child;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    const signal = (name: NodeJS.Signals) => { try { process.kill(-child.pid!, name); } catch {} };
    signal('SIGTERM'); if (!this.stopTimer) { this.stopTimer = setTimeout(() => signal('SIGKILL'), this.options.limits.stopGraceMs); this.stopTimer.unref(); }
  }
  async close() { this.stop(); await this.ended; if (this.stopTimer) clearTimeout(this.stopTimer); }
}
