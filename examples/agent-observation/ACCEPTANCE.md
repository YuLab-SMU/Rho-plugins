# Agent observation acceptance, 2026-10-25

Scope: macOS, Claude Code 2.1.310, dsh 0.2.1-rc.2, Agent 0.4.5 source and the selected
Core activity implementation. All four actual model runs used
`westlakehpc/deepseek-v4.1-flash` through the user's authorized Magpie provider.
No credentials, gateway address or private native transcript is published here.
Raw evidence remains in the local ignored `Rho-core/work/agent-observation/` folder.

## Analysis and native backfill

Both clients received disposable inputs: alpha = 1, 2, 8; beta = -3, 4, 7.
They fixed integer division, generated a CSV and SVG, and ran the requested exit-7
diagnostic. The evaluator checked group membership/counts and means independently;
Claude rounded to 3.67/2.67 (absolute tolerance 0.005), dsh retained floating-point
11/3 and 8/3. SVG XML parsed. Visual or scientific-method quality was not graded.

| Actual observation | Claude Code | dsh |
| --- | --- | --- |
| Client duration / exit | 34.82 s / 0 | 52.36 s / 0 |
| Tool calls | 7 | 10 |
| Selected retained events | 14 | 28 |
| Explicit process exit-7 evidence | 1 call | 1 call |
| Current output candidates with hashes | 2 | 2 |
| Repeat collection appended | 0 | 0 |
| After owned Host SIGKILL/restart | Identical events and receipts | Identical events and receipts |
| Managed executions created by observation | 0 | 0 |

Claude also tried a compound command outside its selected Python-only allowlist;
the native rejection is retained, rather than reported as execution. Its later
intentional exit-7 call is a separate observation. dsh reports that command's tool
result as non-error and the job as completed; the parser retains native exit 7
separately. Equating either label with success would lose a real failure.

The first dsh patch paired `workspace-write` with approval `never` but left the
default named preset unmatched. It warned and completed the task. The live trial
explicitly configured that same sandbox/approval pair as its selected preset;
the warning disappeared. The initial diagnostic is retained locally.

## Attach while the original tool runs

Each client ran one foreground Python fixture. It appended one run marker, waited
for an evaluator-owned release file, wrote outputs, and intentionally exited 7.
The native invocation had already begun when the collector attached.

| Actual observation | Claude Code | dsh |
| --- | --- | --- |
| Selected events while the tool was pending | 1 | 2 |
| Pending interpretation | Requested, result unknown | Requested, result unknown |
| Stop collector, SIGKILL its owned Core Host | Agent remained active | Agent remained active |
| Release original fixture, restart Host/collector | 2 total selected events | 6 total selected events |
| Final correlated process exit | 7 | 7 |
| Actual native run markers | Exactly 1 | Exactly 1 |
| Repeat collection | 0 new events; native source hash unchanged | 0 new events; native source hash unchanged |

Collector and Host lifetime therefore separated from the external execution in
these two observed episodes. This does not establish all-version compatibility,
all Agent actions, remote sessions, or a native resumption/control capability.

## Verification scope and retained failures

The seven focused plugin tests cover native identity/scope conflict, duplicate
events, normalized prefix changes, dsh exit semantics, Unicode clipping, partial
vs corrupt JSONL, source limits and bounded current artifact inspection. Core's
independent tests cover transaction/crash, concurrency, retention and caller scope.
The public CLI acceptance script also checks backfill, repeat collection and
Host restart on the real sources above.

During implementation, one TypeScript literal type widened incorrectly and was
corrected. The first acceptance script assumed Core `list` returned an array;
the actual contract returns `{runs: [...]}`. That assertion was corrected and both
native acceptances rerun. Neither failure was counted as a pass.
The first full plugin check also refused a computed dsh import. The reader now
uses three literal imports from the selected native installation, declared as
optional peers and allowed only in that entry by the ownership check.

A fresh isolated install of the packed Agent 0.4.5 and Contracts packages exposed
the CLI and public exports without installing dsh. Its actual CLI read the two
live sources (2/6 events), recovered exit 7 and added zero on repeat. The dsh reader
used the separately selected native installation. This verifies the local package
entry; no user application installation was replaced.

Rho application assembly, browser UI, distribution, user installation, Linux activity
acceptance and semantic model-generated recommendations are outside this record.
The collector and summary are callable source entries; existing application
bindings and user Hosts were not changed.
