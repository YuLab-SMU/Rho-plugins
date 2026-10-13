# Rho-plugins

Rho-plugins owns the functional components used by the Rho intelligent system:
Agents, editors, file operations, tables, plots, scientific methods, evaluation
and other concrete capabilities. Each component owns its behavior, native
preconditions, resources, results and checks.

[Rho-core](https://github.com/YuLab-SMU/Rho-core) supplies the execution foundation.
[Rho](https://github.com/YuLab-SMU/Rho) assembles components into an application.
A component can serve headless callers and application users through optional
CLI, Skills, MCP or UI entries to the same functionality.

## Available components

| Component | Available behavior | Acceptance |
| --- | --- | --- |
| [Agent evaluation](plugins/agent-eval/README.md) | Isolated public Core CLI trials, domain-owned checks and offline regrading | [Recorded execution](plugins/agent-eval/ACCEPTANCE.md) |
| [Paired airway analysis](examples/real-r-analysis/README.md) | DESeq2 analysis, donor sensitivity, conditional simulations and artifact checks | [Scientific and execution facts](examples/real-r-analysis/ACCEPTANCE.md) |

These Python and R consumers run today. Editor, file, table, plot and Agent UI
components, general component loading and application assembly are selected
work, not implemented products. [Status](docs/STATUS.md) records that boundary.

## Use and verify

Evaluation uses Python's standard library. Core trials take an explicitly
selected public `rho-core` binary. Model trials also require the configured
Claude Code CLI and model gateway described in the consumer documentation.
The R recipe uses existing R packages and ordinary files.

```sh
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
evolve in one application flow. Rho's selected container uses Electron,
React/TypeScript, Vite and Dockview. Selected views use CodeMirror 6, AG Grid
Community and ECharts. Agent-composed UI uses a typed json-render catalog;
independent HTML views may use isolated MCP Apps when needed.

[Architecture](docs/ARCHITECTURE.md) defines component responsibilities and the
proposed Action, Resource, Selection and View concepts.
[Roadmap](docs/ROADMAP.md) defines the first joint acceptance flow.
These documents select implementation direction; no SDK, universal loader or
runnable application composition is delivered by these choices alone.

Execution completion, artifact completeness, domain checks and model judgments
are distinct facts. Existing authorization is checked at the actual boundary;
models and retrieved content cannot broaden its scope.

See [Privacy](PRIVACY.md), [Security](SECURITY.md) and
[contribution instructions](AGENTS.md). Source is licensed under
[AGPL-3.0](LICENSE).
