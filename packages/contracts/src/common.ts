import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class Fault extends Error {
  constructor(public kind: string, message: string, public details: Record<string, unknown> = {}, public status = 409) { super(message); }
}
export function requireThat(condition: unknown, kind: string, message: string, details: Record<string, unknown> = {}): asserts condition {
  if (!condition) throw new Fault(kind, message, details);
}
export const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export const now = () => new Date().toISOString();
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export async function readJson<T>(file: string, fallback?: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e: any) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}
// Acknowledgements follow file fsync, rename and directory fsync. One application
// writer holds the project lease; this is not a second Core execution journal.
export async function atomicJson(file: string, value: unknown) { return atomicBytes(file, JSON.stringify(value) + '\n'); }
export async function atomicBytes(file: string, value: string | Uint8Array) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  const h = await fs.open(tmp, 'wx', 0o600);
  try { await h.writeFile(value); await h.sync(); } finally { await h.close(); }
  try {
    await fs.rename(tmp, file);
    const d = await fs.open(path.dirname(file), 'r');
    try { await d.sync(); } finally { await d.close(); }
  } finally { await fs.rm(tmp, { force: true }); }
}
export async function confined(root: string, relative: string, allowMissing = false): Promise<string> {
  requireThat(typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative) && !relative.includes('\0') && !relative.split(/[\\/]/).some(s => s === '..'), 'scope', 'Use a project-relative path without parent traversal.', { path: relative });
  const base = await fs.realpath(root);
  const parts = relative.split('/').filter(p => p !== '.' && p !== '');
  let current = base;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const st = await fs.lstat(current);
      requireThat(!st.isSymbolicLink(), 'scope', 'Symbolic links are not supported at this boundary.', { path: relative });
    } catch (e: any) { if (!(allowMissing && e.code === 'ENOENT')) throw e; }
  }
  requireThat(current === base || current.startsWith(base + path.sep), 'scope', 'Path is outside the project.');
  return current;
}
export async function stateDirectory(root: string, relative: string) {
  const p = await confined(root, relative, true);
  await fs.mkdir(p, { recursive: true, mode: 0o700 });
  return await confined(root, relative);
}
export async function fileDigest(file: string, maxBytes = 1024 * 1024): Promise<string | null> {
  try { requireThat((await fs.stat(file)).size <= maxBytes, 'limit', 'Disk document exceeds the bounded digest reader; the acknowledged buffer is retained.', { limit: 'maxBufferBytes', maximum: maxBytes }); return digest(await fs.readFile(file)); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
}
export const objectSchema = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
export const text = { type: 'string', minLength: 1 };
export const version = { type: 'string', pattern: '^[a-f0-9]{64}$' };
export const refSchema = objectSchema({ id: text, version });
export interface ResourceRef { id: string; version: string }
