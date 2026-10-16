# Headless components 0.1

`@rho-workspace/headless` 0.1.0 supplies functional owners for the Rho local
backend. Node 22.22.x, TypeScript 5.9.3, MCP SDK 1.29.0 and csv-parse 7.0.3 are
locked in the package. There is no React/DOM dependency or UI implementation.
The Rho service consumes the exported API and publishes its
[versioned consumer contract](https://github.com/YuLab-SMU/Rho/blob/main/docs/HEADLESS.md).

This prototype mixes reusable document/Agent behavior with workflow-specific
requirements, actions and data readers. Its catalog is not the selected reusable
plugin model. The [plugin boundary](PLUGIN-MODEL.md) requires removing the paired
recipe from base registration/packaging and checking the same capabilities with
a non-gene consumer before plugin UI acceptance. That extraction is pending;
the API description below records actual 0.1 behavior.

## Entries and owners

| Entry | Functional behavior |
| --- | --- |
| `Documents` | One persistent buffer per normalized project-relative path, UTF-16 transactions, Unicode validation, undo, snapshots and conditional save/restore. |
| `checkRequirements`, `preparation` | Selected-action R/package observation; explicit project-library installation plan through BiocManager. No inferred project-wide dependency graph. |
| `planAnalysis` | Frozen saved script or acknowledged buffer; actual airway analysis and apeglm shrinkage recipe. |
| `collectArtifacts`, `verifyArtifacts` | Actual files and independent completion, byte-integrity, arithmetic and native-state facts. |
| `Resources` | Digest-versioned artifacts, typed CSV pages, real plot data, stable gene selection and two-input comparisons preserving missing values. |
| `catalog` | Two actions, four finite view registrations and one external Agent adapter descriptor. UI entries are unavailable. |
| `rho-agent-mcp` | Granted Rho HTTP operations exposed as stdio MCP tools, with the credential's project injected mechanically. |

Components do not start Core Hosts or maintain a second execution journal. Rho
owns credentials, project routing, durable application intents, composition and
observation; Core remains the owner of managed execution. The adapter owns no
model loop: Claude Code owns conversation, authentication/provider and inference.
The actual Rho experiment used Claude Code 2.1.300, fetched explicit context and
edited the same unsaved Chinese/emoji buffer as the human client. The MCP caller
fsyncs immutable managed identity/input records before HTTP delivery, independent
of conversation persistence. Write-once slots prevent concurrent replacement and
bound retention. `RHO_MAX_AGENT_INTENTS` defaults to 256 per project/session;
exhaustion rejects new intents while preserving previous identities.

## Scientific case

`airway.analyze` uses the existing [paired airway recipe](../examples/real-r-analysis/README.md)
with donor-paired DESeq2, four donor-omission fits and selected conditional
simulation count (1–1000). It returns real CSV, RDS, PDF, scripts, manifests and
completion declarations. A saved script must match its digest; a buffer must
match its exact document version. Submission preparation freezes the code bytes.
Subsequent edits do not alter that snapshot.

`airway.shrink` consumes the baseline full model and matching full table from one
analysis. It executes `DESeq2::lfcShrink(type="apeglm", coef="dex_trt_vs_untrt")`.
Original Wald p-values/padj are retained. A separate native checker compares the
exported numbers to saved objects and the baseline. The derived comparison binds
both exact input versions, left-joins stable `gene_id` and retains missing Y as
null. The original scientific PDFs stay available alongside interactive data.

New integrated acceptance used R 4.5.2, DESeq2 1.48.2, airway 1.28.0, jsonlite
2.0.0 and project-prepared apeglm. It observed 16,139 actual genes, including
KLF15 / ENSG00000163884. The bounded smoke case used one conditional simulation;
the earlier 200-simulation [scientific record](../examples/real-r-analysis/ACCEPTANCE.md)
retains its own scope. Byte and numerical agreement do not validate every model
assumption or establish biological/clinical validity.

The first bootstrap=1 run exposed the existing Freedman–Diaconis histogram's
singleton failure after models/tables had been written. The recipe now selects
one bin for that supported input. Both the failure and subsequent successful
execution are retained by Rho; the focused regression invokes the actual R plot
expression. The first shrinkage checker also exposed a missing DESeq2 namespace
before S4 dispatch; explicit loading fixed the checker, and the actual saved
objects subsequently passed. No original failure is relabeled successful.

An installed analysis under a spaced Chinese path completed natively but the
independent checker found an absent script digest. Rscript represents spaces in
its `--file` argument as `~+~`; the recipe now decodes that representation only
when the literal path does not exist. The native-path regression checks the
actual recorded hash against the submitted file bytes.

## Persistence and resource limits

Component state lives below `.rho/plugins`, separate from `.rho/rho` coordination
and Core's files. File fsync, rename and directory fsync precede acknowledgements.
Rho supplies the single project-writer lease and serialized calls. A document
save checks both the expected buffer version and the disk digest before atomic
replacement; it does not claim filesystem CAS against uncooperative writers.
Invalid UTF-8, surrogate splits, stale versions and external writes preserve the
acknowledged buffer and undo. Internal `.rho`/`.git` files cannot become documents.

Every resource has its own digest/version, provenance and actual availability.
A partial file is not marked complete without its native declaration; checks are
separate. Source mutation makes an older reference stale. Restored bytes retain
their identities and record rebased provenance. There is no global scientific
revision or implied R-memory recovery after Host loss.

Exported defaults are `documentLimits` and `resourceLimits`; constructors accept
partial overrides. Documents default to 64 buffers, 1 MiB each, 8 MiB total
content and 8 MiB undo per buffer. Resources default to 64 MiB per file, 1024
registered resources, 512 MiB retained artifact bytes, 100,000 rows, 1000 rows/page,
20,000 plot points and 64 KiB byte reads. Old retained snapshot bytes count toward
the storage budget. Exceeding a limit rejects new work while keeping obtained
content; sampled plot data explicitly reports the method. These bounds do not
limit native R memory or confer an OS sandbox.

## Build and verify

```sh
npm ci
npm run build
npm test
npm pack
```

The eight focused tests cover shared Unicode/stale edits, undo/disk conflict and
recovery, buffer budgets, the singleton R plot, spaced Unicode script paths,
MCP caller identity/concurrent retention, actual typed data/missing values,
stale two-input resources, retained snapshot budgets and invalid UTF-8.
The full HTTP/Core/Agent/scientific/install composition is tested by Rho's
[scripts and acceptance record](https://github.com/YuLab-SMU/Rho/blob/main/docs/BACKEND-ACCEPTANCE.md).
It is distinct from this owner package's tests and from browser acceptance.
No npm registry publication or signed delivery is claimed.
