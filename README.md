# Rho plugins

This repository owns Rho's actual functional components: Agents, editors, file
operations, tables, plots, scientific methods, evaluation and other selected
capabilities. Components retain their native conditions, semantics, results and
checks; CLI, Skills, MCP and UI are optional entry points to the same functionality.
[Rho-core](https://github.com/YuLab-SMU/Rho-core) is the intelligent system's
foundation, providing generic managed execution through its public CLI; the
[Rho application](https://github.com/YuLab-SMU/Rho) is the application container,
owning component selection, assembly and presentation.

`main` contains the selected rebuilt work. The complete former implementation is
preserved on the published
[`codex/legacy-plugins-before-rebuild`](https://github.com/YuLab-SMU/Rho-plugins/tree/codex/legacy-plugins-before-rebuild)
branch. Its sixteen packages, Core dependency snapshots, build tools, Jet source
and patches are historical references, not dependencies of this branch or a list
of features to restore.

## Available work

| Entry | What it does | Current boundary |
| --- | --- | --- |
| [Agent evaluation plugin](plugins/agent-eval/README.md) | Runs explicit public Core CLI trials, invokes domain-owned checkers and regrades retained evidence | Reusable Python source plugin; no application installation or automatic improvement loop |
| [Real R analysis recipe](examples/real-r-analysis/README.md) | Paired airway/GSE52778 DESeq2 analysis, donor sensitivity, conditional simulations and artifact checks | Real batch consumer and domain acceptance; no interactive R-memory recovery |

The [component architecture](docs/ARCHITECTURE.md) records the selected shared
action/resource/selection/view semantics and headless/application consumption.
The [current status](docs/STATUS.md) distinguishes implementation, verification
and selected design. The [rebuild plan](docs/REBUILD.md) retains domain evidence
and ownership. Execution success, domain checks and model judgments remain
separate facts. There is no implemented general component runtime or application
integration on this branch.

## Run and verify

The evaluation entry uses Python's standard library. Core trials require an
explicitly selected public `rho-core` binary; model trials additionally use the
caller's configured Claude Code CLI. Neither requires Core source, a legacy SDK,
Rust build tools or the former plugin protocol.

```sh
python3 plugins/agent-eval/run.py --help
python3 plugins/agent-eval/run.py core-agent --binary /absolute/rho-core --baseline --trials 1
python3 plugins/agent-eval/run.py r-artifacts /absolute/airway/artifacts

python3 -m unittest discover -s plugins/agent-eval -p 'test_*.py' -v
RHO_EVAL_CORE_BINARY=/absolute/rho-core python3 -m unittest discover -s plugins/agent-eval/core-agent -p 'test_*.py' -v
```

The R recipe documents its existing R/package prerequisites and native resource
limits. Checks can read retained artifacts without rerunning analysis or starting
Core. Outputs and local evidence stay in ignored `target/` or a caller-selected
new directory; tracked acceptance records do not publish those private files.
See [evaluation acceptance](plugins/agent-eval/ACCEPTANCE.md) and
[R fact acceptance](examples/real-r-analysis/ACCEPTANCE.md) for actual checks,
original failures and scientific limits.

## Selected next composition

Rho's selected direction is an Electron + React/TypeScript/Vite container with
Dockview. Selected first-party views use CodeMirror 6, AG Grid Community and
ECharts; Agent-composed views use a typed component catalog, with json-render as
the initial candidate. Independent HTML views may use isolated MCP Apps when
needed. These are design choices, not installed packages or delivered UI.

The first integrated flow combines natural-language actions, actual script/table/
plot resources, linked selection, docking/detachment and continuation of the
original managed task. These experiences evolve together. Native functionality
remains usable headlessly; Core does not load UI or acquire the Agent's model loop.
See [integrated acceptance](docs/ARCHITECTURE.md#first-integrated-acceptance).

R batch recipes, scientific artifact checks and bounded evaluation remain real
component work. Candidate optimization, Git rollback, development/validation/
blind-test management, uniform loading and application integration are still
unimplemented. Select concrete behavior and fix its actual Owner.

Source is licensed under [AGPL-3.0](LICENSE). Current handling and reporting rules
are in [Privacy](PRIVACY.md) and [Security](SECURITY.md).
