# Public plugin interfaces 0.4

This reference inventories the eight implemented capability packages at version
**0.4.0**. It describes their Node APIs and injected service ports. The application
HTTP API belongs to [Rho](https://github.com/YuLab-SMU/Rho/blob/main/docs/HEADLESS.md).
Browser entries are unimplemented; a component descriptor is not a renderer.
Future capability proposals are not additional implemented packages.

## Package and dependency boundary

Every name below has the prefix `@rho-workspace/plugin-`. Every package depends
on `contracts` 0.4.0. These npm dependencies do not select another capability,
start a service or grant a caller permission.

| Package | Required capability ports | Additional npm dependency |
| --- | --- | --- |
| `documents` | None | None |
| `files` | None; typed validators are injected | None |
| `r` | Files; Requirements for `r.execute`; Documents for buffer scripts | None |
| `requirements` | None; an explicit Rscript path for probes/plans | None |
| `tables` | Files | `csv-parse` 7.0.3 |
| `media` | Files | None |
| `charts` | Tables, transitively Files | None |
| `agent` | Only the document/file/table/media sources used by a context | MCP SDK 1.29.0 |

No plugin imports a sibling implementation. Rho selects versions, checks required
providers and connects the ports. R's package descriptor requires Files; its
action descriptor separately requires Requirements. Consequently, Files/R can
read exported objects without Requirements, Documents, Rscript or a Core Host.
Requirements preparation can be planned without selecting the R adapter.

`contracts` is shared infrastructure, not a ninth capability plugin. Its only
entry is the root: generic references/declaration envelopes, `ResourceStore`,
`DocumentSnapshotSource`, `TableReader`, `ActionPlan`, `PluginDescriptor`, faults,
schema primitives, contained paths, hashing and durable ordinary-file helpers.
It owns no formats, catalog, native planner/probe, document state, data parser,
Agent transport or renderer. See its [bounded surface](../packages/contracts/README.md).

In the API descriptions, `ref` means `{id, version}` with a SHA-256 resource
version. A document reference is `{documentId, version}` with an integer buffer
version. Public resource metadata excludes the private `storage` path. Root
entries are Node APIs; even a pure schema entry is not a verified browser bundle.

## Documents

Owns one logical unsaved buffer per document, content versions, authors, undo,
conditional saves and frozen script/context snapshots.

- Root exports: `Documents`, `documentLimits`, `plugin`; types `DocumentState`
  and `TextEdit`. No subpath entry.
- `new Documents(root, limits?)`; `list()`, `read(id)`, `open(path, author)`.
- `edit(id, expectedVersion, edits, undoGroup, author)` and
  `undo(id, expectedVersion, author)` return the acknowledged document state.
  Edits are `{from,to,insert}` in UTF-16 code units; invalid Unicode and surrogate
  splits are rejected.
- `save(id, expectedVersion, expectedDiskDigest, author)` checks buffer and actual
  disk conditions. `snapshot(id, expectedVersion)` returns
  `{code,sha256,source}`; `restore(state, author)` retains drafts/undo or reports
  conflicts. Snapshot/restore are service ports, not separate HTTP methods.
- `rho.editor` is its sole registered view entry. No redo operation, filesystem
  watcher or language service is implemented. Conditional replace does not
  provide filesystem CAS against arbitrary external writers.
- `./ui` also exports `DocumentCardBody` and `documentForms` for an application
  item frame: reference, card (`show`: passage, change or outline), summary (one
  section and recent changes) and compare (one named change). Cards read the
  buffer shared with the editor; their only write is an explicit revert of an
  Agent change. Anchors `{from,to,version}` follow retained edits; rewritten text
  names its author and keeps the original under "Show before".

## Files

Owns contained resource registration, byte snapshots, independent identity and
digest, provenance, bounded reads, artifact collection and byte-inventory checks.
Typed meanings stay with injected validators.

- Root exports: `Files`, `fileLimits`, `collectArtifacts`, `verifyArtifacts`,
  `publicResource`, `plugin`; types `Resource` and `DeclarationValidator`.
- `new Files(root, projectId, limits?, validators?)`; `validateDeclaration(d)`,
  `list()`, `resolve(ref)`, `bytes(ref)`, `read(ref, offset, maxBytes?)`.
  `resolve` checks the current source digest; `bytes` also verifies stored bytes.
  `read` returns base64 bytes, metadata, `nextOffset` and `more`.
- `register(path, provenance, availability, coverage?, declaration?, expectedDigest?)`
  returns a resource. `restore(metadata, bytes)` verifies identity/bytes and
  returns an available/conflict result. Rho's HTTP registration requires the
  expected source digest, even though the owner method also supports collection.
- `collectArtifacts(root, projectId, run, resources)` retains partial output and
  missing-provider facts. `verifyArtifacts(root, run, resources)` checks the
  declared completion inventory and exact bytes. Neither runs scientific checks.
- `./contract` exports `declarationSchema` for ordinary `file` resources.
  There is no registered file-browser view, project tree/listing, upload, rename
  or delete HTTP operation. Files is not a scientific format registry.

## R

Owns generic R script/argument planning, script snapshots, object declarations and
exported JSON object reads. Project scripts determine the analysis.

- Root exports: `planExecution`, `executionLimits`, `actions`,
  `createExecutionInputSchema`, `scriptSchema`, `validateObjectDeclaration`,
  `declarationValidator`, `Objects`, `plugin`; type `Environment`.
- `planExecution(root, input, operationId, environment, resources, documents?, limits?)`
  returns `ActionPlan`: frozen code, literal arguments, source provenance, output
  and completion paths. Its resource port is only `resolve/validateDeclaration`;
  its optional document port is only `snapshot`.
- `input` contains `script`, `args`, `requirements`, `artifacts`, `completion`.
  Disk scripts require `{kind:"disk",path,digest}`; buffer scripts require
  `{kind:"buffer",documentId,version}`. Resource arguments require exact refs.
- `new Objects(files).read(ref)` needs only `bytes` and the read limit and returns
  `{resource,observation:"exported-snapshot",value}`. It does not inspect live R.
- `./contract` exports `scriptSchema`, object `declarationSchema` and
  `createExecutionInputSchema(declarationSchema?, requirementsSchema?)`. The
  application supplies foreign schemas; R does not import their owners.
- `r.execute` **0.2.0** is the sole registered action; `rho.object` is the view
  descriptor. There is no built-in scientific pipeline, persistent R interpreter,
  live variable inspection or R-memory recovery. Planning does not dispatch Core
  or own its managed-request journal.

## Requirements

Owns explicit CRAN/Bioconductor package requirements, bounded R probes and a
project-library installation plan. It does not choose analysis dependencies.

- Root exports: `checkRequirements`, `preparation`, `libraryPrefix`, `plugin`;
  type `Requirement` = `{package,source,minimumVersion?}`.
- `checkRequirements(root, requirements, rscript)` returns the exact requirements,
  environment, timestamp, check ID, native evidence and `present/missing/unknown`.
  It runs a bounded base-R probe, not the project script or a Core Host.
- `preparation(root, requirements, rscript)` rechecks and returns an explicit
  installation plan for `.rho/plugins/R-library`. The Rho managed-request layer
  executes it through Core, then observation rechecks the packages.
- `libraryPrefix(environment)` creates the selected library-path prefix.
  `./contract` exports `requirementSchema` and `requirementsSchema`.
- There is no registered action/view descriptor here: `requirements.prepare` is
  an application operation. Automatic installation, R installation, package
  lockfile solving and reproducible native environment provisioning are absent.

## Tables

Owns declared CSV/JSON-row semantics: columns, scalar types, null encodings,
optional entity keys/namespaces, paging and explicit two-input numeric comparison.

- Root exports: `Tables`, `tableLimits`, `validateTableDeclaration`,
  `declarationValidator`, `plugin`; type `TableFormat`.
- `new Tables(files, limits?)` takes only `root/bytes/resolve/register`.
  `rows(ref)` returns normalized rows, columns, resource, `entityKey`, `namespace`.
- `page(ref, offset, limit, sort?, filter?)` returns rows and total/filtered counts,
  continuation offsets and entity semantics. Sort has `column/direction`;
  filter has `column/op/value`, with `eq/lt/gt/isNull` operations.
- `compare(left, right, options)` returns a new table resource with both source
  refs/provenance. Options explicitly name both keys, namespaces, numeric fields,
  `mapping:"equal-string"` and `join:"left"|"inner"|"full"`.
- `./contract` exports `columnSchema`, `tableFormatSchema`, `declarationSchema`;
  types `Column`, `TableFormat`. `rho.table` is the view descriptor.
- `./ui` also exports `TableCardBody` and `tableForms`: reference, card (`show`:
  count, rows or cell), summary (subsets by key or by one filter/sort) and compare.
  Each form is bounded `data.page` reads of published versions; keyed rows are one
  page per key, at most 50. Compare reads a recorded `data.compare` table and its
  coverage counts and never runs a comparison.
- There is no table-cell write API, arbitrary expression/query engine, automatic
  identifier conversion or general join mapper. Unkeyed tables can be read but
  cannot supply stable entity selection. Paging currently parses bounded whole
  resources; it is not a streaming or unlimited-data engine.

## Media

Owns declared original PNG/JPEG/SVG/PDF metadata and coordinate context.

- Root exports: `Media`, `validateMediaDeclaration`, `declarationValidator`,
  `plugin`. `new Media(files)` takes only `resolve`.
- `describe(ref)` returns resource/original refs, declared MIME type, optional
  pages/dimensions and `rendering:"unavailable"`.
- `region(ref, {page,x,y,width,height,units})` checks the original version,
  declared bounds and units: pixels for images, points for PDF. It returns the
  checked rectangle with `mapping:"original-media-coordinates"`. Rho reaches this
  port through `context.create`; there is no `media.region` HTTP operation.
- `./contract` exports media `declarationSchema`. `rho.media` is the view
  descriptor. Metadata is producer-declared, not decoded from file contents.
  Image/PDF rendering, thumbnails, coordinate transforms, zoom, annotations and
  browser interaction are unimplemented.

## Charts

Owns a bounded numeric scatter-data projection and validation of its view bindings.
It consumes normalized Tables rows; it does not parse or store scientific data.

- Root exports: `Charts`, `chartLimits`, `validateComponentBindings`, `plugin`.
  No subpath entry.
- `new Charts(tableReader, limits?)`; `plot(ref, x, y, maxPoints?)` returns resource,
  scatter spec, stable keyed points, original count and explicit deterministic
  stride sampling facts. It requires an entity key and two numeric columns.
- `validateComponentBindings(id, props, resources)` checks scatter column/key
  semantics; Rho separately validates registered props and binding roles.
- `rho.scatter` is the descriptor. There is no chart renderer, interaction loop,
  arbitrary chart grammar, chart export or additional chart type implemented.
  Original R-produced plot files use Media/Files rather than Charts.

## Agent

Owns explicit context packages, external-session bindings, tool receipts and the
project-scoped stdio MCP adapter. The external client owns the model loop/chat.

- Root exports: `AgentContext`, `agentLimits`, `retainAgentIntent`, `plugin`;
  type `ContextSources`. No editor, R planner or data parser is absorbed here.
- `new AgentContext(root, projectId, sources, limits?)` takes optional snapshot,
  file `resolve/read`, normalized table reader and media `region` ports.
- `createContext(input, principal)` freezes a document range, selected table
  entities or bounded resource page/checked media rectangle. `readContext(id,
  principal)` records `tool-fetched`; this is a receipt, not proof of model use.
- `binding(method, principal, externalSessionId)`, `bindings(principal)`,
  `activity(principal)`, `recordActivity(principal, method, input, result, errorKind?)`
  retain connection metadata and bounded receipts, independently of task lifetime.
- `retainAgentIntent(descriptor, connection, method, input, maxIntents?)` fsyncs
  exact managed input/identity before delivery; conflicting identity reuse fails.
- `./mcp` is the executable `rho-agent-mcp`, not an embeddable renderer API.
  `RHO_AGENT_CONNECTION` selects a private descriptor. Granted protocol methods
  become `rho_<operation_with_underscores>` tools; project identity is injected.
  Managed calls require a retained `operationId` before HTTP delivery.
- No registered Agent view, embedded chat, proactive external-chat push, model
  provider hosting or conversation synchronization is implemented. Binding close
  does not stop a task. `session.grant` and credential enforcement belong to Rho.

## Evidence and scope

Owner defaults and exceeded-limit behavior are listed in
[headless capabilities](HEADLESS.md); actual package installation and dependency
checks are recorded in [package acceptance](PLUGIN-PACKAGES.md#build-pack-and-verify).
The [boundary acceptance](https://github.com/YuLab-SMU/Rho/blob/main/docs/PLUGIN-BOUNDARY-ACCEPTANCE.md)
records both ordinary and scientific project consumers using these same APIs.
That evidence covers the headless composition, not a browser product or signed
distribution. Project workflows and scientific checkers remain external consumers,
excluded from the eight capability tarballs and Rho's application package.
