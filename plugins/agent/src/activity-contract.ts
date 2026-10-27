import { objectSchema as obj } from '@rho-workspace/plugin-contracts';
const id = { type: 'string', pattern: '^[A-Za-z0-9._:@-]{1,128}$' };
const count = { type: 'integer', minimum: 0 };
const text = { type: 'string' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const filePath = { type: 'string', minLength: 1, maxLength: 1024 };
const entry = obj({ cursor: count, received_at_ms: count, event: obj({ sequence: count, kind: text, data: { type: 'object' } }) });
const stream = obj({ id, producer: text, sessionId: text, nextCursor: count, retainedFrom: count, droppedEvents: count });
const output = obj({ path: filePath, state: { enum: ['observed', 'symlink-skipped', 'file-byte-limit'] }, bytes: count, sha256: hash, kind_hint: text, observed_at: text, provenance: { const: 'current-filesystem-observation' }, producer_confirmed: { const: false } }, ['path', 'state']);
export const activityOperationContracts = {
  'agent.activity.read': {
    inputSchema: obj({ streamId: id, after: count }, []),
    outputSchema: obj({ streams: { type: 'array', maxItems: 64, items: stream }, page: { anyOf: [{ type: 'null' }, obj({ entries: { type: 'array', maxItems: 128, items: entry }, nextCursor: count, more: { type: 'boolean' }, gap: { type: 'boolean' } })] } }),
    requires: [], effect: 'read' as const,
  },
  'agent.activity.outputs': {
    inputSchema: obj({ directory: filePath }),
    outputSchema: obj({ files: { type: 'array', maxItems: 64, items: output } }),
    requires: [], effect: 'read' as const,
  },
  'agent.activity.capture': {
    inputSchema: obj({ path: filePath, expectedDigest: hash }, ['path']),
    outputSchema: obj({ id: hash, version: hash, kind: text, path: filePath }),
    requires: ['files'], effect: 'metadata' as const,
  },
};
