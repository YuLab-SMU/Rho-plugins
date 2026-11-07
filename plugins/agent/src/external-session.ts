import fs, { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Ajv } from 'ajv';
import { externalSessionLimits as limits, externalSessionSummarySchema, externalTurnSchema } from './external-session-contract.js';

export { externalSessionLimits } from './external-session-contract.js';
export interface ExternalTool { id: string; at: string; name: string; detail: string; output: string; outcome: 'requested' | 'returned' | 'failed' | 'unknown'; exitCode?: number; paths: string[] }
export interface ExternalResult { path: string; toolId: string; id?: string; version?: string; projectId?: string }
export interface ExternalTurn { id: string; at: string; endedAt?: string; state: 'running' | 'completed' | 'failed' | 'stopped' | 'unknown'; prompt: string; reply: string; messages: Array<{ at: string; text: string }>; tools: ExternalTool[]; results: ExternalResult[]; omittedTools: number; omittedChars: number ; where?: string }
export interface ExternalSessionSummary { id: string; producer: string; sessionId: string; title: string; lastAt: string; observedAt: string; state: ExternalTurn['state']; turns: number; sourceCursor: number; omittedTurns: number; problem?: string; inputOwner?: 'external';
  where?: string; open?: { where: string; since?: string; pid?: number } | null; resume?: string; bytes?: number; continueWith?: 'claude-acp' | 'codex-acp' | 'acp' | `acp:${string}` | null; conversationId?: string }
export interface ExternalSessionRecord { format: 1; projectRoot: string; summary: ExternalSessionSummary; turns: ExternalTurn[]; sourceDigest: string }
export const externalSessionId = (producer: string, session: string) => 'x-' + createHash('sha256').update(producer + '\0' + session).digest('hex');
const schema = new Ajv({ strict: false }).compile({ type: 'object', additionalProperties: false, required: ['format', 'projectRoot', 'summary', 'turns', 'sourceDigest'], properties: {
  format: { const: 1 }, projectRoot: { type: 'string' }, summary: externalSessionSummarySchema,
  turns: { type: 'array', maxItems: limits.maxTurns, items: externalTurnSchema }, sourceDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' }
} });
function directory(root: string, create = false) {
  let dir = fs.realpathSync(root);
  for (const part of ['.rho', 'agent', 'external']) {
    dir = path.join(dir, part);
    if (create) { try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; } }
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(dir) !== dir) throw new Error('External session storage must stay in the project.');
  }
  return dir;
}
function read(file: string, root: string): ExternalSessionRecord {
  const fd = fs.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limits.maxRecordBytes) throw new Error('External session record exceeds 4 MiB.');
    const b = Buffer.alloc(stat.size + 1), n = fs.readSync(fd, b, 0, b.length, 0);
    if (n !== stat.size) throw new Error('External session changed during observation.');
    const v = JSON.parse(b.subarray(0, n).toString('utf8'));
    if (!schema(v) || v.projectRoot !== root || v.summary.id !== externalSessionId(v.summary.producer, v.summary.sessionId)) throw new Error('Invalid external session record.');
    return v;
  } finally { fs.closeSync(fd); }
}
function observed(v: ExternalSessionRecord): ExternalSessionRecord {
  // No heartbeat proves the model or its native subprocess is alive.
  if (v.summary.state !== 'running' || Date.now() - Date.parse(v.summary.observedAt) < 10000) return v;
  return { ...v, summary: { ...v.summary, state: 'unknown' }, turns: v.turns.map(t => t.state !== 'running' ? t : { ...t, state: 'unknown', tools: t.tools.map(tool => tool.outcome === 'requested' ? { ...tool, outcome: 'unknown' } : tool) }) };
}
export function listExternalSessions(root: string) {
  root = fs.realpathSync(root); const sessions: ExternalSessionSummary[] = []; let omitted = 0;
  try {
    const dir = directory(root), entries = fs.opendirSync(dir);
    try { let e, scanned = 0; while ((e = entries.readSync())) {
      if (++scanned > limits.maxSessions * 4) { omitted++; break; }
      if (!/^x-[a-f0-9]{64}\.json$/.test(e.name)) continue;
      if (sessions.length >= limits.maxSessions) { omitted++; continue; }
      try { sessions.push(observed(read(path.join(dir, e.name), root)).summary); } catch { omitted++; }
    } } finally { entries.closeSync(); }
  } catch (e: any) { if (e.code !== 'ENOENT') omitted++; }
  return { sessions: sessions.sort((a, b) => b.lastAt.localeCompare(a.lastAt)), omitted };
}
export function readExternalSession(root: string, input: { session: string; before?: number; limit?: number }) {
  if (!/^x-[a-f0-9]{64}$/.test(input.session)) throw new Error('Invalid external session identity.');
  root = fs.realpathSync(root);
  const v = observed(read(path.join(directory(root), input.session + '.json'), root));
  const end = Math.min(v.turns.length, input.before ?? v.turns.length), first = Math.max(0, end - Math.min(20, Math.max(1, input.limit ?? 4)));
  return { session: v.summary, first, turns: v.turns.slice(first, end) };
}
/** Native adapters retain an observation under their existing filesystem authority.
 * No managed execution, Agent input, grant change or runtime startup is involved. */
export function saveExternalSession(root: string, value: ExternalSessionRecord, previousDigest?: string) {
  root = fs.realpathSync(root);
  if (value.projectRoot !== root || !schema(value) || value.summary.id !== externalSessionId(value.summary.producer, value.summary.sessionId)) throw new Error('Invalid external session observation.');
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > limits.maxRecordBytes) throw new Error('External session exceeds maxRecordBytes; previous observation retained.');
  const dir = directory(root, true), file = path.join(dir, value.summary.id + '.json');
  // The lock covers only a small local observation write; never steal a live writer's lock.
  const lock = file + '.lock'; let fd: number;
  try { fd = fs.openSync(lock, 'wx', 0o600); } catch {
    // Recover only a positively dead writer. Unknown owners and live PIDs retain the lock.
    try {
      const stat = fs.lstatSync(lock);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32) throw new Error();
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error();
      try { process.kill(pid, 0); throw new Error(); } catch (e: any) { if (e.code !== 'ESRCH') throw e; }
      const now = fs.lstatSync(lock); if (now.ino !== stat.ino || now.dev !== stat.dev) throw new Error();
      fs.unlinkSync(lock); fd = fs.openSync(lock, 'wx', 0o600);
    } catch { throw new Error('External session observation is busy; previous observation retained.'); }
  }
  fs.writeFileSync(fd, String(process.pid));
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    let old: ExternalSessionRecord | undefined;
    try { old = read(file, root); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    if (old) {
      if (value.summary.sourceCursor < old.summary.sourceCursor) throw new Error('External source moved backwards; previous observation retained.');
      if (value.summary.sourceCursor === old.summary.sourceCursor && old.sourceDigest !== value.sourceDigest) throw new Error('External source identity conflicts with retained content.');
      if (value.summary.sourceCursor > old.summary.sourceCursor && previousDigest !== old.sourceDigest) throw new Error('External source prefix conflicts with retained content.');
    } else {
      const entries = fs.readdirSync(dir).filter(n => /^x-[a-f0-9]{64}\.json$/.test(n));
      if (entries.length >= limits.maxSessions) throw new Error('External session maxSessions reached; previous observations retained.');
    }
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file);
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); try { fs.unlinkSync(temp); } catch {} }
  return value.summary;
}
export function retainedExternalSession(root: string, producer: string, sessionId: string) {
  root = fs.realpathSync(root);
  try { return read(path.join(directory(root), externalSessionId(producer, sessionId) + '.json'), root); }
  catch (e: any) { if (e.code === 'ENOENT') return undefined; throw e; }
}
