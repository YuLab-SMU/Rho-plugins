import { objectSchema as obj } from '@rho-workspace/plugin-contracts';
import { cellId, cellSchema, changeId, copySchema, inspectStates, language, objectSchema, placeCheckSchema, placeId, placeInput, placeRef, placesSchema, remoteEntrySchema, server, serverSkillTextSchema, serversSchema, sessionId, sessionSchema, sortInput } from './contract.js';

// Owner business contracts. Application project/authentication fields are separate.
export const operationContracts = {
  // place names where a session that is not live yet starts ("local" is this machine); a cell
  // naming another place than the live session's is refused.
  'kernel.run': {
    inputSchema: obj({ language, code: { type: 'string', minLength: 1, maxLength: 65536 }, purpose: { type: 'string', maxLength: 200 }, changeId, waitMs: { type: 'integer', minimum: 0, maximum: 600000 }, place: placeRef }, ['language', 'code', 'changeId']),
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
  // Reads one value without changing it. It never starts a session and waits for no cell: while
  // one runs or waits, the answer is busy. path names parts by their index among the parts a
  // reading listed; offset, limit and sort choose the page of rows, elements or parts.
  'kernel.inspect': {
    inputSchema: obj({ language, name: { type: 'string', minLength: 1, maxLength: 256 }, path: { type: 'array', items: { type: 'integer', minimum: 0 }, maxItems: 16 }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 }, sort: sortInput }, ['language', 'name']),
    outputSchema: obj({ state: { enum: [...inspectStates] }, sessionId: { anyOf: [sessionId, { type: 'null' }] }, afterCell: { type: 'integer', minimum: 0 }, readAt: { type: 'string', minLength: 1 }, problem: { anyOf: [{ type: 'string' }, { type: 'null' }] }, object: { anyOf: [objectSchema, { type: 'null' }] } }),
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
  'kernel.places': {
    inputSchema: obj({}, []),
    outputSchema: placesSchema,
    requires: [] as string[], effect: 'read' as const,
  },
  // Names a place (or renames, moves or changes its setup), removes one, or chooses where each
  // language's next session starts.
  'kernel.place.set': {
    inputSchema: { ...obj({ place: placeInput, remove: placeId, use: obj({ r: placeRef, python: placeRef }, []) }, []), minProperties: 1 },
    outputSchema: placesSchema,
    requires: [] as string[], effect: 'metadata' as const,
  },
  'kernel.place.check': {
    inputSchema: obj({ placeId }),
    outputSchema: obj({ placeId, check: placeCheckSchema }),
    requires: [] as string[], effect: 'native' as const,
  },
  // path is a folder within the place's folder ("" for the folder itself).
  'kernel.place.list': {
    inputSchema: obj({ placeId, path: { type: 'string', maxLength: 1024 } }, ['placeId']),
    outputSchema: obj({ placeId, path: { type: 'string' }, readAt: { type: 'string', minLength: 1 }, folder: { type: 'string' }, entries: { type: 'array', items: remoteEntrySchema }, omitted: { type: 'integer', minimum: 0 }, cut: { type: 'boolean' } }),
    requires: [] as string[], effect: 'read' as const,
  },
  'kernel.place.copy': {
    inputSchema: obj({ placeId, path: { type: 'string', minLength: 1, maxLength: 1024 } }),
    outputSchema: obj({ copy: copySchema }),
    requires: [] as string[], effect: 'file' as const,
  },
  // The servers serverctl manages and the skills bound to each, read from its registry now; no
  // server is connected to.
  'kernel.servers': {
    inputSchema: obj({}, []),
    outputSchema: serversSchema,
    requires: [] as string[], effect: 'read' as const,
  },
  // One skill bound to a server, as its file reads now. A server whose skills serverctl cannot
  // all resolve gives none: its guidance is not taken in part.
  'kernel.server.skill': {
    inputSchema: obj({ server, name: { type: 'string', minLength: 1, maxLength: 128 } }),
    outputSchema: serverSkillTextSchema,
    requires: [] as string[], effect: 'read' as const,
  },
};
