# Working on the Rho plugin rebuild

Read [README](README.md), [Component architecture](docs/ARCHITECTURE.md),
[Rebuild plan](docs/REBUILD.md) and [Status](docs/STATUS.md), and inspect Git status
before editing. `main` owns only
selected new plugin work. The complete former implementation is preserved on the
published `codex/legacy-plugins-before-rebuild` branch. Do not restore its sixteen
packages, SDK snapshots, build tools or state models merely for compatibility.

Plugins are actual functional components, including Agents, editors, files,
tables/plots, scientific methods and evaluation. CLI, Skills, MCP and UI are
optional entries to the same functionality. Headless/application use does not
require Core to load UI. The selected architecture is a future design; preserve
the distinction between it and the implemented R/evaluation consumers.

Start with a real user action, its domain owner and observable completion
conditions. Try the existing public Core managed CLI and maintained R/native
tools before adding a plugin. The selected
[real-R analysis](examples/real-r-analysis/README.md) must produce actual input,
continuation and artifact evidence; a Core fixture or successful command is not
scientific acceptance. Record failures and limitations before selecting the
smallest owner change.

Each domain owner keeps native state, preconditions, execution, observations,
scientific interpretation and recovery. The
[evaluation plugin](plugins/agent-eval/README.md) owns isolated trials, evidence
and grading; it invokes domain checkers rather than taking their semantics.
Core owns only its documented managed guarantees and deterministic regressions;
the application owns composition and presentation. Do not import private Core
or application source, create another managed-execution journal, or claim
coverage of external effects. Reads do not start or recover runtimes.

Public Core binaries are explicit caller inputs. No new SDK, HTTP/MCP, plugin
loader, installation or application integration is implied by this repository.
Do not refresh old consumer snapshots, update application locks or migrate legacy
catalogs to close a plugin task. Consult archived code only to answer a concrete
requirement; native tooling belongs to its actual domain owner when selected.

Use fresh projects and storage. Never restart a user's Host or live R session
for verification. Keep original request identity, native facts, partial results,
uncertainty and no-replay continuation observable. Waiting interruption,
execution interruption, Host restart and native-session recovery are separate
claims; test only the selected guarantee.

Choose focused behavior checks for the changed owner. Old package counts,
directory assertions and whole-product suites are not acceptance requirements.
Use the evaluation README's Python regressions and explicitly selected public
binary. Reuse valid evidence; no model reevaluation or R refitting is needed for
an unchanged consumer. Never run Cargo builds/tests concurrently if later native
work is selected. Report only executed checks and preserve incomplete evidence.
Documentation changes need link/anchor checks and rendered inspection.

Product-authored UI is English; preserve Unicode user content. Substantial UI
redesign needs the application's design review. Commit coherent owner changes.
Before publication inspect the actual remote, branch and account, carry forward
user authorization, and verify remote heads. Preserve required archive branches
before removing their source from main. Source publication, release, installation
and application integration are distinct outcomes.
