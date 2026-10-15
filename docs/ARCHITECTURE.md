# Component architecture

Rho-core is the execution foundation, Rho is the application container and
Rho-plugins owns the actual functional components. Components serve headless
callers and application users while retaining the same native behavior and facts.
[Status](STATUS.md) distinguishes delivered consumers from this selected design.

## Components and entries

A component provides a concrete capability such as an Agent, editor, file
operation, table, plot, scientific method or evaluation. It owns its implementation,
inputs, native preconditions, effects, resources, results and checks.

CLI, Skills, MCP and UI are optional entries. A component provides the entries its
consumers need. Entries performing the same operation reuse its behavior and
conditions; managed execution entries also preserve the original request identity.
Skills supply instructions, and do not grant additional authority.

A component's UI entry source, meaning its view implementation, typed properties
and action bindings, is owned in this repository. Rho assembles those views into
the application at explicit component versions and supplies theme, layout and
routing. The selected editor, table and plot UI components are not implemented yet.

R, Python, Rust, TypeScript and maintained CLIs are valid implementation choices.
Headless consumers can use Core's public resident CLI without a UI dependency.
Rho can assemble component views and interactions. Core owns execution guarantees;
it does not host React views or the Agent's model loop.

## Shared interaction concepts

The initial composition uses four shared concepts. The [headless package](HEADLESS.md)
implements a finite versioned catalog and owner APIs; Rho publishes the HTTP
consumer schemas. A universal plugin loader remains outside this scope.

| Concept | Component owns | Rho owns |
| --- | --- | --- |
| Action | Inputs, preconditions, effects, results and cancellation semantics | Presentation and routing within the existing authorization and scope |
| Resource | Identity, source and validity of files, tables, plots, tasks and buffers | Passing references and displaying owner-provided facts |
| Selection | Stable domain objects in a specific resource/content version | Linked views and explicit Agent context |
| View | Rendering, actions, subscriptions and release behavior | Placement, focus, layout and windows |

Selection refers to domain identities, such as genes in an analysis result,
rather than a row's current display position. Owners validate resource identity
and freshness before applying actions. Buffer versions and artifact digests serve
their own resources; there is no global scientific revision.

## State and lifetimes

Core owns managed execution facts. Scientific components own native state,
artifacts, provenance and checks. Editors own logical buffers, unsaved content,
local versions, undo and concurrent-write checks. Agent components own sessions
and model context. Rho owns layout and composition; each view owns rendering,
focus and cursor state.

Detached views refer to the same logical resources. Detaching an editor must not
create a second authoritative unsaved buffer. Layout restoration does not prove
content saved, execution active or artifacts complete. Agent edits encounter the
same buffer and conflict checks as user edits.

The resident Core Host has a lifetime independent of observing views and renderer
processes. Closing a view or Agent session is distinct from task cancellation and
confirmed execution stop. Reconnection queries the original request, preserves
unknown outcomes and does not automatically replay work under a new identity.
Reading must not start or recover a runtime. Host shutdown and native-session
recovery retain the limits of Core's
[managed execution](https://github.com/YuLab-SMU/Rho-core/blob/main/docs/MANAGED-RUN.md)
and [resident CLI](https://github.com/YuLab-SMU/Rho-core/blob/main/docs/HOST-CLI.md).

Bounded stdout/stderr are execution observations. Scientific artifacts remain
ordinary files with owner-defined manifests, completion declarations and checks.
Execution completion, artifact completeness and scientific interpretation remain
separate facts.

## Application surfaces

The first Rho delivery is an npm local service and single-window browser WebUI
with React/TypeScript, Vite and Dockview. Electron/native windows follow later.
First-party components retain their source ownership and contribute trusted React
views. Selected editing, table and plot views use CodeMirror 6, AG Grid Community
and ECharts, preserving native scientific outputs and provenance. These choices
are not implemented UI dependencies in this repository.

Agent-composed views use a typed json-render catalog of registered components
with explicit resource and action references. Schema validation does not establish
authorization, resource freshness or scientific truth. Models do not supply
privileged executable JavaScript. Independently supplied HTML views may use an
isolated MCP Apps host with only the selected messages and permissions.

Every entry applies the same mechanical checks of existing authorization,
caller/project visibility and native conditions. Rho adds no further approval when
the user's authorization covers the action. Models and retrieved content cannot
broaden scope. Core caller namespaces are not authenticated principals; UI
isolation does not sandbox native R/Python execution. Native programs retain the
Host's OS authority. See [Privacy](../PRIVACY.md) and [Security](../SECURITY.md).

MCP can expose tools/resources. MCP Apps can expose isolated UI. AG-UI or A2UI
adapters require a concrete Agent event or cross-client UI consumer. Portable
Skills/MCP packaging can coexist with namespaced Rho extensions. These optional
interfaces do not replace native facts or Core request identity.
Rho's [technology direction](https://github.com/YuLab-SMU/Rho/blob/main/docs/TECHSTACK.md)
records library choices, licensing and official references.

## Integrated acceptance

Scientific workbench interaction, freely composed views and Agent-driven UI evolve
in the same vertical flow: an Agent selects a component action, native execution
produces real resources, script/table/plot views share selection, views detach
without losing unsaved content, and observers reconnect to the original task.
The Agent then composes a further view from the same catalog and references.
[Roadmap](ROADMAP.md#first-integrated-flow) defines the acceptance conditions.

The headless part of this flow has run through Rho HTTP, public Core CLI and a
real external Claude Code adapter. Browser interaction, native input and rendering
remain unverified. Existing component evidence is reused only within its recorded
scope. See [Headless components](HEADLESS.md). Assembly records immutable component identities, explicit local
overrides and actual acceptance of the combination. Measure protected resources
and configure exceeded-limit behavior before making performance or containment
claims.
