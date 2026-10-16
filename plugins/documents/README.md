# Documents and code plugin

`@rho-workspace/plugin-documents` 0.3.0 is an independently packed npm plugin.

Public entries: `Documents`, `documentLimits`.

One logical document buffer, Unicode edits, undo, snapshots, conditional save and restore.

Selected services: None.

No language runtime, table parser or Agent SDK.

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
npm pack --workspace plugins/documents --ignore-scripts
```

Use the repository's `pack:plugins` command to produce the contracts tarball and
selected plugin tarballs together. Both explicit R examples are separate consumers
and are excluded from every plugin artifact. No UI work is included.
