import fs, { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { externalSessionId, type ExternalSessionSummary, type ExternalTool, type ExternalTurn } from './external-session.js';

// The sessions an Agent keeps in its own files for one folder, wherever they were started: a
// terminal, an editor, its own app or Rho. The Agent's own files and session id are the record;
// nothing is copied, started or changed by reading them. Each read is bounded.
export const nativeSessionLimits = {
  maxSessions: 64, maxScanFiles: 4096, maxHeadBytes: 262144, maxTailBytes: 262144, maxReadBytes: 268435456,
  maxTurns: 200, maxTools: 256, maxTextChars: 32768, maxDetailChars: 8192,
  // A session written to this recently, with its last turn unfinished, is taken as still working.
  activeMs: 60000
};
export type NativeProducer = 'claude-code' | 'codex';
export interface NativeSessionSources { claudeConfigDir?: string; codexHome?: string }
export interface NativeSessionSummary extends ExternalSessionSummary {
  producer: NativeProducer;
  // Where the session was started, in the Agent's own record (Terminal, VS Code, Codex app…).
  where: string;
  // A live process of the Agent holds this session open now.
  open: { where: string; since?: string; pid?: number } | null;
  // The command that continues this session in a terminal, in its folder.
  resume: string;
  bytes: number;
}

const home = () => os.homedir();
export function nativeSources(env: NodeJS.ProcessEnv = process.env): Required<NativeSessionSources> {
  return { claudeConfigDir: env.CLAUDE_CONFIG_DIR || path.join(home(), '.claude'), codexHome: env.CODEX_HOME || path.join(home(), '.codex') };
}
const quote = (value: string) => process.platform === 'win32' ? '"' + value.replace(/"/g, '""') + '"' : "'" + value.replace(/'/g, "'\\''") + "'";
const resumeCommand = (producer: NativeProducer, root: string, sessionId: string) =>
  (process.platform === 'win32' ? 'cd /d ' : 'cd ') + quote(root) + ' && ' + (producer === 'claude-code' ? 'claude --resume ' : 'codex resume ') + sessionId;
const cut = (text: string, max: number) => text.length <= max ? text : text.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, '') + '…';
const realpath = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

// Up to `max` bytes from the start or the end of a file, as whole lines.
function readLines(file: string, from: 'head' | 'tail', max: number) {
  const fd = fs.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const size = fs.fstatSync(fd).size, length = Math.min(size, max), start = from === 'head' ? 0 : size - length;
    const buffer = Buffer.alloc(length), n = fs.readSync(fd, buffer, 0, length, start);
    let lines = buffer.subarray(0, n).toString('utf8').split('\n');
    // A cut line at either end is dropped rather than misread.
    if (from === 'tail' && start > 0) lines = lines.slice(1);
    if (from === 'head' && length < size) lines = lines.slice(0, -1);
    return { lines: lines.filter(Boolean), truncated: length < size, size };
  } finally { fs.closeSync(fd); }
}
function parse(line: string): any { try { return JSON.parse(line); } catch { return null; } }
// A file read as a stream into `reader`, so a long session neither holds the service nor its
// memory; only the last `max` bytes of a larger file.
async function streamInto(file: string, max: number, reader: TurnReader) {
  const size = fs.statSync(file).size, start = Math.max(0, size - max);
  const input = fs.createReadStream(file, { fd: fs.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW), start, autoClose: true });
  let skip = start > 0;
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (skip) { skip = false; continue; }
    if (line) reader.push(line);
  }
  return { turns: reader.finish(), truncated: start > 0 };
}

// ——— Claude Code ———
// Claude Code keeps a folder's sessions under projects/<the folder path with every character
// other than a letter or digit replaced by '-'>. Long paths are shortened, and different folders
// can share a name, so each session's own cwd decides.
function claudeFolders(configDir: string, root: string) {
  const projects = path.join(configDir, 'projects'), names = new Set<string>();
  for (const candidate of new Set([root, realpath(root)])) {
    const name = candidate.replace(/[^a-zA-Z0-9]/g, '-');
    if (name.length <= 200) names.add(name);
    else try { for (const entry of fs.readdirSync(projects)) if (entry.startsWith(name.slice(0, 200))) names.add(entry); } catch { /* No projects folder yet. */ }
  }
  return [...names].map(name => path.join(projects, name)).filter(dir => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } });
}
const claudeWhere: Record<string, string> = { cli: 'Terminal', 'sdk-ts': 'Agent app', 'sdk-py': 'Agent app', 'sdk-cli': 'Script', 'claude-vscode': 'VS Code', 'claude-desktop': 'Claude app', 'claude-jetbrains': 'JetBrains', remote: 'Claude on the web' };
// A human prompt, not a tool result, an injected reminder or a local command's output.
function claudePrompt(record: any): string | null {
  if (record.type !== 'user' || record.isMeta || record.isSidechain || record.isCompactSummary || record.isVisibleInTranscriptOnly) return null;
  const content = record.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) && !content.some((b: any) => b?.type === 'tool_result')
    ? content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n') : null;
  if (text === null) return null;
  const trimmed = text.trim();
  if (!trimmed || /^<(local-command-stdout|local-command-stderr|local-command-caveat|system-reminder|task-notification)/.test(trimmed)) return null;
  const command = /^<command-name>([^<]*)<\/command-name>/.exec(trimmed) ?? /<command-name>([^<]*)<\/command-name>/.exec(trimmed);
  if (command) { const args = /<command-args>([^<]*)<\/command-args>/.exec(trimmed)?.[1]?.trim(); return (command[1] ?? '').trim() + (args ? ' ' + args : ''); }
  return trimmed;
}
const interrupted = (record: any) => record.type === 'user' && JSON.stringify(record.message?.content ?? '').includes('[Request interrupted by user');
function toolDetail(input: any, max: number) {
  if (!input || typeof input !== 'object') return '';
  for (const key of ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'query', 'url', 'operation', 'description', 'prompt']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return cut(value.trim(), max);
  }
  return cut(JSON.stringify(input), max);
}
function toolPaths(input: any) {
  return ['file_path', 'notebook_path', 'path'].map(key => input?.[key]).filter((v): v is string => typeof v === 'string' && v.length < 4096).slice(0, 32);
}
function resultText(content: unknown, max: number): string {
  if (typeof content === 'string') return cut(content, max);
  if (Array.isArray(content)) return cut(content.map(b => typeof b === 'string' ? b : b?.type === 'text' ? b.text : b?.type === 'image' ? '[image]' : '').filter(Boolean).join('\n'), max);
  return '';
}

interface Builder { turns: ExternalTurn[]; texts: Map<ExternalTurn, Array<{ at: string; text: string; afterTool: boolean }>>; omittedChars: number; ended: Set<ExternalTurn> }
function newBuilder(): Builder { return { turns: [], texts: new Map(), omittedChars: 0, ended: new Set() }; }
function startTurn(b: Builder, id: string, at: string, prompt: string) {
  const turn: ExternalTurn = { id, at, state: 'unknown', prompt: cut(prompt, nativeSessionLimits.maxTextChars), reply: '', messages: [], tools: [], results: [], omittedTools: 0, omittedChars: prompt.length > nativeSessionLimits.maxTextChars ? 1 : 0 };
  b.turns.push(turn); b.texts.set(turn, []);
  if (b.turns.length > nativeSessionLimits.maxTurns) { const dropped = b.turns.shift()!; b.texts.delete(dropped); b.ended.delete(dropped); }
  return turn;
}
function addText(b: Builder, turn: ExternalTurn, at: string, text: string) {
  if (!text.trim()) return;
  turn.endedAt = at;
  b.texts.get(turn)!.push({ at, text, afterTool: false });
}
function addTool(turn: ExternalTurn, tool: ExternalTool, b: Builder) {
  turn.endedAt = tool.at;
  for (const t of b.texts.get(turn)!) t.afterTool = true;
  if (turn.tools.length >= nativeSessionLimits.maxTools) { turn.omittedTools++; return; }
  turn.tools.push(tool);
}
// The words after the last tool are the answer; earlier words are what the Agent said on the way.
function finish(b: Builder, lastWrite: number, now: number): ExternalTurn[] {
  const recent = now - lastWrite < nativeSessionLimits.activeMs;
  return b.turns.map((turn, index) => {
    const texts = b.texts.get(turn)!, answer = texts.filter(t => !t.afterTool), along = texts.filter(t => t.afterTool);
    const reply = answer.map(t => t.text).join('\n\n').trim();
    const replyCut = cut(reply, nativeSessionLimits.maxTextChars);
    const last = index === b.turns.length - 1, pending = turn.tools.some(t => t.outcome === 'requested');
    let state: ExternalTurn['state'] = turn.state;
    if (state === 'unknown') state = b.ended.has(turn) || (!last && reply) || (last && reply && !pending && !recent) ? 'completed' : last && recent ? 'running' : reply && !pending ? 'completed' : 'unknown';
    const tools = state === 'running' ? turn.tools : turn.tools.map(t => t.outcome === 'requested' ? { ...t, outcome: 'unknown' as const } : t);
    return { ...turn, state, tools, reply: replyCut, messages: along.slice(-200).map(t => ({ at: t.at, text: cut(t.text, nativeSessionLimits.maxTextChars) })),
      omittedChars: turn.omittedChars + (reply.length > replyCut.length ? 1 : 0) };
  });
}

interface TurnReader { push(line: string): void; finish(): ExternalTurn[] }
const readAll = (reader: TurnReader, lines: string[]) => { for (const line of lines) reader.push(line); return reader.finish(); };
function claudeTurns(lines: string[], lastWrite: number, now: number) { return readAll(claudeReader(lastWrite, now), lines); }
function claudeReader(lastWrite: number, now: number): TurnReader {
  const b = newBuilder(), tools = new Map<string, ExternalTool>();
  let current: ExternalTurn | null = null;
  return { finish: () => finish(b, lastWrite, now), push(line: string) {
    const r = parse(line);
    if (!r || (r.type !== 'user' && r.type !== 'assistant') || r.isSidechain) return;
    const at = typeof r.timestamp === 'string' ? r.timestamp : new Date(lastWrite).toISOString();
    const prompt = claudePrompt(r);
    if (prompt !== null) { current = startTurn(b, typeof r.uuid === 'string' ? r.uuid : 'turn-' + b.turns.length, at, prompt); if (typeof r.entrypoint === 'string') current.where = claudeWhere[r.entrypoint] ?? r.entrypoint; return; }
    if (!current) return;
    if (interrupted(r)) { current.state = 'stopped'; current.endedAt = at; return; }
    const content = Array.isArray(r.message?.content) ? r.message.content : [];
    for (const block of content) {
      if (r.type === 'assistant' && block?.type === 'text' && typeof block.text === 'string') addText(b, current, at, block.text);
      else if (r.type === 'assistant' && block?.type === 'tool_use' && typeof block.id === 'string') {
        const tool: ExternalTool = { id: block.id, at, name: String(block.name ?? 'tool').slice(0, 256), detail: toolDetail(block.input, nativeSessionLimits.maxDetailChars), output: '', outcome: 'requested', paths: toolPaths(block.input) };
        tools.set(block.id, tool); addTool(current, tool, b);
      } else if (r.type === 'user' && block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        const tool = tools.get(block.tool_use_id);
        if (tool) { tool.outcome = block.is_error ? 'failed' : 'returned'; tool.output = resultText(block.content, nativeSessionLimits.maxDetailChars); current.endedAt = at; }
      }
    }
    if (r.type === 'assistant' && r.message?.stop_reason === 'end_turn') b.ended.add(current);
  } };
}

interface Live { pid: number; sessionId: string; where: string; since?: string }
// Claude Code names each live process and the session it holds in sessions/<pid>.json.
function claudeLive(configDir: string): Map<string, Live> {
  const live = new Map<string, Live>(), dir = path.join(configDir, 'sessions');
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter(n => /^\d+\.json$/.test(n)).slice(0, 256); } catch { return live; }
  for (const name of names) {
    try {
      const file = path.join(dir, name), stat = fs.statSync(file);
      if (stat.size > 65536) continue;
      const v = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Number.isSafeInteger(v.pid) || v.pid <= 0 || typeof v.sessionId !== 'string') continue;
      try { process.kill(v.pid, 0); } catch (e: any) { if (e.code !== 'EPERM') continue; }
      live.set(v.sessionId, { pid: v.pid, sessionId: v.sessionId, where: claudeWhere[v.entrypoint] ?? 'another window', ...(Number.isFinite(v.startedAt) ? { since: new Date(v.startedAt).toISOString() } : {}) });
    } catch { /* A file being written is read next time. */ }
  }
  return live;
}

// ——— Codex ———
const codexWhere = (originator: unknown) => {
  const o = String(originator ?? '');
  return /cli/i.test(o) ? 'Terminal' : /desktop/i.test(o) ? 'Codex app' : /vscode/i.test(o) ? 'VS Code' : /acp/i.test(o) ? 'Agent app' : o || 'Codex';
};
// The person's request inside a message that also lists attachments or context.
function codexRequest(text: string) {
  const marker = text.lastIndexOf('## My request:');
  const value = (marker >= 0 ? text.slice(marker + '## My request:'.length) : text).trim();
  if (!value || /^<(environment_context|user_instructions|external_[a-z_]+|turn_aborted)/.test(value) || value.startsWith('# AGENTS.md instructions')) return null;
  return value;
}
function codexTurns(lines: string[], lastWrite: number, now: number) { return readAll(codexReader(lastWrite, now), lines); }
function codexReader(lastWrite: number, now: number): TurnReader {
  const b = newBuilder(), calls = new Map<string, ExternalTool>();
  let current: ExternalTurn | null = null, modern = false;
  const text = (content: any) => Array.isArray(content) ? content.map((c: any) => typeof c?.text === 'string' ? c.text : '').join('\n') : typeof content === 'string' ? content : '';
  return { finish: () => finish(b, lastWrite, now), push(line: string) {
    const r = parse(line), p = r?.payload;
    if (!r || !p) return;
    const at = typeof r.timestamp === 'string' ? r.timestamp : new Date(lastWrite).toISOString();
    if (r.type === 'event_msg' && p.type === 'item_completed' && p.item) {
      modern = true;
      const item = p.item;
      if (item.type === 'UserMessage') { const request = codexRequest(text(item.content)); if (request) current = startTurn(b, String(p.turn_id ?? item.id), at, request); return; }
      if (!current) return;
      if (item.type === 'AgentMessage') addText(b, current, at, text(item.content));
      else if (item.type === 'CommandExecution') {
        const command = Array.isArray(item.command) ? String(item.command.at(-1) ?? '') : String(item.command ?? '');
        addTool(current, { id: String(item.id), at, name: 'Command', detail: cut(command, nativeSessionLimits.maxDetailChars), output: cut(String(item.aggregated_output ?? ''), nativeSessionLimits.maxDetailChars),
          outcome: item.status === 'completed' ? (Number.isInteger(item.exit_code) && item.exit_code !== 0 ? 'failed' : 'returned') : item.status === 'failed' ? 'failed' : 'requested', ...(Number.isInteger(item.exit_code) ? { exitCode: item.exit_code } : {}), paths: [] }, b);
      } else if (item.type === 'FileChange') {
        const paths = Object.keys(item.changes ?? {}).slice(0, 32);
        addTool(current, { id: String(item.id), at, name: 'Edit', detail: cut(paths.join('\n'), nativeSessionLimits.maxDetailChars), output: '', outcome: item.status === 'failed' ? 'failed' : 'returned', paths }, b);
      } else if (item.type === 'McpToolCall') {
        addTool(current, { id: String(item.id), at, name: [item.server, item.tool].filter(Boolean).join('.') || 'MCP tool', detail: toolDetail(item.arguments, nativeSessionLimits.maxDetailChars), output: '', outcome: item.status === 'failed' ? 'failed' : 'returned', paths: [] }, b);
      } else if (item.type === 'WebSearch' || item.type === 'ImageView') {
        addTool(current, { id: String(item.id), at, name: item.type === 'WebSearch' ? 'Web search' : 'View image', detail: cut(String(item.query ?? item.path ?? ''), nativeSessionLimits.maxDetailChars), output: '', outcome: 'returned', paths: [] }, b);
      }
      return;
    }
    if (r.type === 'event_msg' && (p.type === 'task_complete' || p.type === 'turn_aborted')) {
      if (current) { if (p.type === 'turn_aborted') current.state = 'stopped'; else b.ended.add(current); current.endedAt = at; }
      return;
    }
    if (modern) return;
    // The earlier rollout format: messages as events, tools as response items.
    if (r.type === 'event_msg' && p.type === 'user_message' && typeof p.message === 'string') { const request = codexRequest(p.message); if (request) current = startTurn(b, 'turn-' + b.turns.length + '-' + at, at, request); }
    else if (!current) return;
    else if (r.type === 'event_msg' && p.type === 'agent_message' && typeof p.message === 'string') addText(b, current, at, p.message);
    else if (r.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call') && typeof p.call_id === 'string') {
      let input: any = p.input ?? p.arguments; try { if (typeof input === 'string' && input.startsWith('{')) input = JSON.parse(input); } catch { /* Kept as text. */ }
      const tool: ExternalTool = { id: p.call_id, at, name: String(p.name ?? 'tool'), detail: typeof input === 'string' ? cut(input, nativeSessionLimits.maxDetailChars) : toolDetail(input, nativeSessionLimits.maxDetailChars), output: '', outcome: 'requested', paths: [] };
      calls.set(p.call_id, tool); addTool(current, tool, b);
    } else if (r.type === 'response_item' && (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && calls.has(p.call_id)) {
      const tool = calls.get(p.call_id)!; tool.outcome = 'returned'; tool.output = resultText(typeof p.output === 'string' ? p.output : p.output, nativeSessionLimits.maxDetailChars);
    }
  } };
}
// Codex holds thread-writer-locks/<id>.lock while a thread is open for writing.
function codexOpen(codexHome: string, sessionId: string) {
  try { return fs.statSync(path.join(codexHome, 'thread-writer-locks', sessionId.toLowerCase() + '.lock')).isFile(); } catch { return false; }
}
function* codexFiles(codexHome: string) {
  // Newest days first; each day's rollouts newest first.
  const sessions = path.join(codexHome, 'sessions'), sorted = (dir: string) => { try { return fs.readdirSync(dir).sort().reverse(); } catch { return []; } };
  for (const year of sorted(sessions)) for (const month of sorted(path.join(sessions, year))) for (const day of sorted(path.join(sessions, year, month)))
    for (const name of sorted(path.join(sessions, year, month, day))) if (/^rollout-.*\.jsonl$/.test(name)) yield path.join(sessions, year, month, day, name);
}

// ——— Listing and reading ———
interface Found { producer: NativeProducer; sessionId: string; file: string; summary: NativeSessionSummary }
const cache = new Map<string, { key: string; value: Omit<NativeSessionSummary, 'open' | 'observedAt' | 'state'> & { unfinished: boolean } | null }>();
const titleOf = (...candidates: Array<string | null | undefined>) => cut((candidates.find(c => c && c.trim()) ?? 'Untitled session').replace(/\s+/g, ' ').trim(), 200);

function claudeSummary(file: string, root: string) {
  const stat = fs.statSync(file), key = stat.size + ':' + stat.mtimeMs, kept = cache.get(file);
  if (kept?.key === key) return kept.value;
  const head = readLines(file, 'head', nativeSessionLimits.maxHeadBytes), tail = head.truncated ? readLines(file, 'tail', nativeSessionLimits.maxTailBytes) : head;
  let cwd = '', entrypoint = '', created = '', first: string | null = null, sessionId = path.basename(file, '.jsonl');
  for (const line of head.lines) {
    const r = parse(line); if (!r) continue;
    if (!cwd && typeof r.cwd === 'string') cwd = r.cwd;
    if (!entrypoint && typeof r.entrypoint === 'string') entrypoint = r.entrypoint;
    if (!created && typeof r.timestamp === 'string') created = r.timestamp;
    if (first === null) first = claudePrompt(r);
    if (cwd && entrypoint && created && first !== null) break;
  }
  let custom = '', ai = '', summaryText = '', lastPrompt = '';
  for (const line of tail.lines) {
    const r = parse(line); if (!r) continue;
    if (r.type === 'custom-title' && typeof r.customTitle === 'string') custom = r.customTitle;
    else if (r.type === 'ai-title' && typeof r.aiTitle === 'string') ai = r.aiTitle;
    else if (r.type === 'summary' && typeof r.summary === 'string') summaryText = r.summary;
    else if (r.type === 'last-prompt' && typeof r.lastPrompt === 'string') lastPrompt = r.lastPrompt;
  }
  // A transcript with no human prompt (a probe, or settings only) is not a conversation.
  const turns = claudeTurns(tail.lines, stat.mtimeMs, Date.now());
  // Unfinished: the last message is a prompt, a tool call or a tool result, not a final answer.
  let unfinished = false;
  for (let i = tail.lines.length - 1; i >= 0; i--) {
    const r = parse(tail.lines[i]!);
    if (!r || (r.type !== 'user' && r.type !== 'assistant') || r.isSidechain || r.isMeta) continue;
    unfinished = r.type === 'user' ? !interrupted(r) : r.message?.stop_reason !== 'end_turn';
    break;
  }
  const value = (!cwd || realpath(cwd) !== root || (first === null && !turns.length)) ? null : {
    id: externalSessionId('claude-code', sessionId), producer: 'claude-code' as const, sessionId, title: titleOf(custom, ai, summaryText, first, lastPrompt),
    lastAt: new Date(stat.mtimeMs).toISOString(), turns: turns.length, sourceCursor: stat.size, omittedTurns: tail.truncated ? 1 : 0,
    where: claudeWhere[entrypoint] ?? (entrypoint || 'Claude Code'), resume: resumeCommand('claude-code', root, sessionId), bytes: stat.size,
    unfinished
  };
  cache.set(file, { key, value });
  if (cache.size > 4096) cache.delete(cache.keys().next().value!);
  return value;
}
function codexSummary(file: string, root: string) {
  const stat = fs.statSync(file), key = stat.size + ':' + stat.mtimeMs, kept = cache.get(file);
  if (kept?.key === key) return kept.value;
  const head = readLines(file, 'head', nativeSessionLimits.maxHeadBytes);
  const meta = head.lines.length ? parse(head.lines[0]!) : null, p = meta?.type === 'session_meta' ? meta.payload : null;
  let value: (Omit<NativeSessionSummary, 'open' | 'observedAt' | 'state'> & { unfinished: boolean }) | null = null;
  if (p && typeof p.id === 'string' && typeof p.cwd === 'string' && realpath(p.cwd) === root) {
    const tail = head.truncated ? readLines(file, 'tail', nativeSessionLimits.maxTailBytes) : head;
    const firstTurns = codexTurns(head.lines, stat.mtimeMs, Date.now()), turns = head.truncated ? codexTurns(tail.lines, stat.mtimeMs, Date.now()) : firstTurns;
    let unfinished = false;
    for (let i = tail.lines.length - 1; i >= 0; i--) {
      const q = parse(tail.lines[i]!)?.payload;
      if (q?.type === 'task_complete' || q?.type === 'turn_aborted') break;
      if (q?.type === 'task_started') { unfinished = true; break; }
    }
    if (firstTurns.length || turns.length) value = {
      id: externalSessionId('codex', p.id), producer: 'codex', sessionId: p.id, title: titleOf(firstTurns[0]?.prompt, turns[0]?.prompt),
      lastAt: new Date(stat.mtimeMs).toISOString(), turns: turns.length, sourceCursor: stat.size, omittedTurns: head.truncated ? 1 : 0,
      where: codexWhere(p.originator), resume: resumeCommand('codex', root, p.id), bytes: stat.size, unfinished
    };
  }
  cache.set(file, { key, value });
  return value;
}

function find(root: string, sources: Required<NativeSessionSources>) {
  root = realpath(root);
  const now = Date.now(), found: Found[] = []; let omitted = 0;
  const live = claudeLive(sources.claudeConfigDir);
  const add = (producer: NativeProducer, file: string, value: ReturnType<typeof claudeSummary>, open: NativeSessionSummary['open']) => {
    if (!value) return;
    const { unfinished, ...rest } = value;
    const active = unfinished && now - Date.parse(value.lastAt) < nativeSessionLimits.activeMs;
    found.push({ producer, sessionId: value.sessionId, file, summary: { ...rest, observedAt: new Date(now).toISOString(), open, state: active ? 'running' : 'completed' } });
  };
  for (const dir of claudeFolders(sources.claudeConfigDir, root)) {
    let names: string[] = [];
    try { names = fs.readdirSync(dir).filter(n => /^[0-9a-f-]{36}\.jsonl$/i.test(n)); } catch { continue; }
    if (names.length > nativeSessionLimits.maxScanFiles) { omitted += names.length - nativeSessionLimits.maxScanFiles; names = names.slice(0, nativeSessionLimits.maxScanFiles); }
    for (const name of names) {
      const file = path.join(dir, name);
      try { const value = claudeSummary(file, root); const holder = value && live.get(value.sessionId); add('claude-code', file, value, holder ? { where: holder.where, pid: holder.pid, ...(holder.since ? { since: holder.since } : {}) } : null); }
      catch { omitted++; }
    }
  }
  let scanned = 0;
  for (const file of codexFiles(sources.codexHome)) {
    if (++scanned > nativeSessionLimits.maxScanFiles) { omitted++; break; }
    try { const value = codexSummary(file, root); add('codex', file, value, value && codexOpen(sources.codexHome, value.sessionId) ? { where: 'Codex' } : null); }
    catch { omitted++; }
  }
  found.sort((a, b) => b.summary.lastAt.localeCompare(a.summary.lastAt));
  if (found.length > nativeSessionLimits.maxSessions) { omitted += found.length - nativeSessionLimits.maxSessions; found.length = nativeSessionLimits.maxSessions; }
  return { found, omitted };
}

/** The Agents' own sessions whose working folder is `root`, newest first. Reads files only. */
export function listNativeSessions(root: string, sources: NativeSessionSources = {}) {
  const { found, omitted } = find(root, { ...nativeSources(), ...sources });
  return { sessions: found.map(f => f.summary), omitted };
}
/** One session's turns, read through its file (its last maxReadBytes when larger). */
export async function readNativeSession(root: string, input: { session: string; before?: number; limit?: number }, sources: NativeSessionSources = {}) {
  const { found } = find(root, { ...nativeSources(), ...sources });
  const hit = found.find(f => f.summary.id === input.session || f.sessionId === input.session);
  if (!hit) return null;
  const stat = fs.statSync(hit.file), now = Date.now();
  const body = await streamInto(hit.file, nativeSessionLimits.maxReadBytes, hit.producer === 'claude-code' ? claudeReader(stat.mtimeMs, now) : codexReader(stat.mtimeMs, now)), turns = body.turns;
  const end = Math.min(turns.length, input.before ?? turns.length), first = Math.max(0, end - Math.min(50, Math.max(1, input.limit ?? 20)));
  return { session: { ...hit.summary, turns: turns.length, omittedTurns: body.truncated ? 1 : 0 }, first, turns: turns.slice(first, end) };
}
/** Whether `sessionId` names a session of this Agent in `root`, and its summary. */
export function nativeSession(root: string, producer: NativeProducer, sessionId: string, sources: NativeSessionSources = {}) {
  return find(root, { ...nativeSources(), ...sources }).found.find(f => f.producer === producer && f.sessionId === sessionId)?.summary ?? null;
}
