# Current status

Updated: 2026-10-27 (later). Documents 0.4.3: a buffer with no unsaved text follows
its file. `open` adopts changed disk text as one `edit` by the author `disk`, as the
smallest changed span; history keeps the text before, own undo is untouched, unsaved
text or a pending save is never replaced, and missing, non-UTF-8 or over-budget files
leave the buffer. The editor labels it "File on disk" and highlights it. Agent 0.4.12:
`agent.activity.capture` observes only the named regular file (inside the project, no
symlinks, at most 8 MiB) instead of scanning its folder, with `expectedDigest`
optional. Annotations 0.4.4 only widens its optional Documents peer to 0.4.3. Rho's
Agent canvas needed both owner changes; all 90 owner checks pass, and Rho's
[canvas record](https://github.com/YuLab-SMU/Rho/blob/main/docs/AGENT-CANVAS-EPISODE.md)
keeps the composed browser and real-Agent evidence.

Updated: 2026-10-27. Agent 0.4.11 adds each tool step's bounded title, ACP category
and identifying input (command, path, pattern or query) to the shared ACP v1
identity, permission and recovery accepted at 0.4.10. External clients can select
the stdio relay for bounded observations while retaining input and runtime.
Advertised session close releases native writers; process-group escalation survives
wrapper exit. Standard diff paths supply file references without retaining contents.
All 89 owner checks pass. Rho's installed acceptance at 0.4.10 passed eight Westlake
HPC turns for each Agent plus external Codex load, live observation across Rho
restart and same-session reconnect; [the record](https://github.com/YuLab-SMU/Rho/blob/main/docs/ACP-MULTI-AGENT-EPISODE.md)
keeps native-job cancellation limits, failed attempts and installation evidence.
Core and the native collector are unchanged; uninstrumented clients still need the transcript fallback.

Updated: 2026-10-25. Agent 0.4.5 adds `rho-agent-observe`: selected Claude Code
JSONL and dsh read-only native persistence feed Core's public activity CLI.
Immutable selection, original call IDs, prefix verification and retained cursors
allow late attachment and observer restart. Deterministic summaries preserve
tool return, native exit and unknown outcome separately; optional bounded output
inspection supplies current hashes without claiming historical production.
Four actual WestlakeHPC runs covered both clients: analysis backfill yielded
14/28 events, live attachment yielded 2/6 final events, and collector/owned Host
restart preserved the original invocation (one run marker each). Repeated scans
added zero events. Build and all 74 owner tests passed after the explicit native
dependency correction; actual evidence and limitations are in
[Agent observation acceptance](../examples/agent-observation/ACCEPTANCE.md).
Rho browser composition, installation and Linux observation acceptance remain separate.

Updated: 2026-10-24. Annotations 0.4.3 adds an optional table-question UI using the
single Documents buffer, exact source/row anchors, original submission identities
and explicit Agent replies. Replies may name up to 16 exact output refs, resolved
through Files; these author links do not establish domain correctness. UI intent
retention is capped at 16 KiB; exceeding it preserves the draft and refuses a new
submission. A submitted question folds to one status control; a host may place the
question's actions in the view's own header and keep only the open thread below. Assigned task feedback keeps its existing delivery entry. Agent 0.4.4
adds document-open identity, resource id/version and output-stream metadata to its
bounded activity log, without tool inputs, code or row/output contents. Owner
checks pass 67/67, including retry/archive links and bounded metadata after restart.
Rho owns the composed browser/real-model acceptance; S6 remains human unverified.

Updated: 2026-10-23. Agent defaults to four tools (discovery, contract resolution,
invocation, retained-result reading); large results have scoped, bounded, released
references without replay. Files streams hashes/snapshots through a bounded cache;
Media negotiates page size, caps display bytes and cancels inactive reads; Documents
adds metadata-only summaries, bounded reads and conditional browser saves that keep
retry identity. Owner checks passed 65/65; Rho records composed trials separately.

Updated: 2026-10-22. Documents and Tables now draw their own bodies in an
application's item frame, following the Paper page
[04 · 插件形态](https://app.paper.design/file/01M5HG6R8RBC33N84S245J0YXT/p-8-0).
Both `./ui` entries export a card body and form declarations (reference, card,
summary, compare); compare is reached by naming a change or a recorded comparison,
not by zooming. The Agent names `show`; without it Tables shows a count when an
earlier table is given, else rows, and Documents shows a passage for an anchor, a
change for a named group, else the outline. People may switch `show` on the card.
Size caps are form parameters with maxima, and each body reports what it left out,
counted from the whole resource; null cells read "empty". Source checks passed 53/53
with seven DOM-free card-model tests; Rho recorded the composed browser check.

Updated: 2026-10-22. Files 0.4.1 provides an optional finite source-folder resolver;
Documents 0.4.2 and R 0.4.1 use it for reads, conditional saves, restoration and saved
scripts. Unknown folders, traversal, internal state and symlinks refuse; equal names
stay distinct and overlapping aliases share a buffer. Source checks passed 46/46.
Annotations accepted Documents 0.4.1 and 0.4.2 as optional peers, behavior unchanged.

Updated: 2026-10-21. Application phase 5 now accepts the selected external offline
grades candidate with Agent 0.4.3 and the existing Documents/Files/Tables/Annotations
owners. Actual Claude Code 2.1.306 / Westlake HPC DeepSeek completed two original
business sessions and two restricted presentation sessions: 77 tool calls,
1,098,713 input tokens including cache and 29,705 output tokens. The application
records 32 installed checks, real browser/worker/save-ACK faults and frozen
AC01–AC21 coverage. Earlier interrupted-trial calls/usage lower bounds are retained;
no provider invoice or exactly-once native execution claim is made. Core remains
unchanged; same-project multi-task, full product acceptance and registry publication remain
unselected. Local evidence belongs to Rho's
`work/phase5-installed-dual-agent-20261021/results.html`.

## Phase 4 optional presentation and layered MCP source candidate

Agent 0.4.3 adds explicit three-tool MCP profiles, bounded complete-body cache,
closed schema checks and original managed-intent reuse. The optional read-only
`rho.agent-note` displays at most 600 Unicode characters; Rho writes its author
and binding basis through the assigned guarded path. Generic rho_call feedback
fetches retain exact native return attribution. Headless compatibility and optional
React isolation remain; the catalog now lists the actual note view. Source owner
checks pass 45/45, with Rho 63/63 and real two-project SDK/browser evidence recorded
by the application. No model ran in those source/SDK checks; the separate phase-5
model and installed evidence is summarized above. See [layered MCP](../plugins/agent/README.md#layered-mcp-and-optional-presentation).

## Phase 3 original feedback delivery source candidate

Agent 0.4.2 adds exact original submissions, frozen targeted contexts, one durable
bounded delivery file, whole feedback reads/status and optional Claude hook/worker
entries. ACK loss permits only original lookup; persisted hook attempts never
re-emit after ambiguous crashes. Native MCP returns carry exact fetch attribution.
Annotations 0.4.1 adds the contextual question entry and exact retained thread
contract. It reuses Documents 0.4.1 buffer-readiness notification and Tables 0.4.2
confirmed-selection action; no duplicate editor or domain workflow is introduced.
Private schema refinement retains ACK/hook-boundary facts without changing frozen
public profiles. Component regressions pass 44/44; Rho 57/57 and actual two-project
browser checks have separate application evidence. This phase used zero model
tokens. Real Claude consumption, presentation enhancement and installed acceptance
remain pending. See [Agent feedback](../plugins/agent/README.md#original-feedback-delivery).

## Phase 2 table display evidence source candidate

Tables 0.4.1 adds an optional DOM-observation callback and pure coverage schema.
It reports exact visible keys/columns, typed-value digests, query and actual
viewport/hit-test coverage after data paint. Virtual buffers, sticky-header-covered
rows and native hidden tabs do not claim visible cells. Headless readers remain
unchanged; no Agent model or Core runtime is required. Owner checks pass 43/43;
Rho records actual split/refresh/restart/hidden/occlusion checks separately. Reliable
feedback, presentation enhancement and the full installed combination remain work.

## Phase 1 native observation source candidate

Agent 0.4.1 adds pure/native/Claude stream-observer entries, registered attachment
and bounded original-source observations. Separate adapter authority and the
application project writer protect ingestion; no model loop, queue or execution
journal is introduced. Existing Files/Tables supply artifact validation unchanged.
The [Agent guide](../plugins/agent/README.md#native-observation-entry) records limits
and scope. Owner source checks pass 43/43. Application source acceptance ran two
real Claude Code 2.1.306 / Westlake HPC DeepSeek projects: an explicit native
resume repaired one manifest path without rerunning either Python computation.
Application/usage evidence and remaining phases belong to Rho; no independent
installation or publication of the candidate is claimed.

## U2 optional editor and table entries

Documents and Tables now ship separate `./ui` entries with exact optional peers;
headless imports load no React or DOM. The existing confirmed design uses
CodeMirror serial identified input, authenticated tab author labels, owner undo,
individual Agent-change revert, recovery copies and separate exact-version reads.
AG Grid Community requests 200-row blocks, caches five blocks, supports one sort
and typed filter, and preserves explicit keyed selections through cache changes.

`npm test` passes 40/40. Rho’s 40/40 source tests pass; its
[U2 acceptance](https://github.com/YuLab-SMU/Rho/blob/main/docs/U2-UI-ACCEPTANCE.md)
records composed browser/install results and remaining gates. U3/U4 and manual
macOS candidate-window input are separate from the Chrome composition check.

## U2 Documents prerequisites

Documents now retains per-change author/delta history, exact before/after reads,
authenticated own-group undo and targeted single-edit revert. Later overlapping
edits are refused; unrelated text is preserved. Legacy global undo remains
compatible. History is bounded by entries/deltas and the shared undo text budget;
format-3 restore validates its versions, ranges and digests. Stable receipts,
pending-save resume/abandon and live-document binding prerequisites remain.
The 31 owner tests and Rho's 40 tests pass, including real stdio MCP/HTTP author
checks and zero native attempts in the new flow. That backend prerequisite batch did not build UI or extend browser grants. The [Documents guide](../plugins/documents/README.md)
and [Rho handoff](https://github.com/YuLab-SMU/Rho/blob/main/docs/U2-BACKEND-HANDOFF.md)
record API limits and frontend integration still required.

## Catalog presentation

All nine descriptors now provide icons, body copy, ordering, Skill descriptions,
action/view descriptions and developer/license/link/dependency information for
Rho's U1 catalog. R and Requirements expose bounded executable-file observations
without running Rscript or starting a Host. Missing Rscript leaves exported object
reads available. These fields grant no access and add no functional renderer.
See [catalog presentation](PLUGIN-PRESENTATION.md).

`npm test` passes 17/17, including real non-executing executable observations;
all nine isolated owner installation/import checks pass. Application composition,
browser acceptance and installation evidence remain with Rho.

## Headless collaboration extension

Nine owner packages now include the minimal `annotations` capability. All ship
versioned operation declarations and digest-checked Skills in the actual compiled
entry; Rho checks business-schema parity. The shared MCP adapter intersects the
live catalog with grants and optional plugin filters before listing/calling tools.
Annotations freezes Documents UTF-16 excerpts or Tables stable-key entities and
submitted Documents drafts; replies explicitly link messages. Agent contexts
separately record preparation, fetch and explicit reply observations. No UI or
new execution journal is introduced. See [Collaboration](COLLABORATION.md).

Fourteen owner tests and all nine isolated tarball installation/import checks
pass, rechecked on 2026-10-17. They cover annotations, versioned entries and Skill
digests as well as the existing owner boundaries. The two native example
regressions also pass. Source Rho integration and actual Claude Code 2.1.302
collaboration passed without Host starts
or native dispatches. The [README](../README.md#implemented-capabilities) now lists
all nine owners and their shipped entry/feedback scope separately from planned UI.
Installed application evidence remains the application's responsibility: its
[collaboration acceptance](https://github.com/YuLab-SMU/Rho/blob/main/docs/COLLABORATION-ACCEPTANCE.md)
records fixed Full and Collaboration-minimal installations. The earlier
eight-plugin installation below is historical.

## Historical eight-plugin foundation and consumers

[Eight independent headless plugins 0.4](PLUGIN-PACKAGES.md) supply one generic `r.execute` action,
explicit R requirements and preparation, shared documents, declared file/table/
media/object resources, bounded readers and keyed comparisons, typed composition
descriptors and project-scoped stdio MCP. The npm packages ship compiled
capabilities; no project recipe, native R script or scientific checker is bundled.

The [plugin model](PLUGIN-MODEL.md) defines ownership. Documents, files, R, requirements, tables, media, charts and Agent each own a
package, descriptor and implementation. A thin contracts package has no catalog,
capability state, format registry, native plan, document budget, CSV parser or MCP
dependency. Format/requirement/script schemas live in pure owner contract entries;
import and export guards keep those boundaries explicit. Rho selects and wires
services; plugins do not import one another. Only Tables installs csv-parse and
only Agent installs the MCP SDK. Root is a private source workspace. See
[package boundaries and selection](PLUGIN-PACKAGES.md). Five registered view descriptors report UI
unavailable. Those descriptors validate props/bindings without implementing
renderers. There is no marketplace or dynamic loader.

The [public interface reference](PUBLIC-INTERFACES.md) enumerates the eight Node
APIs, dependency ports, schema subpaths and missing capabilities. Browser consumers
use Rho's versioned HTTP/SSE contract; no browser SDK or renderer is supplied.

- Twelve focused capability tests pass: document/undo budgets, immutable MCP intents,
  typed strings/nulls and entity namespaces, joins/provenance, resource freshness,
  script/argument snapshots, requirement probes, byte completion and containment.
  R owns `maxScriptBytes`; saved-script execution does not borrow document limits.
  Only the R execution action requires Requirements; exported objects remain
  readable with Files/R alone, without Documents, Requirements, R or a Host.
- All eight plugin tarballs passed isolated installation/import with only their
  contracts dependency and required external dependencies. No sibling plugin,
  aggregate package, native R script or example is installed.
- Two separate example tests pass: native singleton histogram behavior and exact
  script identity under a spaced Chinese path.
- The [ordinary R project](../examples/ordinary-r-project/README.md) uses base R:
  four sample rows, real linear-model coefficients, PNG/PDF and an exported model
  snapshot. Identifiers `001` and literal `NA` remain strings.
- The [paired analysis](../examples/real-r-analysis/README.md) is an explicit
  scientific consumer. Rho's actual installed 0.4 trial completed five DESeq2 fits,
  16,139-row typed results, independent arithmetic/native checks, apeglm shrinkage
  and a comparison recording both input versions.
- Both projects use the same action, requirements, declaration, reader and
  composition contracts. Rho's full 0.4 installation passes both consumers and
  recovery. Two reduced installations physically include only Contracts/Documents/
  Files or Contracts/Files/R. Unicode documents or exported objects work without
  R or a Host; missing action dependencies remain unavailable before dispatch.
  Removal/reselection retains
  bytes, drafts/undo, selection intent, view references and original requests.
- Actual Claude Code 2.1.301 through MCP SDK 1.29.0 fetched v2 context and changed
  the same unsaved Chinese/emoji buffer, without starting a Host.

The eight-owner application results and installation evidence are in
[Rho's plugin boundary review](https://github.com/YuLab-SMU/Rho/blob/main/docs/PLUGIN-BOUNDARY-ACCEPTANCE.md).
Earlier evidence and retained failures remain in
[Rho's extraction acceptance](https://github.com/YuLab-SMU/Rho/blob/main/docs/EXTRACTION-ACCEPTANCE.md).
The earlier [scientific record](../examples/real-r-analysis/ACCEPTANCE.md) remains
a separate 200-simulation result: five saved models, 121/121 native observations,
12/12 original/retrieved arithmetic checks and rejected altered counterexamples.
The new bounded integration uses one simulation and does not replace that record.

[Agent evaluation](../plugins/agent-eval/README.md) remains a separate development
tool. Its recorded acceptance includes 43 regressions, eight actual CLI baseline
cases, six optional library-fixture cases and one actual-model execution trial.
Retained full-model evidence remains 15/16, including its failure. No evaluator is
required by any capability package.

## Compatibility and remaining work

Rho owns v2 HTTP/client/fixtures and the retained v1 observation bridge. Old requests
keep original parameters, versions and Core identity; observation and restoration
do not rerun recipes. The Plugins collector retains legacy resource/check facts
without selecting old source or requiring the old scientific package set.
Incompatible new work uses v2, rather than redefining the accepted v1 actions.

The first product direction remains npm + local service + a single-window browser
WebUI. React/TypeScript, Vite, Dockview, CodeMirror 6, AG Grid Community and ECharts
are selected UI choices; their views and browser assembly are not implemented.
Electron and cross-window movement follow later. No UI work is part of this
extraction. See [Roadmap](ROADMAP.md#first-integrated-flow).

R execution is batch Rscript. Objects are explicit exported snapshots, with
provenance and bounded JSON previews; there is no live variable inspection or
R-memory recovery after Host replacement. A Core Host is not an R interpreter.
Document/resource reads start no Host or R process. Media returns original bytes and metadata,
without image decoding, PDF rendering or browser interaction.

Execution success, byte integrity, domain checks and model judgments remain
separate facts. Generic integrity checks do not validate scientific methods.
Native tools retain the Host's OS authority; this is not an execution sandbox.
Candidate optimization, blind-set management and hillclimbing remain outside the
implemented evaluator.

Source publication, accepted application composition, npm installation and signed
distribution have separate evidence. Local ignored trial artifacts are retained
at their selected paths, rather than published as a permanent remote archive.
