import * as fs from 'node:fs/promises';
import path from 'node:path';
import { digest, requireThat, stateDirectory, atomicJson } from '@rho-workspace/plugin-contracts';

export const resultLimits = { maxResultBytes: 16 * 1024 * 1024, maxRetainedBytes: 64 * 1024 * 1024, maxResults: 64 };
const bytes = (value: any) => Buffer.byteLength(JSON.stringify(value));
const shape = (value: any) => value === null ? { type: 'null' } : Array.isArray(value) ? { type: 'array', length: value.length }
  : typeof value === 'object' ? { type: 'object', length: Object.keys(value).length }
  : typeof value === 'string' ? { type: 'string', length: value.length, unit: 'utf16' } : { type: typeof value };
const escaped = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');
const splitSurrogate = (s: string, n: number) => n > 0 && n < s.length && /[\uD800-\uDBFF]/.test(s[n - 1]!) && /[\uDC00-\uDFFF]/.test(s[n]!);

// Exact observed replies, scoped to one private connection. This stores no action
// plan and cannot execute or replay anything. Capacity is reserved before a call;
// retained replies are removed only by an explicit release, including after restart.
export class ResultPages {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private root: string, private scope: string, private authorize: (operation: string) => Promise<void>, public limits = resultLimits) {}
  private directory() { return stateDirectory(this.root, '.rho-agent/results/' + this.scope); }
  private serial<T>(run: () => Promise<T>) {
    const next = this.queue.then(run); this.queue = next.catch(() => undefined); return next;
  }
  deliver(operation: string, invoke: () => Promise<any>, maxBytes = 16384) {
    return this.serial(async () => {
      const directory = await this.directory(), names = (await fs.readdir(directory)).filter(n => /^[a-f0-9]{64}\.json$/.test(n));
      let retained = 0;
      for (const name of names) retained += (await fs.stat(path.join(directory, name))).size;
      requireThat(names.length < this.limits.maxResults && retained + this.limits.maxResultBytes <= this.limits.maxRetainedBytes, 'limit', 'Release retained result references before another call. No operation was sent.', { limit: 'agent.results', maximum: this.limits.maxRetainedBytes, retained });
      const result = await invoke();
      if (bytes(result) <= maxBytes) return result;
      const record = { operation, result }, size = bytes(record) + 1, ref = digest(JSON.stringify(record));
      requireThat(size <= this.limits.maxResultBytes, 'limit', 'The operation replied, but its result exceeds the retained-response budget. Observe the original request; do not execute a replacement.', { limit: 'maxResultBytes', maximum: this.limits.maxResultBytes, observedReply: true });
      await atomicJson(path.join(directory, ref + '.json'), record);
      return { apiVersion: result.apiVersion ?? '2.0', ok: result.ok, ...(result.error ? { error: { kind: result.error.kind, message: String(result.error.message).slice(0, 240) } } : {}),
        result: { ref, bytes: size, ...shape(result) }, complete: false };
    });
  }
  async read(input: { ref: string; path?: string; offset?: number; limit?: number; maxBytes?: number; release?: boolean }) {
    requireThat(/^[a-f0-9]{64}$/.test(input.ref), 'invalid', 'Invalid result reference.');
    const file = path.join(await this.directory(), input.ref + '.json');
    let record: { operation: string; result: any };
    try {
      requireThat((await fs.lstat(file)).isFile() && (await fs.stat(file)).size <= this.limits.maxResultBytes, 'limit', 'Retained response exceeds the selected budget.');
      record = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
      requireThat(false, 'not_found', 'This result is unavailable in this connection. Observe the original request; never execute it again to recreate a result reference.');
    }
    requireThat(digest(JSON.stringify(record)) === input.ref, 'condition', 'Retained response integrity changed.');
    if (input.release) { await fs.unlink(file); return { released: input.ref }; }
    await this.authorize(record.operation);
    const pointer = input.path ?? '', offset = input.offset ?? 0, limit = input.limit ?? 20, maxBytes = input.maxBytes ?? 16384;
    requireThat(pointer === '' || pointer.startsWith('/'), 'invalid', 'Select a JSON pointer beginning with /.');
    let value = record.result;
    for (const part of pointer === '' ? [] : pointer.slice(1).split('/')) {
      requireThat(!/~(?![01])/.test(part), 'invalid', 'Invalid JSON pointer escape.');
      const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
      requireThat(value !== null && typeof value === 'object' && Object.hasOwn(value, key), 'not_found', 'Result field is unavailable.'); value = value[key];
    }
    const result: any = { ref: input.ref, path: pointer, ...shape(value), offset, next: null, complete: true };
    const fits = (candidate: any) => bytes(candidate) + 64 <= maxBytes;
    if (typeof value === 'string') {
      requireThat(offset <= value.length && !splitSurrogate(value, offset), 'invalid', 'Text offset must lie on a Unicode character boundary.');
      let lo = offset, hi = Math.min(value.length, offset + maxBytes);
      while (lo < hi) { const end = Math.ceil((lo + hi) / 2); if (fits({ ...result, value: value.slice(offset, end), next: end, complete: false })) lo = end; else hi = end - 1; }
      if (splitSurrogate(value, lo)) lo--;
      requireThat(lo > offset || offset === value.length, 'limit', 'A character cannot fit this result page.');
      result.value = value.slice(offset, lo); result.complete = lo === value.length; result.next = result.complete ? null : lo;
    } else if (value !== null && typeof value === 'object') {
      const keys = Object.keys(value); requireThat(offset <= keys.length, 'invalid', 'Result offset is beyond the container.'); result.entries = [];
      for (const key of keys.slice(offset, offset + limit)) {
        const child = value[key], entry: any = { key, path: pointer + '/' + escaped(key), ...shape(child) };
        if (bytes(child) <= 512) entry.value = child;
        const trial = { ...result, entries: [...result.entries, entry], next: offset + result.entries.length + 1, complete: false };
        if (!fits(trial)) break;
        result.entries.push(entry);
      }
      result.complete = offset + result.entries.length === keys.length; result.next = result.complete ? null : offset + result.entries.length;
      requireThat(result.complete || result.entries.length > 0, 'limit', 'A result field cannot fit this page.');
    } else { requireThat(offset === 0, 'invalid', 'A scalar has no offset.'); result.value = value; }
    requireThat(fits(result), 'limit', 'Result page exceeds maxBytes.');
    return result;
  }
}
