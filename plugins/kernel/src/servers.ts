import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { now, requireThat } from '@rho-workspace/plugin-contracts';
import { runProgram, said, type Place, type Remote, type RunLimits, type Transport } from './places.js';

// The servers a person manages with serverctl (ssh-server-manager): it keeps each server's login
// in the system's credential vault and its connection settings, and binds to each server the
// skills that say how that server is used, which an Agent reads before working there. A place on
// such a server is reached through `serverctl exec`, never with ssh beside it: ssh alone has
// neither the login nor the settings. The registry is read as serverctl reports it, with no
// connection made; a server's address and account stay with serverctl.
export interface ServerSkill { name: string; description: string; path: string; status: string; problem: string | null }
export interface Server { server: string; system: string | null; tags: string[]; skills: ServerSkill[] }
export interface Servers { tool: { program: string; ok: boolean; problem: string | null }; servers: Server[]; readAt: string }

const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;

export class Serverctl implements Transport {
  // reuseS: how long serverctl keeps a server's shared connection open after its last use.
  // sessionS: serverctl's own time limit for one command, which for a session is its lifetime.
  constructor(readonly program = 'serverctl', private options: { reuseS: number; sessionS: number; readMs: number; skillBytes: number }) {}
  // serverctl quotes each word for the server's shell.
  private args(place: Pick<Place, 'destination'>, command: Remote, timeoutS: number) {
    return ['exec', place.destination, '--timeout', String(timeoutS), '--reuse', String(this.options.reuseS), '--', ...command];
  }
  async spawn(place: Pick<Place, 'destination'>, command: Remote, cwd: string): Promise<ChildProcess> {
    return spawn(this.program, this.args(place, command, this.options.sessionS), { cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  run(place: Pick<Place, 'destination'>, command: Remote, limits: RunLimits) {
    return runProgram(this.program, this.args(place, command, Math.max(1, Math.ceil(limits.timeoutMs / 1000))), limits);
  }

  // One read of the registry: its JSON, or what serverctl said when it could not answer.
  private async read(args: string[]): Promise<{ value: unknown; problem: string | null }> {
    const run = await runProgram(this.program, [...args, '--json'], { timeoutMs: this.options.readMs, maxBytes: 4 * 1024 * 1024 });
    let value: unknown;
    try { value = JSON.parse(run.out.toString('utf8')); } catch { return { value: null, problem: said(run, `serverctl ${args.join(' ')}`) }; }
    const failed = record(value);
    if (!Array.isArray(value) && failed.ok === false && typeof failed.message === 'string') return { value: null, problem: `serverctl: ${failed.message}` };
    return { value, problem: null };
  }

  async servers(): Promise<Servers> {
    const [hosts, skills] = await Promise.all([this.read(['server', 'list']), this.read(['skill', 'list'])]);
    const problem = hosts.problem ?? skills.problem;
    if (problem || !Array.isArray(hosts.value) || !Array.isArray(skills.value)) return { tool: { program: this.program, ok: false, problem: problem ?? 'serverctl answered in a form Rho does not read.' }, servers: [], readAt: now() };
    const bound = skills.value.map(record);
    return {
      tool: { program: this.program, ok: true, problem: null },
      servers: hosts.value.map(record).filter(h => typeof h.alias === 'string').map(h => ({
        server: h.alias as string, system: typeof record(h.facts).os === 'string' ? record(h.facts).os as string : null, tags: strings(h.tags),
        skills: bound.filter(s => Array.isArray(s.servers) && s.servers.some(x => record(x).alias === h.alias)).map(s => ({
          name: String(s.name), description: typeof s.description === 'string' ? s.description : '', path: String(s.path), status: String(s.status),
          problem: s.status === 'ready' ? null : typeof s.status_message === 'string' ? s.status_message : `serverctl reports it ${String(s.status)}.`,
        })),
      })),
      readAt: now(),
    };
  }

  // The server's name as serverctl spells it, or null when serverctl does not manage it (or
  // cannot be asked).
  async named(destination: string) {
    const { tool, servers } = await this.servers();
    return tool.ok ? servers.find(s => s.server.toLowerCase() === destination.toLowerCase())?.server ?? null : null;
  }

  // One skill bound to a server, as its file reads now. serverctl resolves the server's skills
  // together and fails when one is not ready; then none is given, as serverctl intends: a
  // server's guidance is not taken in part or from another place of the same name.
  async skill(server: string, name: string) {
    const { value, problem } = await this.read(['skill', 'resolve', server]);
    requireThat(!problem, 'unavailable', problem!);
    const resolved = record(value), hosts = Array.isArray(resolved.hosts) ? resolved.hosts.map(record) : [];
    const host = hosts.find(h => typeof h.alias === 'string' && h.alias.toLowerCase() === server.toLowerCase());
    requireThat(host, 'not_found', `serverctl manages no server named ${server}. Read kernel.servers for the servers there are.`);
    const skills = Array.isArray(host.skills) ? host.skills.map(record) : [];
    const notReady = skills.filter(s => s.status !== 'ready');
    requireThat(resolved.ok !== false && !notReady.length, 'unavailable', `serverctl cannot resolve the skills of ${host.alias}: ${notReady.map(s => `${s.name} is ${s.status}${typeof s.status_message === 'string' ? ` (${s.status_message})` : ''}`).join('; ') || 'it reported a problem'}. Fix the binding in serverctl, then read it again.`);
    const skill = skills.find(s => typeof s.name === 'string' && s.name.toLowerCase() === name.toLowerCase());
    requireThat(skill, 'not_found', `No skill named ${name} is bound to ${host.alias}. Read kernel.servers for its skills.`);
    const file = String(skill.path);
    requireThat(path.isAbsolute(file) && path.basename(file) === 'SKILL.md', 'scope', `serverctl names ${file} for ${skill.name}; only a skill's SKILL.md is read.`);
    const st = await fs.stat(file).catch(() => null);
    requireThat(st && st.isFile(), 'not_found', `${file} is not there now.`);
    requireThat(st.size <= this.options.skillBytes, 'limit', `${skill.name} is ${st.size} bytes; skills larger than ${this.options.skillBytes} bytes are not read here. Read ${file} itself.`, { limit: 'serverSkillBytes', maximum: this.options.skillBytes });
    return { server: host.alias as string, name: String(skill.name), description: typeof skill.description === 'string' ? skill.description : '', path: file, text: await fs.readFile(file, 'utf8'), bytes: st.size, readAt: now() };
  }
}
