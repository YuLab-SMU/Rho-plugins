import { objectSchema as obj, text, publicResource, requireThat, type ResourceRef, type TableFormat, type TableReader } from '@rho-workspace/plugin-contracts';
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
  const f = resources.data?.format as TableFormat | undefined;
  requireThat(f?.key && [props.x, props.y].every(name => f.columns.some(c => c.name === name && c.type === 'number')), 'condition', 'Scatter entries require an explicit entity key and two declared numeric columns.');
}
export const plugin = { id: 'charts', package: '@rho-workspace/plugin-charts', version: '0.3.0', requires: ['tables'], capabilities: ['charts'], components: [{ id: 'rho.scatter', version: '0.2.0', owner: 'rho-plugins.scatter', bindings: { data: 'table' }, ui: 'unavailable', propsSchema: obj({ title: text, x: text, y: text }) }] };
