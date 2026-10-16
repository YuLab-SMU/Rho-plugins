# Rho-plugins

Rho-plugins owns reusable functional capabilities: documents/code, files and
artifacts, runtime adapters and object inspection, requirements, tables, media,
charts and Agent integration. Each capability owns its behavior, native
preconditions, resources, results and checks. Project analysis workflows compose
these capabilities; they are not plugins.

[Rho-core](https://github.com/YuLab-SMU/Rho-core) supplies the execution foundation.
[Rho](https://github.com/YuLab-SMU/Rho) assembles components into an application.
A component can serve headless callers and application users through optional
CLI, Skills, MCP or UI entries to the same functionality.

## Plugin boundary

The [reusable plugin model](docs/PLUGIN-MODEL.md) defines capability ownership,
headless and UI entries, resource/selection contracts and extraction acceptance.
A plugin can contribute several views over one state owner. Rho selects and
arranges those entries; a workflow's dataset, method choices and sequencing stay
in project code or an example. The model is selected architecture; extraction
from the current headless prototype remains pending.

## Current implementations and consumers

| Implementation | Available behavior | Acceptance |
| --- | --- | --- |
| [Headless prototype](docs/HEADLESS.md) | Shared documents and MCP adapter; dependency/data readers and scientific actions still coupled to the paired example | [Component and integration scope](docs/HEADLESS.md#build-and-verify) |
| [Agent evaluation](plugins/agent-eval/README.md) | Separate development tool: isolated public Core CLI trials, domain-owned checks and offline regrading | [Recorded execution](plugins/agent-eval/ACCEPTANCE.md) |

The [paired airway analysis](examples/real-r-analysis/README.md) is a scientific
example and acceptance consumer: DESeq2 analysis, donor sensitivity, simulations
and artifact checks. Its [scientific/execution record](examples/real-r-analysis/ACCEPTANCE.md)
is retained. It is not a plugin or a base-system requirement. The current 0.1
package still bundles it; separating that dependency is required work.

The Python/R consumers and Node headless component package run today. Editor,
table, plot and Agent UI entries remain independent work. [Status](docs/STATUS.md) records that boundary.

## Use and verify

Evaluation uses Python's standard library. Core trials take an explicitly
selected public `rho-core` binary. Model trials also require the configured
Claude Code CLI and model gateway described in the consumer documentation.
The R recipe uses existing R packages and ordinary files.

```sh
npm ci
npm test
python3 plugins/agent-eval/run.py --help
python3 plugins/agent-eval/run.py core-agent --binary /absolute/rho-core --baseline --trials 1
python3 plugins/agent-eval/run.py r-artifacts /absolute/airway/artifacts

python3 -m unittest discover -s plugins/agent-eval -p 'test_*.py' -v
RHO_EVAL_CORE_BINARY=/absolute/rho-core python3 -m unittest discover -s plugins/agent-eval/core-agent -p 'test_*.py' -v
```

Each evaluation writes a new evidence directory. Retained artifact checks and
regrading do not invoke a model or rerun the scientific analysis. Read each
consumer's prerequisites, limits and evidence scope before execution.

## Build the shared experience

Scientific code/data/plots, freely composed views and Agent-driven interaction
evolve in one application flow. Rho first delivers an npm local backend, then a
React/TypeScript, Vite and Dockview WebUI in one browser window. Electron and
cross-window movement follow later. Selected views use CodeMirror 6, AG Grid
Community and ECharts. Agent-composed UI uses a typed json-render catalog;
independent HTML views may use isolated MCP Apps when needed.

[Architecture](docs/ARCHITECTURE.md) defines component responsibilities and the
Action, Resource, Selection and View boundaries. The finite 0.1 headless catalog
is implemented but contains workflow-specific actions and bindings. Reusable
capability extraction and a second non-gene consumer precede plugin UI acceptance;
UI rendering remains selected work.
[Roadmap](docs/ROADMAP.md) defines the first integrated flow.
The [headless package](docs/HEADLESS.md) documents the implemented entries and
actual Rho composition checks. There is no universal component loader.

Execution completion, artifact completeness, domain checks and model judgments
are distinct facts. Existing authorization is checked at the actual boundary;
models and retrieved content cannot broaden its scope.

See [Privacy](PRIVACY.md), [Security](SECURITY.md) and
[contribution instructions](AGENTS.md). Source is licensed under
[AGPL-3.0](LICENSE).
