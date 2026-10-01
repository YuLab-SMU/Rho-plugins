# Rho official plugins

Read README.md and inspect git status before editing. Each scientific owner keeps
its domain state, native preconditions, execution, observations and recovery.
Views consume public capabilities. Do not import private core/application source
or create a second scientific-operation journal. Queries do not start runtimes.

`crates/` and `sdk/` are a generated, pinned public dependency from Rho-core.
Never edit these copies; change their owner, commit and explicitly refresh the
snapshot. Domain contracts stay with their plugin. Jet is maintained through
patches/jet; run node scripts/vendor-jet.mjs check after changing it.

Choose focused tests by behavior. The old whole-product suite and directory
assertions are not mandatory. Reuse a retained core binary for cross-boundary
tests; do not rebuild it for plugin-only changes. Run Cargo builds/tests serially.
Keep scientific effects, caller/project containment, original request identity,
uncertainty and recovery observable. Test with disposable projects, not a user's
Host or live R session. Packages inspection remains read-only.

Product-authored UI is English; preserve Unicode user content. Substantial UI
redesign still needs Paper review under the application's docs/RHO-DESIGN.md.
Commit coherent changes; use Rho/dev.mjs as the coordinated development entry.
