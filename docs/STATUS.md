# Current status

Updated: 2026-10-16.

## Implemented prototype and consumers

- [Headless components 0.1](HEADLESS.md) exports persistent shared documents,
  action-local R dependency checks/preparation, actual resource/data readers,
  a finite typed catalog, apeglm shrinkage and a project-scoped stdio MCP adapter.
  Eight focused tests pass. Rho separately exercised the actual HTTP/public Core
  CLI composition, real Claude Code handoff and 16,139-gene analysis/comparison.
  This 0.1 prototype still mixes reusable behavior with workflow-specific actions,
  package requirements, column readers and bindings. UI entry points remain
  unavailable; the external client owns its model loop.

- [Agent evaluation](../plugins/agent-eval/README.md) runs isolated public Core CLI
  trials, invokes domain-owned checkers and regrades retained model evidence.
  Its Python implementation uses explicitly selected public binaries and ordinary
  files. The recorded acceptance includes 43 regressions, eight real CLI baseline
  cases, six optional library-fixture cases and one real-model execute trial.
  The retained full-model evidence remains 15/16, including its failure.
- [Paired airway analysis](../examples/real-r-analysis/README.md) is an example
  and acceptance consumer, not a plugin. It uses
  airway/GSE52778, donor-paired DESeq2, four donor-omission fits and 200 conditional
  simulations. The recorded R execution took 562.6595 seconds. Wait-client
  interruption retained the original run/PID and one native entry. Original and
  retrieved artifacts each passed 12/12 checks; five saved models passed 121/121
  native observations. Three altered counterexamples were rejected.

The [evaluation record](../plugins/agent-eval/ACCEPTANCE.md) and
[scientific record](../examples/real-r-analysis/ACCEPTANCE.md) retain failures,
check scopes and incomplete guarantees. Source-only execution with a copied Core
binary passed the eight CLI baseline cases without a Core checkout. Recorded
runs establish only those subjects and environments.

## Current focus: reusable capability extraction

The [plugin model](PLUGIN-MODEL.md) selects documents/code, files/artifacts,
R execution/objects, requirements, tables, media, charts and Agent integration as
reusable capability boundaries. Several views can share one capability/state
owner. A fixed analysis workflow stays in project code or an example. Domain
extensions require a reusable native operation or resource adapter; Agent
evaluation remains a separate development tool.

The current catalog still registers `airway.analyze`/`airway.shrink`; the base
package includes the example. Readers still know `gene_id`, scientific columns
and model pairing. Extraction into explicit providers and generic contracts is
pending, as are a base install without the example and a second non-gene consumer.
These gates precede plugin UI acceptance. The
[Rho extraction plan](https://github.com/YuLab-SMU/Rho/blob/main/docs/PLUGIN-EXTRACTION.md)
records source locations, owner changes and compatibility requirements. Current
scientific/headless passes retain their actual scope and do not accept this model.

## Selected application direction

CLI, Skills, MCP and UI are optional entries to reusable capabilities.
Rho-core supplies public managed execution; Rho owns selection, assembly and
presentation. [Architecture](ARCHITECTURE.md) defines proposed Action, Resource,
Selection and View concepts and their ownership.

The first application delivery is npm + local service + a single-window browser
WebUI with React/TypeScript, Vite and Dockview. Electron follows later. Selected
views use CodeMirror 6, AG Grid Community and ECharts; Agent-composed UI uses a
typed json-render catalog, with optional isolated MCP Apps for independent HTML.
View library dependencies and browser UI assembly are not implemented. The
headless package supplies concrete finite schemas and owner APIs, not a universal
loader.

[The first integrated flow](ROADMAP.md#first-integrated-flow) combines natural-language
actions, actual script/table/plot resources, linked selection, docking and splits,
unsaved Unicode content and original-task continuation. Its headless portion has
run in Rho; actual browser interaction remains pending. Runtime
lifetime remains independent of views, and reads do not start or recover it.

## Implementation limits

- The new bounded smoke analysis uses one conditional simulation. Original
  200-simulation evidence remains separate. The first singleton plot failure and
  first shrink checker S4-load failure remain recorded with their repairs. The
  installed-path trial also exposed Rscript's `~+~` space encoding in `--file`;
  decoding a nonexistent raw path now preserves the actual script digest, with
  a native R regression under a spaced Chinese path.
- Generic resource/key/field contracts, recipe-free base packaging and typed
  capability/view contributions are not yet extracted from the 0.1 prototype.
  Editor, file, table, media/chart, object and Agent UI entries remain work.
- Candidate optimization, candidate comparison/rollback, development/validation/
  blind-test management and hillclimbing are not implemented.
- The R batch consumer supplies no general live-variable inspection or interactive
  R-memory recovery after Host replacement. The selected initial object view
  contract consumes explicit exported snapshots; that generic entry is pending.
  Its numerical checks do not independently validate every model assumption.
- Core execution success, checker results, model judgment and scientific validity
  remain separate. Current evidence does not establish autonomous scientific
  research or a complete application composition.
- Native tools use the Host's OS authority. Caller namespaces, bounded output and
  UI isolation are not a native execution sandbox.

Local scientific artifacts and evaluation evidence remain at their chosen paths.
Ignored evidence is not published or a permanent remote archive. Source publication,
application composition, signed delivery and installation have separate evidence.

Current documentation links/anchors, rendered pages and consistency of source
ownership have been checked. These checks do not rerun model trials or scientific
fitting or extend their recorded acceptance.
