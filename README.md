# Rho plugins

This repository owns domain methods, native preconditions, scientific artifact
checks and reusable Agent evaluation. [Rho-core](https://github.com/YuLab-SMU/Rho-core)
owns generic managed execution through its public CLI; the
[Rho application](https://github.com/YuLab-SMU/Rho) owns component selection,
assembly and presentation.

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

The [current status](docs/STATUS.md) distinguishes implementation, verification
and remaining design. The [rebuild plan](docs/REBUILD.md) records ownership and
why new methods and evaluation stay outside Core. Execution success, domain
checks and model judgments remain separate facts.

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

## Subsequent work

Priorities are R batch recipes, scientific artifact provenance/integrity/retrieval,
and bounded evaluation improvement. Candidate optimization, Git rollback,
development/validation/blind-test management, uniform plugin loading and new
application integration remain unimplemented. Select a new capability from an
observed user gap and fix it in its owner.

Source is licensed under [AGPL-3.0](LICENSE). Current handling and reporting rules
are in [Privacy](PRIVACY.md) and [Security](SECURITY.md).
