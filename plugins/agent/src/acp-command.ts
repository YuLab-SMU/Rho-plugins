import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export type AcpAgent = 'claude' | 'codex';
export function acpCommand(agent: AcpAgent) {
  if (agent !== 'claude' && agent !== 'codex') throw new Error('Choose claude or codex.');
  const entry = agent === 'claude' ? '@agentclientprotocol/claude-agent-acp/dist/index.js' : '@agentclientprotocol/codex-acp';
  return { file: process.execPath, args: [fileURLToPath(import.meta.resolve(entry))] };
}
const executableVariable: Record<AcpAgent, string> = { claude: 'CLAUDE_CODE_EXECUTABLE', codex: 'CODEX_PATH' };
const clientName: Record<AcpAgent, string> = { claude: 'Claude Code', codex: 'Codex' };
/** The adapters drive the person's installed client. Their bundled native clients are
 * optional dependencies that an application need not install, so name the selected
 * executable, else the one already named in the environment, else the client on PATH. */
export function acpEnvironment(agent: AcpAgent, env: NodeJS.ProcessEnv, executable?: string): NodeJS.ProcessEnv {
  const name = executableVariable[agent];
  return { ...env, [name]: executable || env[name] || agent };
}
/** Why the adapter could not start the person's client, or null when its executable is
 * there. The adapters report a missing client only as a closed connection. */
export function missingClient(agent: AcpAgent, env: NodeJS.ProcessEnv): string | null {
  const executable = env[executableVariable[agent]] || agent;
  // On Windows a copied environment keeps the variable's own case (Path), and a client is a
  // file with an extension PATHEXT names (claude.exe, an npm codex.cmd), as the shell finds it.
  const windows = process.platform === 'win32';
  const variable = (name: string) => windows ? Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1] : env[name];
  const named = executable.includes('/') || (windows && executable.includes('\\'));
  const extensions = windows && !path.extname(executable) ? (variable('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const candidates = (named ? [executable] : (variable('PATH') ?? '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, executable))).flatMap(file => extensions.map(extension => file + extension));
  const runnable = (file: string) => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } };
  if (candidates.some(runnable)) return null;
  return `${clientName[agent]} was not found ${named ? 'at ' + executable : 'on PATH (' + executable + ')'}. Install it, or select its executable.`;
}
