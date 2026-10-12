# Rho official plugins

This repository owns scientific implementations, domain contracts, native
adapters, methods and optional views. A reusable Agent evaluation and improvement
plugin has also been selected: it will organize trials and call owner-supplied
checkers, while scientific semantics remain with each domain owner and Core
contract regressions remain in Core. This is a design decision; the shared plugin
and improvement workflow have not been implemented. See the
[evaluation boundary](docs/REBUILD.md#agent-评估与改进插件). The new
[Rho-core](https://github.com/YuLab-SMU/Rho-core) provides selected managed
execution through a library, local host and CLI. The
[Rho application](https://github.com/YuLab-SMU/Rho) owns composition and presentation.

The former plugin source has been backed up on the local branch
`codex/legacy-plugins-before-rebuild`. New work proceeds on `main`; this planning
step has not cleared its old source tree or rebuilt the plugins. The archive
branch has not been pushed. The existing sixteen packages and their Core
dependency snapshots describe the old implementation, not an accepted new-Core
composition or a requirement to recreate all packages.

Read the [rebuild plan](docs/REBUILD.md) and
[real-R domain trial](examples/real-r-analysis/README.md). The selected trial uses
the public airway/GSE52778 RNA-seq data, a donor-paired DESeq2 analysis and
leave-one-donor-out checks plus 200 model-conditional count simulations. The
[observed acceptance](examples/real-r-analysis/ACCEPTANCE.md) records a 9-minute
23-second native run, continuation of the original request, verified retrieval,
independent arithmetic checks and native model observation. Its scientific limits
and original failures remain explicit. Only demonstrated gaps select subsequent
plugin or application work; this plan assumes no new SDK or plugin protocol.

## Historical capability-transfer references

These documents record the former Core-reduction plan and old consumers. They
remain available to answer concrete requirements; they do not select rebuild
work or require legacy-data migration:

| Owner | Required capability preservation |
| --- | --- |
| [Studio](plugins/studio/MIGRATION.md) | Source editing, builds, fixture previews, disposable backend tests and development drafts |
| [Manager](plugins/manager/MIGRATION.md) | Scenario definitions, history, preparation and composition orchestration |
| [Editor](plugins/editor/MIGRATION.md) | Document identity, acknowledged drafts, external-file conflicts and public editing actions |
| [Console](plugins/console/MIGRATION.md) | Command input, acknowledged view state and original execution continuity |

No receiving flow is claimed complete by keeping these documents. New domain
work does not require Studio, Manager, Editor, Console or their old state models.

## Legacy development reference

The following commands build or check the retained implementation against its
old pinned public dependency. They do not verify compatibility with rebuilt Core
or run the new domain trial. Use the trial's own instructions for selected work.

```sh
npm ci --ignore-scripts
node scripts/check.mjs
node scripts/build.mjs files /new/external/files-package
node scripts/build.mjs r /new/external/r-package
```

The normal builder reuses this repository's Cargo cache. `--independent` additionally
builds the selected self-contained source package. UI tool dependencies live in
this repository's `node_modules`, independently of the application's tools.

`crates/` and `sdk/` contain the former public dependency pinned by `core-sdk.json`.
Keep these snapshots unchanged during planning and the real-domain trial; do not
refresh them from rebuilt Core. A future selected integration defines its own
public dependency before any consumer update. Native scientific libraries, Jet
and its ordered patches are owned here.

Use focused tests for the changed owner, for example:

```sh
cargo test -p rho-files-backend --locked
python3 /absolute/files-package/tests/protocol.py /absolute/files-package/dist/rho-files-backend
```

The old application connection tests live in `Rho/scripts/test-composition.mjs`
and consume old built artifacts. Their historical results do not establish a
new-Core integration. Whole-product runners, package-count and monorepo-path
checks are not rebuild prerequisites. Component READMEs describe the retained
protocol behavior; use them only for concrete owner requirements. No runtime or
user installation is started by a build.
