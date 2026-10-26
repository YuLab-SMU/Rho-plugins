import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { normalizeClaude, normalizeDsh, activityNormalizer, type CaptureOptions, type ObservedEvent } from './activity-normalize.js';

export interface SourceOptions extends CaptureOptions {
  producer: 'claude' | 'dsh'; project: string; session: string; source: string;
  dshPackage?: string; compression?: 'zstd' | 'none';
  maxSourceBytes?: number; maxNativeEvents?: number;
}
export interface SourceSnapshot { source: { stream_id: string; producer: string; session_id: string; metadata: any }; events: ObservedEvent[]; pendingTail: boolean }

export async function readActivitySource(options: SourceOptions, streamId: string): Promise<SourceSnapshot> {
  if (!/^[A-Za-z0-9._:@-]{1,128}$/.test(options.session)) throw new Error('Select a valid native session identity');
  const project = await fs.realpath(options.project), source = await fs.realpath(options.source);
  const maxBytes = options.maxSourceBytes ?? 32 * 1024 * 1024, maxEvents = options.maxNativeEvents ?? 32768;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxEvents) || maxEvents < 1) throw new Error('Source read limits must be positive integers');
  for (const n of [options.maxFieldBytes ?? 8192, options.maxEventBytes ?? 32768]) {
    if (!Number.isSafeInteger(n) || n < 1) throw new Error('Capture limits must be positive integers');
  }
  const metadata: any = { normalizer: activityNormalizer, project, source,
    capture: options.content ? 'content' : 'metadata', maxFieldBytes: options.maxFieldBytes ?? 8192,
    maxEventBytes: options.maxEventBytes ?? 32768 };
  let events: ObservedEvent[], pendingTail = false;
  if (options.producer === 'claude') {
    const handle = await fs.open(source, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes) throw new Error('Claude source exceeds maxSourceBytes or is not a regular file');
      metadata.device = stat.dev; metadata.inode = stat.ino;
      // A fixed observed prefix prevents an active writer from extending this read indefinitely.
      const bytes = Buffer.alloc(stat.size); let read = 0;
      while (read < bytes.length) { const chunk = await handle.read(bytes, read, bytes.length - read, read); if (!chunk.bytesRead) throw new Error('Claude source shrank during observation'); read += chunk.bytesRead; }
      const end = bytes.lastIndexOf(10); pendingTail = end !== bytes.length - 1;
      const lines = end < 0 ? [] : bytes.subarray(0, end).toString('utf8').split('\n');
      if (lines.length > maxEvents) throw new Error('Claude source exceeds maxNativeEvents');
      const records = lines.filter(Boolean).map(line => {
        if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('Claude source line exceeds 1 MiB');
        try { return JSON.parse(line); } catch { throw new Error('Claude source contains an invalid complete JSON record'); }
      });
      events = normalizeClaude(records, options.session, project, options);
      const after = await fs.stat(source);
      if (after.ino !== stat.ino || after.dev !== stat.dev || after.size < stat.size) throw new Error('Claude source replaced or truncated during observation');
    } finally { await handle.close(); }
  } else {
    if (!options.dshPackage || !path.isAbsolute(options.dshPackage)) throw new Error('dsh requires the selected installation package.json path');
    const require = createRequire(options.dshPackage);
    const pkg = JSON.parse(await fs.readFile(options.dshPackage, 'utf8'));
    if (pkg.name !== '@deepseek-ai/dsh') throw new Error('Selected package is not dsh');
    metadata.dsh_version = pkg.version; metadata.compression = options.compression ?? 'zstd';
    // Optional peers come from the explicitly selected native installation.
    // Node 22 loads these synchronous ESM modules; no arbitrary module selector.
    const { Context } = require('@deepseek-ai/cordis');
    const session = require('@deepseek-ai/dsh-session');
    const persistence = require('@deepseek-ai/dsh-session-persistence-jsonl');
    const context = new Context();
    try {
      await context.plugin(session.default);
      await context.plugin(persistence, {root: source, compression: metadata.compression});
      const stat = await context.sessionPersistence.stat(options.session);
      if (!stat || typeof stat.sizeBytes !== 'number' || stat.sizeBytes > maxBytes) throw new Error('dsh source is absent or exceeds maxSourceBytes');
      const reader = await context.sessionPersistence.open(options.session, 'read');
      try {
        if (reader.header.id !== options.session || typeof reader.header.cwd !== 'string' || await fs.realpath(reader.header.cwd) !== project) throw new Error('dsh observation does not match selected project/session');
        const {events: native} = await reader.read(0, maxEvents + 1);
        if (native.length > maxEvents) throw new Error('dsh source exceeds maxNativeEvents');
        events = normalizeDsh(native, options);
      } finally { await reader.close(); }
    } finally { await context.fiber.dispose(); }
  }
  return { source: {stream_id: streamId, producer: options.producer, session_id: options.session, metadata}, events, pendingTail };
}
