#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { retainAgentIntent } from './agent-intents.js';
import { layeredSchemas } from './layered-contract.js';
import { LayeredMcp } from './layered.js';
import { ResultPages, resultLimits } from './result-pages.js';
import { Ajv } from 'ajv';
import { Fault, digest, requireThat } from '@rho-workspace/plugin-contracts';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const descriptor = process.env.RHO_AGENT_CONNECTION;
if (!descriptor) throw new Error('Set RHO_AGENT_CONNECTION to a private connection file.');
const c = JSON.parse(await fs.readFile(descriptor, 'utf8'));
const endpoint = new URL(c.url);
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') throw new Error('Only the local Rho service is supported.');
const limits = { ...resultLimits,
  maxResultBytes: Number(process.env.RHO_MAX_RESULT_BYTES ?? resultLimits.maxResultBytes),
  maxRetainedBytes: Number(process.env.RHO_MAX_RETAINED_RESULT_BYTES ?? resultLimits.maxRetainedBytes),
  maxResults: Number(process.env.RHO_MAX_RESULTS ?? resultLimits.maxResults) };
requireThat(Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0) && limits.maxResultBytes > 2048 && limits.maxRetainedBytes >= limits.maxResultBytes, 'invalid', 'Invalid result retention budget.');
async function invoke(method: string, input: Record<string, unknown> = {}, contractRef?: string) {
  const response = await fetch(new URL('/api/v2/' + method, endpoint), {
    method: 'POST', headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json', ...(contractRef ? { 'x-rho-contract-ref': contractRef } : {}) },
    body: JSON.stringify({ ...input, projectId: c.projectId }), signal: AbortSignal.timeout(30000)
  });
  const reader = response.body!.getReader(), chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > limits.maxResultBytes - 2048) {
      await reader.cancel();
      throw new Fault('limit', 'The response exceeded the transport budget. The operation may have completed; observe its original identity, never submit replacement work.', { limit: 'maxResultBytes', maximum: limits.maxResultBytes, outcomeUnknown: true });
    }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const connection = { ...c, profile: c.profile ?? 'layered-business' };
const layer = new LayeredMcp(connection, { invoke, retain: (method, input) => retainAgentIntent(descriptor, c, method, input, Number(process.env.RHO_MAX_AGENT_INTENTS ?? 256)) }, Number(process.env.RHO_KNOWLEDGE_CACHE_ENTRIES ?? 128), Number(process.env.RHO_KNOWLEDGE_CACHE_BYTES ?? 4194304));
const results = new ResultPages(path.dirname(descriptor), digest(c.projectId + ':' + c.externalSessionId + ':' + c.token), async operation => {
  const index = await layer.index({ search: operation });
  requireThat(index.ok && index.value.entries.some((e: any) => e.id === operation), 'scope', 'The operation that produced this result is no longer available to this connection.');
}, limits);
const tools = [
  { name: 'rho_index', description: 'Discover authorized owners first. Select owner or search to page its operations. No full schemas are loaded.', inputSchema: layeredSchemas.McpIndexInput },
  { name: 'rho_resolve', description: 'Fetch complete guidance and contracts only for selected operations. Follow whole-object pages; knownRefs reuse bodies you still hold.', inputSchema: layeredSchemas.McpResolveInput },
  { name: 'rho_call', description: 'Call one resolved authorized operation. Large replies return an immutable result reference for rho_read; never repeat a write to retrieve its output.', inputSchema: layeredSchemas.McpCallInput },
  { name: 'rho_read', description: 'Inspect a retained result by JSON pointer, page containers or text, or explicitly release it. Text offsets count UTF-16 units. Reading never invokes the original operation.', inputSchema: layeredSchemas.McpReadInput }
];
const ajv = new Ajv({ strict: false });
const validators = Object.fromEntries(tools.map(t => [t.name, ajv.compile(t.inputSchema)]));
const server = new Server({ name: 'rho-project', version: '0.4.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const input = request.params.arguments ?? {}, validate = validators[request.params.name];
    requireThat(validate && validate(input), 'invalid', 'Use the selected discovery, call or result-page schema.');
    const result = request.params.name === 'rho_index' ? await layer.index(input)
      : request.params.name === 'rho_resolve' ? await layer.resolve(input)
      : request.params.name === 'rho_read' ? { apiVersion: '2.0', ok: true, value: await results.read(input as any) }
      : await results.deliver(String(input.operation), () => layer.call(input), input.maxBytes as number | undefined);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: !result.ok };
  } catch (e) {
    const error = e instanceof Fault ? { kind: e.kind, message: e.message, details: e.details } : { kind: 'unknown', message: 'Delivery outcome unknown. Observe the original write identity; do not mint a replacement.' };
    return { content: [{ type: 'text', text: JSON.stringify({ apiVersion: '2.0', ok: false, error: { ...error, continuation: 'Keep original write identities and obtained output. Refresh the small index or resolve complete contracts when needed.' } }) }], isError: true };
  }
});
await server.connect(new StdioServerTransport());
