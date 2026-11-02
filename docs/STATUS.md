# Current component status

Updated: 2026-11-02.

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
over Manual).
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
