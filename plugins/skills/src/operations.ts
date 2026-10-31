import { objectSchema as obj } from '@rho-workspace/plugin-contracts';
import { changeId, changeRef, changeSchema, evidenceSchema, limitsSchema, outsideSchema, skillName, skillSchema, skillSummarySchema, version } from './contract.js';

const maybe = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const description = { type: 'string', minLength: 1, maxLength: 1024, pattern: '^[^\\r\\n]*$' };
const reason = { type: 'string', minLength: 1, maxLength: 500 };

// Owner business contracts. Application project/authentication fields are separate.
export const operationContracts = {
  // The project's skills on disk now, and those whose file is gone but whose changes are kept.
  'skills.list': {
    inputSchema: obj({}, []),
    outputSchema: obj({ folder: { type: 'string' }, skills: { type: 'array', items: skillSummarySchema }, removed: { type: 'array', items: skillSummarySchema }, limits: limitsSchema }),
    requires: [] as string[], effect: 'read' as const,
  },
  // One skill's text and its changes, newest first, each with what it added and removed.
  'skills.read': {
    inputSchema: obj({ name: skillName, limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['name']),
    outputSchema: obj({ skill: maybe(skillSchema), changes: { type: 'array', items: changeSchema }, omitted: { type: 'integer', minimum: 0 }, outside: maybe(outsideSchema) }),
    requires: [] as string[], effect: 'read' as const,
  },
  // Writes a skill: a new one (expectedVersion null, with its description), a new text for one,
  // or its removal. expectedVersion is the version read; the same changeId from the same caller
  // returns the same change and never writes twice.
  'skills.change': {
    inputSchema: obj({ name: skillName, description, body: { type: 'string', maxLength: 262144 }, remove: { type: 'boolean' }, reason, evidence: { type: 'array', maxItems: 16, items: evidenceSchema }, expectedVersion: maybe(version), changeId }, ['name', 'reason', 'expectedVersion', 'changeId']),
    outputSchema: obj({ skill: maybe(skillSchema), change: changeSchema }),
    requires: [] as string[], effect: 'file' as const,
  },
  // Puts a skill back as it was before its newest change, when the file is still as that change left it.
  'skills.undo': {
    inputSchema: obj({ name: skillName, change: changeRef, changeId }),
    outputSchema: obj({ skill: maybe(skillSchema), change: changeSchema }),
    requires: [] as string[], effect: 'file' as const,
  },
};
