import { fileURLToPath } from 'node:url';
export type AcpAgent = 'claude' | 'codex';
export function acpCommand(agent: AcpAgent) {
  if (agent !== 'claude' && agent !== 'codex') throw new Error('Choose claude or codex.');
  const entry = agent === 'claude' ? '@agentclientprotocol/claude-agent-acp/dist/index.js' : '@agentclientprotocol/codex-acp';
  return { file: process.execPath, args: [fileURLToPath(import.meta.resolve(entry))] };
}
