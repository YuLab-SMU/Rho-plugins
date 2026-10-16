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
  if (d.kind === 'table') {
    const f = d.format as TableFormat;
    requireThat(['csv', 'json-rows'].includes(f.encoding) && Array.isArray(f.columns) && f.columns.length > 0 && f.columns.length <= 256, 'invalid', 'Declare a supported table encoding and columns.');
    requireThat(new Set(f.columns.map(c => c.name)).size === f.columns.length && f.columns.every(c => c.name && ['string', 'number', 'boolean'].includes(c.type) && Array.isArray(c.nullValues) && c.nullValues.length <= 16 && c.nullValues.every(n => typeof n === 'string')), 'invalid', 'Column names, types and null encodings must be explicit and unique.');
    requireThat(f.key === null || f.key?.namespace && f.columns.some(c => c.name === f.key!.column && c.type === 'string'), 'invalid', 'Entity keys require a declared string column and namespace.');
  } else if (d.kind === 'object') requireThat(d.format.encoding === 'json' && (d.format as any).observation === 'exported-snapshot' && Array.isArray((d.format as any).classes), 'invalid', 'Objects must be explicit exported JSON snapshots.');
  else {
    requireThat(typeof (d.format as any).mimeType === 'string' && (d.format as any).mimeType.length > 0, 'invalid', 'Declare the original media type.');
    if (d.kind === 'media') {
      const f = d.format as any;
      requireThat(['image/png', 'image/jpeg', 'image/svg+xml', 'application/pdf'].includes(f.mimeType) && (f.pages === undefined || Number.isSafeInteger(f.pages) && f.pages > 0) && ['width', 'height'].every(k => f[k] === undefined || Number.isFinite(f[k]) && f[k] > 0), 'invalid', 'Media dimensions and page counts must be finite positive declarations.');
    }
  }
}
