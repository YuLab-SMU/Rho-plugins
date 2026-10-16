# R requirements plugin

`@rho-workspace/plugin-requirements` 0.4.0 is an independently packed npm plugin.

Public entries: `checkRequirements`, `preparation`.

Probe explicit R package/source/version requirements and plan explicit installation into the project library.

The pure `./contract` entry exports this owner's JSON schema without importing
its implementation or native/parser dependencies.

Selected services: Selected external Rscript for probes. Preparation is dispatched through the application/Core bridge.

No script scanning, global ready flag or scientific dependency set.

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
npm pack --workspace plugins/requirements --ignore-scripts
```

Use the repository's `pack:plugins` command to produce the contracts tarball and
selected plugin tarballs together. Both explicit R examples are separate consumers
and are excluded from every plugin artifact. No UI work is included.
