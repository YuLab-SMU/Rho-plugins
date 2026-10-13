# Rho-plugins: functional components

Selected design: 2026-10-13. Rho-core is the intelligent system's foundation;
Rho is the application container; Rho-plugins owns actual functional components.
This page records the selected direction, not an implemented plugin runtime or
application composition. See [Status](STATUS.md) for delivered behavior and
[Rebuild](REBUILD.md) for the retained domain evidence.

## Ownership and entry points

A component may provide an Agent, editor, file operations, data table, plot,
scientific method, evaluation or another real capability. Scientific components
retain their methods, native preconditions, artifact interpretation and checks.
The broader component model does not transfer those semantics to the container.

CLI, Skills, MCP and UI are optional entry points to the same functionality.
Components need only the entries required by their consumers. A command,
MCP tool and UI action that perform the same operation must reuse the component's
implementation, preconditions and result facts. Managed execution entries also
preserve the original request identity.
Skills supply instructions; they do not independently grant authority or execute
a second scientific path.

Headless and application consumption are both supported design goals. A native
component can use Core's public execution capability without a UI dependency;
Rho can assemble its views and interaction. This does not require Core to load
React, interpret plugin manifests or run the Agent's model loop. Core's current
resident CLI is the demonstrated public connection, not its private socket wire.

R, Python, Rust, TypeScript, maintained CLIs and ordinary files remain valid
implementation choices. Do not introduce a mandatory language runtime, Rust
dynamic ABI, scientific WASM runtime or replacement native execution system.

## Shared interaction semantics

The selected composition needs four common concepts. Their exact schema and
versioning will be implemented for a concrete consumer; this page does not create
a new public protocol, SDK or universal loader.

| Concept | Component responsibility | Application responsibility |
| --- | --- | --- |
| Action | Define input, native conditions, effects, results and cancellation semantics | Present and route the selected action with its existing authorization and scope |
| Resource | Identify files, tables, plots, tasks or buffers and their source and validity | Pass resource references and display Owner facts |
| Selection | Identify stable domain objects within a particular resource/content version | Propagate selection between participating views and Agent context |
| View | Provide rendering, actions, subscriptions and release behavior | Place it in the workspace and manage focus, layout and window lifetime |

Selection uses domain identity, such as gene IDs in a particular analysis output,
not a visible row index after sorting. A component checks that selected inputs
still refer to valid content before applying an action. A buffer-local content
version or artifact digest serves its particular resource; there is no global
scientific revision.

## State and lifecycle

Each Owner retains its facts. Core owns its documented managed execution state;
scientific components own native conditions, outputs and scientific checks; the
editor owns unsaved buffers and content conflicts; the Agent component owns its
session and model context; Rho owns layout, focus and application composition.
An application store is not another execution journal or scientific database.

When assembling Rho, the resident Core Host must have a lifetime independent of
its observing windows and renderer processes. Closing or releasing a view is
distinct from cancelling a task or confirming that execution stopped. A new
window queries the original request; uncertainty is preserved and does not cause
automatic submission under a new request ID. Reading must not start or recover
a runtime. Host shutdown and native-session recovery retain Core's actual limits.

Multi-window views share references to the same logical resources. Detaching an
editor view does not create a second authoritative unsaved buffer. Layout restore
does not prove content saved, a task running or an artifact complete. These
properties need explicit acceptance in the chosen application combination.

See Core's [managed contract](https://github.com/YuLab-SMU/Rho-core/blob/main/docs/MANAGED-RUN.md)
and [Host/CLI contract](https://github.com/YuLab-SMU/Rho-core/blob/main/docs/HOST-CLI.md).
Core stdout/stderr are bounded observations, not scientific artifact storage.
Existing manifests, completion declarations, ordinary files and Owner checkers
remain the scientific evidence path.

## UI implementation and interoperability

Rho's selected container direction is Electron, React, TypeScript, Vite and
Dockview. First-party functional views are selected and built with the
application while their source and semantics remain owned by their components.
This is a design choice; no React plugin package, docking implementation or
Electron application currently exists on main.

The first composition selects CodeMirror 6 for editing, AG Grid Community for
tables and ECharts alongside preserved native scientific outputs for plots.
Avoid requiring commercial grid or docking features implicitly; acceptance must
name the actual features and licensing of the chosen combination. These libraries
are implementation choices, not mandatory dependencies of every component.

There are three complementary view forms:

- Trusted React views integrate with the application's theme, commands, selection
  and layout for selected first-party functionality.
- Agent-composed views use a typed catalog, with json-render as the selected
  initial candidate. The Agent describes registered components and binds resource
  and action references. Schema validation is separate from authorization,
  stale-input checks and scientific validity; arbitrary generated privileged
  JavaScript is not the selected integration path.
- Independently supplied HTML views may use an isolated MCP Apps host when a
  real consumer needs it. The host must expose only the selected messages and
  permissions. An iframe or renderer boundary does not sandbox native R/Python
  code or make every plugin safe to run.

An Agent, click or CLI command must encounter the same mechanical checks of the
existing authorization, caller/project visibility and native preconditions.
Models and retrieved content cannot broaden scope. The container does not add
another approval to a request whose authorization already covers the action.
Core caller namespaces are not authenticated principals or an OS sandbox. Native
tools retain the Host's OS authority; UI isolation and bounded output retention do
not add native containment. See the current [Privacy](../PRIVACY.md) boundary.

MCP is an optional tool/resource interface; MCP Apps is an optional isolated UI
interface; AG-UI may adapt a selected Agent's event stream; A2UI may serve a
demonstrated cross-client declarative UI requirement. None replaces Core's
request identity or scientific Owner facts. Agent Plugins packaging can expose
portable Skills/MCP and namespaced Rho extensions, but is not itself Rho's
functional component runtime.

Official references for these design choices:

- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
  and [Dockview licensing/features](https://dockview.dev/docs/overview/licence/).
- [CodeMirror state/view model](https://codemirror.net/docs/ref/),
  [AG Grid Community/Enterprise boundary](https://www.ag-grid.com/react-data-grid/community-vs-enterprise/)
  and [ECharts events/actions](https://echarts.apache.org/handbook/en/concepts/event/).
- [json-render catalog](https://json-render.dev/docs/catalog),
  [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx),
  [AG-UI](https://docs.ag-ui.com/introduction), [A2UI](https://a2ui.org/) and
  [Agent Plugins specification](https://agent-plugins.org/specification).

## First integrated acceptance

Natural-language interaction, linked scientific views and workspace composition
must evolve together. The first selected application slice is:

1. An Agent turns a concrete analysis request into the component's action and a
   parameter view; execution uses the same native implementation and public Core
   capability as a headless caller.
2. The actual script, result table and plot share the analysis resources and
   provenance. Selecting stable objects in either view updates the other view and
   the Agent's explicit context.
3. Docking and detaching views preserve selection, Unicode input, unsaved content
   and undo behavior. Agent edits encounter the editor's buffer and conflict checks.
4. Closing an observer and reconnecting find the original task and partial
   results without replay. Execution completion, artifact completeness and
   scientific checks are displayed separately.
5. The Agent composes a further view using registered components and the same
   resource/action references. A second domain component later tests whether
   these semantics are reusable.

This is a future acceptance flow, not a passed application test. Existing R and
evaluation evidence can be reused within its recorded scope. Fresh execution uses
disposable projects and owned Hosts; no user Host or R session is restarted.
Before resource or performance claims, name the protected resource, configuration
and exceeded-limit behavior, then measure the actual chosen combination.

Each repository continues to deliver its selected owner boundary independently.
Application assembly records immutable source and artifact identities, explicit
local overrides and acceptance of the combination. A component regression pass
does not prove the application composition, distribution or installation.
