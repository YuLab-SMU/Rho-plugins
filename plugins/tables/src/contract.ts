import { objectSchema as obj, text } from '@rho-workspace/plugin-contracts';
export interface Column { name: string; type: 'string' | 'number' | 'boolean'; nullValues: string[] }
export interface TableFormat { encoding: 'csv' | 'json-rows'; columns: Column[]; key: { column: string; namespace: string } | null }
export const columnSchema = obj({ name: text, type: { enum: ['string', 'number', 'boolean'] }, nullValues: { type: 'array', items: { type: 'string' }, maxItems: 16 } });
export const tableFormatSchema = obj({ encoding: { enum: ['csv', 'json-rows'] }, columns: { type: 'array', items: columnSchema, minItems: 1, maxItems: 256 }, key: { anyOf: [obj({ column: text, namespace: text }), { type: 'null' }] } });
export const declarationSchema = obj({ path: text, kind: { const: 'table' }, format: tableFormatSchema });
