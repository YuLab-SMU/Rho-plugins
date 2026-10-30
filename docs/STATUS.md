# Current component status

Updated: 2026-10-30.

Files 0.5.0, Annotations 0.5.2 and Tables 0.5.0 supply immutable captures,
version-bound human decisions and explicit multi-field comparison. Documents
0.4.7 adds confirmed selection review and captured text comparison. Agent 0.4.19
delegates the compatible capture entry to Files and exposes frozen-context delivery
facts. It keeps a command's whole text (8 KiB) instead of its first line, so a
here-document an Agent ran can be read and run again. Console 0.1.0 runs a person's
shell commands in the project folder and retains each one's identity, ending and
bounded output. Markdown 0.1.0 and the earlier code/highlight/command-output work are retained.
The owner suite passes 117/117; application composition and installation are checked
by Rho, separately from component checks.

| Owner | Implemented boundary | Material limit |
| --- | --- | --- |
| Files | Independent digest-checked snapshots with path/time/source; original bytes survive overwrite/delete; legacy registration unchanged | 8 MiB snapshot default, existing 512 MiB/1024-resource store; no inferred production claim |
| Annotations | Whole-resource, document-range and keyed-row questions; explicit replies; append-only accepted/needs-changes/withdrawal decisions and retry receipts | Only embedding-authenticated humans decide; reasons required for needs-changes; later versions inherit nothing |
| Tables | One to sixteen numeric field pairs, explicit keys/namespaces/mapping, full/left/inner join, before/after/delta and row presence | Missing row/null/zero differ; invalid mapping/duplicates/non-finite delta refused; no inferred scientific comparability |
| Documents | Single shared buffer, own undo, disk conditions/merge, native-edit hook, snapshots; confirmed range review and immutable text comparison | Disk/buffer capture stays distinct; 1 MiB comparison read and 64 KiB preview |
| Agent | Claude/Codex ACP, native tools normally, optional Core, bounded activity/commands, frozen contexts and explicit response facts | Unknown outcomes preserved; no arbitrary session-history access or human decision authority |
| Markdown | Optional reader over Documents with source editor, relative links/media and math | Same buffer; not an additional document owner |
| Console | Person-run commands in the project folder: change identity, process-group stop, exit/signal, head-and-tail output, continuing/unknown after restart | 200 records, 4 running, 1 MiB kept output (64 KiB tail); the host decides who may run; never reruns a known identity |

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
