# Typed tables and comparison plugin

`@rho-workspace/plugin-tables` 0.4.0 is an independently packed npm plugin.

Public entries: `Tables`, `tableLimits`, `declarationValidator`.

Typed CSV/JSON rows, bounded pages/sort/filter, stable keys/namespaces and an explicit two-input join.

The pure `./contract` entry exports this owner's JSON schema without importing
its implementation or native/parser dependencies.

Selected services: Only the root, bytes, resolve and register ports of Files; no editor or R service.

Only this plugin depends on csv-parse. No scientific column assumptions or chart renderer.

The package depends on `@rho-workspace/plugin-contracts` 0.4.0 for generic envelopes and service ports
and ordinary file primitives; that package contains no capability implementation.
Service ports do not install or start other plugins. Rho explicitly selects and
connects providers. `plugin` describes this package and its selected-service
requirements. The optional `./ui` entry supplies the browser renderer; component contracts
remain 0.2.0 independently of the package version.

```sh
# From the Rho-plugins source checkout
npm ci
npm run build
npm pack --workspace plugins/tables --ignore-scripts
```

Use the repository's `pack:plugins` command to produce the contracts tarball and
selected plugin tarballs together. Both explicit R examples are separate consumers
and are excluded from every plugin artifact. Browser behavior is supplied separately through `./ui`.

## Optional browser entry

`@rho-workspace/plugin-tables/ui` exports the AG Grid Community view and draft
contribution declaration. React and AG Grid are exact optional peers; headless
imports require neither React nor DOM.

The Infinite Row Model requests 200 rows per block and retains at most five
blocks. Only one sort and one typed condition are offered. Every response
updates the exact filtered count, so removing a filter also restores later rows.
Null values render as italic “empty”. Stable row IDs use the declared namespace
and key; an explicit shared channel preserves the original resource/version
and picked keys across sorting, filtering and block eviction. An unkeyed table
is readable but cannot publish entity selections.

[Rho’s U2 acceptance](https://github.com/YuLab-SMU/Rho/blob/main/docs/U2-UI-ACCEPTANCE.md)
records the actual assembled browser checks.
