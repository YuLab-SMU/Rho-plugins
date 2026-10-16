# Component roadmap

Rho-plugins develops concrete functional components for both headless callers and
the Rho application. [Architecture](ARCHITECTURE.md) defines ownership;
[Status](STATUS.md) records implemented behavior and unresolved limits.

## Reusable foundation before plugin UI

The [plugin model](PLUGIN-MODEL.md) separates reusable capability plugins, their
optional entries and project workflows. The headless 0.2 package extracts the
reusable foundation; its source trials use both an ordinary R project and the
paired example. The following gates define the delivered headless boundary and
the remaining UI acceptance.

1. Remove the fixed paired recipe from base catalog/packaging. Keep the example,
   scientific checks and historical evidence as an explicit consumer.
2. Extract declared script execution, requirement providers, artifact readers and
   checks behind reusable owners. Rho keeps request mapping and the Core bridge.
3. Declare table types/keys, chart field mappings, media resources and bounded
   object snapshots. Remove gene/fold-change/model assumptions from generic readers
   and application routing. Live R inspection requires its own native adapter.
4. Deliver versioned capability/view contracts, client and fixtures with explicit
   compatibility for old records. Restore missing entries without execution.
5. Verify the base install without scientific example dependencies, an ordinary
   non-gene R project and the paired recipe through the same capabilities. Then
   implement and accept browser entries against those contracts.

The [application extraction plan](https://github.com/YuLab-SMU/Rho/blob/main/docs/PLUGIN-EXTRACTION.md)
records owners, source locations, migration and completion conditions. Actual
source and installation evidence lives in Rho's extraction acceptance. Browser
entries remain pending.

## First integrated flow

The first application flow develops scientific workbench interaction, freely
composed views and Agent-driven UI together. Its selected components cover an
Agent bridge, document/code, runtime, requirements, table, media and chart
capabilities, exercised by an explicitly selected project recipe.

1. A user gives an analysis request. The Agent selects the component's action
   and shows its parameters through a registered UI component. Headless and UI
   entries use the same native implementation and public Core execution capability.
2. Native execution produces actual script, table, plot and provenance resources.
   Execution completion, artifact completeness and scientific checks are visible
   as separate facts, including failures and partial results.
3. Selecting a stable domain object in a table or plot updates participating
   views and the Agent's explicit context within the same resource version.
4. Views dock, split and move within one browser window while retaining Unicode input,
   unsaved content and undo. Agent edits respect buffer ownership and conflicts.
5. Closing an observer and reconnecting find the original task and its actual
   output. Missing acknowledgements preserve the original request identity and
   unknown outcome; they do not cause automatic replay.
6. The Agent composes another view using the same typed catalog, resources and
   actions. Invalid, stale or out-of-scope references produce an observable result.

Rho first delivers an npm local service and React/TypeScript, Vite and Dockview
WebUI. Electron and cross-window movement belong to a later client.
Functional views select CodeMirror 6, AG Grid Community and ECharts; Agent-composed
views use a json-render catalog. MCP Apps is optional for an isolated independent
HTML consumer. [Rho's technology direction](https://github.com/YuLab-SMU/Rho/blob/main/docs/TECHSTACK.md)
is the application selection reference. The [headless component package](HEADLESS.md)
and its Rho HTTP/Core/Agent composition have been checked with two explicit R
projects. UI assembly remains pending.

Acceptance also covers input methods, keyboard access, missing components, stale
resources, failed view restoration and version mismatch. Record the actual chosen
source/artifact identities and overrides. A successful component check alone does
not accept the combination. Set and measure limits for the actual protected
processes, output retention, buffer sizes, subscriptions and rendered resources;
name configuration and exceeded-limit behavior.

<a id="scientific-component-work"></a>

## Scientific recipes and domain extensions

The [paired airway recipe](../examples/real-r-analysis/README.md) is an example,
not a plugin. It supplies real batch execution, conditional simulation, ordinary
artifacts and native/independent
checks. Reuse its evidence within the [recorded acceptance](../examples/real-r-analysis/ACCEPTANCE.md).
Existing R tools, RDS, manifests and ordinary file operations remain valid paths.
Scientific owners retain method choice, model assumptions and interpretation.

Reusable domain extensions may contribute parameterized native operations and
object adapters when a demonstrated consumer needs them. Dataset/design/contrast
choices and workflow sequencing stay in recipes and do not become base contracts.
Extend a recipe or add native-session support only for a demonstrated user need.
A request requiring interactive R memory must specify object identity, lifetime,
input and recovery guarantees before implementation. Waiting continuation does not
establish R-memory recovery after Host replacement.

Artifact work preserves input identities, native versions, completion declarations,
partial outputs and provenance. A copied file is checked against its declared
source. Missing or mutable files stay observable; a name or current path alone does
not establish an earlier task's output.

## Evaluation and improvement

The [evaluation component](../plugins/agent-eval/README.md) provides isolated Core
CLI trials, domain-owned result checks and offline regrading. An improvement
experiment is a separate selected action; its current implementation is pending.

An experiment fixes cases, expected behavior, subject identity, model configuration
and scorer version. It declares allowed candidate changes and compares attributable
patches against a retained baseline. Domain checks stay with their owners; model
judgments cannot override native failure or scientific limits. Exceptions, timeout,
interruption and missing evidence remain in the denominator.

Development cases guide diagnostics, validation cases compare candidates, and a
blind final set supplies held-out acceptance. Material used repeatedly in selection
is no longer an unseen final set. Regrading writes new judgments against retained
materials and scorer identities without replacing original reports. Report gains
within trial variation as insufficient evidence.

Before running, configure trial count, process timeouts, model/token budget and
evidence retention, and define stop behavior for exhaustion. The existing evaluator
implements the documented trial/process/output limits; experiment-wide model
budgets, candidate comparison, Git rollback and blind-set management remain work.
Candidate results do not implicitly publish source, install software or restart
user runtimes.

## Subsequent composition

A second non-gene consumer is delivered as an ordinary base-R project. Subsequent domain extensions and
interoperability adapters require a selected consumer. Deliver owner changes
independently, then accept their actual application combination. Distribution and installation have
separate acceptance and do not follow automatically from source publication.
