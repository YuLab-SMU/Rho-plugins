# Chart data and interaction plugin

`@rho-workspace/plugin-charts` 0.4.0 is an independently packed npm plugin.

Public entries: `Charts`, `chartLimits`, `validateComponentBindings`.

Validate explicit numeric scatter fields and stable keys; return sampled data with original coverage and mark identity.

Selected services: A TableReader supplied by the tables plugin.

No file parser, scientific axes or browser renderer.

The package depends on `@rho-workspace/plugin-contracts` 0.4.0 for generic envelopes and service ports
and ordinary file primitives; that package contains no capability implementation.
Service ports do not install or start other plugins. Rho explicitly selects and
connects providers. `plugin` describes this package and its selected-service
requirements. View descriptors, where present, remain UI-unavailable; action/view
contract versions remain 0.2.0 independently of the package version.

```sh
# From the Rho-plugins source checkout
npm ci
npm run build
npm pack --workspace plugins/charts --ignore-scripts
```

Use the repository's `pack:plugins` command to produce the contracts tarball and
selected plugin tarballs together. Both explicit R examples are separate consumers
and are excluded from every plugin artifact. No UI work is included.
