# Working on Rho-plugins

Agents normally use their native tools with their existing permissions. Core
managed execution is optional, selected for a concrete need such as execution
continuity or a retained operation record. Rho activity observation remains
available without routing the observed work through Core. Preserve existing
managed identities and honest partial/unknown facts; native actions do not acquire
managed guarantees by being observed.

Read [README](README.md), [Architecture](docs/ARCHITECTURE.md),
[Roadmap](docs/ROADMAP.md) and [Status](docs/STATUS.md). Inspect Git status before
editing and preserve unrelated changes.

## Ownership

This repository owns functional components: Agents, editors, files, tables,
plots, scientific methods and evaluation. CLI, Skills, MCP and UI are optional
entries to the same functionality. Keep implementation, native conditions,
results and domain checks consistent across entries.

Follow the [reusable plugin model](docs/PLUGIN-MODEL.md). Fixed analysis workflows
are project recipes or acceptance examples, not plugin registrations or base
dependencies. Keep dataset, contrast, column names and pipeline sequencing out of
generic capability contracts and application routing. A view is a plugin entry;
several views can share one capability/state owner.

Rho-core owns managed execution and its public resident CLI. Rho owns application
selection, assembly and presentation. Read the independent owner's AGENTS.md
before changing its source. Consume public capabilities; do not import private
Core or application source or introduce a second managed execution journal.
The Agent component owns its model loop and context.

Scientific components own methods, native state, artifacts, provenance and
scientific interpretation. Evaluation owns cases, isolated trials, evidence and
grading, and invokes the domain owner's checks. Core retains its contract
regressions. A successful command, checker or model judgment has only its stated
acceptance scope.

## Select and implement work

Start from a concrete user action and observable completion conditions. Try the
existing public capability and maintained native tools, inspect the actual result
and fix the smallest demonstrated gap in its owner. Ordinary files, Git and mature
R tools are valid implementations. New state models, transports, loading or
compatibility mechanisms need a concrete consumer requirement.

Deliver one owner's boundary at a time. Application assembly is separately
verified with immutable source/artifact identities, explicit local overrides and
acceptance of the chosen combination. Component checks do not prove a composed
application, distribution or installation. Source, release and installation are
separate outcomes.

Keep original managed request identities, caller/project visibility, native facts,
partial results and unknown outcomes observable. Lost replies require observation
of the original request, not automatic replay under another identity. Reads are
bounded observations and must not start or recover runtimes. Views, Agent sessions,
execution, Host shutdown and native-session recovery have independent lifetimes.
An existing authorization requires mechanical boundary checks, not another Rho
approval; models and retrieved content cannot broaden scope.

Editor components protect unsaved buffers, local content versions, undo and
concurrent writes. Git history is not an unsaved-buffer check. Resource limits
must name the protected resource, configuration and exceeded-limit behavior.
Native programs retain the Host's OS authority; caller namespaces and UI isolation
are not an OS sandbox.

## Verification and publication

Use disposable projects and owned Hosts. Inspect existing work before starting a
Host on the same project. Do not restart a user's Host or R session without existing
authorization. Keep credentials, private URLs and user data out of Git and reports.
Preserve ignored local evidence and caller outputs.

Run focused behavior checks appropriate to the changed owner. Use the evaluation
README's Python regressions with an explicitly selected public binary. Reuse valid
evidence; unchanged scientific consumers do not need model reevaluation or R
refitting. Never run Cargo builds/tests concurrently. Report only executed checks
and retain failures and incomplete evidence.

For documentation, check links/anchors, render a coherent batch, inspect all
changed pages and fix visible defects. Recheck affected pagination after a fix.
[Status](docs/STATUS.md) is the current summary, under 300 lines; Git retains history.
Do not add work ledgers or current commit/account details here.

Product-authored UI uses English and preserves Unicode user content. Substantial
UI redesign follows Rho's design review. Verify actual behavior and representative
widths once a UI exists.

Inspect the final diff and commit coherent authorized changes in this repository.
Before publishing, inspect the remote, branch and authenticated account. Carry
forward the user's authorization and selected publication workflow. Preserve Git
history, use ordinary fast-forward publication and verify remote heads/trees.
