#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import { retainAgentIntent } from './agent-intents.js';
import { Fault } from '@rho-workspace/plugin-contracts';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// The descriptor is provisioned by the local operator, not model/tool arguments.
// It contains a project-scoped credential; stdout is exclusively MCP transport.
const descriptor = process.env.RHO_AGENT_CONNECTION;
if (!descriptor) throw new Error('Set RHO_AGENT_CONNECTION to a private connection file.');
const c = JSON.parse(await fs.readFile(descriptor, 'utf8'));
const endpoint = new URL(c.url);
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') throw new Error('Only the local Rho service is supported.');
async function invoke(method: string, input: Record<string, unknown> = {}) {
  const response = await fetch(new URL('/api/v' + (c.apiVersion ?? '1.0').split('.')[0] + '/' + method, endpoint), { method: 'POST', headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json' }, body: JSON.stringify({ ...input, projectId: c.projectId }), signal: AbortSignal.timeout(30000) });
  return response.json() as Promise<any>;
}
const schema = await invoke('protocol.describe');
if (!schema.ok) throw new Error('Rho protocol is unavailable.');
const allowed: string[] = c.methods;
async function available() {
  const catalog = await invoke('capability.list');
  if (!catalog.ok) throw new Error('Project catalog is unavailable.');
  // A provisioned entry filter can only narrow the authenticated grant. Query
  // every time so a cached tools/list cannot bypass project configuration.
  return allowed.filter(method => {
    const operation = catalog.value.operations?.find((op: any) => op.method === method);
    return operation?.authorized && operation.state === 'available' &&
      (!c.pluginFilter || !operation.owner || c.pluginFilter.includes(operation.owner));
  });
}
const server = new Server({ name: 'rho-project', version: '0.4.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: (await available()).map(method => {
  const source = structuredClone(schema.value.operations[method]);
  delete source.properties.projectId;
  source.required = source.required.filter((p: string) => p !== 'projectId');
  return { name: 'rho_' + method.replaceAll('.', '_'), description: schema.value.descriptions[method] ?? method, inputSchema: source };
}) }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const method = (await available()).find(m => 'rho_' + m.replaceAll('.', '_') === request.params.name);
  if (!method) return { content: [{ type: 'text', text: 'Unsupported project operation.' }], isError: true };
  try {
    await retainAgentIntent(descriptor, c, method, request.params.arguments ?? {}, Number(process.env.RHO_MAX_AGENT_INTENTS ?? 256));
    const result = await invoke(method, request.params.arguments);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: !result.ok };
  } catch (e) {
    if (e instanceof Fault) { const result = { apiVersion: c.apiVersion ?? '1.0', ok: false, error: { kind: e.kind, message: e.message, details: e.details, continuation: 'Observe the original intent and reconcile; do not replace its identity.' } }; return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: true }; }
    return { content: [{ type: 'text', text: 'Delivery is unknown. Query the original operationId; do not mint a replacement.' }], isError: true }; }
});
await server.connect(new StdioServerTransport());
