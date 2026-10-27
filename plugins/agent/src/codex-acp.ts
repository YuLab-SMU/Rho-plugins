import { AcpConversation, type AcpConversationOptions } from './acp-conversation.js';
import { acpCommand } from './acp-command.js';
export interface CodexAcpOptions extends Omit<AcpConversationOptions, 'command' | 'sessionMeta'> {
  codex?: string; command?: AcpConversationOptions['command'];
}
/** The official adapter owns Codex configuration, permissions and App Server. */
export class CodexAcpConversation extends AcpConversation {
  constructor(o: CodexAcpOptions) {
    const env: NodeJS.ProcessEnv = { ...process.env, ...o.env, ...(o.codex ? { CODEX_PATH: o.codex } : {}) };
    if (o.model) env.CODEX_CONFIG = JSON.stringify({ ...JSON.parse(env.CODEX_CONFIG ?? '{}'), model: o.model });
    super({ ...o, env, command: o.command ?? acpCommand('codex') });
  }
}
