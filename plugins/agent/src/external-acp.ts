import fs, { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Ajv } from 'ajv';
import { SessionObserver, type SessionObservation } from './session-observation.js';
import { sessionObservationSchema } from './session-contract.js';
import type { AcpAgent } from './acp-command.js';

export const externalAcpLimits = { maxSessions: 64, maxRecordBytes: 524288, maxPending: 128, maxMessageChars: 8192, leaseMs: 10000 };
export interface ExternalAcpSession {
  format: 1; id: string; agent: AcpAgent; projectRoot: string; sessionId: string;
  connectionId: string; pid: number; heartbeatAt: string; connected: boolean;
  state: 'idle' | 'running' | 'completed' | 'stopped' | 'failed' | 'unknown';
  prompts: number; pendingPermissions: number; lastMessage: string; omittedMessageChars: number;
  observation: SessionObservation;
}
const observationValid = new Ajv({ strict: false }).compile(sessionObservationSchema);
const identity = (agent: AcpAgent, sessionId: string) => 'e-' + createHash('sha256').update(agent + '\0' + sessionId).digest('hex');
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === 'EPERM'; } };
function directory(root: string, create = false) {
  let dir = fs.realpathSync(root);
  for (const part of ['.rho', 'agent', 'acp']) {
    dir = path.join(dir, part);
    if (create) { try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; } }
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(dir) !== dir) throw new Error('External ACP observation directory is outside the selected project.');
  }
  return dir;
}
function json(file: string, max = externalAcpLimits.maxRecordBytes): any {
  const fd = fs.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) throw new Error('External ACP record exceeds its read limit.');
    const bytes = Buffer.alloc(stat.size + 1), n = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (n !== stat.size) throw new Error('External ACP record changed during observation.');
    return JSON.parse(bytes.subarray(0, n).toString('utf8'));
  } finally { fs.closeSync(fd); }
}
function valid(v: any, root: string): v is ExternalAcpSession {
  return v?.format === 1 && ['claude', 'codex'].includes(v.agent) && typeof v.sessionId === 'string' && v.sessionId.length <= 1024
    && v.id === identity(v.agent, v.sessionId) && v.projectRoot === root && typeof v.connectionId === 'string'
    && Number.isSafeInteger(v.pid) && v.pid > 0 && Number.isFinite(Date.parse(v.heartbeatAt)) && typeof v.connected === 'boolean'
    && ['idle', 'running', 'completed', 'stopped', 'failed', 'unknown'].includes(v.state)
    && [v.prompts, v.pendingPermissions, v.omittedMessageChars].every(n => Number.isSafeInteger(n) && n >= 0)
    && typeof v.lastMessage === 'string' && v.lastMessage.length <= externalAcpLimits.maxMessageChars
    && observationValid(v.observation) && v.observation.sessionId === v.sessionId;
}
/** Local bounded reads only. No Agent, collector or Host is started or contacted. */
export function readExternalAcp(root: string): { sessions: ExternalAcpSession[]; omitted: number } {
  const sessions: ExternalAcpSession[] = []; let omitted = 0;
  try {
    root = fs.realpathSync(root); const dir = directory(root), entries = fs.opendirSync(dir);
    try {
      let entry: fs.Dirent | null, scanned = 0;
      while ((entry = entries.readSync())) {
        if (++scanned > externalAcpLimits.maxSessions * 4) { omitted++; break; }
        if (!/^e-[a-f0-9]{64}\.json$/.test(entry.name)) continue;
        if (sessions.length >= externalAcpLimits.maxSessions) { omitted++; continue; }
        try {
          const v = json(path.join(dir, entry.name)); if (!valid(v, root)) { omitted++; continue; }
          const connected = v.connected && Date.now() - Date.parse(v.heartbeatAt) <= externalAcpLimits.leaseMs && alive(v.pid);
          sessions.push({ ...v, connected, pendingPermissions: connected ? v.pendingPermissions : 0,
            state: !connected && v.state === 'running' ? 'unknown' : v.state,
            observation: { ...v.observation, connected, tools: v.observation.tools.map(t => !connected && t.outcome === 'requested' ? { ...t, outcome: 'unknown' as const } : t) } });
        } catch { omitted++; }
      }
    } finally { entries.closeSync(); }
  } catch (e: any) { if (e.code !== 'ENOENT') omitted++; }
  return { sessions: sessions.sort((a, b) => b.heartbeatAt.localeCompare(a.heartbeatAt)), omitted };
}

/** Observes messages passing through an external client's stdio connection.
 * It never originates a prompt, permission choice, file request or cancellation. */
export class ExternalAcpObserver {
  private root: string; private dir: string; private connectionId = randomUUID();
  private requests = new Map<string | number, any>();
  private permissions = new Map<string | number, string>();
  private sessions = new Map<string, { value: ExternalAcpSession; observer: SessionObserver; loading: boolean; attached: boolean; lock: string }>();
  private pendingUpdates: any[] = []; private pendingBytes = 0; private timer: ReturnType<typeof setInterval>;
  private changed = new Set<string>(); private disabled = false; private closed = false;
  constructor(root: string, private agent: AcpAgent, private problem: () => void = () => {}) {
    this.root = fs.realpathSync(root); this.dir = directory(this.root, true);
    this.timer = setInterval(() => this.guard(() => this.flush()), 2000); this.timer.unref();
  }
  private guard(work: () => void) { if (!this.disabled) try { work(); } catch { this.disabled = true; this.problem(); } }
  private session(sessionId: string, loading = false) {
    let s = this.sessions.get(sessionId); if (s) { s.loading = loading; return s; }
    if (typeof sessionId !== 'string' || sessionId.length > 1024 || this.sessions.size >= externalAcpLimits.maxSessions) throw new Error('External ACP session limit.');
    const id = identity(this.agent, sessionId), file = path.join(this.dir, id + '.json'), lock = path.join(this.dir, id + '.lock');
    const kept = readExternalAcp(this.root);
    if (kept.sessions.length + kept.omitted >= externalAcpLimits.maxSessions && !kept.sessions.some(v => v.id === id)) throw new Error('External ACP retention is full.');
    try {
      const old = json(lock, 1024);
      if (Number.isSafeInteger(old.pid) && alive(old.pid)) throw new Error('Another external client owns observation of this session.');
      fs.unlinkSync(lock);
    } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, connectionId: this.connectionId }), { flag: 'wx', mode: 0o600 });
    let previous: ExternalAcpSession | undefined;
    try { const v = json(file); if (valid(v, this.root)) previous = v; } catch {}
    const observer = new SessionObserver(observation => { entry.value.observation = observation; this.changed.add(sessionId); }, previous?.observation);
    const entry = { observer, loading, attached: false, lock, value: {
      format: 1 as const, id, agent: this.agent, projectRoot: this.root, sessionId, connectionId: this.connectionId, pid: process.pid,
      heartbeatAt: new Date().toISOString(), connected: true, state: previous?.state === 'running' ? 'unknown' as const : previous?.state ?? 'idle' as const,
      prompts: previous?.prompts ?? 0, pendingPermissions: 0, lastMessage: previous?.lastMessage ?? '', omittedMessageChars: previous?.omittedMessageChars ?? 0,
      observation: previous?.observation as SessionObservation
    } };
    this.sessions.set(sessionId, entry); return entry;
  }
  client(message: any) { this.guard(() => {
    const { method, params, id } = message;
    if (method === 'session/new' || method === 'session/load') {
      if (this.requests.size >= externalAcpLimits.maxPending) throw new Error('External ACP request limit.');
      if (fs.realpathSync(params.cwd) !== this.root) return;
      this.requests.set(id, { method, sessionId: params.sessionId });
      if (method === 'session/load') this.session(params.sessionId, true);
    } else if (method === 'session/prompt') {
      const s = this.sessions.get(params.sessionId); if (!s?.attached) return;
      if (this.requests.size >= externalAcpLimits.maxPending) throw new Error('External ACP request limit.');
      this.requests.set(id, { method, sessionId: params.sessionId }); s.value.prompts++;
      s.value.state = 'running'; s.value.lastMessage = ''; s.value.omittedMessageChars = 0; this.changed.add(params.sessionId); this.flush();
    } else if (id !== undefined && !method) {
      const sid = this.permissions.get(id), s = sid && this.sessions.get(sid);
      if (s) { s.value.pendingPermissions = Math.max(0, s.value.pendingPermissions - 1); this.changed.add(sid!); }
      this.permissions.delete(id);
    }
  }); }
  agentMessage(message: any) { this.guard(() => {
    const { method, params, id, result, error } = message;
    if (method === 'session/update') {
      const s = this.sessions.get(params.sessionId);
      if (!s && [...this.requests.values()].some(r => r.method === 'session/new')) {
        const bytes = Buffer.byteLength(JSON.stringify(params)); this.pendingBytes += bytes;
        if (this.pendingUpdates.length >= externalAcpLimits.maxPending || this.pendingBytes > externalAcpLimits.maxRecordBytes) throw new Error('External ACP pre-session update limit.');
        this.pendingUpdates.push(params); return;
      }
      if (!s) return;
      s.observer.update(params, s.loading ? 'history' : s.attached ? 'live' : 'initial');
      const u = params.update;
      if (!s.loading && u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
        const space = Math.max(0, externalAcpLimits.maxMessageChars - s.value.lastMessage.length), text = u.content.text;
        s.value.lastMessage += text.slice(0, space).replace(/[\uD800-\uDBFF]$/, ''); s.value.omittedMessageChars += Math.max(0, text.length - space);
        this.changed.add(params.sessionId);
      }
    } else if (method === 'session/request_permission') {
      const s = this.sessions.get(params.sessionId); if (!s) return;
      if (this.permissions.size >= externalAcpLimits.maxPending) throw new Error('External ACP permission observation limit.');
      this.permissions.set(id, params.sessionId); s.value.pendingPermissions++; this.changed.add(params.sessionId); this.flush();
    } else if (id !== undefined && !method) {
      const r = this.requests.get(id); this.requests.delete(id); if (!r) return;
      if (r.method === 'session/new' || r.method === 'session/load') {
        if (error) return;
        const sid = r.sessionId ?? result?.sessionId, s = this.session(sid, r.method === 'session/load');
        for (const update of this.pendingUpdates) if (update.sessionId === sid) s.observer.update(update, 'initial');
        this.pendingUpdates = []; this.pendingBytes = 0;
        s.observer.attached(sid); s.attached = true; s.loading = false; this.changed.add(sid); this.flush();
      } else if (r.method === 'session/prompt') {
        const s = this.sessions.get(r.sessionId); if (!s) return;
        s.value.state = error ? 'failed' : result?.stopReason === 'cancelled' ? 'stopped' : result?.stopReason === 'end_turn' ? 'completed' : 'failed';
        this.changed.add(r.sessionId); this.flush();
      }
    }
  }); }
  unavailable() { this.guard(() => { throw new Error('External ACP observation stopped at a transport limit.'); }); }
  private flush() {
    directory(this.root);
    for (const [sid, s] of this.sessions) {
      if (!s.attached) continue;
      // Heartbeat is evidence of the observing connection, not model progress.
      s.value.heartbeatAt = new Date().toISOString();
      const lock = json(s.lock, 1024); if (lock.connectionId !== this.connectionId) throw new Error('External ACP observation ownership changed.');
      const bytes = JSON.stringify(s.value);
      if (Buffer.byteLength(bytes) > externalAcpLimits.maxRecordBytes) throw new Error('External ACP record limit.');
      const file = path.join(this.dir, s.value.id + '.json'), temp = file + '.' + this.connectionId + '.tmp';
      fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); this.changed.delete(sid);
    }
  }
  close() {
    if (this.closed) return; this.closed = true;
    clearInterval(this.timer);
    this.guard(() => {
      for (const s of this.sessions.values()) { s.observer.disconnected(); s.value.connected = false; s.value.pendingPermissions = 0; if (s.value.state === 'running') s.value.state = 'unknown'; }
      this.flush();
    });
    for (const s of this.sessions.values()) try { if (json(s.lock, 1024).connectionId === this.connectionId) fs.unlinkSync(s.lock); } catch {}
  }
}
