import { createHash } from 'node:crypto';
import path from 'node:path';

export const activityNormalizer = 'rho-agent-activity/1';
export interface ObservedEvent { sequence: number; kind: string; data: Record<string, any> }
export interface CaptureOptions { content?: boolean; maxFieldBytes?: number; maxEventBytes?: number }
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function canonicalActivity(value: any): string {
  return JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
}
const sensitive = /(?:^|[_-])(?:authorization|cookie|password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|token)$/i;
const hidden = /^(?:thinking|reasoning|reasoning_content|signature)$/i;
const txt = (v: any): string => typeof v === 'string' ? v : Array.isArray(v) ? v.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '';

function payload(value: any, options: CaptureOptions) {
  let redacted = false, truncated = false;
  const cap = options.maxFieldBytes ?? 8192;
  const identities = new Set(['native_id','call_id','root_call_id','job_id','parent_message_id']);
  function visit(v: any, depth = 0): any {
    if (depth > 12) { truncated = true; return '[depth limit]'; }
    if (typeof v === 'string') {
      const scrubbed = v.replace(/\b(Bearer)\s+[^\s'";]+/gi, '$1 [redacted]')
        .replace(/\b([\w-]*(?:api[_-]?key|password|passwd|auth[_-]?token|access[_-]?token|secret)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s'";]+)/gi, '$1[redacted]');
      if (scrubbed !== v) redacted = true;
      if (Buffer.byteLength(scrubbed) <= cap) return scrubbed;
      truncated = true;
      let result = '', size = 0;
      for (const c of scrubbed) { const n = Buffer.byteLength(c); if (size + n > cap) break; result += c; size += n; }
      return result;
    }
    if (Array.isArray(v)) {
      if (v.length > 128) truncated = true;
      return v.slice(0, 128).filter(x => !['thinking', 'redacted_thinking'].includes(x?.type)).map(x => visit(x, depth + 1));
    }
    if (v && typeof v === 'object') {
      const entries = Object.entries(v); if (entries.length > 128) truncated = true;
      return Object.fromEntries(entries.slice(0, 128).filter(([k]) => !hidden.test(k)).map(([k, x]) => {
        if (depth === 0 && identities.has(k)) {
          if (x !== null && x !== undefined && (typeof x !== 'string' || !x || Buffer.byteLength(x) > 1024)) throw new Error('Native identity is invalid or exceeds 1 KiB; it cannot be clipped');
          return [k,x];
        }
        if (sensitive.test(k)) { redacted = true; return [k, '[redacted]']; }
        return [k, visit(x, depth + 1)];
      }));
    }
    return v;
  }
  let data = visit(value);
  if (Buffer.byteLength(JSON.stringify(data)) > (options.maxEventBytes ?? 32768)) {
    data = { native_id: data.native_id, call_id: data.call_id, tool: data.tool,
      source_time: data.source_time, source_seq: data.source_seq, detail_omitted: 'event byte limit' };
    truncated = true;
  }
  return { ...data, capture: options.content ? 'content' : 'metadata', redacted, truncated };
}

function inputSummary(input: any) {
  if (!input || typeof input !== 'object') return {};
  return Object.fromEntries(['command', 'file_path', 'path', 'pattern', 'description', 'operation'].filter(k => typeof input[k] === 'string').map(k => [k, input[k]]));
}

function chained(items: { kind: string; data: any }[], options: CaptureOptions): ObservedEvent[] {
  let prefix = hash(activityNormalizer);
  return items.map(({ kind, data }, sequence) => {
    const safe = payload(data, options);
    prefix = hash(prefix + canonicalActivity({ kind, data: safe }));
    return { sequence, kind, data: { ...safe, prefix_sha256: prefix } };
  });
}

export function normalizeClaude(records: any[], sessionId: string, project: string, options: CaptureOptions = {}): ObservedEvent[] {
  const events: { kind: string; data: any }[] = [], calls = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const r of records) {
    if (!['assistant', 'user'].includes(r.type)) continue;
    const blocks = r.message?.content;
    if (!Array.isArray(blocks)) continue;
    const selected = blocks.filter((b: any) => ['tool_use', 'tool_result'].includes(b?.type));
    if (!selected.length) continue;
    if (r.sessionId !== sessionId || typeof r.cwd !== 'string' || path.resolve(r.cwd) !== project || typeof r.uuid !== 'string') throw new Error('Claude observation does not match the selected project/session or lacks native identity');
    for (let index = 0; index < selected.length; index++) {
      const b = selected[index], native_id = `${r.uuid}:${index}`;
      const fingerprint = canonicalActivity({block:b,parent:r.parentUuid,time:r.timestamp,denial:r.toolDenialKind});
      if (seen.has(native_id)) {
        if (seen.get(native_id) !== fingerprint) throw new Error('Claude native identity names conflicting content');
        continue;
      }
      seen.set(native_id, fingerprint);
      const requested = b.type === 'tool_use';
      const call_id = requested ? b.id : b.tool_use_id;
      if (typeof call_id !== 'string') throw new Error('Claude tool event has no call identity');
      if (requested) {
        if (typeof b.name !== 'string') throw new Error('Claude tool request has no tool name');
        calls.set(call_id, b.name);
      }
      const tool = requested ? b.name : calls.get(call_id) ?? null;
      const body = txt(b.content), nativeExit = !requested && tool === 'Bash'
        ? /^Exit code (-?\d+)(?:\n|$)/.exec(body) : null;
      events.push({ kind: requested ? 'tool.requested' : r.toolDenialKind ? 'tool.rejected' : 'tool.returned', data: {
        native_id, call_id, parent_message_id: r.parentUuid ?? null, tool,
        source_time: r.timestamp ?? null, ...(requested ? { input: inputSummary(b.input) } : {
          tool_error: b.is_error === true, denial_kind: r.toolDenialKind ?? null,
          exit_code: nativeExit ? Number(nativeExit[1]) : null,
          exit_basis: nativeExit ? 'claude-tool-result-marker' : null,
          association_missing: !calls.has(call_id),
        }),
        ...(options.content ? { detail: requested ? b.input : b.content } : {}),
      }});
    }
  }
  return chained(events, options);
}

export function normalizeDsh(records: any[], options: CaptureOptions = {}): ObservedEvent[] {
  const events: { kind: string; data: any }[] = [], calls = new Map<string, string>();
  const seen = new Map<number,string>(); let latest = -1;
  const selected = new Set(['tool/call', 'tool/result', 'job/registered', 'job/settled', 'turn/start', 'turn/end']);
  for (const r of records) {
    if (!selected.has(r.type)) continue;
    if (!Number.isSafeInteger(r.seq) || r.seq < 0) throw new Error('dsh event has no native sequence');
    const fingerprint = canonicalActivity(r);
    if (seen.has(r.seq)) {
      if (seen.get(r.seq) !== fingerprint) throw new Error('dsh native identity names conflicting content');
      continue;
    }
    if (r.seq <= latest) throw new Error('dsh native sequence moved backwards');
    seen.set(r.seq, fingerprint); latest = r.seq;
    const d = r.data ?? {}, common = { native_id: String(r.seq), source_seq: r.seq, source_time: r.time ?? null };
    if (r.type === 'tool/call') {
      if (typeof d.callId !== 'string' || typeof d.name !== 'string') throw new Error('dsh tool event has no call identity');
      calls.set(d.callId, d.name);
      let input = d.arguments;
      if (typeof input === 'string') { try { input = JSON.parse(input); } catch { /* preserve raw content only if selected */ } }
      events.push({kind: 'tool.requested', data: {...common, call_id: d.callId, tool: d.name,
        input: inputSummary(input), ...(options.content ? {detail: input} : {})}});
    } else if (r.type === 'tool/result') {
      const m = d.message, call_id = m?.toolCallId ?? m?.source?.callId;
      if (typeof call_id !== 'string') throw new Error('dsh tool result has no original call identity');
      events.push({kind: 'tool.returned', data: {...common, call_id, tool: calls.get(call_id) ?? null,
        tool_error: m.isError === true, association_missing: !calls.has(call_id),
        source_event_seqs: r.sourceEventSeqs ?? [], ...(options.content ? {detail: m.content} : {})}});
    } else if (r.type.startsWith('job/')) {
      const exit = r.type === 'job/settled' && typeof d.detail === 'string' ? /^exit code: (-?\d+)$/.exec(d.detail) : null;
      events.push({kind: r.type === 'job/settled' ? 'process.settled' : 'process.started', data: {...common,
        call_id: d.toolCall?.callId ?? null, root_call_id: d.toolCall?.rootCallId ?? null,
        job_id: d.jobId, native_status: d.status ?? null, exit_code: exit ? Number(exit[1]) : null,
        exit_basis: exit ? 'dsh-job-detail' : null, started_at: d.startedAt ?? null,
        finished_at: d.finishedAt ?? null, ...(options.content ? {detail: d.detail ?? null} : {})}});
    } else {
      events.push({kind: r.type === 'turn/start' ? 'turn.started' : 'turn.ended', data: {...common, turn: d.turn ?? null, native_reason: d.reason?.kind ?? null}});
    }
  }
  return chained(events, options);
}
