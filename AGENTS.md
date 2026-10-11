# Working on the Rho plugin rebuild

Read [README](README.md), [Rebuild plan](docs/REBUILD.md) and inspect Git status
before editing. The former source is retained on the local branch
`codex/legacy-plugins-before-rebuild`. New work is selected on `main`; its old
source tree has not been cleared. Branch creation does not publish the archive.

Start with a real user action, its domain owner and observable completion
conditions. Try the existing Core managed CLI and maintained R/native tools
before adding a plugin. The selected [real-R analysis](examples/real-r-analysis/README.md)
must produce actual input, session, continuation and artifact evidence; a Core
fixture or a successful command is not scientific acceptance. Record failures
and limitations before choosing the smallest owner change. Do not assume all
sixteen old plugins, their package protocol or a provider framework must return.

Each domain owner keeps native state, preconditions, execution, observations,
scientific interpretation and recovery. Core owns only its documented managed
guarantees; the application owns composition and presentation. Do not import
private Core/application source, create a second managed-execution journal or
claim coverage of external effects. Reads do not start or recover runtimes.

The existing `crates/`, `sdk/` and `core-sdk.json` are dependency snapshots of the
former Core. They are not the new Core contract. Do not edit or refresh them,
update application locks, migrate legacy catalogs or add compatibility layers
to close this planning or domain-trial task. A later integration explicitly
selects the needed public boundary and consumers. Consult archived code only to
answer a concrete requirement. Jet and its ordered patches remain owned here;
run `node scripts/vendor-jet.mjs check` when changing them.

Use fresh projects and storage. Never restart a user's Host or live R session
for verification. Keep original request identity, native facts, partial results,
uncertainty and no-replay continuation observable. Waiting interruption,
execution interruption, host restart and native-session recovery are separate
claims; test only the selected guarantee. Packages inspection stays read-only.

Choose focused behavior checks for the changed owner. Old package counts,
directory assertions and whole-product suites are not acceptance requirements.
Reuse applicable built components; never run Cargo builds/tests concurrently.
Report only executed checks and preserve failed or incomplete evidence.
Documentation changes need link/anchor checks and rendered inspection.

Product-authored UI is English; preserve Unicode user content. Substantial UI
redesign needs Paper review under the application's docs/RHO-DESIGN.md.
Commit coherent owner changes. Legacy build commands and Rho/dev.mjs remain
references for the old composition until a new integration is selected.
