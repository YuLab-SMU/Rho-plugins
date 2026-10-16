import { objectSchema as obj, text, requireThat } from './common.js';
export interface Declaration { path: string; kind: string; format: Record<string, any> }
export const declarationEnvelopeSchema = obj({ path: text, kind: text, format: { type: 'object' } });
export function validateDeclarationEnvelope(d: Declaration) {
  requireThat(d && typeof d.kind === 'string' && d.kind.length > 0 && d.format && typeof d.format === 'object' && !Array.isArray(d.format) && typeof d.path === 'string', 'invalid', 'An explicit resource declaration is required.');
  requireThat(d.path.length > 0 && !d.path.includes('\\') && !d.path.startsWith('/') && !/^[A-Za-z]:/.test(d.path) && !d.path.split('/').some(p => ['', '.', '..'].includes(p)), 'scope', 'Declared artifact paths must stay inside their selected output directory.');
}
