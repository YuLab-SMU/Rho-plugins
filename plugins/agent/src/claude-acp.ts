import { AcpConversation, type AcpConversationOptions } from './acp-conversation.js';
import { acpCommand } from './acp-command.js';
export interface ClaudeAcpOptions extends Omit<AcpConversationOptions, 'command' | 'sessionMeta'> {
  claude?: string; command?: AcpConversationOptions['command'];
  allowedTools?: string[]; settingSources?: Array<'user' | 'project' | 'local'>;
  // Local Claude Code plugin directories (writeClaudePlugin) loaded into the session.
  plugins?: string[];
}
export class ClaudeAcpConversation extends AcpConversation {
  constructor(o: ClaudeAcpOptions) {
    super({ ...o, command: o.command ?? acpCommand('claude'),
      // Expose native task tools on custom models; retain native permission policy.
      env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1', ...process.env, ...o.env, ...(o.claude ? { CLAUDE_CODE_EXECUTABLE: o.claude } : {}) },
      sessionMeta: { claudeCode: { options: { maxTurns: o.limits.maxAgentTurns, promptSuggestions: false,
        ...(o.model ? { model: o.model } : {}), ...(o.settingSources ? { settingSources: o.settingSources } : {}),
        ...(o.plugins?.length ? { plugins: o.plugins.map(p => ({ type: 'local', path: p, skipMcpDiscovery: true })) } : {}),
        allowedTools: [...new Set([...['rho_index', 'rho_resolve', 'rho_call', 'rho_read'].map(x => 'mcp__rho__' + x), ...(o.allowedTools ?? [])])]
      } } }
    });
  }
}
