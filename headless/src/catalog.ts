import { objectSchema as obj, refSchema, text, version, requireThat } from './common.js';
import { declarationSchema, type TableFormat } from './declarations.js';
export const componentVersion = '0.2.0';
export const scriptSchema = { oneOf: [
  obj({ kind: { const: 'disk' }, path: text, digest: version }),
  obj({ kind: { const: 'buffer' }, documentId: version, version: { type: 'integer', minimum: 1 } })
] };
export const requirementSchema = obj({ package: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9.]*$' }, source: { enum: ['cran', 'bioconductor'] }, minimumVersion: { type: 'string', pattern: '^[0-9]+([.-][0-9]+)*$' } }, ['package', 'source']);
export const requirementsSchema = { type: 'array', items: requirementSchema, maxItems: 64, uniqueItems: true };
export const executionInputSchema = obj({ script: scriptSchema, args: { type: 'array', maxItems: 64, items: { oneOf: [{ type: 'string', maxLength: 4096 }, obj({ resource: refSchema })] } }, requirements: requirementsSchema, artifacts: { type: 'array', items: declarationSchema, maxItems: 128 }, completion: { anyOf: [text, { type: 'null' }] } });
export const actions = [{ id: 'r.execute', version: componentVersion, owner: 'rho-plugins.r', effects: ['native-execution', 'create-declared-artifacts'], cancellation: 'Core cancellation request; native stop requires observation', inputSchema: executionInputSchema }];
export const components = [
  { id: 'rho.editor', bindings: { document: 'document' } },
  { id: 'rho.table', bindings: { data: 'table' } },
  { id: 'rho.scatter', bindings: { data: 'table' } },
  { id: 'rho.media', bindings: { data: 'media' } },
  { id: 'rho.object', bindings: { data: 'object' } }
].map(c => ({ ...c, version: componentVersion, owner: 'rho-plugins.' + (c.id === 'rho.editor' ? 'documents' : c.id.slice(4)), ui: 'unavailable', propsSchema: c.id === 'rho.scatter' ? obj({ title: text, x: text, y: text }) : obj({ title: text }) }));
// Entry semantics stay with the component owner. The application only routes
// validated, versioned bindings; it does not infer scientific axes or fields.
export function validateComponentBindings(id: string, props: Record<string, unknown>, resources: Record<string, { format?: unknown }>) {
  if (id !== 'rho.scatter') return;
  const f = resources.data?.format as TableFormat | undefined;
  requireThat(f?.key && [props.x, props.y].every(name => f.columns.some(c => c.name === name && c.type === 'number')), 'condition', 'Scatter entries require an explicit entity key and two declared numeric columns.');
}
export const catalog = { version: componentVersion, actions, components, capabilities: ['documents', 'files', 'r-execution', 'requirements', 'tables', 'media', 'charts', 'agent-context'], agent: { id: 'claude-code-mcp', transport: 'stdio', modelLoop: 'external-client', contextDelivery: 'pull-tool-result', proactivePush: 'unsupported' } };
