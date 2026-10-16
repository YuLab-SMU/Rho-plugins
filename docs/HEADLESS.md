# Headless plugins 0.4

Eight independent `@rho-workspace/plugin-*` 0.4.0 packages supply reusable
functional owners to Rho. The [package inventory](PLUGIN-PACKAGES.md) records
ownership, typed service ports, required providers and independent installation.
Node 22.22.x, TypeScript 5.9.3, MCP SDK 1.29.0 and csv-parse 7.0.3 remain locked.
Each npm package includes its compiled owner code and optional entries; it
contains no analysis recipe, scientific checker, native R script or UI code.

The [plugin model](PLUGIN-MODEL.md) defines ownership.
Rho publishes the [v2 consumer contract](https://github.com/YuLab-SMU/Rho/blob/main/protocol/v2.json)
and routes requests through the public Core CLI. The former 0.1 scientific
candidate retains its separate historical acceptance.

## Functional owners and entries

| Export/entry | Implemented behavior |
| --- | --- |
| `Documents` | One persistent buffer/path; Unicode-safe UTF-16 transactions, undo, conditional save, snapshots and restoration. |
| `checkRequirements`, `preparation` | Explicit R package/source/minimum-version declarations; bounded base-R probe and explicit project-library preparation through CRAN/BiocManager. Empty requirements need only base R. |
| `planExecution` | Frozen saved/buffer R script, explicit arguments and immutable resource inputs, requirements and declared outputs. No default recipe or scientific branch. |
| `collectArtifacts`, `verifyArtifacts` | Scoped declared bytes, partial/declared/verified inventory facts; domain checks stay separate project outputs. |
| `Files`, `Tables`, `Charts`, `Media`, `Objects` | Independent storage, typed parsing/joins, chart data, original media/region checks and exported object readers. Rho injects their service ports. |
| Owner `plugin` descriptors and chart `validateComponentBindings` | `r.execute` 0.2.0 and five finite entry schemas. Scatter props name numeric x/y fields; bindings require the declared key. UI availability is explicit. |
| `rho-agent-mcp` | Granted application methods over stdio, mechanically bound to one project; durable managed caller intents before delivery. |

Each capability is an independent npm package. The private root only coordinates
source builds/tests and cannot be packed. Shared contracts supply generic envelopes, typed service ports and file
primitives, with no capability catalog, format registry, state owner or runtime
dependency. Each resource/requirement/script schema lives in its provider
package's pure `./contract` entry. The R schema factory accepts foreign schemas
from the consumer; pure contracts never load the provider implementation.
Rho owns credentials, project scope, serialization/writer lease, durable
application-to-Core mapping and workspace composition. Plugins does not start
Hosts or maintain another managed-execution journal. The external Agent client
owns its conversation and model loop.

## Explicit resources and execution

A resource declaration contains `path`, `kind` and `format`. Format is a MIME
type for a file, typed CSV/JSON-row columns and an optional key for a table,
original MIME/pages/dimensions for media, or JSON classes and
`observation:"exported-snapshot"` for an object. Extensions and column names
never select scientific semantics. Declared artifact paths cannot escape the
output directory, including through symlinks.

Columns explicitly list string/number/boolean types and CSV null encodings.
String `001` and literal `NA` are preserved. A stable key is a unique nonempty
string column with an entity namespace. Unkeyed tables remain readable; entity
interaction is unavailable. Comparison requires both versions, key/namespace/
numeric-field declarations, explicit equal-string mapping and left/inner/full
join policy. It preserves unmatched nulls and both input provenances. Scientific
comparability belongs to the project.

Exported object reads need Files/R only. Requirements is an action-level
dependency for `r.execute`; Documents is needed only for buffer scripts. A missing
Requirements provider does not disable object snapshots or their entry.

The selected R script receives the output path first and creates it. Further
arguments are literals or checked immutable resource snapshots. The exact code
and declarations remain frozen with the accepted request. The optional completion
inventory is a run-relative sidecar, returned as `plan.completion`; placing it
beside `artifacts` preserves the producer's own immutable inventory.
Verification checks bytes only. A project can execute its scientific checker
as another ordinary script and declare its report as a separate resource.

Media retains original bytes/version and provider-declared page/dimension facts.
The Media owner validates rectangle context against those facts. There is no decoder or
browser renderer here. Object previews read bounded exported JSON, never evaluate
R expressions. A resident Core Host is not a persistent R interpreter.

The finite entries are `rho.editor`, `rho.table`, `rho.scatter`, `rho.media`
and `rho.object`, all 0.2.0 and UI-unavailable. The application validates the
owner's schemas/bindings, retains missing entries and does not reconstruct a
workspace by executing analysis.

## Two explicit project consumers

[Ordinary R project](../examples/ordinary-r-project/README.md) uses base R to fit
a small model and export tables with non-gene keys, PNG/PDF and an object snapshot.
Its project-owned checker reads the actual saved model and observations.

[Paired analysis](../examples/real-r-analysis/README.md) supplies the original
analysis, explicit package requirements/output declarations, shrinkage and
independent/native checkers. These scripts remain under the example and are
excluded from npm. Both consumers use the same Rho acceptance runner,
`r.execute`, requirements, resource, data, context and workspace APIs.
The original 200-simulation scientific evidence retains its stated scope; the
extraction smoke case requests one simulation.

## Compatibility and limits

Historical frozen plans and registered resource bytes stay observable without
the removed recipe. Generic typed reads require a declaration; they never guess
a historical scientific schema. Historical checks requiring the old provider are
unavailable for new execution, while recorded results remain. Rho preserves the
v1 schema/candidate and offers an observation bridge for original identities.

State stays under `.rho/plugins`; Rho coordination and Core state keep their
owners. Mutation acknowledgement follows fsync/rename/directory fsync.
Save checks the actual disk condition and preserves conflict content/undo; it is
not CAS against outside writers. Source mutation makes a registered reference
stale; restored bytes keep identities with explicit rebased provenance.

Constructors accept `documentLimits`, `fileLimits`, `tableLimits` and
`chartLimits` overrides for their own protected resources.
R's `executionLimits.maxScriptBytes` independently limits saved/buffer snapshots
to 1 MiB before dispatch; Documents selection and buffer limits cannot change it.
Defaults: 64 buffers, 1 MiB each, 8 MiB content and undo/buffer; 64 MiB/resource,
1024 resources, 512 MiB retained bytes, 100,000 rows, 1000 rows/page, 20,000 chart
points and 64 KiB byte/object/completion reads. Earlier snapshots count toward
storage. Excess rejects new work and preserves acknowledged facts; sampling is
explicit. Dependency probes use 20 seconds/1 MiB. Native R memory/OS authority
remain outside these limits.

MCP persists original managed identity/input before HTTP delivery, independently
of external conversation persistence. `RHO_MAX_AGENT_INTENTS` defaults to 256
per project/session; changed reuse conflicts and exhaustion retains old intents.
The connection descriptor selects API 2.0; older descriptors keep their API
selection. Explicit tool-fetched context does not establish proactive delivery.

## Build and verify

```sh
npm ci
npm test
npm run test:examples
npm run pack:plugins -- --destination /absolute/plugin-tarballs
npm run test:install -- /absolute/plugin-tarballs
```

Twelve owner tests cover documents, durable/concurrent Agent intents,
declared types/keys/nulls, explicit two-input mappings, stale resources, bounded
storage, base-R probes and immutable producer inventories with escaping-path
rejection, provider-independent bytes and missing-provider context/collection, architecture
import/dependency guards, generic Contracts exports and independent R budgets.
Eight isolated installations/imports verify independent package/dependency
boundaries. The two separate example tests retain native singleton-histogram and
spaced-Unicode-path coverage. Examples are not capability test dependencies.

Rho separately verifies real HTTP/Core execution, stdio MCP and external Claude
handoff, both explicit projects, partial/unknown recovery and actual npm
installation. [Boundary review acceptance](https://github.com/YuLab-SMU/Rho/blob/main/docs/PLUGIN-BOUNDARY-ACCEPTANCE.md)
records the chosen source/artifact identities, failures and exact scope.
Browser input/rendering, live R memory, signed delivery and registry publication
remain separate.
