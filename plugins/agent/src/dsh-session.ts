import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { activityPayload, canonicalActivity } from './activity-normalize.js';
import { externalSessionId, retainedExternalSession, saveExternalSession, type ExternalSessionRecord, type ExternalTurn, type ExternalTool } from './external-session.js';
import { externalSessionLimits as limits } from './external-session-contract.js';

const text = (v: any): string => typeof v === 'string' ? v : Array.isArray(v) ? v.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n') : '';
const time = (v: any) => { const n = typeof v === 'number' ? v : Date.parse(v); if (!Number.isFinite(n)) throw new Error('Native event has no valid timestamp.'); return new Date(n).toISOString(); };
const hash = (v: unknown) => createHash('sha256').update(canonicalActivity(v)).digest('hex');
const safe = (value: string, cap = limits.maxTextChars) => (activityPayload({ text: value }, { content: true, maxFieldBytes: cap * 4, maxEventBytes: cap * 8 }).text as string ?? '').slice(0, cap).replace(/[\uD800-\uDBFF]$/, '');
export function externalProjectPath(root: string, input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 1024 || input.includes('\0')) return null;
  const relative = path.relative(root, path.resolve(root, input)).split(path.sep).join('/');
  return relative && !relative.startsWith('../') && !path.isAbsolute(relative) && !relative.split('/').some(p => ['..', '.rho', '.git'].includes(p)) ? relative : null;
}
function paths(root: string, args: any, content: string) {
  const candidates = [args?.path, args?.file_path, args?.filename, args?.declaration?.path];
  // These are explicitly labelled mentions, never inferred file writes or historical snapshots.
  for (const m of content.matchAll(/(?<![\w/.:\-])\/?(?:[\w.\-\u0080-\uFFFF]+\/)*[\w.\-\u0080-\uFFFF]+\.(?:R|r|py|md|csv|tsv|png|svg|pdf|json|txt|qmd|Rmd)\b/g)) candidates.push(m[0]);
  return [...new Set(candidates.map(p => externalProjectPath(root, p)).filter((p): p is string => !!p))].slice(0, 32);
}
/** Project the native committed log. System prompts, injected context and reasoning
 * are excluded. Original session, turn and call identities survive every backfill. */
export function projectDshSession(root: string, header: any, events: readonly any[], observedAt = new Date().toISOString()): ExternalSessionRecord {
  root = fs.realpathSync(root);
  if (!header || header.version !== 4 || typeof header.id !== 'string' || !/^[A-Za-z0-9._:@-]{1,128}$/.test(header.id) || typeof header.cwd !== 'string' || fs.realpathSync(header.cwd) !== root) throw new Error('Harness session does not match the selected project.');
  if (events.length > limits.maxEvents || Buffer.byteLength(JSON.stringify(events)) > limits.maxSourceBytes) throw new Error('Harness observation exceeds source limits; previous observation retained.');
  const turns: ExternalTurn[] = [], byTurn = new Map<number, ExternalTurn>(), tools = new Map<string, { turn: ExternalTurn; tool: ExternalTool }>();
  let current: ExternalTurn | undefined, title = '', lastAt = time(header.createdAt), omittedTurns = 0;
  const makeTurn = (id: number, at: string) => {
    let t = byTurn.get(id); if (t) return t;
    t = { id: 'turn:' + id, at, state: 'unknown', prompt: '', reply: '', messages: [], tools: [], results: [], omittedTools: 0, omittedChars: 0 };
    byTurn.set(id, t); turns.push(t);
    if (turns.length > limits.maxTurns) { const gone = turns.shift()!; omittedTurns++; for (const [k, v] of tools) if (v.turn === gone) tools.delete(k); for (const [k, v] of byTurn) if (v === gone) byTurn.delete(k); }
    return t;
  };
  const appendText = (t: ExternalTurn, field: 'prompt' | 'reply', value: string, replace = false) => {
    const full = replace ? value : t[field] + (t[field] ? '\n\n' : '') + value;
    t[field] = safe(full); t.omittedChars += Math.max(0, full.length - t[field].length);
  };
  for (let i = 0; i < events.length; i++) {
    const e = events[i]; if (e.seq !== i) throw new Error('Harness source has a missing or reordered native event.');
    const d = e.data ?? {}, at = time(e.time); lastAt = at;
    if (e.type === 'session/title' && typeof d.title === 'string') title = safe(d.title, 512);
    if (e.type === 'turn/start') { current = makeTurn(d.turn, at); current.state = 'running'; }
    if (e.type === 'user/message' && d.source?.kind === 'user') { if (!current) current = makeTurn(e.seq, at); appendText(current, 'prompt', text(d.content)); }
    if (e.type === 'assistant/message') {
      const t = byTurn.get(d.turn) ?? current; if (!t) continue;
      const message = text(d.message?.content); if (message) {
        if (t.reply) t.messages.push({ at, text: t.reply });
        while (t.messages.length > 200 || t.messages.reduce((n, m) => n + m.text.length, 0) > limits.maxTextChars) t.omittedChars += t.messages.shift()!.text.length;
        appendText(t, 'reply', message, true);
      }
    }
    if (e.type === 'tool/call') {
      const t = byTurn.get(d.turn) ?? current; if (!t || typeof d.callId !== 'string' || typeof d.name !== 'string') continue;
      if (tools.has(d.callId)) throw new Error('Harness call identity was reused.');
      if (t.tools.length >= limits.maxTools) { t.omittedTools++; continue; }
      let args = d.arguments; if (typeof args === 'string') { try { args = JSON.parse(args); } catch {} }
      const name = d.name === 'mcp__rho__rho_call' && typeof args?.operation === 'string' ? args.operation : d.name;
      const input = args?.input ?? args;
      const detail = safe(typeof input?.command === 'string' ? input.command : JSON.stringify(input) ?? '', limits.maxDetailChars);
      const tool: ExternalTool = { id: d.callId, at, name, detail, output: '', outcome: 'requested', paths: paths(root, input, detail) };
      t.tools.push(tool); tools.set(d.callId, { turn: t, tool });
    }
    if (e.type === 'tool/result') {
      const message = d.message, item = tools.get(message?.toolCallId ?? message?.source?.callId); if (!item) continue;
      const output = text(message?.content); item.tool.output = safe(output, limits.maxDetailChars); item.tool.outcome = message?.isError ? 'failed' : 'returned';
      item.turn.omittedChars += Math.max(0, output.length - item.tool.output.length);
      // Only a successful Rho registration/capture reply asserts an exact resource version.
      if (['resource.register', 'resource.capture', 'agent.activity.capture'].includes(item.tool.name) && !message?.isError) {
        try {
          const response = JSON.parse(output), r = response.value?.resource ?? response.value;
          const relative = externalProjectPath(root, r?.path);
          if (response.ok === true && relative && /^[a-f0-9]{64}$/.test(r.id) && /^[a-f0-9]{64}$/.test(r.version) && typeof r.projectId === 'string' && item.turn.results.length < 64) item.turn.results.push({ path: relative, id: r.id, version: r.version, projectId: r.projectId, toolId: item.tool.id });
        } catch { /* The bounded receipt can be incomplete; never fabricate a resource. */ }
      }
    }
    if (e.type === 'job/settled') {
      const item = tools.get(d.toolCall?.rootCallId ?? d.toolCall?.callId), exit = typeof d.detail === 'string' ? /^exit code: (-?\d+)$/.exec(d.detail) : null;
      if (item && exit) item.tool.exitCode = Number(exit[1]);
    }
    if (e.type === 'deliverables/presented') {
      const t = byTurn.get(d.turn) ?? current; if (!t) continue;
      for (const file of d.files ?? []) { const relative = externalProjectPath(root, file.path); if (relative && !t.results.some(r => r.path === relative) && t.results.length < 64) t.results.push({ path: relative, toolId: d.callId ?? 'event:' + e.seq }); }
    }
    if (e.type === 'turn/end') {
      const t = byTurn.get(d.turn); if (!t) continue;
      t.state = d.reason?.kind === 'completed' ? 'completed' : d.reason?.kind === 'cancelled' ? 'stopped' : d.reason?.kind === 'error' ? 'failed' : 'unknown'; t.endedAt = at;
      for (const tool of t.tools) if (tool.outcome === 'requested') tool.outcome = 'unknown';
    }
  }
  const summary = { id: externalSessionId('dsh', header.id), producer: 'dsh', sessionId: header.id, title: title || turns.find(t => t.prompt)?.prompt.slice(0, 160) || 'Harness conversation', lastAt, observedAt,
    state: turns.at(-1)?.state ?? 'unknown' as const, turns: turns.length + omittedTurns, sourceCursor: events.length, omittedTurns, inputOwner: 'external' as const };
  const result: ExternalSessionRecord = { format: 1, projectRoot: root, summary, turns, sourceDigest: hash(events) };
  // A suffix is retained at the record budget; gaps are explicit, earlier files stay untouched.
  while (Buffer.byteLength(JSON.stringify(result)) > limits.maxRecordBytes && result.turns.length > 1) { result.turns.shift(); result.summary.omittedTurns++; }
  if (Buffer.byteLength(JSON.stringify(result)) > limits.maxRecordBytes) throw new Error('Harness turn exceeds maxRecordBytes; previous observation retained.');
  return result;
}
export function observeDshSession(root: string, header: any, events: readonly any[]) {
  const old = retainedExternalSession(root, 'dsh', header.id);
  const value = projectDshSession(root, header, events);
  return saveExternalSession(root, value, old ? hash(events.slice(0, old.summary.sourceCursor)) : undefined);
}
