# Agent evaluation acceptance

Recorded execution: 2026-10-12. This record covers the reusable evaluator's public
Core CLI consumer, domain-checker entry and retained-evidence regrading.
[README](README.md) defines current commands and resource boundaries;
[Roadmap](../../docs/ROADMAP.md#evaluation-and-improvement) defines planned
candidate experiments.

## Accepted behavior

The Core consumer receives a selected public binary and obtains its contract from
actual capabilities. Evidence retains binary and evaluation-source digests.
The shared [entry](run.py) runs Core CLI trials, the R artifact checker and ordinary
owner-checker scripts. Scientific rules remain in the domain checker.
Regrading writes separate judgments without moving or replacing original reports.

## Executed verification

| Check | Result and evidence scope |
| --- | --- |
| Public CLI baseline before shared-entry acceptance | Eight real CLI cases passed; Core `target/agent-evals/20261012T075206.322934Z/` |
| Consumer regressions | 36 CLI/scorer checks and 7 shared owner-checker checks passed; covered identity changes, timeout, bounded output, missing/invalid reports, native failure overriding positive judgment and interruption preserving the denominator |
| Shared-entry CLI baseline | 8/8, including real nondelivery and a lost reply after actual acceptance; plugin `target/agent-evals/20261012T081109.910249Z/` |
| Optional library-fixture baseline | Explicit selected binary, 6/6; `target/agent-evals/20261012T081835.288060Z/`; CLI mode does not require it |
| Real-model execution | One execute trial passed; `target/agent-evals/20261012T081834.105051Z/`; configured Magpie/WestlakeHPC/deepseek-v4.1-flash route and restricted tools |
| R artifact-check reuse | Original airway-03 retrieved artifacts passed 12/12 through the owner's checker; `target/agent-evals/20261012T081111.004498Z/`; no R refit, model call or additional RDS read |
| Execution without a Core checkout | Exported plugin and copied public binary in a temporary directory passed the execute baseline; evidence copied to `target/agent-evals/export-check/`; owned temporary environment cleaned |
| Retained-model evidence regrading | Original 20261011T074746.148572Z remained 15/16; command exited 1 for its retained failure; all 17 report/summary SHA-256 identities unchanged; new judgments in separate files, with check at `target/agent-evals/migration-regrade-check.json` |
| Source-only full CLI baseline | All eight CLI baseline cases passed using an exported source tree and copied public binary without a Core checkout |

`target/` paths are local ignored evidence, not published or permanent remote
archives. Baselines are mechanical calls, not model trials. The new execute pass
does not erase the failed trial in the original sixteen or establish open-ended
semantic quality. R checks verify their declared file/arithmetic scope; they do
not independently refit a model or establish autonomous scientific research.

## Failures and limits

- The initial regression invocation omitted `RHO_EVAL_CORE_BINARY`: seven CLI
  integration checks errored for missing binary selection while 29 others passed.
  With the explicit public parameter, all 36 passed. No build-path guessing was added.
- The first regrading attempt selected a model-free baseline directory and was
  rejected because no Agent trials were available. The actual model directory
  produced 15/16, without mixing baseline trials into that denominator.
- Candidate optimization, patch comparison/rollback, blind-set management,
  an LLM judge and hillclimbing were not implemented or accepted.
- Core runtime behavior was unchanged. Verification used the already validated
  binary; Cargo and platform fault suites were not rerun. Full eight-scenario model
  repetition retained its recorded evidence; only the one execute trial was added.
- Application integration and installation are outside this component acceptance.
  User Hosts and R sessions were not restarted.
