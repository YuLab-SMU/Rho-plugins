# Current status

Updated: 2026-10-13.

## Implemented components

- [Agent evaluation](../plugins/agent-eval/README.md) runs isolated public Core CLI
  trials, invokes domain-owned checkers and regrades retained model evidence.
  Its Python implementation uses explicitly selected public binaries and ordinary
  files. The recorded acceptance includes 43 regressions, eight real CLI baseline
  cases, six optional library-fixture cases and one real-model execute trial.
  The retained full-model evidence remains 15/16, including its failure.
- [Paired airway analysis](../examples/real-r-analysis/README.md) uses
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

## Selected application direction

Components include Agents, editors, files, tables, plots, scientific methods and
evaluation. CLI, Skills, MCP and UI are optional entries to the same functionality.
Rho-core supplies public managed execution; Rho owns selection, assembly and
presentation. [Architecture](ARCHITECTURE.md) defines proposed Action, Resource,
Selection and View concepts and their ownership.

The selected container is Electron + React/TypeScript + Vite + Dockview. Selected
views use CodeMirror 6, AG Grid Community and ECharts; Agent-composed UI uses a
typed json-render catalog, with optional isolated MCP Apps for independent HTML.
Those dependencies, component schemas, general loading and application assembly
are not implemented in this repository.

[The first integrated flow](ROADMAP.md#first-integrated-flow) combines natural-language
actions, actual script/table/plot resources, linked selection, docking/detachment,
unsaved Unicode content and original-task continuation. It has not run. Runtime
lifetime remains independent of views, and reads do not start or recover it.

## Implementation limits

- Editor, file, table, plot and Agent UI components and cross-view interaction
  remain selected work.
- Candidate optimization, candidate comparison/rollback, development/validation/
  blind-test management and hillclimbing are not implemented.
- The R batch consumer does not recover interactive R memory after Host replacement.
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
