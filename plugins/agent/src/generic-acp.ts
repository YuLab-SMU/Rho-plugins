import { AcpConversation, type AcpConversationOptions } from './acp-conversation.js';

/** A generic ACP agent: any program that speaks ACP v1 over stdio. Rho starts the
 * operator-selected command and drives it exactly as it drives Claude Code or Codex, so
 * supporting another agent is configuration (`--acp-command`), not a new adapter. The
 * command is a file plus its arguments and needs no per-agent environment. */
export interface GenericAcpOptions extends Omit<AcpConversationOptions, 'command' | 'sessionMeta'> {
  command: AcpConversationOptions['command'];
}

export class GenericAcpConversation extends AcpConversation {
  constructor(o: GenericAcpOptions) {
    // A supplied command skips the missing-client check: the operator named the program.
    super({ ...o, command: o.command });
  }
}
