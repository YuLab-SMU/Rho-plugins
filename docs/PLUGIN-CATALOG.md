# Concrete capability and entry catalog

Updated: 2026-10-16.

The [plugin model](PLUGIN-MODEL.md) selects the capability boundaries and common
contracts. This document instantiates them: the concrete test for what is a
plugin, the first-party (core) capabilities with their entries and typed
surfaces, and the rules by which the application is assembled from them. It is
selected design, not implemented API; names are descriptive until registered,
and the [extraction plan](https://github.com/YuLab-SMU/Rho/blob/main/docs/PLUGIN-EXTRACTION.md)
owns migration and acceptance.

## The test

A unit is a **capability plugin** only if all four hold:

1. Two distinct consumers need it without the workflow that motivated it.
2. It owns state, resources or native conditions with a lifetime — a buffer, a
   version, an environment probe, a subscription. A button, panel, sort control
   or zoom does not qualify on its own; several views may share one owner.
3. Its contracts can be stated without a dataset, design, contrast, column name
   or method sequence.
4. Removing it reports unavailable and preserves references, drafts and other
   capabilities; nothing is installed or replayed to rebuild a screen.

A **workflow or recipe** fails 1–3 by construction: it fixes data, method
choices, parameters, sequencing and domain interpretation. The paired
dexamethasone analysis is one; it stays project material and an acceptance
consumer. `airway.analyze` and `airway.shrink` are two of its steps, not
capabilities. In the 0.1 catalog, `rho.comparison`'s binding roles `baseline`
and `shrinkage` encode recipe semantics inside a registered component; the
extracted entry takes two declared inputs with explicit keys, fields and join
policy instead. The extraction plan removes these couplings without
invalidating the recorded vertical evidence.

Worked negatives: a DESeq2 plugin; a gene table; a volcano-plot entry; a
"paired-response" dashboard. Worked positives: run this declared script;
display this declared table with this key; check these declared requirements;
mark this figure region.

## Capabilities and entries

Entry kinds follow the model: headless operation, resource reader, view and
context adapter. Each capability below states what it owns, what it must not
know and its entries. Capabilities are responsibilities; package boundaries
follow real consumers, and an explicit module list is sufficient for the first
release. The four surfaces the application direction names — code display,
variable display, dependency checks, figure display and interaction — are the
C1, C3, C4 and C6/C7 entries below, not screens of their own.

### C1 · Documents and code

- Owns: one logical buffer per document; transactions, undo, conflict-aware
  save; immutable snapshots for execution and context.
- Must not know: language, science, or where a run control lives.
- Headless: document read/write, transaction commit, snapshot create/list.
- UI entries: `code-editor` (one buffer per document), `code-view` (read-only,
  optional range), `diff-view` (two versions of one document),
  `snapshot-picker`.
- Contract: every view over one document shares the buffer; a read-only view or
  diff never holds a second authoritative copy.

### C2 · Files and artifacts

- Owns: scoped file inventory, byte snapshots, digests, format declarations,
  bounded text/byte preview and export inputs.
- Must not know: what a file means scientifically. A name or current path is
  not provenance.
- Headless: inventory/list, stat, bounded read.
- UI entries: `file-browser`, `artifact-details` (declared origin, digest,
  version), `text-preview` (bounded).

### C3 · R execution and objects

- Owns: execution plans for explicit script snapshots (saved file or unsaved
  buffer) through Core's public bridge; runtime identity; declared object
  exports and supported inspections.
- Must not know: DESeq2, contrasts, or which script is "the analysis".
- Headless: plan/submit, bounded output observation, object descriptor list,
  bounded object preview.
- UI entries: `run-output` (bounded stdout/stderr observation retaining the
  original request identity), `object-browser` (variable display: descriptors
  with runtime, name, type, shape, observation time, availability),
  `object-preview` (bounded).
- Limits: batch Rscript supplies explicitly exported snapshots only. Listing or
  previewing a descriptor never starts R; live variable inspection, object
  mutation and R-memory recovery require a separately demonstrated native
  adapter.

### C4 · Requirements

- Owns: declared requirements of a selected capability, action or recipe;
  probes bound to the actual environment; explicit preparation plans through
  native providers (first provider: R packages).
- Must not know: a global "environment ready" state; requirements are never
  inferred by scanning arbitrary scripts.
- Headless: probe, prepare.
- UI entries: `requirement-status` (at the selected action: present/missing/
  unknown with check time and scope), `preparation-result`.
- Contract: a check result names its subject, provider, observed time and
  scope; missing entries carry a next step.

### C5 · Tables

- Owns: declared typed columns, null encoding, optional stable row key, bounded
  read/sort/filter, and one checked keyed two-input transform with explicit
  keys, fields and join policy.
- Must not know: `gene_id`, `log2FoldChange`, `baseline` or `shrinkage` as
  semantics.
- Headless: page read, sort/filter, transform.
- UI entries: `table-view` (selection by stable key), `column-details`,
  `keyed-comparison` (two versioned inputs; preserves both versions, unmatched
  rows and nulls).
- Contracts: selection is a resource version plus a declared key space; display
  position is never an entity. A table without a key stays readable and
  sortable, with entity linking unavailable.

### C6 · Media

- Owns: declared image/PDF resources, original bytes, bounded pages and tiles.
- Must not know: what a figure depicts. A pixel rectangle is a coordinate
  selection with its own metadata, not a domain entity.
- UI entries: `image-view` (zoom/pan), `pdf-view` (page navigation).

### C7 · Charts

- Owns: a validated data/spec binding (exact resource version plus declared
  fields), missing-value and sampling facts, and mark-to-entity mapping.
- Must not know: the analysis type; scale and transform choices are declared,
  not guessed.
- Headless: chart data read/validate.
- UI entries: `scatter` (first selected renderer) with linked selection: a mark
  selection maps to source keys, and sampling reports method and coverage while
  preserving original data.
- Contract: a PDF preview is not an interactive chart.

### C8 · Agent bridge and context

Current source candidate Agent 0.4.3 supplies the optional `rho.agent-note` plain
read-only UI entry, with at most 600 characters and application-authenticated
author/binding basis. Its layered MCP mode exposes three small tools and complete
selected contracts; existing compatibility entries remain. Other UI entries below
remain proposed, not shipped renderers. Live-model/installed acceptance is separate.

- Owns: capability discovery for the Agent, granted tools, versioned document/
  resource context, and retention of the caller's original intent.
- Must not know: chat presentation; the external client keeps its model loop.
- Entries: MCP tools/resources; UI `binding-status` (connection, project
  binding and failure continuation), `context-preview` (what an action would
  send), `tool-activity`.

### C9 · Presentation and animation (proposed, for review)

- Why: the selected application direction has the Agent present and explain —
  annotated summaries first, and live compositions or short animated explainers
  as its expression reference. Those are display/interaction surfaces like any
  other; they must come from the registry, not from bespoke screens.
- Owns (proposed): validation of presentation specs that bind registered
  entries to exact resource versions; the renderer for an animated explainer
  built from an editable spec, including timeline, frame addressing and an
  export plan. An explanation artifact is labelled and stays distinct from
  execution, artifact and check facts.
- Entries (proposed): `presentation-host` (a validated composition of
  registered entries), `motion-player`, `motion-editor` (the spec is a
  document under C1: editable, diffable, undoable).
- Liveness rule: a live composition refreshes by re-reading owner facts when a
  referenced resource version changes. It never re-executes; stale or
  unavailable sources are shown as such with their source version, and last
  refresh is part of the surface, not decoration.
- Not: a video-generation model; model-supplied executable code; any science.
- Status: boundaries for review. A saved arrangement without bindings or
  liveness remains Rho's layout domain. Implementation starts with the concrete
  consumer and after the extraction gates.

### C10 · Annotations and feedback (proposed, for review)

- Why: people mark, circle and comment on what the Agent shows, and the mark
  must reach the Agent as context tied to the exact object and version. Every
  presentation surface accepts it, so it needs one reusable owner rather than
  per-view work.
- Owns (proposed): project-scoped annotation content with buffer semantics
  (user content, Unicode preserved), anchor validation against the referenced
  resource version, and serialization into explicit Agent context.
- Anchors: each entry declares the anchor kinds its owner supports — code
  range; table row or region; chart mark or region; image rectangle; motion
  frame or time range; trace step. An anchor is resource reference plus version
  plus kind plus coordinates in the owner's coordinate system; nothing else may
  be treated as an entity.
- Must not know: domain meaning. An annotation steers the next step and joins
  the trace; it never gates or approves execution.
- Entries (proposed): `annotation-layer`, `note-editor` (C1 buffer),
  `send-to-agent` (C8 context).
- Open for review: store owner (this capability versus the application) once
  the consumer exists.

## How the UI composes

1. Registry: installed capabilities publish descriptors and entries at
   explicit versions. Rho resolves entries, validates bindings and routes
   interaction; no universal loader is required.
2. Views are contributions: each view entry declares a props schema, named
   binding roles, accepted resource contracts, anchor kinds, availability with
   a reason, and release behavior. Several views share one owner
   (`code-editor`/`code-view`/`diff-view`; `table-view`/`column-details`).
3. Agent composition selects registered entries and binds references. Schema
   validation never establishes authority, freshness or truth, and models
   cannot supply privileged executable code.
4. Availability and restore: missing UI code hides only that entry; a missing
   capability preserves references and drafts. Reads never start runtimes;
   restore never installs or replays.
5. The shell stays fixed while capabilities and domain extensions add entries.
   This is what makes later UI work plugin-based rather than a set of hardcoded
   screens.

## Consumer proofs

The [model's acceptance gates](PLUGIN-MODEL.md#workflow-location-and-acceptance)
and the [roadmap](ROADMAP.md#reusable-foundation-before-plugin-ui) define the
proofs: a base install without the paired example; an ordinary non-gene R
project using the same entries; the paired recipe as an explicit consumer; and
missing-entry/reconnect behavior without new execution. C9 and C10 add no
separate proof until their consumer is selected; their entries must pass the
same gates before UI implementation.

The Rho design boards W1–W5 on Paper page
[Rho · 工作台 v1 · Release 1 · v3 (capabilities)](https://app.paper.design/file/01M4X13H2YQGGR8NQXE8W0QDQY/p-8-0)
sketch the composed UI over C1–C10 with the paired analysis as content; they are
design evidence pending review, not implementation acceptance.

## Open decisions

1. C9/C10 are included as proposed boundaries now and implemented only with a
   concrete consumer, after the extraction gates.
2. Entry and capability naming is descriptive here; registration waits for the
   extracted modules.
3. Module grouping follows the first consumers; no marketplace, dynamic loader
   or workflow engine.
4. The annotation store owner stays open until C10's consumer exists.
