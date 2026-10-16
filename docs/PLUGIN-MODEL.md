# Reusable plugin model

Updated: 2026-10-16.

This document selects the capability boundaries for Rho's first-party plugins.
A plugin supplies a reusable capability with an owned resource/state boundary;
an analysis workflow composes capabilities in a project. The paired dexamethasone
analysis is an example and acceptance consumer, and does not belong in the plugin
catalog or the base application's dependency set.

The [0.2 headless package](HEADLESS.md) implements the bounded capability subset:
explicit R scripts and requirements, declared files/tables/media/object snapshots,
document state and scoped MCP tools. Its base tarball excludes project recipes.
The broader UI and live-session entries below remain design requirements. The
[application extraction plan](https://github.com/YuLab-SMU/Rho/blob/main/docs/PLUGIN-EXTRACTION.md)
records the extraction and acceptance gates; HEADLESS identifies the actual APIs.

## Capability, entry and workflow

| Unit | Owns | Example |
| --- | --- | --- |
| Capability plugin | Reusable behavior, native conditions, resource semantics and owned state | Documents, typed tables, R execution adapter |
| Entry contributed by a plugin | A headless operation, resource reader, view or context adapter using that capability | A code editor and a read-only code view over one document service |
| Workflow or recipe | Question, inputs, method choices, parameters, sequencing and domain interpretation | Paired airway DESeq2 analysis with donor omission and shrinkage |
| Application composition | Selected plugin versions, routing, supported entries and workspace arrangement | Rho's npm/local WebUI composition |

A view is a contribution, not the definition of a plugin. Buttons, panels,
sorting, undo and zoom do not each require a package. Group behavior when it
shares a state owner, lifetime and consumer contract; split it when consumers
need independent dependencies or activation. Package boundaries can follow real
consumers later. An initial explicit module list is sufficient; this model does
not require a marketplace, dynamic loader or workflow engine.

Rho-core continues to own managed execution through its public CLI. Rho owns
application authentication, project visibility, durable request mapping,
composition, docking and interaction routing. Those responsibilities are not
copied into capability plugins.

## Initial capability boundaries

Names in this table are descriptive design names, not newly registered IDs.
The rows define responsibilities; they do not prescribe eight npm packages.

| Capability | Headless responsibility | Possible UI entries |
| --- | --- | --- |
| Documents and code | One logical buffer per document; transactions, undo, conflict-aware save and immutable execution/context snapshots | Editor, code viewer, diff; all use the same buffer |
| Files and artifacts | Scoped file access, byte snapshots, inventory, media/format declarations, digest verification and export inputs | File browser, artifact details, bounded text/byte preview |
| R runtime adapter | Explicit saved/buffer script execution plans for the public Core bridge; runtime identity and declared object exports or supported inspections | Run output, variable/object browser, bounded object preview |
| Requirements | Selected capability/action requirements, environment-bound probes and explicit preparation plans using native providers | Dependency details and preparation results at the selected action |
| Tables | Declared typed columns, bounded reads, sorting/filtering, stable row keys and a checked keyed transform for the selected comparison consumer | Table and column/details views |
| Media | Declared image/PDF resources, bounded pages/tiles and original bytes with provenance | Image/PDF viewer, zoom, pan and page navigation |
| Charts | Validated chart data/specifications, explicit field mappings, missing-value and sampling facts, mark-to-entity mapping | Scatter/other selected chart renderers, linked selection |
| Agent bridge and context | Capability discovery, granted tools, versioned document/resource context and caller-intent retention | Binding/context preview and tool activity; external client owns chat/model loop |

The variable browser belongs to the runtime's object contract, not to DESeq2 or
to the layout shell. Requirements has native providers: the first can check R
packages without inventing an installer for every language. Media can be used
without a table or R installation. Charts consume actual declared data and can
be used without the workflow that produced it. Low-level UI controls can be shared
implementation utilities without becoming independently registered plugins.

Agent evaluation is a separate development tool with its own consumers and
evidence. It is not required to open an editor, display data or connect the
selected external Agent. A future domain extension may contribute a reusable,
parameterized native operation or object adapter when a concrete consumer needs
it. A fixed dataset/design/contrast pipeline remains a recipe; renaming it as a
method plugin would leave the same coupling in place.

## Common contracts

Implement the smallest contracts needed by two distinct consumers. They share
references and invocation rules, rather than one global mutable application model.

| Contract | Required meaning |
| --- | --- |
| Capability descriptor | Stable namespaced identity, version, supported contract versions, required/optional capabilities and entries, actual availability with a reason |
| Action | Versioned input/output schemas, effects, native conditions and requirement declaration; explicitly bound resource/document/runtime inputs; cancellation semantics |
| Resource descriptor | Provider/owner, project, ID and independent version, kind and format/schema, availability/coverage and provenance; bounded reader operations |
| Selection | Resource or document version plus a declared entity-key space or text coordinate system; no display row/pixel as an entity ID |
| View contribution | Entry/version, props schema, named binding roles and accepted resource contracts, supported actions/context and release behavior |
| Check result | Subject and version, checker identity, observed time, outcome/unknown and exact scope; byte integrity and domain validity remain distinct |

The Rho service validates caller/project authority and resolves an installed
entry/version. The selected owner validates its input schemas, resource freshness
and native conditions before preparing work. Rho executes accepted plans through
the public Core bridge and retains the original mapping. UI, Agent and supported
CLI entries reuse these operations. A catalog entry or model-generated props
cannot supply authority or replace an owner check.

Compatibility is explicit at both capability and entry boundaries. Missing UI
code must not hide a usable headless capability. Missing runtime support must not
disable unrelated file/document views. An unavailable entry carries a reason;
the UI does not infer availability from the presence of a package.

## Resources and selections

Providers publish explicit resource descriptors. A `.rds` extension alone does
not establish a DESeq2 model, and `.pdf` alone does not supply interactive chart
coordinates. The common resource inventory resolves references and readers;
providers retain format semantics, independent versions and checks.

A table declares column IDs/types, null encoding and a stable key when one
exists. The first selected key contract can use a unique, non-null string column
with a declared entity namespace. Preserve identifiers such as `001` and literal
`NA` when the provider declares strings; do not infer scientific column types
from their names. A table without a stable key remains readable and sortable,
with entity linking unavailable. Sorted/filtered row positions never become keys.

Selection is local to an exact resource version. Linking two resources requires
an explicit owner-validated mapping and compatible entity namespaces; matching
column names or strings alone do not establish the same entity. Rho routes that
mapping and scoped selection, while the producer owns its domain meaning.
Text selections use the document's declared coordinates and content version.

A keyed comparison takes two versioned inputs, explicit keys/fields and a join
policy. It records both inputs, unmatched rows, nulls and column provenance.
The table provider validates types, uniqueness and declared mapping. A domain
adapter or recipe checks scientific comparability, such as model and contrast
compatibility. Rho's workspace and the generic table/chart renderer never know
`gene_id`, `log2FoldChange`, `baseline` or `shrinkage` as required semantics.
Use maintained data tools or the bounded reader needed by this consumer; a general
query engine is not implied.

## Images, charts and variables

An image/PDF view preserves the original file/version. Zoom, pan and page changes
are view state. A pixel rectangle is an image coordinate selection with its own
coordinate metadata; it is not a biological or table entity. Only an explicit
producer mapping can connect image regions to domain objects.

A chart binds an exact table/resource version and declared x/y/label/key fields,
plus the supported chart specification. Numeric field requirements, scale and
missing-value behavior are checked without guessing an analysis type. Mark
selections map back to source keys. Sampling reports its method and coverage,
preserves original data and distinguishes displayed marks from a complete entity
set. A PDF preview does not count as an interactive chart implementation.

Variable/object inspection needs a native owner. A descriptor identifies the
runtime or producing operation, object name/handle, type/class, shape, observation
time, snapshot/version, availability and bounded preview. Values may be stale or
unavailable; listing a descriptor is different from materializing an object.
Previewing/exporting a large or computed native object requires the adapter's
explicit supported operation and budget.

The current R consumer is batch Rscript. Core's resident Host is not a persistent
R interpreter. Batch support can display explicitly exported object snapshots
after execution; it cannot promise live variable inspection or R-memory recovery.
A future live-session adapter must first demonstrate its public native-session
capability, identity, mutation/freshness and lifetime. Reading a saved descriptor
must not start R, evaluate arbitrary R expressions or recover a missing session.

## UI assembly and lifetimes

Plugins provide trusted view implementations and schemas; Rho selects explicit
versions and supplies theme, docking, focus and layout persistence. CodeMirror,
AG Grid and ECharts are implementation choices behind entries, not resource or
workflow identities. The browser calls public service operations and subscribes
to owner facts. View code does not implement another buffer, request journal or
native runtime. Agent composition selects registered entries and named bindings;
it cannot inject privileged executable code.

Closing a view releases subscriptions/rendering. It preserves document buffers,
resource bytes, running operations and the external Agent's own session. Disabling
an entry prevents new use according to its declared policy, and retains original
requests, obtained output and restoration intent. In-flight work keeps the owner
version needed to observe it; removing a package is not cancellation or shutdown.
Restoring a missing entry reports unavailable and preserves references. It never
installs dependencies or replays a workflow to rebuild a screen.

Budgets belong to the protected resource: document/undo bytes, artifact bytes,
table pages, chart points, media decode/page pixels, object preview bytes/elements,
subscriptions and native process/output limits. Each implementation records its
configuration and over-limit result. Rejection or declared truncation preserves
obtained content and uncertainty; UI closure does not stop unrelated execution.

## Workflow location and acceptance

Keep the paired analysis, its data/design choices, shrinkage and scientific
checkers under `examples/real-r-analysis` or project-owned recipe material. The
recipe supplies dependency declarations, script snapshots and output descriptors
to reusable capabilities. Domain-specific serialization/readers stay with a
selected domain provider. The base plugin catalog and package must work without
installing airway, DESeq2 or apeglm and without shipping the example. The 0.2
package enforces that inventory; scientific dependencies are declared only by the
explicit example consumer.

Before UI work treats the new boundaries as stable, prove these flows:

1. Start/install the base composition without the paired example or its scientific
   packages. Open/edit/undo/save code, inspect a normal file and display a declared
   table and image. Reading them starts no Host or R session.
2. Run an ordinary project R script with no airway/DESeq2 dependency. It exports
   a small typed table with a non-gene key, an image and bounded object metadata.
   The same table/image/runtime entries consume those resources without domain
   branches. Its dependency check concerns only its selected requirements.
3. Run the paired analysis as an explicitly selected recipe through those same
   entries. Scientific checks stay recipe-owned, and original real-analysis
   evidence retains its stated scope.
4. Compare two non-gene tables with explicit key/field/join declarations. Preserve
   missing values, both versions and stable selection after sorting. Reject
   stale/mismatched inputs; a chart and table share the resulting resource.
5. Omit a view/capability, reconnect and restore workspace state. Preserve buffers,
   original requests and resource references, report availability, and execute no
   new work. Then verify actual browser views, input and accessibility separately.

Headless source checks now exercise these boundaries with an ordinary base-R
project and the original paired analysis through the same operations. Actual npm
installation is recorded by the application acceptance. Browser views, input and
accessibility in gate 5 remain pending. Historical headless/scientific evidence
continues to identify its original composition.
