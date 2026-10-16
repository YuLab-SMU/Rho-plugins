# Shared plugin contracts

`@rho-workspace/plugin-contracts` 0.4.0 supplies generic resource references,
declaration envelopes, typed service ports, faults, hashing, contained paths and
ordinary-file durability primitives. It has no npm runtime dependency and exports
only the root entry. It owns no catalog, state, format validators, language
execution plan, dependency set, parser, Agent adapter or UI.

Resource kinds are open strings at this boundary. File/table/media/object schemas
belong to their provider's pure `./contract` entry. Requirements owns its package
schema; R owns script/object schemas and an execution-schema factory whose foreign
schemas are supplied by the composition. Document disk checks and budgets belong
to Documents. Typed service ports do not instantiate or import their providers.

Version 0.4 removes the former central `./execution`, `./requirements`, typed
resource schemas and document digest helper. Consumers migrate to owner contracts;
Rho retains its selected v2 wire snapshot with owner-parity checks so missing
packages do not prevent describing the API. Wire action/view 0.2.0 is unchanged.

The architecture test fixes the bounded runtime export list and checks all owner
imports against declared dependencies. New format support must not expand this
package into a capability registry. Node 22.22.x is selected.

```sh
npm run build --workspace packages/contracts
npm pack --workspace packages/contracts --ignore-scripts
```
