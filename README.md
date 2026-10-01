# Rho official plugins

Scientific implementations and their views, public domain contracts, methods,
native adapters and tests. Plugins share a development repository but produce
separate immutable packages. They do not require the core or application checkout
to build. All existing sixteen official packages remain ordinary plugins.
The public core lives in [Rho-core](https://github.com/YuLab-SMU/Rho-core);
the application and coordinated development entry live in
[Rho](https://github.com/YuLab-SMU/Rho).

```sh
npm ci --ignore-scripts
node scripts/check.mjs
node scripts/build.mjs files /new/external/files-package
node scripts/build.mjs r /new/external/r-package
```

The normal builder reuses this repository's Cargo cache. `--independent` additionally
builds the selected self-contained source package. UI tool dependencies live in
this repository's `node_modules`, independently of the application's tools.

`crates/` and `sdk/` contain the public dependency exported by `Rho-core`, pinned
by `core-sdk.json` and verified before the top-level build. Do not edit these
vendored copies. `node ../Rho/dev.mjs sdk sync plugins` explicitly updates them
from a committed local core checkout. Their file digests and license are retained.
Native scientific libraries, Jet and its ordered patches are owned here.

Use focused tests for the changed owner, for example:

```sh
cargo test -p rho-files-backend --locked
python3 /absolute/files-package/tests/protocol.py /absolute/files-package/dist/rho-files-backend
```

Application-level connection tests live in `Rho/scripts/test-composition.mjs` and
consume built artifacts. Whole-product runners and historical package-count or
monorepo-path checks are not a prerequisite. Component READMEs describe protocol
behavior; former monorepo acceptance-runner references are superseded by these
repository-level commands. No runtime or user installation is started by a build.
