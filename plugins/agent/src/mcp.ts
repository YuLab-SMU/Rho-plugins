#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { retainAgentIntent } from './agent-intents.js';
import { layeredSchemas } from './layered-contract.js';
import { LayeredMcp } from './layered.js';
import { ResultPages, resultLimits } from './result-pages.js';
import { Ajv } from 'ajv';
import { Fault, atomicJson, canonical, digest, readJson, requireThat, stateDirectory } from '@rho-workspace/plugin-contracts';
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
const cacheEntries = Number(process.env.RHO_KNOWLEDGE_CACHE_ENTRIES ?? 128), cacheBytes = Number(process.env.RHO_KNOWLEDGE_CACHE_BYTES ?? 4194304);
// A conversation runs one MCP server per message, so knowledge resolved in an earlier message
// is kept beside the connection and restored when the next message starts its own server. Only
// the complete immutable bodies this cache actually retained are kept, one file per reference,
// bounded by the same entry and byte budgets the cache itself uses. The service still re-checks
// the current contract reference on every call, so a kept body never widens what may execute.
async function knowledgeStore(descriptor: string, who: { projectId: string; externalSessionId: string }) {
  const owner = await fs.realpath(path.dirname(descriptor));
  const directory = await stateDirectory(owner, 'mcp-knowledge-' + digest(canonical([who.projectId, who.externalSessionId])));
  // References reach the cache only after their digest is verified, so this is a name the
  // filesystem can hold; keeping it checked stops any other shape from becoming a path.
  const file = (ref: string) => { requireThat(/^[a-f0-9]{64}$/.test(ref), 'condition', 'A retained body is named by its own content digest.'); return path.join(directory, ref + '.json'); };
  const kept = async () => {
    const names = (await fs.readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    return Promise.all(names.map(async name => { const stat = await fs.stat(path.join(directory, name)); return { name, at: stat.mtimeMs, size: stat.size }; }));
  };
  let writes = Promise.resolve();
  return {
    // Newest first: the bodies this conversation used last are the ones it is most likely to
    // reach for next, and the budgets are the cache's own.
    async load() {
      const objects: any[] = []; let bytes = 0;
      for (const entry of (await kept()).sort((a, b) => b.at - a.at).slice(0, cacheEntries)) {
        if (bytes + entry.size > cacheBytes) continue;
        try { objects.push(await readJson(path.join(directory, entry.name))); bytes += entry.size; }
        catch { /* a body that cannot be read is not knowledge this process holds */ }
      }
      return objects;
    },
    remember(object: any) {
      writes = writes.then(async () => {
        const bytes = Buffer.byteLength(JSON.stringify(object));
        if (bytes > cacheBytes) return;
        await atomicJson(file(object.ref), object);
        // Oldest files go first, so the kept bodies stay inside the same budgets as the cache.
        const sized = await kept(); let total = sized.reduce((sum, x) => sum + x.size, 0), count = sized.length;
        for (const old of sized.sort((a, b) => a.at - b.at)) {
          if (count <= cacheEntries && total <= cacheBytes) break;
          if (old.name === object.ref + '.json') continue;
          await fs.rm(path.join(directory, old.name), { force: true }); total -= old.size; count--;
        }
      }).catch(() => {});
      return writes;
    },
    forget(ref: string) {
      writes = writes.then(() => fs.rm(file(ref), { force: true })).catch(() => {});
      return writes;
    }
  };
}
const knowledge = await knowledgeStore(descriptor, c);
const layer = new LayeredMcp(connection, { invoke, retain: (method, input) => retainAgentIntent(descriptor, c, method, input, Number(process.env.RHO_MAX_AGENT_INTENTS ?? 256)), remember: object => knowledge.remember(object), forget: ref => knowledge.forget(ref) }, cacheEntries, cacheBytes);
// Restored before the first tool call, so a resumed message works from what it already resolved.
layer.seed(await knowledge.load());
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
