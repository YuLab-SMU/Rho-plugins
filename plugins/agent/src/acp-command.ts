import fs from 'node:fs';
import os from 'node:os';
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
  return { ...withoutSessionMarkers(env), [name]: executable || env[name] || agent };
}
// When Rho itself was started from inside a Claude Code session (an Agent ran the setup), the
// environment carries that session's markers. A Claude Code started with them takes itself for
// its child: it saves no transcript (so its session cannot be continued anywhere) and reports to
// the parent's socket. Rho's sessions are the person's own, so those markers are not passed on.
const sessionMarkers = /^(CLAUDECODE|CLAUDE_CODE_(CHILD_SESSION|ENTRYPOINT|SESSION_ID|SESSION_ATTENDED|MESSAGING_SOCKET|MESSAGING_TOKEN|EXECPATH|SSE_PORT)|CLAUDE_PID)$/;
export function withoutSessionMarkers(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !sessionMarkers.test(key)));
}
/** The file a shell runs for `program`: the program itself when it names a path, else the first
 * runnable match on PATH. On Windows a copied environment keeps the variable's own case (Path),
 * and a program is a file with an extension PATHEXT names (claude.exe, an npm codex.cmd). */
export function locate(program: string, env: NodeJS.ProcessEnv): string | null {
  const windows = process.platform === 'win32';
  const variable = (name: string) => windows ? Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1] : env[name];
  const named = program.includes('/') || (windows && program.includes('\\'));
  const extensions = windows && !path.extname(program) ? (variable('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const candidates = (named ? [program] : (variable('PATH') ?? '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, program))).flatMap(file => extensions.map(extension => file + extension));
  const runnable = (file: string) => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } };
  return candidates.find(runnable) ?? null;
}
/** Why the adapter could not start the person's client, or null when its executable is
 * there. The adapters report a missing client only as a closed connection. */
export function missingClient(agent: AcpAgent, env: NodeJS.ProcessEnv): string | null {
  const executable = env[executableVariable[agent]] || agent;
  if (locate(executable, env)) return null;
  const named = executable.includes('/') || (process.platform === 'win32' && executable.includes('\\'));
  return `${clientName[agent]} was not found ${named ? 'at ' + executable : 'on PATH (' + executable + ')'}. Install it, or select its executable.`;
}

/** Agents that serve ACP through a command of their own: the program a person installs and the
 * arguments that make it an ACP Agent, as the ACP registry (github.com/agentclientprotocol/registry,
 * read 2026-11-07) gives them or as Rho has run them. Rho starts any of these as it starts a
 * command the person names; the list only lets it find them. */
export interface KnownAcpAgent { id: string; name: string; program: string; args: string[] }
export const knownAcpAgents: KnownAcpAgent[] = [
  // DeepSeek Harness serves ACP from its `acp` profile, installed apart from the launcher.
  { id: 'dsh', name: 'DeepSeek Harness', program: 'dsh', args: ['acp'] },
  { id: 'hermes', name: 'Hermes Agent', program: 'hermes', args: ['acp'] },
  { id: 'kimi', name: 'Kimi Code', program: 'kimi', args: ['acp'] },
  { id: 'opencode', name: 'OpenCode', program: 'opencode', args: ['acp'] },
  { id: 'gemini', name: 'Gemini CLI', program: 'gemini', args: ['--acp'] },
  { id: 'qwen', name: 'Qwen Code', program: 'qwen', args: ['--acp'] },
  { id: 'goose', name: 'goose', program: 'goose', args: ['acp'] },
  { id: 'cursor', name: 'Cursor Agent', program: 'cursor-agent', args: ['acp'] },
  { id: 'auggie', name: 'Auggie CLI', program: 'auggie', args: ['--acp'] },
  { id: 'codebuddy', name: 'CodeBuddy Code', program: 'codebuddy', args: ['--acp'] },
  { id: 'droid', name: 'Factory Droid', program: 'droid', args: ['exec', '--output-format', 'acp-daemon'] },
];
const harnessProfile = (env: NodeJS.ProcessEnv) => fs.existsSync(path.join(env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'acp', 'package.json'));
/** The known Agents installed on this computer, each with the file its command starts. Finding
 * them reads PATH (and Harness's profile folder) and starts nothing: whether one answers as an
 * ACP Agent is known only once it is started. */
export function installedAcpAgents(env: NodeJS.ProcessEnv = process.env) {
  return knownAcpAgents.flatMap(agent => {
    const file = locate(agent.program, env);
    return file && (agent.id !== 'dsh' || harnessProfile(env)) ? [{ id: agent.id, name: agent.name, command: { file, args: agent.args } }] : [];
  });
}
/** The known Agent a command starts, when it starts one with its ACP arguments. */
export function knownAcpAgent(command: { file: string; args: string[] }) {
  const program = path.basename(command.file).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
  return knownAcpAgents.find(agent => agent.program === program && agent.args.length === command.args.length && agent.args.every((arg, i) => arg === command.args[i])) ?? null;
}
