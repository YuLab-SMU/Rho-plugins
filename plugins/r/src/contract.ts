import { objectSchema as obj, text, version, refSchema, declarationEnvelopeSchema } from '@rho-workspace/plugin-contracts';
export const scriptSchema = { oneOf: [
  obj({ kind: { const: 'disk' }, path: text, digest: version }),
  obj({ kind: { const: 'buffer' }, documentId: version, version: { type: 'integer', minimum: 1 } })
] };
export const declarationSchema = obj({ path: text, kind: { const: 'object' }, format: obj({ encoding: { const: 'json' }, observation: { const: 'exported-snapshot' }, classes: { type: 'array', items: text, maxItems: 32 } }) });
// Foreign declaration and requirement schemas are supplied by the composition.
// The native owners still validate their data through injected service ports.
export function createExecutionInputSchema(declarationSchema: object = declarationEnvelopeSchema, requirementsSchema: object = { type: 'array', items: { type: 'object' }, maxItems: 64, uniqueItems: true }) {
  return obj({ script: scriptSchema, args: { type: 'array', maxItems: 64, items: { oneOf: [{ type: 'string', maxLength: 4096 }, obj({ resource: refSchema })] } }, requirements: requirementsSchema, artifacts: { type: 'array', items: declarationSchema, maxItems: 128 }, completion: { anyOf: [text, { type: 'null' }] } });
}
