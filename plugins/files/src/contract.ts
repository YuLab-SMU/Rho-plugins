import { objectSchema as obj, text } from '@rho-workspace/plugin-contracts';
export const declarationSchema = obj({ path: text, kind: { const: 'file' }, format: obj({ mimeType: text }) });
