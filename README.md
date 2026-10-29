# Rho-plugins

Rho-plugins owns reusable functional capabilities: documents/code, files and
artifacts, runtime adapters and object inspection, requirements, tables, media,
charts, Agent integration and anchored feedback. Each capability owns its
behavior, native preconditions, resources, results and checks. Project analysis
workflows compose these capabilities; they are not plugins.

[Rho-core](https://github.com/YuLab-SMU/Rho-core) supplies the execution foundation.
[Rho](https://github.com/YuLab-SMU/Rho) assembles components into an application.
A component can serve headless callers and application users through optional
CLI, Skills, MCP or UI entries to the same functionality.

## Plugin boundary

The [reusable plugin model](docs/PLUGIN-MODEL.md) defines capability ownership,
headless and UI entries, resource/selection contracts and extraction acceptance.
The [concrete catalog](docs/PLUGIN-CATALOG.md) names the first-party
capabilities and their entries.
UI entry designs do not establish shipped renderers.
A plugin can contribute several views over one state owner. Rho selects and
arranges those entries; a workflow's dataset, method choices and sequencing stay
in project code or an example. The 0.4 implementation ships those
capabilities as nine independent npm plugins; browser entries remain separate work.

## Implemented capabilities

The nine `@rho-workspace/plugin-<id>` packages have independent versions, pinned in
each package manifest and the selected application composition. Each
ships its own implementation and descriptor; the generic Contracts package is
shared infrastructure, not a tenth capability. The source root is private and
cannot be packed as an aggregate runtime package.

| Plugin | Available headless behavior | Owner reference |
| --- | --- | --- |
| `documents` | One shared Unicode buffer per document, edits/undo, conditional save and frozen snapshots | [Documents](plugins/documents/README.md) |
| `files` | Scoped resource registration, immutable bytes, inventory and integrity checks | [Files](plugins/files/README.md) |
| `r` | Explicit script execution plans and bounded exported object snapshots; Core owns managed execution | [R](plugins/r/README.md) |
| `requirements` | Declared R dependency probes and explicit project-library preparation plans | [Requirements](plugins/requirements/README.md) |
| `tables` | Declared types/nulls/keys, bounded pages and keyed two-input comparisons | [Tables](plugins/tables/README.md) |
| `media` | Original image/PDF bytes and metadata, checked coordinate context; no renderer | [Media](plugins/media/README.md) |
| `charts` | Validated scatter bindings, stable entity mapping and explicit sampling | [Charts](plugins/charts/README.md) |
| `agent` | Frozen context, bindings/receipts, durable caller intents and project-scoped stdio MCP | [Agent](plugins/agent/README.md) |
| `annotations` | Version-anchored feedback and explicit replies over Documents drafts and source-owner-validated anchors | [Annotations](plugins/annotations/README.md) |

`@rho-workspace/plugin-markdown` is a browser view only, not a capability: a UI
extension over Documents that reads a Markdown document as formatted text
([Markdown](plugins/markdown/README.md)).

Every owner ships `entryVersion:1.0`, versioned operation input/output contracts,
dependency and side-effect declarations, and a digest-checked Skill in its compiled
npm entry. Skills install no global Agent configuration and grant no authority.
An owner may also declare `claudeCode` skills and hooks for the Claude Code sessions
an application starts; the Agent entry writes them into one plugin directory named by
its content (Documents: a native skill and a `PreToolUse` hook).
The shared MCP adapter filters both tool discovery and calls against the live
project catalog, grants and optional plugin filters. HTTP and MCP use the same
functional owners.

The [collaboration guide](docs/COLLABORATION.md) covers the ninth owner and
entry declarations. Documents validates exact UTF-16 ranges; Tables validates
stable-key entities at an exact resource version. Annotations freezes submitted
drafts and source snapshots without creating another mutable buffer. Context
preparation, a tool fetch and an explicitly linked reply remain separate facts;
none proves model understanding or work completion.

The [headless guide](docs/HEADLESS.md), [package inventory](docs/PLUGIN-PACKAGES.md)
and [public interface reference](docs/PUBLIC-INTERFACES.md) describe the original
eight-owner foundation; the collaboration guide records its additive extension.
[Status](docs/STATUS.md) is the current implementation and verification summary.

## Consumers and evidence

[Agent evaluation](plugins/agent-eval/README.md) is a separate development tool:
isolated public Core CLI trials, domain-owned checks and offline regrading. Its
[recorded execution](plugins/agent-eval/ACCEPTANCE.md) is independent of capability
package and application acceptance.

The [paired airway analysis](examples/real-r-analysis/README.md) is a scientific
example and acceptance consumer: DESeq2 analysis, donor sensitivity, simulations
and artifact checks. Its [scientific/execution record](examples/real-r-analysis/ACCEPTANCE.md)
is retained. Neither it nor the [ordinary base-R project](examples/ordinary-r-project/README.md)
is shipped in any capability package. Both explicitly declare scripts, requirements,
artifacts and checks to the same `r.execute` capability.

The Python/R consumers and nine Node capability packages run today. Five view
descriptors (`rho.editor`, `rho.table`, `rho.scatter`, `rho.media`, `rho.object`)
validate properties and bindings, but all report UI unavailable. Browser renderers,
Agent UI and presentation/animation entries remain separate work. The minimal
Annotations headless owner does not implement annotation UI or other anchor kinds.

## Use and verify

Use Node 22.22.x for the npm workspace. `npm test` builds the owners and runs their
component tests; `test:examples` additionally invokes native R examples. Packing
and isolated installation/import checks cover the selected capability tarballs,
not an installed Rho application. Neither example nor the evaluator is bundled.

Evaluation uses Python's standard library. Core trials take an explicitly
selected public `rho-core` binary. Model trials also require the configured
Claude Code CLI and model gateway described in the consumer documentation.
The R recipe uses existing R packages and ordinary files.

```sh
npm ci
npm test
npm run test:examples
npm run pack:plugins -- --destination /absolute/plugin-tarballs
npm run test:install -- /absolute/plugin-tarballs
python3 plugins/agent-eval/run.py --help
python3 plugins/agent-eval/run.py core-agent --binary /absolute/rho-core --baseline --trials 1
python3 plugins/agent-eval/run.py r-artifacts /absolute/airway/artifacts

python3 -m unittest discover -s plugins/agent-eval -p 'test_*.py' -v
RHO_EVAL_CORE_BINARY=/absolute/rho-core python3 -m unittest discover -s plugins/agent-eval/core-agent -p 'test_*.py' -v
```

Each evaluation writes a new evidence directory. Retained artifact checks and
regrading do not invoke a model or rerun the scientific analysis. Read each
consumer's prerequisites, limits and evidence scope before execution.

## Build the shared experience

Scientific code/data/plots, freely composed views and Agent-driven interaction
evolve in one application flow. Rho first delivers an npm local backend, then a
React/TypeScript, Vite and Dockview WebUI in one browser window. Electron and
cross-window movement follow later. Selected views use CodeMirror 6, AG Grid
Community and ECharts. Agent-composed UI uses a typed json-render catalog;
independent HTML views may use isolated MCP Apps when needed.

[Architecture](docs/ARCHITECTURE.md) defines component responsibilities and the
Action, Resource, Selection and View boundaries. The 0.4 headless owners use
declared types, entity namespaces and fields without scientific workflow
branches. Both R projects have passed actual headless execution in Rho. Browser
rendering, input and layout remain selected work.
[Roadmap](docs/ROADMAP.md) defines the first integrated flow.
Rho's [collaboration acceptance](https://github.com/YuLab-SMU/Rho/blob/main/docs/COLLABORATION-ACCEPTANCE.md)
records fixed installed Full and Collaboration-minimal compositions separately
from component checks and the historical eight-owner baseline. There is no
universal component loader, npm registry publication or signed distribution.

Execution completion, artifact completeness, domain checks and model judgments
are distinct facts. Existing authorization is checked at the actual boundary;
models and retrieved content cannot broaden its scope.

See [Privacy](PRIVACY.md), [Security](SECURITY.md) and
[contribution instructions](AGENTS.md). Source is licensed under
[AGPL-3.0](LICENSE).
