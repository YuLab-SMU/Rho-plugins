# Agent bridge and context plugin

Agents normally use their native tools and existing permission settings. Rho MCP
capabilities supplement those tools; managed execution is selected only for a
concrete need. The compatibility Claude CLI driver no longer disables built-in
tools, hides configured MCP servers or forces `dontAsk`. Its noninteractive entry
cannot answer new native permission prompts; ACP supplies interactive choices.
External activity retention stays independent of managed execution and does not
confer Core acceptance, deduplication or scientific validity.

`@rho-workspace/plugin-agent` 0.4.19 adds visible tool titles, ACP tool categories
and one identifying input (path, pattern or query, or the whole command up to
8192 characters) to conversation steps; since 0.4.23 a command also keeps the Agent's
own few words on what it is for (`purpose`, Claude Code's Bash description, one line
of at most 200 characters),
plus Claude/Codex ACP conversations and an external-client relay, native-log
collection, original feedback, MCP and presentation entries.

Public entries: `AgentContext`, `retainAgentIntent`, `NativeActivity`,
`ClaudeCodeObserver`; `rho-agent-mcp` / `./mcp`, pure `./contract`, `./native`
and `./claude-native`. Independent installation/publication of this candidate
is separate from its source checks.

Scoped MCP tools, durable original caller intents, versioned explicit context, bindings and tool-fetch receipts.

Selected services: Only the read-only sources actually used by a context: documents, files, tables or media.

Only this plugin depends on the MCP and ACP SDKs. Native Agents retain their model loops.

## ACP conversations

`./conversation` exports `ClaudeAcpConversation`, `CodexAcpConversation`, `ClaudeCliConversation` and their
shared types. The ACP entry pins `@agentclientprotocol/sdk` 2.0.2 and
`@agentclientprotocol/claude-agent-acp` 0.97.0 (Claude Agent SDK 0.3.310).
Codex uses the official `@agentclientprotocol/codex-acp` 2.3.0 (written against Codex 0.164.0).
Both adapters drive the person's installed client: `claude` / `CLAUDE_CODE_EXECUTABLE`
and `codex` / `CODEX_PATH` select an executable, otherwise `claude` or `codex` on
`PATH`. The adapters' bundled native clients are optional platform packages an
application can omit (`npm install --omit=optional`). `CODEX_CONFIG` keeps
the adapter's native provider settings. An explicit `model` merges into that config.
No Claude-specific session metadata or permissions are sent to Codex.
It uses stable ACP v1 over an owned stdio process. One connection carries multiple
prompts; an explicit later prompt can load the recorded session after connection
loss. Unsupported loading fails without creating another session or resending work.

The embedding application's `session(identity)` callback must durably retain the
ACP identity before `run()` dispatches the prompt. The native transcript ID is not
inferred from that identity. `event()` receives visible text and original tool IDs;
each tool step also carries the Agent's bounded human title, its ACP tool category
(`read`, `edit`, `execute`, `search`, …) and one identifying native input (command,
file path, pattern or query) when the Agent reports one. A command also carries its
exit code and the last lines it printed (`commandOutput`, within `commandOutputLimits`:
20 lines and 2 KiB, terminal codes removed), which the Agent sends because the client
asks for ACP's `terminal_output` extension; an exit code the Agent does not report is
not invented. Load-history replay, hidden thoughts and other tool output are excluded. `run()`
reports completion, failure, confirmed cancellation or an unknown transport outcome.
Calling `close()` releases the owned connection; it does not prove native work or
arbitrary background descendants finished. A cancelled original prompt confirms ACP
cancellation. Without that response, cancellation timeout retains an unknown outcome.
When the Agent advertises `sessionCapabilities.close`, normal shutdown first sends
`session/close` within `stopGraceMs`, releasing the native writer before process
termination. Unsupported/failed/timed-out close still ends the owned transport;
it never deletes or replaces the native session.

`instructions` is text the embedding application tells the Agent about the session.
It is appended to the Agent's own system prompt (ACP `systemPrompt` in append mode)
when the session is created and when it is loaded again, for Claude Code and Codex
alike, and to Claude CLI's appended system prompt. It is trusted embedding
configuration, like the command, never taken from a model or a prompt.

`./describe` exports `describeFile`, one sentence on what a file holds, written by
the person's own Claude Code (`claude -p`) with every tool turned off (`--tools ""`),
no MCP servers and no kept session, under a fixed system prompt for each `strategy`.
It is given the file's path, facts the embedding application read from the file, the
person's request, an explicit `model` when the caller names one, and one of: the
file's first lines (`text`), the image itself (`image`, PNG, JPEG, GIF or WebP sent
as a stream-json image block), or what made the file, such as the code that wrote a
figure (`context`), which is told it has not seen the figure. The caller chooses the
strategy and the working folder; an empty folder keeps project instructions out.
`describeLimits` bounds the text input (8 KiB), the image (3.5 MiB), the output
(256 KiB of stream records), the sentence (320 characters) and the time (60 s, then
the process group is stopped). A failure, a refused image, an empty answer or a call
past its time is reported to the caller and never retried here. The result carries
the model Claude Code used, the tokens it reports and its cost figure with its basis
(`list`, or `unknown` when Claude Code guessed). The sentence is generated: it checks
nothing and grants nothing.

`./models` reads what [models.dev](https://models.dev) lists about a model.
`loadModelCatalog(file)` keeps a compact copy of `api.json` in a file the caller
names, reads it again once a day and keeps the last copy when a download fails, not
asking again for ten minutes; `modelCatalogLimits` bounds the download (16 MiB,
20 s). `findModel(catalog, model)` matches a session's model, such as
`gateway/deepseek-v4.1-flash[1m]`, by the provider it names, else its maker's own
listing, else every listing (median price, majority on image input).
`callCost(call, facts)` gives one call's cost: Claude Code's figure when it knows the
list price, else an estimate from the reported tokens and the listed price, else
unknown with Claude Code's guess named. A provider's bill may differ from either.

`ClaudeAcpOptions.plugins` lists local Claude Code plugin directories the session
loads (`plugins` in `_meta.claudeCode.options`, without their MCP discovery).
`writeClaudePlugin(parent, plugin)` writes one from declared skills and hooks: a
manifest, `skills/<name>/SKILL.md` and `hooks/hooks.json` with shell-quoted absolute
commands, at most `claudePluginLimits` (32 skills, 16 hooks, 64 KiB per skill;
more is refused before writing). The directory is named by its content digest and
never rewritten, so running sessions keep the skills they started with; nothing
private is written. Claude Code may list a skill without its description when its
skill listing exceeds its character budget.

`permission()` receives bounded native titles, command/path details and offered
choices. Only an offered option can be returned. Native policy remains in the selected Agent;
the four Rho MCP tools already covered by the application's grant are allowed
without a second prompt. Native tools run with the CLI's OS authority. Applications
own the user-message ledger, authorization of human choices, pooling and wall limits.
`cwd`, MCP servers, model, settings sources, executable and environment are trusted
embedding configuration, never values supplied by model output.

Session settings are the Agent's own ACP `configOptions` (model, effort, mode and the
like). `config` holds a person's choices by setting id; they are set once the session
opens and before any prompt, and a setting or value the Agent does not offer fails that
message with nothing sent. `preferred` holds the embedding application's defaults for a
new session, such as `{ mode: { value: 'auto', replaces: ['default'] } }`: each applies only
when `config` names nothing for that setting, the Agent offers the value and the session
opened with a value it replaces, and is skipped otherwise; a loaded session keeps its own.
`configure(id, value)` changes one between messages on a
connected session; `configuration` returns what the session offers now. `inspect()`
opens a new session only to read its settings, deletes it when the Agent supports
`session/delete`, and ends the process; it sends no prompt and is an explicit action,
never a read.

Required process limits protect stdout/stderr bytes per prompt (`maxOutputBytes`),
one NDJSON line before decoding (`maxLineBytes`), session setup time
(`connectTimeoutMs`) and cancellation wait (`stopGraceMs`). An optional native step
count (`maxAgentTurns`, Claude only) is passed to Claude Code; without it Claude Code
applies no step cap of its own. Codex uses the embedding application's wall/output
limits, without a fabricated native step cap. Exceeding output/line/setup limits closes the connection and keeps
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
Standard ACP diff paths also supply bounded file references when a tool omits a
separate locations field; the projection retains no old/new file contents.
`./session-contract` exports the pure schema and `./ui` exports `SessionProgress`.

`observationLimits` can reduce the defaults: 32 plan entries, 32 recent tools,
4 locations per tool, 1,024 characters per text field, and 12 settings of at most 256
values each. Overruns keep bounded content and count omissions. Settings are observed
when the session opens, after `configure()` and on `config_option_update`.
Unrepresented v1 variants are counted explicitly: reasoning, user/compaction content,
mode/command and notice updates have no display here. Visible prompt text remains in the turn ledger. These are
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

## External ACP client observation

Select `rho-agent-acp --project /absolute/project --agent codex` as an external
client's ACP command (`claude` selects Claude). Rho's installed CLI exposes the same
entry as `rho --acp /absolute/project --acp-agent codex`. `./acp-cli` exports
`runExternalAcp`; `./external-acp` exports the observer, bounded reader and limits.
The original client creates or loads the native session. The relay forwards the
original stdio bytes and owns only its child connection; Rho owns neither its input
nor its lifetime. Views and reads start no process. ACP v1 has no standard passive
attachment to another live client; an existing session must reopen through its
client with the relay selected. Native transcript collection remains a fallback.

The relay retains selected session observations and up to 8,192 characters of the
latest visible reply, not prompts, permission choices, reasoning or raw tool I/O.
Records live under the selected project's `.rho/agent/acp/`, with one live writer
per agent/session identity. Failed/unknown prompt outcomes and load-history origin
stay distinct. Disconnect expires the connection and marks unfinished work unknown;
it never resends a prompt. Cancellation of a Codex turn can leave an independent
native terminal running; an ACP cancelled response does not certify process exit.

`externalAcpLimits` protects 64 retained sessions, 512 KiB per record, 128 pending
requests/permission observations, and 128 pre-identity updates within 512 KiB.
The transport tap bounds one parsed line at 4 MiB. Overflow or a projection write
failure disables observation, preserves the last record and forwards ACP traffic.
Heartbeat writes occur every two seconds; a ten-second lease or a dead relay PID
makes a read disconnected. Reads scan at most 256 directory entries, reject unsafe
paths/symlinks and count unavailable records. Setup refuses an unsafe store; it does
not silently write outside the project. Retention exhaustion refuses new observed
identities without deleting old records. These bounds do not cap the external
Agent's native execution or the original client's transcript.

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

`ActivityFeed` (`./ui`) shows these reads to a person. It brings its own `rho-act-`
stylesheet and reads the embedding's `--color-*` tokens with fallbacks: a Host that does
not answer is one card with Reconnect, counts are tiles, and each action is a card whose
state is its colour. An embedding may pass the project folder as `root`; a Read/Edit path
inside it is then shown relative to it, while Action details keep the original input.

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
results. Results survive MCP restart. One call to the service may take
`RHO_TRANSPORT_MS` (30 s), plus the `waitMs` it asks the service to wait (at most ten
minutes, as for a Notebook cell); the call uses `node:http`, whose wait for a reply has
no limit of its own. A transport overrun keeps the outcome uncertain and directs
observation of the original identity, never replacement work. A refused connection is the one
transport failure whose outcome is known: nothing reached the service, so the call
returns `unavailable` naming the address and saying nothing ran (`delivered: false`).

Since 0.4.31 each call also carries `x-rho-client`: the name and version the MCP
client gave in its own `initialize` (`clientInfo`), each URL-encoded and at most 128
characters, joined by `/`. A client that gives no name sends no header. The
application uses it to say which Agent a connection belongs to; it grants nothing.

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


Agent 0.4.18 delegates legacy activity capture to the selected Files capture port.
Frozen context state reports which annotation version was sent and whether it was
fetched; an explicit response excludes replies already present in that context.
ACP retains Codex's native MCP spelling while identifying its operation, and names
an otherwise unnamed permission from the original tool update. These observations
do not expand native permission or grant access to arbitrary session history.

## External conversations

Agent 0.4.29 exports `dsh-session` for a Harness adapter to retain a read-only
observation of a native version-4 session. `observeDshSession(projectRoot, header,
events)` requires the real native working folder to equal the selected project.
It preserves session, turn and tool-call identities. Repeated cuts replace the
same record; a changed prefix or backwards cursor is refused. It never creates
an Agent, executes a tool, changes a grant or resumes a runtime.

`external-session` supplies bounded `listExternalSessions` and
`readExternalSession` reads. The operation contracts are `agent.sessions.list`
and `agent.sessions.read`; an embedding application supplies authorization.
`ui-external-session` renders prompts, visible replies, operations and results. The
view sends nothing itself; an application continues the conversation through the
Agent's own session. The operations are presented as Agent conversations: where a
session was started is not a kind of conversation. Reasoning, injected context
and system messages are excluded; credential-shaped strings are redacted.
This is an observation of the client's reports, not an independent execution proof.

A successful resource-registration reply carries its exact resource identity and
version. The application must verify that tuple against its own project resources.
A native deliverable without a receipt is only a reported path, with no historical
bytes asserted. Tool return, native exit code and turn completion remain separate.
An unfinished turn with no observation for 10 seconds has an unknown outcome.

`externalSessionLimits` names the fixed local observation budgets: 64 sessions
per project, 200 retained turns per session, 256 tools per turn, 32,768 source
events / 32 MiB per cut, 32,768 characters per prompt/reply and earlier-reply
collection, 8,192 characters per tool field, and 4 MiB per stored record.
Text/tools/earlier turns beyond their budgets are omitted with counts. An
oversized source, conflicting cut, invalid record or busy writer retains the
previous record and reports failure. Storage is `.rho/agent/external`, contained
in the project without symlink directories; atomic replacement leaves readers a
complete record. A positively dead PID lock can be reclaimed; an unknown/live
lock cannot. Reads create no directories or runtime state. These limits protect
local storage and observation work; they do not limit the native Agent.

`test/external-session.test.mjs` checks identity, prefix conflicts, omissions,
missing outcomes, redaction, project containment, retained failure and pagination.
The Rho application records its separate real Harness/browser acceptance.

### Native Claude Code and Codex sessions

Agent 0.4.30 exports `native-sessions`. `listNativeSessions(root, nativeSources(env))`
lists the Claude Code and Codex sessions whose recorded working folder is `root`,
read from the Agents' own records: `CLAUDE_CONFIG_DIR` (or `~/.claude`)
`/projects/<folder>/<id>.jsonl` and `CODEX_HOME` (or `~/.codex`)
`/sessions/**/rollout-*.jsonl`. Each summary keeps the native session ID, title,
times, turn counts, where it started (Claude Code's `entrypoint`, Codex's
`originator`), whether another process holds it now (Claude Code's live
`sessions/<pid>.json` with a running PID, Codex's `thread-writer-locks/<id>.lock`)
and the terminal resume command. `readNativeSession` streams one record into the
same turn shape as `readExternalSession`, with each turn's tools, results and
reply. Reading starts no Agent, takes no lock and writes nothing.
`nativeSessionLimits` names the budgets: 64 sessions per listing, 4,096 files
scanned per Claude Code folder and across Codex's sessions, 256 KiB read from each end of a file for a summary, at most 256 MiB
streamed from the end for a read, 200 turns, 256 tools per turn, and the text and
tool field limits above. Sidechains, injected reminders and local command output
are excluded. A recorded interruption is stopped. A last turn without an end record
is running while its file was written in the last minute; after that it is completed
when it has a reply and no unanswered tool, and unknown otherwise.
A file is read again only when its size or modification time changes; what is kept
is the folder its session ran in, and every listing compares that folder with `root`,
so one project's sessions are never listed or read for another.

To continue such a session, the application passes its ID as `sessionId` (ACP
`session/load`). `forkFrom` instead asks the Agent for a separate copy through
`session/fork`; the connection is refused before sending when the Agent does not
advertise fork, or returns the same ID. `acpEnvironment` drops inherited Claude Code
session markers (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION` and related variables):
a Claude Code started under them saves no transcript, so its session could not be
listed or continued anywhere else.
