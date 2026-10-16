# Current status

Updated: 2026-10-16.

## Implemented capabilities and consumers

[Eight independent headless plugins 0.3](PLUGIN-PACKAGES.md) supply one generic `r.execute` action,
explicit R requirements and preparation, shared documents, declared file/table/
media/object resources, bounded readers and keyed comparisons, typed composition
descriptors and project-scoped stdio MCP. The npm packages ship compiled
capabilities; no project recipe, native R script or scientific checker is bundled.

The [plugin model](PLUGIN-MODEL.md) defines ownership. Documents, files, R, requirements, tables, media, charts and Agent each own a
package, descriptor and implementation. A thin contracts package has no catalog,
capability state, R execution, CSV parser or MCP dependency. Rho selects and wires
services; plugins do not import one another. Only Tables installs csv-parse and
only Agent installs the MCP SDK. Root is a private source workspace. See
[package boundaries and selection](PLUGIN-PACKAGES.md). Five registered view descriptors report UI
unavailable. Those descriptors validate props/bindings without implementing
renderers. There is no marketplace or dynamic loader.

- Ten focused capability tests pass: document/undo budgets, immutable MCP intents,
  typed strings/nulls and entity namespaces, joins/provenance, resource freshness,
  script/argument snapshots, requirement probes, byte completion and containment.
- All eight plugin tarballs passed isolated installation/import with only their
  contracts dependency and required external dependencies. No sibling plugin,
  aggregate package, native R script or example is installed.
- Two separate example tests pass: native singleton histogram behavior and exact
  script identity under a spaced Chinese path.
- The [ordinary R project](../examples/ordinary-r-project/README.md) uses base R:
  four sample rows, real linear-model coefficients, PNG/PDF and an exported model
  snapshot. Identifiers `001` and literal `NA` remain strings.
- The [paired analysis](../examples/real-r-analysis/README.md) is an explicit
  scientific consumer. Rho's new source trial completed five DESeq2 fits,
  16,139-row typed results, independent arithmetic/native checks, apeglm shrinkage
  and a comparison recording both input versions.
- Both projects use the same action, requirements, declaration, reader and
  composition contracts. Rho separately verifies the actual public Core bridge,
  recovery, frozen v1 observations and the npm installation.
- Actual Claude Code 2.1.301 through MCP SDK 1.29.0 fetched v2 context and changed
  the same unsaved Chinese/emoji buffer, without starting a Host.

Application results, current installation evidence and retained failures are in
[Rho's extraction acceptance](https://github.com/YuLab-SMU/Rho/blob/main/docs/EXTRACTION-ACCEPTANCE.md).
The earlier [scientific record](../examples/real-r-analysis/ACCEPTANCE.md) remains
a separate 200-simulation result: five saved models, 121/121 native observations,
12/12 original/retrieved arithmetic checks and rejected altered counterexamples.
The new bounded integration uses one simulation and does not replace that record.

[Agent evaluation](../plugins/agent-eval/README.md) remains a separate development
tool. Its recorded acceptance includes 43 regressions, eight actual CLI baseline
cases, six optional library-fixture cases and one actual-model execution trial.
Retained full-model evidence remains 15/16, including its failure. No evaluator is
required by any capability package.

## Compatibility and remaining work

Rho owns v2 HTTP/client/fixtures and the retained v1 observation bridge. Old requests
keep original parameters, versions and Core identity; observation and restoration
do not rerun recipes. The Plugins collector retains legacy resource/check facts
without selecting old source or requiring the old scientific package set.
Incompatible new work uses v2, rather than redefining the accepted v1 actions.

The first product direction remains npm + local service + a single-window browser
WebUI. React/TypeScript, Vite, Dockview, CodeMirror 6, AG Grid Community and ECharts
are selected UI choices; their views and browser assembly are not implemented.
Electron and cross-window movement follow later. No UI work is part of this
extraction. See [Roadmap](ROADMAP.md#first-integrated-flow).

R execution is batch Rscript. Objects are explicit exported snapshots, with
provenance and bounded JSON previews; there is no live variable inspection or
R-memory recovery after Host replacement. A Core Host is not an R interpreter.
Reads start no Host or R process. Media returns original bytes and metadata,
without image decoding, PDF rendering or browser interaction.

Execution success, byte integrity, domain checks and model judgments remain
separate facts. Generic integrity checks do not validate scientific methods.
Native tools retain the Host's OS authority; this is not an execution sandbox.
Candidate optimization, blind-set management and hillclimbing remain outside the
implemented evaluator.

Source publication, accepted application composition, npm installation and signed
distribution have separate evidence. Local ignored trial artifacts are retained
at their selected paths, rather than published as a permanent remote archive.
