import { objectSchema as obj, text, requireThat } from './common.js';
export interface Column { name: string; type: 'string' | 'number' | 'boolean'; nullValues: string[] }
export interface TableFormat { encoding: 'csv' | 'json-rows'; columns: Column[]; key: { column: string; namespace: string } | null }
export interface Declaration { path: string; kind: 'file' | 'table' | 'media' | 'object'; format: Record<string, any> | TableFormat }
export const columnSchema = obj({ name: text, type: { enum: ['string', 'number', 'boolean'] }, nullValues: { type: 'array', items: { type: 'string' }, maxItems: 16 } });
export const tableFormatSchema = obj({ encoding: { enum: ['csv', 'json-rows'] }, columns: { type: 'array', items: columnSchema, minItems: 1, maxItems: 256 }, key: { anyOf: [obj({ column: text, namespace: text }), { type: 'null' }] } });
export const declarationSchema = { oneOf: [
  obj({ path: text, kind: { const: 'file' }, format: obj({ mimeType: text }) }),
  obj({ path: text, kind: { const: 'table' }, format: tableFormatSchema }),
  obj({ path: text, kind: { const: 'media' }, format: obj({ mimeType: { enum: ['image/png', 'image/jpeg', 'image/svg+xml', 'application/pdf'] }, pages: { type: 'integer', minimum: 1 }, width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 } }, ['mimeType']) }),
  obj({ path: text, kind: { const: 'object' }, format: obj({ encoding: { const: 'json' }, observation: { const: 'exported-snapshot' }, classes: { type: 'array', items: text, maxItems: 32 } }) })
] };
export function validateDeclaration(d: Declaration) {
  requireThat(d && ['file', 'table', 'media', 'object'].includes(d.kind) && d.format && typeof d.path === 'string', 'invalid', 'An explicit resource declaration is required.');
  requireThat(d.path.length > 0 && !d.path.includes('\\') && !d.path.startsWith('/') && !/^[A-Za-z]:/.test(d.path) && !d.path.split('/').some(p => ['', '.', '..'].includes(p)), 'scope', 'Declared artifact paths must stay inside their selected output directory.');
}
