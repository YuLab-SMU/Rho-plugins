import { fileURLToPath } from 'node:url';
export type AcpAgent = 'claude' | 'codex';
export function acpCommand(agent: AcpAgent) {
  if (agent !== 'claude' && agent !== 'codex') throw new Error('Choose claude or codex.');
  const entry = agent === 'claude' ? '@agentclientprotocol/claude-agent-acp/dist/index.js' : '@agentclientprotocol/codex-acp';
  return { file: process.execPath, args: [fileURLToPath(import.meta.resolve(entry))] };
}
/** The adapters drive the person's installed client. Their bundled native clients are
 * optional dependencies that an application need not install, so name the selected
 * executable, else the one already named in the environment, else the client on PATH. */
export function acpEnvironment(agent: AcpAgent, env: NodeJS.ProcessEnv, executable?: string): NodeJS.ProcessEnv {
  const name = agent === 'claude' ? 'CLAUDE_CODE_EXECUTABLE' : 'CODEX_PATH';
  return { ...env, [name]: executable || env[name] || agent };
}
