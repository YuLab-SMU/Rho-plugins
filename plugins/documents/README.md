# Documents and code plugin

`@rho-workspace/plugin-documents` 0.4.0 is an independently packed npm plugin.

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
The unconfirmed text budget is configurable via the adapter’s
`maxUnconfirmedBytes` (default 1 MiB); rejected input preserves earlier text.
Recovery copies and pending deliveries survive view closure within this tab;
only confirmed owner state is promised after refreshing or closing the browser.

[Rho’s U2 acceptance](https://github.com/YuLab-SMU/Rho/blob/main/docs/U2-UI-ACCEPTANCE.md)
records the composed browser/installed evidence and physical IME limits.
