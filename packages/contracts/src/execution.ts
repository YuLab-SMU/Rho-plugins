import { objectSchema as obj, text, version, refSchema } from './common.js';
import { declarationSchema } from './declarations.js';
export const scriptSchema = { oneOf: [
  obj({ kind: { const: 'disk' }, path: text, digest: version }),
  obj({ kind: { const: 'buffer' }, documentId: version, version: { type: 'integer', minimum: 1 } })
] };
import { requirementsSchema } from './requirements.js';
export const executionInputSchema = obj({ script: scriptSchema, args: { type: 'array', maxItems: 64, items: { oneOf: [{ type: 'string', maxLength: 4096 }, obj({ resource: refSchema })] } }, requirements: requirementsSchema, artifacts: { type: 'array', items: declarationSchema, maxItems: 128 }, completion: { anyOf: [text, { type: 'null' }] } });
