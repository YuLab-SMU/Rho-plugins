import { objectSchema as obj, timelineContract } from '@rho-workspace/plugin-contracts';
import { changeId, commandId, recordSchema, terminalId, terminalSchema, terminalSize } from './contract.js';

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
  // Who ran each command and when, for a timeline: the newest first, without output.
  'console.events': { ...timelineContract },
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
  // The person's own shell on a pseudo-terminal, in the project folder. All of these are the
  // person's alone, the reads too: what is typed and printed in a terminal is not an Agent's.
  'console.terminal.open': {
    inputSchema: obj({ ...terminalSize, cwd: { type: 'string', maxLength: 1024 } }, ['cols', 'rows']),
    outputSchema: obj({ terminal: terminalSchema }),
    requires: [] as string[], effect: 'native' as const,
  },
  'console.terminal.list': {
    inputSchema: obj({}, []),
    outputSchema: obj({ terminals: { type: 'array', items: terminalSchema } }),
    requires: [] as string[], effect: 'read' as const,
  },
  // Output after an offset, as base64 of the bytes printed; with nothing new it waits up to
  // waitMs. `dropped` counts bytes asked for that are no longer kept.
  'console.terminal.read': {
    inputSchema: obj({ terminalId, after: { type: 'integer', minimum: 0 }, waitMs: { type: 'integer', minimum: 0, maximum: 25000 }, maxBytes: { type: 'integer', minimum: 1, maximum: 262144 } }, ['terminalId']),
    outputSchema: obj({ data: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, nextOffset: { type: 'integer', minimum: 0 }, dropped: { type: 'integer', minimum: 0 }, more: { type: 'boolean' }, terminal: terminalSchema }),
    requires: [] as string[], effect: 'read' as const,
  },
  'console.terminal.write': {
    inputSchema: obj({ terminalId, data: { type: 'string', minLength: 1, maxLength: 65536 } }),
    outputSchema: obj({ terminalId, bytes: { type: 'integer', minimum: 0 } }),
    requires: [] as string[], effect: 'native' as const,
  },
  'console.terminal.resize': {
    inputSchema: obj({ terminalId, ...terminalSize }),
    outputSchema: obj({ terminal: terminalSchema }),
    requires: [] as string[], effect: 'native' as const,
  },
  'console.terminal.close': {
    inputSchema: obj({ terminalId }),
    outputSchema: obj({ terminal: terminalSchema }),
    requires: [] as string[], effect: 'native' as const,
  },
};
