import { objectSchema as obj } from '@rho-workspace/plugin-contracts';
import { cellId, cellSchema, changeId, language, sessionId, sessionSchema } from './contract.js';

// Owner business contracts. Application project/authentication fields are separate.
export const operationContracts = {
  'kernel.run': {
    inputSchema: obj({ language, code: { type: 'string', minLength: 1, maxLength: 65536 }, purpose: { type: 'string', maxLength: 200 }, changeId, waitMs: { type: 'integer', minimum: 0, maximum: 600000 } }, ['language', 'code', 'changeId']),
    outputSchema: obj({ cell: cellSchema, session: sessionSchema }),
    requires: [] as string[], effect: 'native' as const,
  },
  'kernel.read': {
    inputSchema: obj({ limit: { type: 'integer', minimum: 1, maximum: 500 }, cellId }, []),
    outputSchema: obj({ sessions: { type: 'array', items: sessionSchema }, cells: { type: 'array', items: cellSchema }, omitted: { type: 'integer', minimum: 0 } }),
    requires: [] as string[], effect: 'read' as const,
  },
  'kernel.plot': {
    inputSchema: obj({ cellId, plot: { type: 'integer', minimum: 1, maximum: 64 } }),
    outputSchema: obj({ mediaType: { const: 'image/png' }, data: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' } }),
    requires: [] as string[], effect: 'read' as const,
  },
  // Each names what it acts on, so a repeated request never reaches a later cell or session.
  'kernel.interrupt': {
    inputSchema: obj({ cellId }),
    outputSchema: obj({ cell: cellSchema }),
    requires: [] as string[], effect: 'native' as const,
  },
  'kernel.stop': {
    inputSchema: obj({ sessionId }),
    outputSchema: obj({ session: sessionSchema }),
    requires: [] as string[], effect: 'native' as const,
  },
};
