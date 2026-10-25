import { skillPresentation, presentation, operationPresentation, viewPresentation } from './presentation.js';
import { operationContracts } from './operations.js';
import { objectSchema as obj, text, publicResource, requireThat, type ResourceRef, type TableReader, digest } from '@rho-workspace/plugin-contracts';

const declaredSkill = (id: string, content: string, version = '1.0') => ({ id, version, content, digest: digest(content) });
export const chartLimits = { maxPoints: 20000 };
export class Charts {
  limits: typeof chartLimits;
  constructor(public tables: TableReader, limits: Partial<typeof chartLimits> = {}) { this.limits = { ...chartLimits, ...limits }; }
  async plot(ref: ResourceRef, x: string, y: string, maxPoints = this.limits.maxPoints) {
    requireThat(Number.isSafeInteger(maxPoints) && maxPoints > 0 && maxPoints <= this.limits.maxPoints, 'limit', 'Plot request exceeds the point budget.', { limit: 'maxPoints', maximum: this.limits.maxPoints });
    const table = await this.tables.rows(ref);
    requireThat(table.entityKey, 'condition', 'Entity interaction requires an explicit unique key and namespace.');
    requireThat([x, y].every(name => table.columns.some(c => c.name === name && c.type === 'number')), 'invalid', 'Declare numeric scatter coordinate fields.');
    const stride = Math.max(1, Math.ceil(table.rows.length / maxPoints));
    return { resource: publicResource(table.resource), spec: { type: 'scatter', entityKey: table.entityKey, namespace: table.namespace, x, y, missing: 'null' }, points: table.rows.filter((_, i) => i % stride === 0).map(r => ({ key: r[table.entityKey!], x: r[x], y: r[y] })), originalPoints: table.rows.length, downsampled: stride > 1, method: stride > 1 ? 'deterministic-stride' : 'none' };
  }
}
export function validateComponentBindings(id: string, props: Record<string, unknown>, resources: Record<string, { format?: unknown }>) {
  if (id !== 'rho.scatter') return;
  const f = resources.data?.format as { key?: unknown; columns: { name: string; type: string }[] } | undefined;
  requireThat(f?.key && [props.x, props.y].every(name => f.columns.some(c => c.name === name && c.type === 'number')), 'condition', 'Scatter entries require an explicit entity key and two declared numeric columns.');
}
const chartsSkillContent = [
  'Plot two declared numeric columns from one immutable table version.',
  'Use capability.list to discover data.plot.',
  '',
  '1. Bind the exact {id, version} of a registered table. The plot reports the resource it',
  '   read, so a chart never drifts from the bytes behind it.',
  '2. Both coordinates must be declared numeric columns. The table must have an entity key',
  '   and namespace, because each point carries its key.',
  '3. A point budget downsamples with a deterministic stride; the reply says so and reports',
  '   originalPoints, so a sparse chart is never mistaken for sparse data.',
  '4. Plotting reads only. It runs no code and changes no resource; if the file changed, the',
  '   version is stale instead of silently mixing two states.'
].join('\n');
const chartsSkill = {
  ...declaredSkill('charts.workspace', chartsSkillContent, '1.1'),
  intent: 'Plot two numeric columns of one table version, bounded and reproducible.',
  requires: ['data.plot', 'data.page', 'resource.register'],
  example: {
    method: 'data.plot',
    input: { resource: { id: '4702434457c0465d6dfbb54793b62d327c9aa4f419be2f5fc6cf92c6918eeaf1', version: '3f9d2b0e1a4c5f6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5' }, x: 'value', y: 'value', maxPoints: 1000 }
  },
  failureRecipes: [
    { kind: 'condition', message: 'Entity interaction requires an explicit unique key and namespace.', next: 'Register the table with a key column and namespace before plotting it.' },
    { kind: 'invalid', message: 'Declare numeric scatter coordinate fields.', next: 'Name two columns declared as number; a string column cannot be a coordinate.' },
    { kind: 'stale', message: 'Resource version changed.', next: 'Re-register the current bytes and plot the new version.' },
    { kind: 'limit', message: 'Plot request exceeds the point budget.', next: 'Lower maxPoints or accept the deterministic downsample the reply reports.' }
  ],
  verify: { command: 'npm run test:charts', description: 'A plot names the exact table version it read, downsamples to the point budget, and a changed file makes the version stale.' }
};
export const plugin = { entryVersion: '1.0', id: 'charts', package: '@rho-workspace/plugin-charts', version: '0.4.0', requires: ['tables'], capabilities: ['charts'], presentation,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })), skills: [{ ...chartsSkill, presentation: skillPresentation }],
  components: [{ id: 'rho.scatter', version: '0.2.0', owner: 'rho-plugins.scatter', bindings: { data: 'table' }, ui: './ui', presentation: viewPresentation, propsSchema: obj({ title: text, x: text, y: text }) }] };
