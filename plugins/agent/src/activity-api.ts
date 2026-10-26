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

// Capture the exact file the person selected. File identity is current observed
// bytes; it is deliberately not attributed to a particular Agent invocation.
export async function captureActivityArtifact(root: string, projectId: string, relative: string, expectedDigest: string,
  files: Pick<ResourceStore, 'restore'> & { validateDeclaration(declaration: Declaration): void }, csvDeclaration?: (data: Buffer, relative: string) => Declaration) {
  publicPath(relative);
  const observations = await inspectActivityArtifacts(root, path.dirname(relative));
  const observed = observations.find(f => f.path === relative && f.state === 'observed');
  requireThat(observed?.sha256 === expectedDigest, 'stale', 'This output changed. Refresh the output list before opening its new version.');
  const handle = await fs.open(path.join(root, relative), constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    requireThat(stat.isFile() && stat.size <= 8 * 1024 * 1024, 'limit', 'Output capture exceeds 8 MiB.');
    const buffer = Buffer.alloc(stat.size + 1); let size = 0;
    while (size < buffer.length) { const r = await handle.read(buffer, size, buffer.length - size, null); if (!r.bytesRead) break; size += r.bytesRead; }
    bytes = buffer.subarray(0, size);
    requireThat(size === stat.size && digest(bytes) === expectedDigest, 'stale', 'This output changed during observation. Refresh before opening.');
  } finally { await handle.close(); }
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
  const id = digest(canonical({ declaration, version: expectedDigest }));
  // Files owns the immutable stored bytes. Its public restore/import primitive
  // creates a resource whose source is that snapshot, so later external edits
  // cannot silently rebind or invalidate a previously opened version.
  const result = await files.restore({ id, version: expectedDigest, projectId, owner: 'rho-plugins.' + declaration.kind, kind: declaration.kind, path: relative, bytes: bytes.length,
    provenance: { source: 'current-filesystem-observation', originalPath: relative, producerConfirmed: false }, coverage: { observedAt: observed.observed_at }, availability: 'available', storage: '', format: declaration.format }, bytes);
  requireThat(result.state === 'available', 'conflict', 'The observed output snapshot conflicts with a retained resource.');
  return { id, version: expectedDigest, kind: declaration.kind, path: relative };
}
