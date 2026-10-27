import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sessionFileLimits = { maxFiles: 16, maxFileBytes: 2 * 1024 * 1024 };
export interface SessionFile {
  path: string; state: 'observed' | 'missing' | 'unavailable' | 'changed' | 'file-byte-limit';
  observedAt: string; bytes?: number; sha256?: string;
  references: Array<{ session: string; tool: string }>;
}
/** Tool locations are references, not evidence of authorship. Inspect current
 * bytes separately, without walking the project or following links. */
export async function observeSessionFiles(root: string, references: Array<{ path: string; session: string; tool: string }>, limits = sessionFileLimits) {
  for (const n of Object.values(limits)) if (!Number.isSafeInteger(n) || n < 1) throw new Error('File observation limits must be positive integers');
  root = await fs.realpath(root);
  const selected = new Map<string, SessionFile['references']>(); let omitted = 0;
  for (const ref of references) {
    const relative = path.relative(root, path.resolve(root, ref.path));
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || relative.split(path.sep).some(p => ['..', '.rho', '.git'].includes(p))) { omitted++; continue; }
    if (!selected.has(relative)) {
      if (selected.size >= limits.maxFiles) { omitted++; continue; }
      selected.set(relative, []);
    }
    const links = selected.get(relative)!;
    if (!links.some(l => l.session === ref.session && l.tool === ref.tool)) {
      if (links.length < 32) links.push({ session: ref.session, tool: ref.tool }); else omitted++;
    }
  }
  const files: SessionFile[] = [];
  for (const [relative, references] of selected) {
    const file: SessionFile = { path: relative, state: 'unavailable', observedAt: new Date().toISOString(), references };
    const absolute = path.join(root, relative);
    try {
      if (await fs.realpath(absolute) !== absolute) { files.push(file); continue; }
      const handle = await fs.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = await handle.stat();
        if (!before.isFile()) { files.push(file); continue; }
        if (before.size > limits.maxFileBytes) { file.state = 'file-byte-limit'; files.push(file); continue; }
        const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let bytes = 0;
        for (;;) { const r = await handle.read(buffer, 0, buffer.length, null); if (!r.bytesRead) break; bytes += r.bytesRead; if (bytes > limits.maxFileBytes) break; hash.update(buffer.subarray(0, r.bytesRead)); }
        const after = await handle.stat(), current = await fs.lstat(absolute);
        if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.ino !== before.ino || current.dev !== before.dev || !current.isFile() || await fs.realpath(absolute) !== absolute) file.state = 'changed';
        else Object.assign(file, { state: 'observed', bytes, sha256: hash.digest('hex') });
      } finally { await handle.close(); }
    } catch (error: any) { file.state = error.code === 'ENOENT' ? 'missing' : 'unavailable'; }
    files.push(file);
  }
  return { files, omitted };
}
