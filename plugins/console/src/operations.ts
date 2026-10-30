import { objectSchema as obj } from '@rho-workspace/plugin-contracts';
import { changeId, commandId, recordSchema } from './contract.js';

// Owner business contracts. Application project/authentication fields are separate.
export const operationContracts = {
  'console.run': {
    inputSchema: obj({ command: { type: 'string', minLength: 1, maxLength: 4096 }, cwd: { type: 'string', maxLength: 1024 }, changeId }, ['command', 'changeId']),
    outputSchema: obj({ command: recordSchema }),
    requires: [] as string[], effect: 'native' as const,
  },
  'console.list': {
    inputSchema: obj({ limit: { type: 'integer', minimum: 1, maximum: 200 } }, []),
    outputSchema: obj({ commands: { type: 'array', items: recordSchema }, omitted: { type: 'integer', minimum: 0 } }),
    requires: [] as string[], effect: 'read' as const,
  },
  'console.output': {
    inputSchema: obj({ commandId, offset: { type: 'integer', minimum: 0 }, maxBytes: { type: 'integer', minimum: 1, maximum: 65536 } }, ['commandId']),
    outputSchema: obj({ text: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, nextOffset: { type: 'integer', minimum: 0 }, more: { type: 'boolean' }, kept: { type: 'integer', minimum: 0 }, running: { type: 'boolean' } }),
    requires: [] as string[], effect: 'read' as const,
  },
  'console.stop': {
    inputSchema: obj({ commandId, changeId }),
    outputSchema: obj({ command: recordSchema }),
    requires: [] as string[], effect: 'native' as const,
  },
};
