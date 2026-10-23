import * as fs from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { requireThat } from '@rho-workspace/plugin-contracts';

// Only fingerprints and digests are cached, never file contents or open handles.
// This process-local bound also applies across short-lived project service ports.
const verified = new Map<string, { fingerprint: string; digest: string }>();
const maxVerifiedFiles = 128;
const chunkBytes = 64 * 1024;
const fingerprint = (s: BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');

async function opened(file: string, maximum: number) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat({ bigint: true });
    requireThat(stat.isFile() && stat.size <= BigInt(maximum), 'limit', 'File exceeds the configured byte budget.', { limit: 'maxFileBytes', maximum });
    return { handle, stat, fingerprint: fingerprint(stat) };
  } catch (error) { await handle.close(); throw error; }
}

function remember(file: string, stamp: string, digest: string) {
  verified.delete(file);
  while (verified.size >= maxVerifiedFiles) verified.delete(verified.keys().next().value!);
  verified.set(file, { fingerprint: stamp, digest });
}

async function scan(handle: fs.FileHandle, maximum: number, target?: fs.FileHandle) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(Math.min(chunkBytes, maximum + 1));
  let bytes = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, maximum - bytes + 1), bytes);
    if (!bytesRead) break;
    bytes += bytesRead;
    requireThat(bytes <= maximum, 'limit', 'File grew beyond the configured byte budget.', { limit: 'maxFileBytes', maximum });
    const part = buffer.subarray(0, bytesRead); hash.update(part);
    if (target) {
      let written = 0;
      while (written < bytesRead) {
        const result = await target.write(part, written, bytesRead - written);
        requireThat(result.bytesWritten > 0, 'storage', 'Artifact snapshot write did not advance.');
        written += result.bytesWritten;
      }
    }
  }
  return { digest: hash.digest('hex'), bytes };
}

export async function verifyFile(file: string, maximum: number, expected?: string) {
  const openedFile = await opened(file, maximum);
  try {
    const known = verified.get(file);
    const value = known?.fingerprint === openedFile.fingerprint
      ? { digest: known.digest, bytes: Number(openedFile.stat.size) }
      : await scan(openedFile.handle, maximum);
    requireThat(fingerprint(await openedFile.handle.stat({ bigint: true })) === openedFile.fingerprint, 'stale', 'File changed while its bytes were checked.');
    requireThat(!expected || value.digest === expected, 'stale', 'File bytes differ from the selected resource version.');
    remember(file, openedFile.fingerprint, value.digest);
    return value;
  } finally { await openedFile.handle.close(); }
}

export async function snapshotFile(source: string, directory: string, maximum: number, expected: string) {
  const from = await opened(source, maximum), temporary = path.join(directory, '.partial-' + randomUUID());
  let target: fs.FileHandle | undefined;
  try {
    target = await fs.open(temporary, 'wx', 0o600);
    const value = await scan(from.handle, maximum, target);
    requireThat(value.digest === expected && fingerprint(await from.handle.stat({ bigint: true })) === from.fingerprint, 'stale', 'Source changed while the artifact snapshot was written.');
    await target.sync(); await target.close(); target = undefined;
    await fs.rename(temporary, path.join(directory, expected));
    const durableDirectory = await fs.open(directory, 'r');
    try { await durableDirectory.sync(); } finally { await durableDirectory.close(); }
  } finally { await target?.close(); await from.handle.close(); await fs.rm(temporary, { force: true }); }
}

export async function readRange(file: string, maximum: number, version: string, offset: number, length: number) {
  await verifyFile(file, maximum, version);
  const source = await opened(file, maximum);
  try {
    requireThat(verified.get(file)?.fingerprint === source.fingerprint, 'stale', 'Resource changed before the page was read.');
    const total = Number(source.stat.size);
    requireThat(offset <= total, 'invalid', 'Offset is beyond the resource.');
    const data = Buffer.alloc(Math.min(length, total - offset));
    let used = 0;
    while (used < data.length) {
      const { bytesRead } = await source.handle.read(data, used, data.length - used, offset + used);
      requireThat(bytesRead > 0, 'stale', 'Resource ended before the selected page.');
      used += bytesRead;
    }
    requireThat(fingerprint(await source.handle.stat({ bigint: true })) === source.fingerprint, 'stale', 'Resource changed while the page was read.');
    return { data, total };
  } finally { await source.handle.close(); }
}
