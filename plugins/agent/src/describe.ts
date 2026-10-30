import { spawn } from 'node:child_process';
import { visibleError } from './conversation.js';

// One sentence on what a file holds, written by the person's own Claude Code with every tool
// turned off and no session kept: the facts read from the file, its first lines and the
// person's request go in on stdin, and nothing else is given. The protected resources are the
// person's model budget and this process's memory: input and output are bounded, and a call
// past its time is stopped and reported, never retried here.
export const describeLimits = { maxInputBytes: 8192, maxOutputBytes: 65536, timeoutMs: 60000, maxChars: 320, stopGraceMs: 2000 };
export interface DescribeFile {
  binary: string; cwd: string; model?: string | null;
  path: string; facts: string; excerpt: string; request?: string;
  signal?: AbortSignal; limits?: Partial<typeof describeLimits>;
}
export interface FileSentence { text: string; model: string | null; durationMs: number | null; costUsd: number | null }

export const describeInstructions = 'You describe one file of a research project for the person following an Agent\'s work on it. Reply with one plain sentence of at most 30 words saying what the file holds, in the language of the person\'s request. Say only what the facts and lines given show: do not state findings, judge the work or guess what is not shown. No Markdown and no preamble.';

const cut = (text: string, maxBytes: number) => Buffer.byteLength(text) <= maxBytes ? text : Buffer.from(text).subarray(0, maxBytes).toString('utf8').replace(/�+$/, '') + '\n[cut]';
export function describeInput(o: Pick<DescribeFile, 'path' | 'facts' | 'excerpt' | 'request'>, maxBytes = describeLimits.maxInputBytes) {
  const head = [`File: ${o.path}`, `Facts read from the file: ${o.facts}`, ...(o.request ? [`The person's request to the Agent: ${cut(o.request, 1024)}`] : []), 'First lines:'].join('\n');
  return cut(head + '\n' + o.excerpt, maxBytes);
}

export async function describeFile(o: DescribeFile): Promise<FileSentence> {
  const limits = { ...describeLimits, ...o.limits };
  if (o.signal?.aborted) throw new Error('The description was stopped before it started.');
  const args = ['-p', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json', '--system-prompt', describeInstructions, ...(o.model ? ['--model', o.model] : [])];
  const child = spawn(o.binary, args, { cwd: o.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  const kill = (name: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, name); } catch { /* ended */ } };
  let reason: string | null = null, out = Buffer.alloc(0);
  const stop = (why: string) => { reason ??= why; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), limits.stopGraceMs).unref(); };
  const timer = setTimeout(() => stop(`The description took longer than ${Math.round(limits.timeoutMs / 1000)} s and was stopped.`), limits.timeoutMs);
  const abort = () => stop('The description was stopped.');
  o.signal?.addEventListener('abort', abort, { once: true });
  child.stdout.on('data', (chunk: Buffer) => { if (out.length + chunk.length > limits.maxOutputBytes) stop('The description output exceeded maxOutputBytes.'); else out = Buffer.concat([out, chunk]); });
  child.stderr.resume();
  child.stdin.on('error', () => {}); child.stdin.end(describeInput(o, limits.maxInputBytes));
  const end = await new Promise<{ code: number | null; error?: Error }>(resolve => { child.once('error', error => resolve({ code: null, error })); child.once('close', code => resolve({ code })); });
  clearTimeout(timer); o.signal?.removeEventListener('abort', abort);
  if (reason) throw new Error(reason);
  if (end.error) throw new Error(visibleError(end.error));
  let record: any; try { record = JSON.parse(out.toString('utf8')); } catch { throw new Error(`Claude Code ended (exit ${end.code}) without a description.`); }
  if (record?.is_error || typeof record?.result !== 'string') throw new Error(visibleError(new Error(String(record?.result ?? 'Claude Code returned no description.'))));
  const text = record.result.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Claude Code returned an empty description.');
  const models = record.modelUsage && typeof record.modelUsage === 'object' ? Object.keys(record.modelUsage) : [];
  const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
  return { text: text.length > limits.maxChars ? text.slice(0, limits.maxChars - 1).trimEnd() + '…' : text, model: models[0] ?? o.model ?? null, durationMs: number(record.duration_ms), costUsd: number(record.total_cost_usd) };
}
