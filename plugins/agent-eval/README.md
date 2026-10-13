# Agent evaluation

This reusable Python component runs isolated Agent trials, invokes domain-owned
checkers and regrades retained evidence. It uses the standard library and public
consumer interfaces. Core trials take an explicitly selected public binary;
domain checks use ordinary case files, executable checkers and result files.

## Run a consumer

Run from the Rho-plugins root, or use the script's absolute path. Evidence outputs
must be new directories; the default is `target/agent-evals/<UTC time>/`.
The evaluator does not overwrite an existing report.

```sh
python3 plugins/agent-eval/run.py core-agent --binary /absolute/rho-core --baseline --trials 1
python3 plugins/agent-eval/run.py core-agent --binary /absolute/rho-core --case execute --trials 1
python3 plugins/agent-eval/run.py r-artifacts /absolute/airway/artifacts
python3 plugins/agent-eval/run.py core-agent --regrade /absolute/original/agent-evidence
python3 plugins/agent-eval/run.py check --case /absolute/check-case.json --output /absolute/new/evidence
```

The [Core Agent consumer](core-agent/README.md) defines model prerequisites,
restricted tools, eight scenarios and grading. R artifact checks read existing
files through their domain checker; they do not call a model or rerun analysis.
Offline regrading retains the original evidence and writes new judgments.

A generic checker case can be supplied as JSON:

```json
{
  "id": "domain-result",
  "scope": "The domain owner's selected result checks",
  "command": ["python3", "/absolute/owner/verify.py", "/absolute/artifacts", "--report", "{report}"],
  "identity_files": ["/absolute/artifacts/complete.json"],
  "not_scored": ["Agent autonomy", "Scientific generalization"]
}
```

Commands are argument arrays, without shell parsing. `{report}` must occupy one
complete argument; the evaluator replaces it with a new `owner-report.json` path.
The checker writes a JSON object with Boolean `passed` and may supply its own
checks and limits. Domain interpretation stays with that checker; the evaluator
does not reduce different domains to a common quality score.

Commands, cases and reports must not contain credentials. Authentication stays
with native tools. Cases are not an OS sandbox; the evaluator starts and cleans
only its owned checker process group.

## Evidence and limits

Core trials record the selected binary's SHA-256 and the public contract read
from that binary. `--binary`, `RHO_EVAL_CORE_BINARY` or PATH selects it. The
optional library-fixture mode requires an explicit `--transport fixture` and
`--fixture-binary /absolute/eval_fixture`; CLI mode needs neither that fixture nor
Rust tooling.

Generic and R artifact checks retain cases, checker/source digests, input identity
digests, original owner reports, stdout/stderr, exit codes, exceptions, per-trial
judgments and a summary. Declared identity files are compared before and after
checking. Changed identity, owner failure, nonzero exit, timeout and missing or
invalid reports are failures. Unscored scope remains explicit.

The [R checker](../../examples/real-r-analysis/verify.py) owns pairing, file
integrity and independent arithmetic checks. It does not refit DESeq2 or read RDS
models. Checking existing bytes does not establish an undocumented earlier run's
provenance or autonomous research.

| Protected resource | Configuration | Exceeded-limit behavior |
| --- | --- | --- |
| Number of checker trials | `--trials`: 1–20, default 1 | Invalid counts are rejected before execution |
| Owned checker runtime | `--timeout`: 0.01–600 seconds, default 180 | Stop the owned process group and retain failure/partial evidence |
| Combined retained stdout/stderr and readable owner report | `--max-output-bytes`: 1 KiB–64 MiB, default 8 MiB | Retain bounded output, stop the owned process group and fail the check |

Other files written by the checker, scientific input memory and disk use remain
the domain owner's responsibility. These limits are not a disk or whole-environment
quota. Interruption preserves the planned denominator and lists unrun trials.
Repeated checks use new evidence directories.

## Verify and extend

```sh
python3 -m unittest discover -s plugins/agent-eval -p 'test_*.py' -v
RHO_EVAL_CORE_BINARY=/absolute/rho-core python3 -m unittest discover -s plugins/agent-eval/core-agent -p 'test_*.py' -v
```

These regressions check the shared owner-checker entry and the Core CLI/scorer
consumer without a model call. [Acceptance](ACCEPTANCE.md) retains actual results,
failed attempts and scope. A recorded 15/16 model result keeps its remaining
failure; it is not a general reliability claim.

Candidate comparison, Git rollback, blind-set management and automatic
hillclimbing are not implemented. [Roadmap](../../docs/ROADMAP.md#evaluation-and-improvement)
defines that separately selected work. Current component checks do not establish
application loading, UI integration or installation.
