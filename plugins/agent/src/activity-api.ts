import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { canonical, digest, requireThat, type Declaration, type ResourceStore } from '@rho-workspace/plugin-contracts';
import { inspectActivityArtifacts } from './activity-artifacts.js';

// Rho injects its scoped, asynchronous public Core CLI transport. Reads never
// start a Host, collector or Agent; there is no second activity journal here.
export async function readAgentActivity(call: (method: string, args?: string[]) => Promise<any>, streamId?: string, after = 0) {
  const { streams: retained } = await call('activity-list');
  requireThat(retained.length <= 64, 'limit', 'The activity view supports at most 64 retained streams. Core history is unchanged.');
  const streams = retained.filter((s: any) => ['claude', 'dsh'].includes(s.source.producer) && s.source.metadata?.normalizer === 'rho-agent-activity/1').map((s: any) => ({
    id: s.source.stream_id, producer: s.source.producer, sessionId: s.source.session_id,
    nextCursor: s.next_sequence, retainedFrom: s.retained_from, droppedEvents: s.dropped_events,
  }));
  if (!streamId) return { streams, page: null };
  requireThat(streams.some((s: any) => s.id === streamId), 'not_found', 'This activity stream is not available in the selected project.');
  const p = await call('activity-read', ['--id', streamId, '--after', String(after), '--limit', '128', '--max-bytes', '262144']);
  return { streams, page: { entries: p.entries, nextCursor: p.next_cursor, more: p.more, gap: p.gap } };
}

function publicPath(relative: string) {
  requireThat(!path.isAbsolute(relative) && !relative.split(/[\\/]/).some(p => ['..', '.rho', '.git'].includes(p)), 'scope', 'Choose an output inside the project, outside internal state.');
}
export async function activityOutputs(root: string, directory: string) {
  publicPath(directory);
  try { return { files: await inspectActivityArtifacts(root, directory) }; }
  catch (e: any) { if (e.code === 'ENOENT') return { files: [] }; throw e; }
}

// Capture one CSV or image file in the project as an immutable Files snapshot. File
// identity is the bytes observed now; it is deliberately not attributed to a particular
// Agent invocation. Only that one file is observed: a regular file inside the project,
// reached without symlinks. With an expected digest the capture is of that exact version
// and a changed file is refused; without one it is of the current bytes.
export async function captureActivityArtifact(root: string, projectId: string, relative: string, expectedDigest: string | undefined,
  files: Pick<ResourceStore, 'restore'> & { validateDeclaration(declaration: Declaration): void; captureBytes?: (data: Uint8Array, declaration: Declaration, source: Record<string, unknown>, expectedDigest?: string) => Promise<any> }, csvDeclaration?: (data: Buffer, relative: string) => Declaration) {
  publicPath(relative);
  const base = await fs.realpath(root), file = path.resolve(base, relative);
  const inside = path.relative(base, file);
  requireThat(inside !== '' && !inside.startsWith('..' + path.sep) && inside !== '..' && !path.isAbsolute(inside), 'scope', 'Choose an output inside the project, outside internal state.');
  const real = await fs.realpath(file).catch((e: any) => { requireThat(e.code !== 'ENOENT', 'not_found', 'This file is not in the project any more.'); throw e; });
  requireThat(real === file, 'scope', 'Files reached through a symlink are not opened.');
  const observedAt = new Date().toISOString();
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    requireThat(stat.isFile(), 'invalid', 'Only a regular file can be opened.');
    requireThat(stat.size <= 8 * 1024 * 1024, 'limit', 'Output capture exceeds 8 MiB.');
    const buffer = Buffer.alloc(stat.size + 1); let size = 0;
    while (size < buffer.length) { const r = await handle.read(buffer, size, buffer.length - size, null); if (!r.bytesRead) break; size += r.bytesRead; }
    bytes = buffer.subarray(0, size);
    requireThat(size === stat.size, 'stale', 'This output changed during observation. Refresh before opening.');
  } finally { await handle.close(); }
  const version = digest(bytes);
  requireThat(expectedDigest === undefined || version === expectedDigest, 'stale', 'This output changed. Refresh the output list before opening its new version.');
  const ext = path.extname(relative).toLowerCase();
  const mime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };
  let declaration: Declaration;
  if (ext === '.csv') {
    requireThat(csvDeclaration, 'unavailable', 'The Tables plugin is needed to open this CSV.');
    declaration = csvDeclaration(bytes, relative);
  } else {
    requireThat(mime[ext], 'unavailable', 'Activity previews support CSV, PNG, JPEG and SVG. Open other formats in a compatible viewer.');
    declaration = { path: relative, kind: 'media', format: { mimeType: mime[ext] } };
  }
  files.validateDeclaration(declaration);
  if (files.captureBytes) {
    const captured = await files.captureBytes(bytes, declaration, { kind: 'disk', path: relative }, expectedDigest);
    return { id: captured.id, version: captured.version, kind: captured.kind, path: relative };
  }
  const id = digest(canonical({ declaration, version }));
  // Files owns the immutable stored bytes. Its public restore/import primitive
  // creates a resource whose source is that snapshot, so later external edits
  // cannot silently rebind or invalidate a previously opened version.
  const result = await files.restore({ id, version, projectId, owner: 'rho-plugins.' + declaration.kind, kind: declaration.kind, path: relative, bytes: bytes.length,
    provenance: { source: 'current-filesystem-observation', originalPath: relative, producerConfirmed: false }, coverage: { observedAt }, availability: 'available', storage: '', format: declaration.format }, bytes);
  requireThat(result.state === 'available', 'conflict', 'The observed output snapshot conflicts with a retained resource.');
  return { id, version, kind: declaration.kind, path: relative };
}
