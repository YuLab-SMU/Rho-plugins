# Agent bridge and context plugin

`@rho-workspace/plugin-agent` 0.4.9 adds a Claude ACP conversation entry alongside
native-log collection, original feedback, MCP and presentation entries.

Public entries: `AgentContext`, `retainAgentIntent`, `NativeActivity`,
`ClaudeCodeObserver`; `rho-agent-mcp` / `./mcp`, pure `./contract`, `./native`
and `./claude-native`. Independent installation/publication of this candidate
is separate from its source checks.

Scoped MCP tools, durable original caller intents, versioned explicit context, bindings and tool-fetch receipts.

Selected services: Only the read-only sources actually used by a context: documents, files, tables or media.

Only this plugin depends on the MCP and ACP SDKs. Claude retains its model loop.

## Claude ACP conversations

`./conversation` exports `ClaudeAcpConversation`, `ClaudeCliConversation` and their
shared types. The ACP entry pins `@agentclientprotocol/sdk` 2.0.2 and
`@agentclientprotocol/claude-agent-acp` 0.97.0 (Claude Agent SDK 0.3.310).
It uses stable ACP v1 over an owned stdio process. One connection carries multiple
prompts; an explicit later prompt can load the recorded session after connection
loss. Unsupported loading fails without creating another session or resending work.

The embedding application's `session(identity)` callback must durably retain the
ACP identity before `run()` dispatches the prompt. The native transcript ID is not
inferred from that identity. `event()` receives visible text and original tool IDs;
load-history replay, hidden thoughts and raw tool output are excluded. `run()`
reports completion, failure, confirmed cancellation or an unknown transport outcome.
Calling `close()` releases the owned connection; it does not prove native work or
arbitrary background descendants finished. A cancelled original prompt confirms ACP
cancellation. Without that response, cancellation timeout retains an unknown outcome.

`permission()` receives bounded native titles, command/path details and offered
choices. Only an offered option can be returned. Native policy remains in Claude;
the four Rho MCP tools already covered by the application's grant are allowed
without a second prompt. Native tools run with the CLI's OS authority. Applications
own the user-message ledger, authorization of human choices, pooling and wall limits.
`cwd`, MCP servers, model, settings sources, executable and environment are trusted
embedding configuration, never values supplied by model output.

Required process limits protect stdout/stderr bytes per prompt (`maxOutputBytes`),
one NDJSON line before decoding (`maxLineBytes`), session setup time
(`connectTimeoutMs`), cancellation wait (`stopGraceMs`) and native step count
(`maxAgentTurns`). Exceeding output/line/setup limits closes the connection and keeps
received output; a dispatched prompt without a result stays unknown. The embedding
application also bounds retained content and connections. Stderr is drained but not
retained. `ClaudeCliConversation` keeps the earlier one-process-per-message behavior
for existing CLI sessions; it does not translate their IDs into ACP sessions.

The connection's optional `observe(SessionObservation)` callback receives a bounded
projection after durable identity acceptance, including between prompts. `observation`
seeds it from a previous retained projection. Plans replace the complete prior list;
usage preserves reported context size and cost currency; session titles and original
tool IDs/locations retain their source. Each update is marked `initial`, `history` or
`live`; loading history does not append a new turn. A read never connects an Agent.
`./session-contract` exports the pure schema and `./ui` exports `SessionProgress`.

`observationLimits` can reduce the defaults: 32 plan entries, 32 recent tools,
4 locations per tool and 1,024 characters per text field. Overruns keep bounded
content and count omissions. Unrepresented v1 variants are counted explicitly:
reasoning, user/compaction content, mode/configuration/command and notice updates
have no display here. Visible prompt text remains in the turn ledger. These are
selected observations, not a complete protocol transcript.

Claude omits task tools for some provider/model names. The driver defaults
`CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, as documented in the SDK's
[todo tracking guide](https://code.claude.com/docs/en/agent-sdk/todo-tracking).
Trusted environment configuration can override it. It exposes native planning tools;
it does not pre-approve their execution or manufacture a plan from model prose.

`observeSessionFiles` checks explicitly referenced current project files separately.
Its limits argument defaults to 16 files and 2 MiB per file; outside/internal paths,
symlink traversal and excess references are omitted or reported unavailable. Missing,
changed and oversized files retain those states. Each file has its own observed
SHA-256 and time, never inferred Agent authorship or a global project revision.

Fault fixtures cover idle updates, complete plan replacement, history origin,
identity-before-prompt, wrong-session rejection, cancellation/unknown outcomes,
offered permission choices, retention limits and contained file observation.
Actual browser/provider evidence belongs to
[Rho's ACP episode](https://github.com/YuLab-SMU/Rho/blob/main/docs/ACP-EPISODE.md#shared-workspace-loop).

## Core activity collection

`rho-agent-observe` / `./activity-reader`, `./activity-normalize` and
`./activity-collect` read selected Claude Code JSONL and dsh native session events
into an explicitly selected, already-running Core Host. `collect` can attach late,
watch for a bounded interval, and reconnect with the original source and ordinal.
It starts no Agent/model/tool/Host. This entry uses Core's public `activity-*` CLI;
it does not write the application's `NativeActivity` store or change its bindings.

`summary` / `summarizeActivity` derives tool requests, returns, unknown outcomes and
native exit evidence, with original call IDs and receipt cursors. Optional
`./activity-artifacts` records hashes of current files in one selected project
output directory. These are candidates, not proof of which tool produced them.
Instructions, budgets, content policy, native version scope and reproducible
acceptance are in [Agent observation](../../examples/agent-observation/README.md).

## Native observation entry

`ClaudeCodeObserver` consumes the selected Claude Code `stream-json` envelopes.
It confirms the actual session ID before invoking `onInit`, then sends original
tool IDs and requested/returned/rejected observations through `append`. A closed
stream marks outstanding observations unknown. It excludes model prose/reasoning;
its caller owns process startup, wall/output limits and observation failure.
An optional `outputs` callback supplies project-declared artifact hints after a
real tool return. Hints do not prove byte integrity or table/domain correctness.

The application provisions a separate native-adapter credential and checks the
registered session/task/binding on each append. `binding.activity.append` is never
a model tool; the scoped MCP entry serves the authorized context operations.
`binding.activity` with `source: native` reads bounded history; calls without that
field retain their principal-filtered Rho API log semantics. Registration records
identity evidence, not current client liveness or OS sandbox isolation.

`NativeActivity` must be called under the embedding application's project writer
lease and serializer. Initialize it only during explicit fresh-task setup, before
activating routing. Missing/corrupt configured history is not an empty store.
Original retained source IDs deduplicate, changed bytes conflict, and expired
sequences reject without replay. Complete-object pages bind the cursor/query and
history version. Reads start no CLI, model or Host.

Defaults under `agentNativeActivity`: event 16 KiB, batch 64 events / 256 KiB,
retained 256 events / 4 MiB, 128 source epochs. The observer defaults to 2,048 tool
identities per process. Oversized writes reject before replacing retained state;
event eviction exposes a gap and preserves source watermarks. Exhausted epochs
reject new sources. No database, queue, native execution journal or delivery
guarantee is added. Original-session feedback is supplied by the separate optional
entries below; the ACP conversation entry above has its own lifetime. The real
source trial used Claude Code 2.1.306 and two separate projects;
its explicit native resume repaired a manifest path without rerunning Python.

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
npm pack --workspace plugins/agent --ignore-scripts
```

Use the repository's `pack:plugins` command to produce the contracts tarball and
selected plugin tarballs together. Both explicit R examples are separate consumers
and are excluded from every plugin artifact. Agent has no chat UI; the selected Annotations UI owns the contextual question entry.


## Original feedback delivery

Version 0.4.2 exports `FeedbackDelivery`, `./delivery`, pure
`./feedback-contract`, `./claude-feedback-worker` and `./claude-feedback-hook`.
The embedding application explicitly selects the task and original business
binding, initializes fresh delivery once, and supplies its existing project
writer/serializer. Public `feedback.submit/read/status` use the phase-0 frozen
profiles. Submissions retain original input/author/route before owner work;
committed message identity survives thread advancement. Existing Context storage
holds the exact source/message, with original-target restrictions. A narrow
`agent.feedback` Skill instructs current related-document reads, conditional
edit/save, human-edit preservation and explicit original-message `replyTo`.

One bounded delivery file has schema `deliveryStoreSchema`: public frozen store
fields plus private `coordinationVersion: 1` ACK/hook-boundary facts. Exact schema,
original digest/identity and receipt references are checked before use. Default
limits protect 128 submissions / 4 MiB, 128 fetch receipts per delivery and a
12 KiB whole selected feedback object. Item caps may be lowered, not raised
beyond the selected profile. Full, corrupt or missing activated storage keeps
original identities/drafts/owner receipts and refuses unsafe continuation.

Attempts are persisted before transport. After any attempt, worker steps only
lookup the original inbox; absence never authorizes re-enqueue. Hooks persist an
emission attempt before stdout and never emit it twice after an unknown boundary.
Actual `rho_call` feedback.read stream results, rather than prose or shell
arguments, supply client-tool-returned evidence. Hook emission and owner-served
reads do not imply model consumption or native-execution deduplication.

The explicit worker consumes `RHO_ADAPTER_CONNECTION` (one private descriptor or
an array of at most 16) and only calls the embedding application's authenticated
local adapter ports. Defaults are 1,200 cycles / 600,000 ms; each HTTP observation
is bounded by six seconds and the remaining worker time. SIGTERM/SIGINT stop
coordination without cancelling business work. The explicit Claude PostToolUse
hook uses one descriptor and bounded 64 KiB stdin / five-second HTTP calls. It
emits only an original fetch reference, not the whole question. Neither helper
starts, resumes or replaces Claude. The harness owns credentials, native process
lifetime and hook selection. These helpers are not public model tools.

Source checks include real subprocess worker replacement and hook crashes before
and after stdout, with fixture native metadata. Full Claude/provider/installed
acceptance belongs to the application composition and is still pending.


## Layered MCP and optional presentation

All MCP descriptors use `rho_index`, `rho_resolve`, `rho_call`, `rho_read`.
Business is the default profile; presentation remains explicitly restricted.
Startup/tools-list fetch no full protocol or catalog. Discovery starts with owner
summaries, then owner/search pages. Relevant Skills and complete exact contracts
come from the existing owner sources. Results have one JSON text body without a
structuredContent duplicate. Old per-operation tools are removed.

Large operation replies become immutable connection-scoped references. `rho_read`
selects fields by JSON pointer, pages containers and Unicode-safe UTF-16 text, or
releases a result. It cannot execute the source operation. Reads recheck current
authorization; explicit release remains possible after an operation is disabled.
Defaults: 16 KiB reply/page (64 KiB maximum); `RHO_MAX_RESULT_BYTES` 16 MiB,
`RHO_MAX_RETAINED_RESULT_BYTES` 64 MiB, `RHO_MAX_RESULTS` 64. Capacity is reserved
before invoking an operation; exhaustion refuses dispatch and preserves existing
results. Results survive MCP restart. A transport overrun keeps the outcome
uncertain and directs observation of the original identity, never replacement work.

The pure `./layered-contract` entry defines the four tool inputs and Agent note
props. `./layered` provides the bounded complete-object cache and caller checks;
it owns no second registry, native loop or task scheduler. Before execution it
verifies immutable hashes, relevant complete guidance, input/output dependency
closure and exact input shape. It uses the existing managed-intent helper and an
ordinary request's contract precondition; the application rechecks live scope,
provider selection and contract before dispatch. Partial/missing schemas never
become executable cache proofs. Actual native `rho_call` feedback.read results
retain exact fetch attribution; an unrelated operation or prose cannot create it.

The selected knowledge profile caps selections/knownRefs at 16/128 and responses
at 64 KiB (16 KiB convention). It pages whole objects, exposes first-object
requiredBytes and refuses one object over the maximum. The cache holds at most 128
complete bodies and 4 MiB serialized bytes by default, configured by
`RHO_KNOWLEDGE_CACHE_ENTRIES/BYTES`. Bodies it retained are kept beside the private
connection, one file per reference, keyed by project and native session, so the next
process under the same connection — the next message of one conversation — starts with
what it already resolved instead of being refused once. Only content-addressed
immutable bodies are kept, each re-verified on load, and the service still rechecks the
current contract reference on every call: a kept body cannot authorize an operation the
composition no longer offers, and a superseded contract is dropped rather than kept.
Eviction, another connection, a missing or unreadable file and a body over the budget
all require refetch; newly fetched bodies are still returned if the chosen cache cannot
retain them. Context loss explicitly omits missing knownRefs. These limits do not claim
a hard OS heap or external model-token budget. Project enablement and authorization
are never answered from cached guidance.

The optional `./ui` entry supplies `rho.agent-note` 0.2.0: read-only plain text,
at most 600 Unicode characters, with application-written author binding/basis.
It uses an optional React peer and owns no editor, feedback or execution state.
The presentation Skill limits the assigned Agent to workspace.observe/enhance;
Rho controls assignment generation, conditional layout changes, original receipts
and actual visibility. Native tools remain an external harness responsibility;
capability scopes are not an OS sandbox. Full live-model and installed acceptance
is separate from component/SDK/browser source checks.
