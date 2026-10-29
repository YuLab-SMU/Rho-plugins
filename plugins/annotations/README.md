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


## Human result review

Version 0.5.0 adds a whole-resource version anchor and `annotation.decide`.
The embedding supplies the authenticated human identity; an Agent cannot make a
human decision. Accept/needs-changes/withdrawal records bind an explicit Agent
reply and its exact result references. Needs changes requires a frozen Documents
reason. Conditional `expectedVersion/changeId` receipts prevent duplicates;
correction appends with `supersedes`, preserving prior facts. Later results do
not inherit acceptance. Neither decisions nor review UI changes the files/layout
or authorizes execution. Existing archives without decisions remain readable.

The optional `ReviewPanel` connects source questions, replies, result/code/table
renderers, decisions, frozen-context sends and external copy handoff. The Shell
provides navigation, conversation selection and export; no application-private
state is imported. Drafts use Documents' single buffer. Original mutation intent
survives a lost response and can be retried explicitly. The application separately
checks browser composition and real Agent behavior.

Annotations 0.5.1 keeps a newly created review conversation as the next send target,
including after acknowledgement loss and original-identity retry. The target
selector is held while a send is pending. Later feedback reuses that conversation.

Annotations 0.5.2 lists the person's questions and the kept results as choices on the
Review page, newest version of each result first with a count of its earlier ones;
any other exact version stays selectable. Decisions and records are unchanged.
