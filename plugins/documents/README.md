# Documents and code plugin

`@rho-workspace/plugin-documents` 0.4.7 is an independently packed npm plugin.

Public entries: `Documents`, `documentLimits`; `./contract` exports Node schemas.

One logical document buffer, Unicode edits, undo, snapshots, conditional save and restore.
Direct Node embeddings must serialize mutations under a project writer lease,
as the Rho service does; independent concurrent writers are not supported.

`edit`, `undo` and `save` accept optional final `{changeId,expectedRevision}` after
the author. Old calls remain valid. Identical retries return current state and
the original `receipt`; changed content, conditions or author conflict. `version`
counts content changes, while `revision` advances on every acknowledged mutation,
including saves and legacy calls. `maxReceipts` defaults to 256 per document;
oldest receipts are evicted above that count and `retainedFromRevision` exposes
the boundary. Expired requests cannot bypass their original revision condition.

Save persists `pendingSave` before disk replacement. Reads expose it without
execution; other mutations wait for an explicit identical retry. Matching intended
disk content finalizes the receipt without another replacement. Outside writes
conflict. This is a digest check plus atomic replacement, not filesystem CAS.
Restoring an unresolved save reports conflict and retains its source reference.
`abandonSave` drops a pending save only when disk matches neither its write
condition nor its intended content, so it can never complete. It requires a
`changeId`/`expectedRevision` and the pending `requestDigest`, never writes disk,
and keeps the buffer, dirty state and undo; a resumable save is refused.

A buffer follows its file. When another program (an Agent's own editor, a
terminal, Git) changed the file, `open` takes the disk text in as one `edit` whose
author is `disk`, recorded as the smallest changed span: views show the current
text, history keeps the text before and the person's own undo is untouched.
Unsaved text is merged line by line with the disk change, against the disk text the
buffer last matched (kept beside the record as `<id>.base`): changes to different
lines are both kept, insertions at one place are both kept with the disk's first,
and the buffer stays unsaved. Where both changed the same lines nothing is merged;
the buffer is kept and the save's disk check reports the divergence. A pending save
is never replaced. A missing, non-UTF-8 or over-budget file leaves the buffer as it
was. Who wrote the adopted bytes is not observed and is not claimed. The merge
compares at most `mergeLimits.maxCells` (1,000,000) line pairs per changed region;
past that the region is compared whole, which can turn a merge into a conflict but
never into a wrong merge. The editor's save, refused because the file changed,
opens the document again so the owner merges, and saves once more if it did.

`find(path)` returns the buffer of a path when one exists, without creating it or
following its file. The entry declares `claudeCode` for Claude Code sessions an
application starts: `documents.workspace` as the native skill `documents`, and
`./claude-hook`, a `PreToolUse` command for `Edit|Write|MultiEdit`. It reads stdin
(at most 64 KiB), finds the nearest folder holding Documents records and, only when
the edited file's buffer has unsaved text, denies the native write. The reason names
the buffer; when the native change is determined (the replaced text found once, or
`replace_all`) and merges by line with that text against the unchanged disk, it also
carries the ready `document.edit` input (at most 16 KiB). Any other file, missing
records or unreadable input pass unchanged with no output. It needs no connection,
writes nothing and never creates `.rho`. Files under selected source folders are not
checked.

Rho accepts `{kind:"live-document",documentId}` for a registered document view;
exact `{documentId,version}` bindings retain their meaning. See the
[U2 handoff](https://github.com/YuLab-SMU/Rho/blob/main/docs/U2-BACKEND-HANDOFF.md).
The schema subpath is not a browser runtime. No React/DOM or UI is introduced;
frontend delivery precedes browser write grants and UI acceptance.

`undoOwn(id,version,author,change)` reverses only that authenticated caller's
latest complete active input group. `revert(id,version,targetChangeId,author,change)`
reverses one active content change, including another author's edit. Both require stable
`changeId` and `expectedRevision`, preserve unrelated later edits and refuse
overlap or ambiguous empty-range insertions. Legacy `undo` remains global; it
is not the browser keyboard action. Reversals add explicit compensation records.

`history(id)` lists retained change IDs, authors, groups, versions/digests and
compensation links. `readChange(id,targetChangeId)` reads exact before/after text;
neither starts work or changes the buffer. Retention defaults to 256 entries and
4096 deltas (`maxHistoryEntries` / `maxHistoryEdits`); oldest entries are evicted
with an explicit `historyRetainedFromVersion` boundary. Shared `maxUndoBytes`
covers legacy snapshots plus inserted/removed history text. Its exhaustion rejects
the new mutation. Incomplete or partially reverted groups cannot be undone as a
group. Old archives retain legacy undo but do not acquire invented change history.
Restoration validates the retained history's ranges, versions and digests.

Selected services: None.

No language runtime, table parser or Agent SDK.

The package depends on `@rho-workspace/plugin-contracts` 0.4.0 for generic envelopes and service ports
and ordinary file primitives; that package contains no capability implementation.
Service ports do not install or start other plugins. Rho explicitly selects and
connects providers. `plugin` describes this package and its selected-service
requirements. The optional `./ui` entry supplies the browser renderer; component contracts
remain 0.2.0 independently of the package version.

```sh
# From the Rho-plugins source checkout
npm ci
npm run build
npm pack --workspace plugins/documents --ignore-scripts
```

Use the repository's `pack:plugins` command to produce the contracts tarball and
selected plugin tarballs together. Both explicit R examples are separate consumers
and are excluded from every plugin artifact. Browser behavior is supplied separately through `./ui`.

## Optional browser entry

`@rho-workspace/plugin-documents/ui` exports the CodeMirror view and its draft
contribution declaration. React/React DOM and CodeMirror State/View are exact,
optional peers. The headless root/contract entries never import the UI.

The owner shows text, not languages. An application adds a language and its
highlighting through `extensionsFor(path)`, which returns CodeMirror extensions for a
document's path, at once or as a promise. It is asked with the buffer's own path and
applied in place: the text shows first, the buffer and its sync are untouched, and a
failure leaves the text plain. Exact-version views take the same function.
`onEditor` receives the live editor once it exists (and null when it goes), for a view
that adds its own commands, such as a formatting toolbar; their changes are local input
like typing.

Another view of a document reads the same buffer with `useDocumentBuffer`, the hook
the cards use: every view of one document shares one adapter, so what one view
types or an Agent edits reaches the others once the owner confirms it.

A shared browser adapter serializes identified edits, retries the original
request after a lost reply and keeps unconfirmed text separate on conflicts.
Composition waits for IME commit. The authenticated tab identity determines
“You”; read buffers and receipts cannot replace it. Exact-version views use
retained change snapshots independently of the live adapter. An unavailable
version never falls back to current content and has no Changes panel.

Keyboard undo uses `undoOwn`; there is no local persistent undo/redo stack.
Agent line marks can be hidden; Changes exposes exact before text and one
Revert per Agent change, including separate changes within the same input group.
Save scheduling stays with the external Agent, with no save timer or save state.
In an embedding header (0.4.9) a control is there while it can act: Save while the
buffer has unsaved edits, Review selected text with a selection, and Highlight changes
while Agent or disk edits remain in the text. The embedding application styles them.
The unconfirmed text budget is configurable via the adapter’s
`maxUnconfirmedBytes` (default 1 MiB); rejected input preserves earlier text.
Recovery copies and pending deliveries survive view closure within this tab;
only confirmed owner state is promised after refreshing or closing the browser.

[Rho’s U2 acceptance](https://github.com/YuLab-SMU/Rho/blob/main/docs/U2-UI-ACCEPTANCE.md)
records the composed browser/installed evidence and physical IME limits.

## Optional source-folder file port

Documents 0.4.2 accepts an optional third constructor argument implementing
`resolve(relative, missing?) -> {file, relative}`. The selected file service owns
path resolution; Documents retains buffer identity, undo, actual disk digests and
conditional save behavior. Canonical source-qualified references distinguish equal
filenames and normalize overlapping aliases. Unavailable source access cannot
create a replacement blank buffer. Restoring an archive does not authorize new
source folders; the injected current resolver must accept its reference.


Documents 0.4.7 adds a confirmed-text selection callback for Review and an optional
`TextComparison` over two retained resource refs. It uses the existing content
excerpt, reads at most 1 MiB per version and previews at most 64 KiB without cutting
a Unicode sequence. Buffer snapshots continue to identify their version/dirty
state separately from disk captures. No comparison rewrites a buffer or its undo.
