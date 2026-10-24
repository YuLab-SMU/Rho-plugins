# Annotations

Versioned object-anchored feedback and explicit replies over Documents drafts.
Document UTF-16 ranges and keyed table entities are validated by their source
owners. Submission freezes the draft and source; subsequent edits never rebase it.
The package ships its operation contracts and discovery Skill. It grants no
permissions, starts no runtime and does not manage another editable text buffer.

The optional `./ui` entry exports `TableQuestion`, alongside the routed
`FeedbackComposer`. It uses the Documents editor (including pending-input/IME
state), freezes a table version and this view's selected entity keys, and retains
original intent before submitting. Reload observes; retry reuses the same identity.
`annotation.reply.resources` optionally names up to 16 exact `{id, version}` refs.
Files resolves them within the selected project. They are explicit author links,
not inferred causality or proof of scientific correctness. Existing messages and
archives without this field remain valid.
