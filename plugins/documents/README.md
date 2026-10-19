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

Selected services: None.

No language runtime, table parser or Agent SDK.

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
npm pack --workspace plugins/documents --ignore-scripts
```

Use the repository's `pack:plugins` command to produce the contracts tarball and
selected plugin tarballs together. Both explicit R examples are separate consumers
and are excluded from every plugin artifact. No UI work is included.
