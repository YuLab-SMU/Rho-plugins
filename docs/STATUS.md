# Current component status

Updated: 2026-11-08.

Kernel **0.5.10** lets an embedding conversation select exact Notebook `cellIds` from
native tool receipts, so sessions sharing one connection grant do not acquire each
other's cells. A focused scope regression and the owner build pass; the application
checked the original two cells in its real Harness Studio without rerunning them.
Tables **0.5.1** uses Agent-neutral selection feedback. See the
[external work episode](https://github.com/YuLab-SMU/Rho/blob/main/docs/EXTERNAL-WORK-EPISODE.md)
for the separate application evidence and limits.

The optional [Semantic figures 0.1.0](../plugins/semantic-figures/README.md) plugin captures native ggtree tree layouts and enrichplot dotplot/cnetplot views from project RDS files. Two separate adapters retain clade membership and term/gene identities; conditional shared selections are readable by Agents. Five owner checks pass; the [Rho episode](https://github.com/YuLab-SMU/Rho/blob/main/docs/SEMANTIC-FIGURES-EPISODE.md) passed with public package data, real R and Chrome, including layout switching, bidirectional linking, reopening and failure recovery. Views remain on Plugins; no automatic Agent interpretation, semantic migration, npm publication or update to the user’s running instance.

Agent **0.4.33** records its shared MCP export, stdio transport and four tools in
`plugin.agent.mcp`. The server and descriptor use `src/mcp-entry.ts`, so discovery
does not maintain another list or start a server. Three intent/unreachable-MCP
regressions pass; Rho separately checked actual stdio tool discovery and its
[plugin disclosure episode](https://github.com/YuLab-SMU/Rho/blob/main/docs/PLUGIN-DISCLOSURE-EPISODE.md).
The [README entry records](../README.md#entry-records) identify the current owner
declarations and distinguish capability, UI extension and asset packages.

Agent **0.4.30** lists and reads the Claude Code and Codex sessions recorded for a
project folder from the Agents' own files, with where each started, whether another
process holds it now and its resume command; reading starts no Agent and is bounded
by `nativeSessionLimits`. ACP conversations can continue a copy of a session
(`forkFrom`, ACP fork), and the adapter no longer passes inherited Claude Code session
markers that turn off transcript saving. [Native sessions](../plugins/agent/README.md#native-claude-code-and-codex-sessions);
32 Agent owner tests pass. The application's continuity episode with a real Claude
Code is separate from this component check.

Native sessions (source after Agent 0.4.33): Codex keeps every folder's sessions in
one place, and the summary kept for each file did not record which project it was
checked for, so after one project was listed, another project opened in the same
process listed and could read the first project's Codex sessions (and missed its own
when the order was reversed). The kept summary now carries the session's own folder;
`test/native-sessions.test.mjs` fails on the previous source and passes.

Agent **0.4.31**: the MCP bridge sends its client's own `clientInfo` name and version
to the application in `x-rho-client` ([Layered MCP](../plugins/agent/README.md#layered-mcp-and-optional-presentation)),
so a connected Agent can be named by what it reports. 33 Agent owner tests pass.

Agent icons **0.1.0** is a new web-only package: the marks and names of 62 Agents and
model makers. These are mostly lobehub icons (MIT), each identified by whole words of
the name an Agent gave, in catalog order. The build refuses icons with scripts, outside
references or no entry. [Agent icons](../plugins/agent-icons/README.md); 4 tests pass.

Agent 0.4.29 retains native Harness conversations in project-local observations,
with original session/turn/call identities, visible replies, separate tool/exit
outcomes and reported or exact-version results. Read-only operations and the UI
entry keep input in the original client. [Budgets and boundaries](../plugins/agent/README.md#external-conversations)
cover partial records, backwards/conflicting sources, symlinks and writer locks.
Four focused owner regressions pass; the application's real Harness episode is
separate from this component check.

The optional [sclet package](../examples/sclet-plugin/README.md) is the first
consumer of Rho's runtime third-party API 1. It lives outside the base catalog:
public sclet operations, a driver Skill and prebuilt UI share the project's R
session. R 4.5.2/sclet 1.1.0 completed a synthetic 200-gene, 60-cell preprocessing
and PCA trial, result recording and audited report; stale plans were refused.
The application [episode](https://github.com/YuLab-SMU/Rho/blob/main/docs/THIRD-PARTY-PLUGINS-EPISODE.md)
keeps failures and limits. No npm publication or biological validity is claimed.

Files 0.5.0, Annotations 0.5.2 and Tables 0.5.0 supply immutable captures,
version-bound human decisions and explicit multi-field comparison. Documents
0.4.8 adds confirmed selection review and captured text comparison, and hands an
embedding view its editor (`onEditor`); 0.4.9 shows its header controls only while
they can act (Save with unsaved edits, Review with a selection, Highlight changes
while Agent or disk edits remain). Agent 0.4.23
delegates the compatible capture entry to Files and exposes frozen-context delivery
facts. It keeps a command's whole text (8 KiB) instead of its first line, so a
here-document an Agent ran can be read and run again, and the Agent's own words on
what the command is for (`purpose`). The embedding application's
session instructions are appended to the Agent's own system prompt when a session is
created and loaded (ACP `systemPrompt`, append). `describeFile` asks the person's own
Claude Code, with no tools and no kept session, for one sentence on what a file holds
from facts and its first lines, the image itself, or the code that made it
(`describeLimits`); `./models` reads models.dev for image input and prices and
estimates a call's cost when Claude Code does not know it (`modelCatalogLimits`). Console 0.1.0 runs a person's
shell commands in the project folder and retains each one's identity, ending and
bounded output; 0.2.0 adds `./ui`, the person's command line and records for a page to place
among its own; 0.3.0 adds `console.events`, who ran each command and when, for a timeline.
Notebook 0.1.0 (`plugins/kernel`) keeps a live R and a live Python
session per project that an Agent and the person share: cells keep their identity,
order, output as it is printed, plots and the session's variables; interrupt names a
cell and stop names a session; sessions end with their host and are recorded so. Its
`kernel.inspect` reads one value as its session describes it (table, model, vector,
list, function) with a page of it and the code that reaches each part, without
starting, waiting for or changing a session, and each cell names the values it made,
changed and removed. Notebook 0.4.0 draws its own views: `./ui` holds the Notebook, Variables,
Plots, Data flow, Servers and a value's view, registered as six components, and `./code` the
statement, load-code and data-flow functions that moved from Rho. Notebook 0.5.0 adds
`kernel.events`, who ran each cell, when, where and how it ended; the contracts package carries
the shared event shape (`timelineContract`) and a descriptor's `timeline` names a plugin's events read. Markdown 0.2.0 ticks to-dos in place, edits with a formatting toolbar
and hides comment-only lines; its view contract stays 0.1.0. The earlier
code/highlight/command-output work is retained.
Agent 0.4.24 has both ACP adapters drive the person's installed `claude` and `codex`
(selected path, `CLAUDE_CODE_EXECUTABLE`/`CODEX_PATH`, else `PATH`), so an application
can omit the adapters' optional native clients. A missing client fails the message
before the adapter starts, with a reason naming it ("Codex was not found on PATH"),
where the adapters reported only a closed connection. The pack script adds Notebook and
Skills, with Notebook's two runners as its only non-`dist` files.
Agent 0.4.26 passes Claude Code a step cap only when the application sets one, and takes
`preferred` settings for a new session: each applies only where the person chose nothing,
the Agent offers the value and the session opened with a value it replaces (Rho prefers Auto
over Manual). Agent 0.4.27's MCP bridge waits for a call as long as the `waitMs` it asked
for plus 30 s, over `node:http`: a 30 s cut-off, and fetch's 300 s one, had ended Notebook
cells still running within their wait with an unknown outcome. Agent 0.4.28's bridge reports a
refused connection — Rho not running at the connection's address — as `unavailable`, with
nothing delivered, instead of an unknown outcome. Notebook 0.5.3 starts a session with a program the
project names (`kernel.run` `interpreter`, such as `.venv/bin/python`, kept for later sessions),
records each session's and each cell's program and version, and lets a caller start again a
session only it ran cells in. Notebook 0.5.4 names, under each cell and each variable, the cell
that made what it read and the later cells that read what it made; reads a script's values from
its text alone (`scriptFlow`, R and Python), drawn as Data flow's boxes for a script beside its
editor (`ScriptFlowView`) and for a cell that makes its values over three or more steps; and has
its runners look at path-like strings first, so a script's labels no longer crowd out the figure
it writes last. Documents 0.4.11 lets a page keep the editor's `flow` switch. Notebook 0.5.5
redraws Data flow as a graph of values from the files read to the results, with functions and
constants named on what uses them, a bar to trace one result and the chosen value's path and
details; each node is titled with the meaning its `# means:` comment gives, with its name beneath (the
Agent writes these, and `scriptFlow` and each session cell read them from the text: `sessionGraph`,
`scriptGraph`); `lanes`, `related`, `flowPath` and `scriptStepAt` are gone. Notebook 0.5.6 says
"on this machine" in the Overview only for a live session: the project Rho ships listed its
ended sessions, recorded where the example was made with R 4.5.2, as "R 4.5.2 on this machine"
on a Windows machine with R 4.5.1 ([Rho#112](https://github.com/YuLab-SMU/Rho/issues/112)). On
Windows it also starts a local session without a POSIX `C.UTF-8` value in `LC_ALL`, `LC_CTYPE`,
`LC_COLLATE`, `LC_TIME` or `LC_MONETARY`, which an Agent's Git Bash passes on to Rho: Windows has
no such locale, so R warned at startup, ran in the C locale and printed "3 × 2 中文" as
"3 <U+00D7> 2 <U+4E2D><U+6587>". The new Windows test fails without the change; in that
environment the kernel tests also left an R session that kept the test file from exiting.
Notebook 0.5.1 runs local R sessions on Linux. Node hands the R runner its answer descriptor
as a socket, which Linux will not open as `/dev/fd/3` (ENXIO); there a `cat` that ignores
the session's interrupts relays the answers. Printed text after a mark now waits up to a
second for that mark's answer, and joins the answers' queue instead of landing at once, so
output keeps its order whichever stream arrives first (the relay, ssh, or a held answer
released by its mark: on macOS a warning sometimes landed after the value printed below it).
On Debian 12 arm64 the local Notebook tests went from 7 passed and 5 R failures to 12 passed
(Matrix absent, one skipped).
On Windows a process an owner starts and stops as a group (a Notebook session, a Console
command, an Agent client) gets a console of its own without a window, which what it starts
shares, so no window opens. Interrupt and Stop raise Ctrl+Break on that console, or Ctrl+C for
a Python session, which turns its Ctrl+C handling back on so that a wait ends at once; a stop
that is not obeyed ends the process tree (`taskkill /T /F`). A process id Windows may since
have reused is not signalled. Notebook 0.5.2: R there cannot open descriptor 3, so the host
serves a named pipe the runner opens, and printed `\r\n` becomes `\n`. Console 0.3.1 runs
cmd.exe unless a shell is named. Agent 0.4.25 looks for `claude` and `codex` with PATHEXT's
extensions (`claude.exe`, an npm `codex.cmd`) and compares Windows paths in either case.
Files 0.5.1, Documents 0.4.10 and R 0.4.2 name project paths with `/`, and skip directory
flushes, which Windows refuses (EPERM). Annotations, Markdown and HTML accept Documents
0.4.10; Markdown named only 0.4.7 before. Requirements 0.4.2 sends its dependency probe as one
line of fixed text, with the project library path in the environment: on Rho's Windows CI runner,
Rscript 4.6.2 ran only the first line of a multi-line `-e`, and nothing of one naming a path with
characters cmd treats specially, exiting 0 both times, so managed R runs there were refused as
unknown. Its output is split on CRLF too.
The owner suite passes 165/165 on macOS. On Windows 11 x64 (Node 22.23.4, R 4.5.1, Python
3.13.9) it passes 158 of 166 and skips 8 that use Unix shell scripts as stand-ins: three for
Claude Code (file descriptions) and five for ssh and serverctl (remote places). Real Claude
Code and Codex were not run on Windows. Application composition and installation are checked
by Rho, separately from component checks.

| Owner | Implemented boundary | Material limit |
| --- | --- | --- |
| Files | Independent digest-checked snapshots with path/time/source; original bytes survive overwrite/delete; legacy registration unchanged | 8 MiB snapshot default, existing 512 MiB/1024-resource store; no inferred production claim |
| Annotations | Whole-resource, document-range and keyed-row questions; explicit replies; append-only accepted/needs-changes/withdrawal decisions and retry receipts | Only embedding-authenticated humans decide; reasons required for needs-changes; later versions inherit nothing |
| Tables | One to sixteen numeric field pairs, explicit keys/namespaces/mapping, full/left/inner join, before/after/delta and row presence | Missing row/null/zero differ; invalid mapping/duplicates/non-finite delta refused; no inferred scientific comparability |
| Documents | Single shared buffer, own undo, disk conditions/merge, native-edit hook, snapshots; confirmed range review and immutable text comparison | Disk/buffer capture stays distinct; 1 MiB comparison read and 64 KiB preview |
| Agent | Claude/Codex ACP, native tools normally, optional Core, bounded activity/commands, frozen contexts, explicit response facts and tool-less one-sentence file descriptions | Unknown outcomes preserved; no arbitrary session-history access or human decision authority; a description is generated and unchecked |
| Agent icons | Marks and names of Agents and model makers, looked up by the words of the name an Agent or its client gave; one-colour marks follow the theme's ink | A name that matches no alias gets no mark; a mark identifies its owner only, from lobehub 1.102.0 or the product's site |
| Markdown | Optional reader over Documents with to-dos ticked in place, an editor with formatting controls, relative links/media and math | Same buffer; not an additional document owner; a to-do whose line moved is left alone |
| Console | Person-run commands in the project folder: change identity, process-group stop, exit/signal, head-and-tail output, continuing/unknown after restart | 200 records, 4 running, 1 MiB kept output (64 KiB tail); the host decides who may run; never reruns a known identity |
| Notebook | Live R and Python sessions shared by an Agent and the person: per-caller cell identity, one queue per session, streamed output in order, R and matplotlib plots, variables, interrupt by cell, stop by session, rho-closed/unknown/not-run after restart | 16 waiting cells, 256 KiB output and 8 plots (4 MiB each) per cell, 500 cells, 200 variables; a cell's own memory and time unbounded; the host decides who may stop |

The Rho [review episode](https://github.com/YuLab-SMU/Rho/blob/main/docs/REVIEW-EVIDENCE-EPISODE.md)
records real airquality, Python/R and browser observations. A context read differs
from a new explicit reply; responses already frozen into a context do not count as
answers to that new context. A Codex permission without a title uses its original
tool update's name; native tool spelling and original permission scope remain.

Native tools and ordinary files remain normal; Core is optional. The existing
execution/resource/domain/model boundaries are unchanged. Selected service ports
do not install other owners. Fixed datasets, months and analysis methods remain
in application scenarios, not generic contracts. Archives retain new decision
fields and exact resource provenance. Old archives without them remain readable.

Earlier work includes source-folder confinement; Documents merge/undo and the
Claude edit hook; finite table paging/selection; feedback original-identity recovery;
Agent ACP settings, idle observation and external-client relay; named-file capture;
optional owner UI entries and pure schema/discovery imports. Their original
observations remain in Git and the individual READMEs/examples.

No component result proves the assembled application's macOS installation,
Windows/Linux support, scientific correctness or human usability. Independent
researcher use and physical IME remain unobserved. Rho owns the selected assembly,
Graph, capture timing and evidence export. Core execution behavior was not changed.
