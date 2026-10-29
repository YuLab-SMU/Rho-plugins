# R execution and exported objects plugin

`@rho-workspace/plugin-r` 0.4.0 is an independently packed npm plugin.

Public entries: `planExecution`, `Objects`, `declarationValidator`, `actions`, `executionLimits`.

Plan an explicitly selected saved/buffer script; freeze code, args and declared outputs. Read bounded exported JSON object snapshots.

Agents normally use their native tools. Select this managed entry when execution
continuity or a retained application operation is needed. It executes user-written
R, with `.libPaths` prepended; R can invoke other native programs with its existing
OS authority. The catalog does not restrict scientific methods. Observing a
native action does not give it Core acceptance or deduplication guarantees.

Selected services: Files for object reads and resource resolution. Only the
`r.execute` action requires Requirements; buffer scripts additionally need a
document snapshot source. Objects remain readable with both providers absent.

The pure `./contract` entry exports script/object schemas and
`createExecutionInputSchema`. Foreign declaration/requirement schemas are supplied
by the consumer composition, with native validation retained by their owners.
`executionLimits.maxScriptBytes` defaults to 1 MiB for disk and buffer snapshots;
exceeding it rejects planning before dispatch. It is independent of Documents
selection and `maxBufferBytes`. Rho configures it through `r.maxScriptBytes`.

No Host lifecycle, request journal, project recipe or live R interpreter.

The package depends on `@rho-workspace/plugin-contracts` 0.4.0 for generic envelopes and service ports
and ordinary file primitives; that package contains no capability implementation.
Service ports do not install or start other plugins. Rho explicitly selects and
connects providers. `plugin` describes this package and its selected-service
requirements. View descriptors, where present, remain UI-unavailable; action/view
contract versions remain 0.2.0 independently of the package version.

```sh
# From the Rho-plugins source checkout
npm ci
npm run build
npm pack --workspace plugins/r --ignore-scripts
```

Use the repository's `pack:plugins` command to produce the contracts tarball and
selected plugin tarballs together. Both explicit R examples are separate consumers
and are excluded from every plugin artifact. No UI work is included.
