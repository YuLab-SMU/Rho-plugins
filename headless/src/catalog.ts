import { objectSchema, refSchema, text, version } from './common.js';
export const componentVersion = '0.1.0';
export const scriptSchema = { oneOf: [
  objectSchema({ kind: { const: 'disk' }, path: text, digest: { type: 'string', pattern: '^[a-f0-9]{64}$' } }),
  objectSchema({ kind: { const: 'buffer' }, documentId: version, version: { type: 'integer', minimum: 1 } })
] };
export const actions = [
  { id: 'airway.analyze', version: componentVersion, owner: 'rho-plugins.airway', effects: ['native-execution', 'create-artifacts'], cancellation: 'Core cancellation request; native stop requires observation', inputSchema: objectSchema({ bootstrapReplicates: { type: 'integer', minimum: 1, maximum: 1000 }, script: scriptSchema }, ['bootstrapReplicates']), packages: ['DESeq2', 'airway', 'SummarizedExperiment', 'jsonlite', 'digest'] },
  { id: 'airway.shrink', version: componentVersion, owner: 'rho-plugins.airway', effects: ['native-execution', 'create-artifacts'], cancellation: 'Core cancellation request; native stop requires observation', inputSchema: objectSchema({ model: refSchema, baseline: refSchema }), packages: ['DESeq2', 'apeglm', 'jsonlite', 'digest'] }
];
export const components = [
  { id: 'rho.editor', version: componentVersion, owner: 'rho-plugins.documents', ui: 'unavailable', propsSchema: objectSchema({ title: text }), bindings: { document: 'document' } },
  { id: 'rho.table', version: componentVersion, owner: 'rho-plugins.data', ui: 'unavailable', propsSchema: objectSchema({ title: text }), bindings: { data: 'table' } },
  { id: 'rho.scatter', version: componentVersion, owner: 'rho-plugins.data', ui: 'unavailable', propsSchema: objectSchema({ title: text }), bindings: { data: 'table' } },
  { id: 'rho.comparison', version: componentVersion, owner: 'rho-plugins.data', ui: 'unavailable', propsSchema: objectSchema({ title: text }), bindings: { baseline: 'table', shrinkage: 'table' } }
];
export const catalog = { version: componentVersion, actions: actions.map(a => ({ ...a, requirements: { status: 'unchecked', scope: 'selected action in the authenticated project' } })), components, agent: { id: 'claude-code-mcp', transport: 'stdio', modelLoop: 'external-client', contextDelivery: 'pull-tool-result', proactivePush: 'unsupported' } };
