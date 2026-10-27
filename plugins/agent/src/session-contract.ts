// Pure contract entry: usable without loading an Agent runtime.
import { objectSchema as obj } from '@rho-workspace/plugin-contracts';
const text = { type: 'string' }, count = { type: 'integer', minimum: 0 };
const stamp = { at: text, origin: { enum: ['initial', 'history', 'live'] } };
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
export const sessionObservationSchema = obj({
  source: { const: 'acp' }, sessionId: text, sequence: count, at: text, connected: { type: 'boolean' }, updates: count, historyUpdates: count, omitted: count, unrepresented: count,
  plan: nullable(obj({ ...stamp, entries: { type: 'array', maxItems: 64, items: obj({ content: text, status: { enum: ['pending', 'in_progress', 'completed'] }, priority: { enum: ['high', 'medium', 'low'] } }) }, omitted: count })),
  usage: nullable(obj({ ...stamp, used: count, size: count, cost: nullable(obj({ amount: { type: 'number' }, currency: text })) }, ['at', 'origin', 'used', 'size'])),
  info: nullable(obj({ ...stamp, title: nullable(text), updatedAt: nullable(text) }, ['at', 'origin'])),
  tools: { type: 'array', maxItems: 64, items: obj({ ...stamp, id: text, tool: text, operation: text, outcome: { enum: ['requested', 'returned', 'rejected', 'unknown'] }, locations: { type: 'array', maxItems: 16, items: obj({ path: text, line: count }, ['path']) } }, ['at', 'origin', 'id', 'locations']) }
});
