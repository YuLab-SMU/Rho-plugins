#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import { retainAgentIntent } from './agent-intents.js';
import { layeredSchemas } from './layered-contract.js';
import { LayeredMcp } from './layered.js';
import { Ajv } from 'ajv';
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
async function invoke(method: string, input: Record<string, unknown> = {}, contractRef?: string) {
  const response = await fetch(new URL('/api/v' + (c.apiVersion ?? '1.0').split('.')[0] + '/' + method, endpoint), { method: 'POST', headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json', ...(contractRef ? { 'x-rho-contract-ref': contractRef } : {}) }, body: JSON.stringify({ ...input, projectId: c.projectId }), signal: AbortSignal.timeout(30000) });
  return response.json() as Promise<any>;
}
const layered = c.profile ? new LayeredMcp(c, { invoke, retain: (method, input) => retainAgentIntent(descriptor, c, method, input, Number(process.env.RHO_MAX_AGENT_INTENTS ?? 256)) }, Number(process.env.RHO_KNOWLEDGE_CACHE_ENTRIES ?? 128), Number(process.env.RHO_KNOWLEDGE_CACHE_BYTES ?? 4194304)) : null;
const schema = layered ? null : await invoke('protocol.describe');
if (!layered && !schema.ok) throw new Error('Rho protocol is unavailable.');
const layerValidator = new Ajv({ strict: false });
const layerTools = [{ name: 'rho_index', description: 'Read a small index of operations for this assigned role. Start here; maxBytes is at most 65536.', inputSchema: layeredSchemas.McpIndexInput }, { name: 'rho_resolve', description: 'Fetch selected relevant guidance and whole exact contracts. Follow complete-object pages; knownRefs require full bodies. After context loss omit missing knownRefs. Never execute a partial contract.', inputSchema: layeredSchemas.McpResolveInput }, { name: 'rho_call', description: 'Execute one authorized operation using its resolved complete contractRef and exact input. Retain original write IDs after unknown outcomes. The authenticated project is injected.', inputSchema: layeredSchemas.McpCallInput }];
const layerValidators = Object.fromEntries(layerTools.map(t => [t.name, layerValidator.compile(t.inputSchema)]));
const allowed: string[] = c.methods;
async function available() {
  const catalog = await invoke('capability.list');
  if (!catalog.ok) throw new Error('Project catalog is unavailable.');
  // A provisioned entry filter can only narrow the authenticated grant. Query
  // every time so a cached tools/list cannot bypass project configuration.
  return allowed.filter(method => {
    if (method === 'binding.activity.append' || method === 'task.routing.put') return false;
    const operation = catalog.value.operations?.find((op: any) => op.method === method);
    return operation?.authorized && operation.state === 'available' &&
      (!c.pluginFilter || !operation.owner || c.pluginFilter.includes(operation.owner));
  });
}
const server = new Server({ name: 'rho-project', version: '0.4.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: layered ? layerTools : (await available()).map(method => {
  const source = structuredClone(schema.value.operations[method]);
  delete source.properties.projectId;
  source.required = source.required.filter((p: string) => p !== 'projectId');
  return { name: 'rho_' + method.replaceAll('.', '_'), description: schema.value.descriptions[method] ?? method, inputSchema: source };
}) }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  if (layered) {
    try {
      const validate = layerValidators[request.params.name];
      if (!validate || !validate(request.params.arguments ?? {})) throw new Fault('invalid', 'Use the exact selected three-tool input schema.');
      const input = request.params.arguments;
      const result = await (request.params.name === 'rho_index' ? layered.index(input) : request.params.name === 'rho_resolve' ? layered.resolve(input) : layered.call(input));
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: !result.ok };
    } catch (e) {
      const error = e instanceof Fault ? { kind: e.kind, message: e.message, details: e.details } : { kind: 'unknown', message: 'Delivery outcome unknown. Observe the original write identity; do not mint a replacement.' };
      return { content: [{ type: 'text', text: JSON.stringify({ apiVersion: '2.0', ok: false, error: { ...error, continuation: 'Observe original writes and refresh the small index or refetch complete contracts as needed. Unknown delivery never authorizes a replacement identity.' } }) }], isError: true };
    }
  }
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
