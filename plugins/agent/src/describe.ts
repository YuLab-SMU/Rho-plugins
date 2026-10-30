import { spawn } from 'node:child_process';
import { visibleError } from './conversation.js';
import type { Tokens } from './models.js';

// One sentence on what a file holds, written by the person's own Claude Code with every tool
// turned off and no session kept. It is given the path, facts the caller read from the file and
// the person's request, and one of: the file's first lines (text), the image itself (image), or
// what made the file, such as the code that wrote it (context), for a figure whose model does
// not take images. Nothing else is given. The protected resources are the person's model
// budget and this process's memory: input, image, output and time are bounded, and a call past
// its time is stopped and reported, never retried here.
export const describeLimits = { maxInputBytes: 8192, maxImageBytes: 3.5 * 1024 * 1024, maxOutputBytes: 262144, timeoutMs: 60000, maxChars: 320, stopGraceMs: 2000 };
export type DescribeStrategy = 'text' | 'image' | 'context';
export interface DescribeFile {
  binary: string; cwd: string; model?: string | null;
  path: string; facts: string; request?: string; strategy?: DescribeStrategy;
  // text: the first lines; context: what made the file.
  excerpt?: string; context?: string;
  image?: { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: Buffer };
  signal?: AbortSignal; limits?: Partial<typeof describeLimits>;
}
export interface FileSentence {
  text: string; model: string | null; durationMs: number | null;
  // Claude Code's figure and its basis ("list" when it knows the model's price, "unknown"
  // when it guessed), and the tokens it reports.
  costUsd: number | null; costBasis: string | null; tokens: Tokens | null;
}

const common = 'You describe one file of a research project for the person following an Agent\'s work on it. Reply with one plain sentence of at most 30 words, in the language of the person\'s request. No Markdown and no preamble.';
export const describeInstructions: Record<DescribeStrategy, string> = {
  text: common + ' Say what the file holds. Say only what the facts and lines given show: do not state findings, judge the work or guess what is not shown.',
  image: common + ' You are shown the figure. Say what it plots: the kind of chart, its axes and what is compared. Use the labels as written; do not state findings that are not labelled in it.',
  context: common + ' You are not shown the figure itself, only the code and words that made it. Say what it plots according to them, as a plan rather than a sight: do not claim to have seen it and do not state findings.',
};

const cut = (text: string, maxBytes: number) => Buffer.byteLength(text) <= maxBytes ? text : Buffer.from(text).subarray(0, maxBytes).toString('utf8').replace(/�+$/, '') + '\n[cut]';
export function describeInput(o: Pick<DescribeFile, 'path' | 'facts' | 'excerpt' | 'context' | 'request' | 'strategy'>, maxBytes = describeLimits.maxInputBytes) {
  const strategy = o.strategy ?? 'text';
  const head = [`File: ${o.path}`, `Facts read from the file: ${o.facts}`, ...(o.request ? [`The person's request to the Agent: ${cut(o.request, 1024)}`] : [])].join('\n');
  const body = strategy === 'text' ? 'First lines:\n' + (o.excerpt ?? '') : strategy === 'context' ? 'What made it:\n' + (o.context ?? '') : 'The figure is attached.';
  return cut(head + '\n' + body, maxBytes);
}

export async function describeFile(o: DescribeFile): Promise<FileSentence> {
  const limits = { ...describeLimits, ...o.limits }, strategy = o.strategy ?? 'text';
  if (o.signal?.aborted) throw new Error('The description was stopped before it started.');
  if (strategy === 'image') {
    if (!o.image) throw new Error('No image was given to describe.');
    if (o.image.data.length > limits.maxImageBytes) throw new Error('The image is larger than maxImageBytes.');
  }
  const content: unknown[] = [
    ...(strategy === 'image' ? [{ type: 'image', source: { type: 'base64', media_type: o.image!.mediaType, data: o.image!.data.toString('base64') } }] : []),
    { type: 'text', text: describeInput(o, limits.maxInputBytes) },
  ];
  const args = ['-p', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--system-prompt', describeInstructions[strategy], ...(o.model ? ['--model', o.model] : [])];
  const child = spawn(o.binary, args, { cwd: o.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  const kill = (name: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, name); } catch { /* ended */ } };
  let reason: string | null = null, out = Buffer.alloc(0);
  const stop = (why: string) => { reason ??= why; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), limits.stopGraceMs).unref(); };
  const timer = setTimeout(() => stop(`The description took longer than ${Math.round(limits.timeoutMs / 1000)} s and was stopped.`), limits.timeoutMs);
  const abort = () => stop('The description was stopped.');
  o.signal?.addEventListener('abort', abort, { once: true });
  child.stdout.on('data', (chunk: Buffer) => { if (out.length + chunk.length > limits.maxOutputBytes) stop('The description output exceeded maxOutputBytes.'); else out = Buffer.concat([out, chunk]); });
  child.stderr.resume();
  child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
  const end = await new Promise<{ code: number | null; error?: Error }>(resolve => { child.once('error', error => resolve({ code: null, error })); child.once('close', code => resolve({ code })); });
  clearTimeout(timer); o.signal?.removeEventListener('abort', abort);
  if (reason) throw new Error(reason);
  if (end.error) throw new Error(visibleError(end.error));
  // The last result record of the stream.
  let record: any = null;
  for (const line of out.toString('utf8').split('\n')) { try { const value = JSON.parse(line); if (value?.type === 'result') record = value; } catch { /* another record or a partial line */ } }
  if (!record) throw new Error(`Claude Code ended (exit ${end.code}) without a description.`);
  if (record.is_error || typeof record.result !== 'string') throw new Error(visibleError(new Error(String(record.result ?? 'Claude Code returned no description.'))));
  const text = record.result.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Claude Code returned an empty description.');
  const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const usage = record.modelUsage && typeof record.modelUsage === 'object' ? Object.entries(record.modelUsage as Record<string, any>) : [];
  const [model, used] = usage[0] ?? [o.model ?? null, null];
  const tokens: Tokens | null = used ? { input: number(used.inputTokens) ?? 0, output: number(used.outputTokens) ?? 0, cacheRead: number(used.cacheReadInputTokens) ?? 0, cacheWrite: number(used.cacheCreationInputTokens) ?? 0 } : null;
  return { text: text.length > limits.maxChars ? text.slice(0, limits.maxChars - 1).trimEnd() + '…' : text, model, durationMs: number(record.duration_ms),
    costUsd: number(used?.costUSD) ?? number(record.total_cost_usd), costBasis: typeof used?.costBasis === 'string' ? used.costBasis : null, tokens };
}
