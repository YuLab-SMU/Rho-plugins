// The Agent entry owns native/protocol behavior. The embedding application owns
// acknowledged user messages, their identities, persistence and presentation.
// ACP tool categories, kept so an embedding application can choose the display treatment.
export type AgentToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';
export interface ConversationStep {
  kind: 'text' | 'tool' | 'error'; at: string; text?: string; cut?: boolean;
  id?: string; tool?: string; operation?: string;
  // What the Agent said it was doing and the one native input that identifies it
  // (a command, file path, pattern or query). Bounded.
  title?: string; toolKind?: AgentToolKind; detail?: string;
  // For a command, the Agent's own few words on what it is for (Claude Code's Bash
  // description), when it gave them. Bounded like a title.
  purpose?: string;
  outcome?: 'requested' | 'returned' | 'rejected' | 'unknown';
  // A command's exit code when the Agent reported one, and the last lines it printed
  // (commandOutputLimits); lines and bytes count the whole output. Other tools' output
  // is not kept.
  exitCode?: number; output?: CommandOutput;
}
export interface CommandOutput { text: string; lines: number; bytes: number; cut: boolean }
// The protected resource is the conversation record. Past either limit only the last
// lines are kept and `cut` says so.
export const commandOutputLimits = { maxBytes: 2048, maxLines: 20 };
// Terminal colour and cursor codes are dropped and a line rewritten with carriage returns
// keeps what a terminal would show last; the text keeps its own Unicode.
export function commandOutput(printed: string, limits = commandOutputLimits): CommandOutput {
  const clean = printed.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .split('\n').map(line => line.replace(/\r$/, '').split('\r').at(-1)!).join('\n').replace(/\s+$/, '');
  const all = clean ? clean.split(/\r?\n/) : [];
  let kept = all.slice(-limits.maxLines);
  while (kept.length > 1 && Buffer.byteLength(kept.join('\n')) > limits.maxBytes) kept = kept.slice(1);
  let text = kept.join('\n');
  if (Buffer.byteLength(text) > limits.maxBytes) text = Buffer.from(text).subarray(-limits.maxBytes).toString('utf8').replace(/^\uFFFD+/, '');
  return { text, lines: all.length, bytes: Buffer.byteLength(clean), cut: text !== clean };
}
export interface ConversationResult {
  isError: boolean; kind: string | null; reason: string | null; steps: number | null;
  durationMs: number | null; costUsd: number | null; message: string | null;
}
export interface AgentPermission {
  id: string; title: string; toolCallId: string; details?: string;
  options: Array<{ id: string; name: string; kind: string }>;
}
export interface AgentSessionIdentity {
  acpSessionId?: string; nativeSessionId?: string;
  protocolVersion?: number; adapter?: { name: string; version?: string }; model?: string;
}
export type ConversationEvent =
  | { type: 'step'; step: ConversationStep; append?: boolean }
  | { type: 'started'; pid: number | null }
  | { type: 'model'; model: string }
  | { type: 'retry'; retry: { attempt: number | null; of: number | null; status: number | null; at: string } | null }
  | { type: 'limit'; reason: 'output-limit' | 'line-limit' | 'identity' };
export interface AgentTurn {
  text: string; signal: AbortSignal;
  // Must durably retain the returned identity before the driver sends a prompt.
  session(identity: AgentSessionIdentity): Promise<void>;
  event(event: ConversationEvent): void;
  permission(request: AgentPermission): Promise<string | null>;
}
export interface AgentCompletion {
  state: 'completed' | 'failed' | 'stopped' | 'unknown';
  result: ConversationResult | null;
  exit: { code: number | null; signal: string | null } | null;
  problem: string | null;
}
export interface AgentConversation {
  readonly connected: boolean;
  readonly pid: number | null;
  run(turn: AgentTurn): Promise<AgentCompletion>;
  close(): Promise<void>;
}
export interface AgentProcessLimits {
  maxAgentTurns: number; maxOutputBytes: number; maxLineBytes: number;
  stopGraceMs: number; connectTimeoutMs: number;
}
export interface AgentMcpServer { name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> }
export function visibleError(error: unknown, env: NodeJS.ProcessEnv = process.env) {
  let text = error instanceof Error ? error.message : 'The Agent connection failed.';
  for (const [key, value] of Object.entries(env)) if (value && /TOKEN|KEY|SECRET|PASSWORD|BASE_URL/i.test(key)) text = text.split(value).join('[private]');
  return text.replace(/https?:\/\/[^\s"'<>]+/g, '[private URL]').slice(0, 2048);
}
export { ClaudeAcpConversation, type ClaudeAcpOptions } from './claude-acp.js';
export { writeClaudePlugin, claudePluginLimits, type ClaudePlugin, type ClaudePluginSkill, type ClaudePluginHook } from './claude-plugin.js';
export { CodexAcpConversation, type CodexAcpOptions } from './codex-acp.js';
export { ClaudeCliConversation } from './claude-cli.js';
export type { SessionObservation, SessionTool, ConfigOption, ConfigValue } from './session-observation.js';
