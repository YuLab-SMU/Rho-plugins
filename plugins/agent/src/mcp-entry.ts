import { layeredSchemas } from './layered-contract.js';

// The public MCP entry and its actual tool list share one declaration. Reading
// this metadata imports no server, connection file or Agent process.
export const mcpTools = [
  { name: 'rho_index', description: 'Discover optional Rho workspace capabilities alongside your native tools. Core managed execution is chosen only when needed. Select owner or search to page authorized operations. No full schemas are loaded.', inputSchema: layeredSchemas.McpIndexInput },
  { name: 'rho_resolve', description: 'Fetch complete guidance and contracts only for selected operations. Follow whole-object pages; knownRefs reuse bodies you still hold.', inputSchema: layeredSchemas.McpResolveInput },
  { name: 'rho_call', description: 'Call one resolved authorized operation. Large replies return an immutable result reference for rho_read; never repeat a write to retrieve its output.', inputSchema: layeredSchemas.McpCallInput },
  { name: 'rho_read', description: 'Inspect a retained result by JSON pointer, page containers or text, or explicitly release it. Text offsets count UTF-16 units. Reading never invokes the original operation.', inputSchema: layeredSchemas.McpReadInput }
];
export const mcpEntry = {
  entry: './mcp', transport: 'stdio',
  tools: mcpTools.map(({ name, description }) => ({ name, description }))
};
