# Independent plugin packages 0.4

The source workspace builds eight independently installable capability plugins.
There is no aggregate runtime package. `@rho-workspace/plugins-source` is private
and rejects root packing. Examples and the separate Agent evaluator remain source
consumers, outside every capability tarball.

## Inventory

All packages are version **0.4.0**. Each capability exports its own `plugin`
descriptor. Existing `r.execute` and view contracts retain version **0.2.0**;
the package split does not redefine accepted actions or resource identities.

| ID / package suffix | Owner and public API | Required services in Rho |
| --- | --- | --- |
| [documents](../plugins/documents/README.md) | `Documents`: one buffer, edits/undo, conditional save, frozen snapshots and restoration | None |
| [files](../plugins/files/README.md) | `Files`, `collectArtifacts`, `verifyArtifacts`: contained immutable bytes, registration, inventory and integrity | None; typed declaration validators are injected |
| [r](../plugins/r/README.md) | `planExecution`, `Objects`: explicit script/resource snapshots, argument plan, exported object reader; no managed journal or Host | Files; requirements only for the execution action; documents only for buffer scripts |
| [requirements](../plugins/requirements/README.md) | `checkRequirements`, `preparation`: bounded R probe and explicit project-library preparation plan | None |
| [tables](../plugins/tables/README.md) | `Tables`: declared type/null/key semantics, pages, sorting/filtering, two-input keyed comparisons | Files |
| [media](../plugins/media/README.md) | `Media`: original image/PDF metadata and checked coordinate context | Files |
| [charts](../plugins/charts/README.md) | `Charts`, binding validator: numeric scatter data, stable entities, sampling and props | Tables |
| [agent](../plugins/agent/README.md) | `AgentContext`, `retainAgentIntent`, `./mcp`: context/bindings/receipts and durable project-scoped stdio tools | None; context sources are injected as needed |

The full npm name is `@rho-workspace/plugin-<suffix>`. Each depends on
`@rho-workspace/plugin-contracts` 0.4.0. No plugin imports another plugin's
implementation. Rho explicitly connects the required service ports; missing
providers make only the affected entries unavailable. Installing a package does
not activate a service, grant authority, start R or start a Core Host.

Only Tables depends on `csv-parse` 7.0.3. Only Agent depends on MCP SDK 1.29.0.
Documents, files and media do not require the R adapter or R packages. Charts
consume the table reader rather than taking ownership of parsing/storage. The
Agent's external client continues to own its model loop and conversation.

[Contracts](../packages/contracts/README.md) contains generic envelopes, typed service
ports, faults, contained paths, hashing and durable ordinary-file primitives.
It has no plugin descriptor, catalog, resource registry, document state, execution
planner, native dependency probe, data parser, MCP server or renderer.
Each format schema is exported by its owner through a pure `./contract` entry:
Files, Tables, Media and R own their respective resource declarations; Requirements
owns package requirements, while R owns script selection and the execution-input
factory. The factory accepts foreign schemas from its consumer. Contracts does not
know those formats, native environments or CSV null encodings. Rho preserves its
selected v2 wire vocabulary and checks parity with these provider contracts.

In 0.4, object reads need Files and R only. Missing Requirements disables the
`r.execute` action and its execution capability, while `r-objects` and the object
entry remain available. R's `maxScriptBytes` protects frozen script bytes with an
independent 1 MiB default. Documents' buffer budget cannot change saved execution.
Media, object, Agent and R readers accept only the service methods they use.

## Selection, missing providers and state

Rho owns a finite reviewed package list and selected versions; there is no
marketplace or arbitrary module-path loader. It imports only selected packages,
checks identity/version and required services, and publishes actual availability.
An absent package does not trigger installation or fallback execution.

State locations and resource IDs survive the split. Removing an owner does not
cancel an accepted request, close its Host, overwrite a draft or delete bytes.
Files can still read retained typed bytes while its parser is absent. New typed
registration requires that type's validator. Collection preserves registered
resources and reports missing validators separately; byte verification retains
that provider-availability fact. Rho retains composition references and bounded
persisted document/resource observations when providers are absent.
Restoration needs actual state owners, preserves unavailable references and never
replays execution. Reselecting providers resumes reads/edits at the original
versions, with original request identities.

The five view entries (`rho.editor`, `rho.object`, `rho.table`, `rho.media`,
`rho.scatter`) remain UI-unavailable. They belong to their respective packages;
no browser renderer or UI work is included in this split.

## Build, pack and verify

```sh
npm ci
npm test
npm run test:examples
npm run pack:plugins -- --destination /absolute/plugin-tarballs
npm run test:install -- /absolute/plugin-tarballs

# A selected subset, plus contracts
npm run pack:plugins -- --destination /absolute/minimal-tarballs --plugins documents,files
```

The packer emits separate `.tgz` files and `plugins.json`, recording package
identity, SHA-256, npm integrity and included files. Each contains only compiled
owner code/types, README, package manifest and license. To use a local artifact,
install its contracts tarball and the selected plugin tarball together; npm
registry publication has not been performed.

Twelve owner tests and two separate native example tests pass. The architecture
check rejects sibling implementation imports and undeclared dependencies, and
locks Contracts to its generic export surface. Builds clean each owner dist
before compiling, so removed schemas cannot survive in tarballs. Packing checks
compiled first-party code for the excluded analysis/evaluator consumers. Eight isolated npm
installations/imports pass, each containing contracts plus exactly one plugin;
CSV/MCP dependencies follow only their owners. Rho separately checks its actual
assembly, provider removal/reselection, both R consumers, Core recovery and a
fresh installed application. See the [boundary review acceptance](https://github.com/YuLab-SMU/Rho/blob/main/docs/PLUGIN-BOUNDARY-ACCEPTANCE.md)
and the earlier [split acceptance](https://github.com/YuLab-SMU/Rho/blob/main/docs/PLUGIN-SPLIT-ACCEPTANCE.md).
Source publication, local packaging, installation and signed distribution remain
separate evidence.
