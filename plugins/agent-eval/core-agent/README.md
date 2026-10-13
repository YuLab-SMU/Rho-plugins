# Core CLI Agent evaluation

This consumer checks whether a real Agent understands and uses Core's managed
execution guarantees. Default trials use a resident `rho-core serve` Host and
public CLI. The controller, restricted entry and predefined scripts isolate the
trial and record actual calls and native results.

## Environment and execution

CLI mode requires Unix, Python 3's standard library and a selected public Core
binary. Model trials also require Claude Code and a configured local Magpie
instance. The recorded environment used Claude Code 2.1.296 with Magpie's
`WestlakeHPC` provider and requested route `westlakehpc/deepseek-v4.1-flash`.
Core has no model dependency.

The runner reads the gateway address and authentication from
`~/.claude/settings.json` and verifies that WestlakeHPC has no fallback in
`~/.config/magpie/providers.json`. It does not change these configurations.
`--settings` selects another Claude settings file; `RHO_EVAL_AUTH_TOKEN` can
supply authentication. Keep authentication values out of commands and reports.
Only a local gateway URL is accepted: local provider configuration does not
establish another instance's routing behavior.

```sh
RHO_EVAL_CORE_BINARY=/absolute/rho-core python3 -m unittest discover -s plugins/agent-eval/core-agent -p 'test_*.py' -v
python3 plugins/agent-eval/run.py core-agent --binary /absolute/rho-core --baseline --trials 1
python3 plugins/agent-eval/run.py core-agent --binary /absolute/rho-core --trials 3
```

Run regressions and the model-free baseline first. Baselines check mechanical
calls and grading; they are not Agent trials. Use `--case` repeatedly to choose
scenarios, for example `--case cancel --case delivery_reply_unknown`.
`--output` selects a new evidence directory. `--subject-label` is a caller label;
the binary digest establishes artifact identity. Without `--binary`, selection
uses `RHO_EVAL_CORE_BINARY` or PATH, never an inferred source/build path.

Default `--transport cli` covers eight scenarios. Optional `--transport fixture`
uses a public library caller for six scenarios and requires
`--fixture-binary /absolute/eval_fixture`. That mode lacks the two CLI delivery
failure scenarios. CLI mode does not use the library fixture or require a Rust
build. Core source and the Rho application are not prerequisites.

## Restricted trial actions

The runner fixes the main and auxiliary model selection. It does not enable a
routing group, Claude fallback, user/project settings, hooks, extra MCP tools or
a persistent session. It uses `--restricted`, selected Read/Bash tools and
`Bash(./rho-core *)`; fixture mode uses `Bash(./core-call *)`.
These permissions constrain trial tools and are not an OS sandbox.

The entry accepts only predefined `sum`, `hold` and `loud` scripts and bounded
CLI parameters. The Agent cannot submit arbitrary code. `capability --contract`
returns the selected binary's actual contract; other calls retain raw JSON replies
and exit codes. Input and documents are read through Read. The configured tool
surface does not authorize Python pipelines, jq, redirection or extra tools.

Compose operations by calling and reading each result. A command sequence has
no transaction guarantee. A later failure cannot justify replay of earlier effects
under a new identity. The recorded Python-pipeline rejection remains a failed
trial; it is not reinterpreted as success.

## Scenarios and checks

| Scenario | Observable conditions |
| --- | --- |
| `plan_only` | No acceptance or native dispatch; inputs unchanged; no invented operation |
| `execute` | `sum-100` dispatches once; actual file contains 1..100; Agent reads 5050 and confirmed exit |
| `resume_finished` | Reopened Host exposes the same operation and original output without resubmission |
| `unknown_after_crash` | Real Host termination; native child closes inherited stdin and remains gated; new Host reports unknown exit and protected records, with no redispatch or cancellation |
| `cancel` | Agent cancels `hold-1` and observes actual exit and group release |
| `truncated_output` | `loud-1` emits 200 bytes with 64 retained; Agent reads actual output and reports counts/incompleteness without rerun |
| `delivery_not_sent` | First real submit exits 3/`host_unavailable` on an absent Host; after its recovery, original `sum-100` runs once |
| `delivery_reply_unknown` | Proxy forwards a real submit and receives acceptance, then discards the reply; CLI exits 4/`reply_unknown`; Agent looks up original `sum-100` and obtains its result without a new identity |

Each trial uses independent temporary inputs, project and storage. The controller
owns the real resident Host. The Agent uses
`./rho-core submit/lookup/list/wait/read/cancel/capability`; the entry validates
script choice, then invokes actual public clients. Acceptance, dispatch and results
are not simulated. Library-fixture mode uses `./core-call '<JSON>'`.
Controller records retain calls and replies. Cleanup stops only owned Hosts and
processes, including its crash-experiment children.

Checks do not require one fixed query order. They inspect native dispatch count,
original operation identity, artifacts, facts actually obtained by the Agent and
its structured report. Extra reads are allowed when reported accurately. A read
of another currently unretained identity returning exit 1/`not_found` is a negative
observation; it proves neither historical nonacceptance nor permission to replay.
The original task must be observed through successful queries. Original-task
`not_found`, write errors, scope errors and other failures remain failures.

Without a read, output-completeness fields must be `null`. New model trials use
Claude `--json-schema` for one four-field `structured_output`, then independently
check its facts. Successful termination without that report fails. Repeated or
conflicting reports fail; the scorer cannot choose the last one to hide conflict.
Mirrored events of the same assistant text count once. `StructuredOutput` tool
inputs count as reports; identical events for one tool ID count once, while
multiple tool IDs remain multiple submissions. Regrading text-report evidence
uses its recorded single-report contract; formatting does not erase failures.

Open-ended solution quality, semantic consistency throughout natural-language
responses and scientific correctness are explicitly `not_scored`. Domain tasks
require their own native outcomes and independent checks. This consumer has no
LLM judge and does not accept autonomous scientific work.

## Evidence and resource limits

Default evidence is ignored locally at `target/agent-evals/<UTC time>/`:

- `manifest.json` records plugin source state, caller label, binary/source digests,
  Claude version, route, transport, report schema and limits. `source/` contains
  evaluation source. Per-trial `contract.txt` comes from the binary; `cli-guide.md`
  contains restricted consumer instructions.
- `scenario.json`, `prompt.txt`, `calls.json`, `state.json` and `report.json` retain
  conditions, calls, final facts, checks and visible answers. CLI evidence includes
  real argv, exit codes, raw replies and Host evidence at delivery-failure boundaries.
- `trace.jsonl` contains visible text, calls/replies and model usage, without hidden
  reasoning or system prompts. The recorded response alias `deepseek-flash` differs
  from the requested route and does not identify underlying model weights.
- `summary.json` includes every planned trial; any failure makes the run nonzero.

| Protected resource | Configuration | Failure behavior |
| --- | --- | --- |
| Trial count | `--trials`: 1–20 per scenario, default 3 | Invalid values rejected before execution |
| Owned Agent runtime | `--timeout`: 1–600 seconds, default 180 | Stop its process group and fail the trial |
| Raw stdout, a line and final report | 8 MiB total, 1 MiB per line, 64 KiB report | Fail on excess |
| Controller request | 32 KiB, 10-second read deadline | Reject or fail the request |
| CLI observation | 20-second entry wait, 15-second real client deadline | Preserve failure evidence |
| Library-fixture response | 10-second wait | Preserve failure evidence |
| Core retained output | 64 bytes per stream; other Core limits use defaults | Actual contract/record determines truncation and status |

Claude cost estimates are not provider billing receipts. These process/output
limits are not memory, disk or whole-environment quotas.

Interruption first stops the owned Agent process group and closes the owned test
Host. Acquired calls, readable state, `interruption.json` and failure reports remain.
Exceptions and incomplete evidence remain failed trials in the original denominator.
Initialization failure retains the scenario and trial number. If state observation
fails, `cli-evidence.json` retains acquired real calls and fault evidence; exception
text masks known authentication values.

## Regrade retained trials

```sh
python3 plugins/agent-eval/run.py core-agent --regrade /absolute/original/agent-evidence
```

New results use separate `regrade-*.json` files with scorer hashes. Original
`report.json` and `summary.json` are not overwritten. Regrading and new trials are
different evidence; model-free baselines are not Agent successes. Local evidence
is not a permanent remote acceptance archive.

Configuration references:
[Claude Code headless execution](https://code.claude.com/docs/en/headless),
[CLI permissions/output](https://code.claude.com/docs/en/cli-reference),
[structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs),
[model gateway](https://code.claude.com/docs/en/llm-gateway) and
[Magpie routing](https://usemagpie.ai/docs/start).
