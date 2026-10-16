# Shared plugin contracts

`@rho-workspace/plugin-contracts` 0.3.0 supplies stable resource/declaration types,
JSON wire schemas, faults, hashing, contained-path and durable ordinary-file
primitives. It has no runtime npm dependency and no plugin descriptor, catalog,
state owner, native execution, parser, Agent adapter or UI.

The `./execution` and `./requirements` subpaths carry the existing 0.2 action
wire shapes so an application can describe its HTTP boundary when an optional
implementation package is absent. They do not execute those operations.

Capability behavior and validation belong to the eight plugin packages. The
application explicitly selects and connects them; this package never assembles
them. Node 22.22.x is selected.

```sh
npm run build --workspace packages/contracts
npm pack --workspace packages/contracts --ignore-scripts
```
