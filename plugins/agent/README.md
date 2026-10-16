# Agent bridge and context plugin

`@rho-workspace/plugin-agent` 0.3.0 is an independently packed npm plugin.

Public entries: `AgentContext`, `retainAgentIntent`; `rho-agent-mcp` / `./mcp`.

Scoped MCP tools, durable original caller intents, versioned explicit context, bindings and tool-fetch receipts.

Selected services: Only the sources actually used by a context: documents, files, tables or media.

Only this plugin depends on the MCP SDK. The external client owns the conversation/model loop.

The package depends on `@rho-workspace/plugin-contracts` 0.3.0 for wire types
and ordinary file primitives; that package contains no capability implementation.
Service ports do not install or start other plugins. Rho explicitly selects and
connects providers. `plugin` describes this package and its selected-service
requirements. View descriptors, where present, remain UI-unavailable; action/view
contract versions remain 0.2.0 independently of the package version.

```sh
# From the Rho-plugins source checkout
npm ci
npm run build
npm pack --workspace plugins/agent --ignore-scripts
```

Use the repository's `pack:plugins` command to produce the contracts tarball and
selected plugin tarballs together. Both explicit R examples are separate consumers
and are excluded from every plugin artifact. No UI work is included.
