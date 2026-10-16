# Collaboration owner entries

Each of the nine headless owner packages ships `entryVersion:1.0`, versioned
operation input/output contracts, dependencies and side-effect declarations, and
a versioned content/digest Skill in its compiled npm entry. No global Agent
configuration is installed. The shared Agent stdio MCP adapter filters discovery
and invocation against the live application/project/grant/entry intersection;
functional owners remain identical to HTTP consumers.

The new `annotations` package consumes Documents and an optional Tables anchor port.
It owns immutable submitted feedback and explicit reply relationships. It does not
own a second mutable text buffer. Create feedback/response drafts through Documents;
submit their exact versions with `annotation.create/reply`, conditional thread
versions and changeIds. `annotation.read/list` retains source snapshots and reports
source-version differences without rebasing.

Documents validates UTF-16 ranges, including complete surrogate boundaries. Tables
validates stable entity keys against an exact immutable resource version. Annotations
freezes the selected source excerpt/entities and submitted draft source/text/digest.
Replies explicitly name an earlier message. Caller authorship comes from Rho's
authenticated boundary, not model input.

Agent contexts freeze selected annotation versions and source snapshots. New feedback
contexts use expectedVersion zero and a stable changeId. Preparation, tool fetch and
existence of an explicit linked reply remain separate observations; none is a model
understanding or completion claim. Agent explanations remain ordinary Documents.
Rho owns project configuration, compositions, protected views, scoped interactions,
events and archive assembly; Core remains unchanged.

Default configurable annotations limits are 128 threads, 256 total submitted
messages, 32 MiB metadata and 256 receipts per thread. Default context limits remain
128 packages and 1 MiB each. Over-limit submissions preserve existing state; evicted
receipt boundaries are visible and never authorize automatic replay. `state` and
`restore` support application format-3 archives without replaying native tasks.
Absent sources retain submitted snapshots; missing owners never install themselves.

Run `npm test`, `npm run pack:plugins`, and `npm run test:install -- DIRECTORY`.
Tests cover immutable Unicode feedback, stale versions, explicit replies, package
entry digests, source boundaries and budgets. Rho additionally checks exact business
schema parity and executes the human HTTP + real stdio MCP / real Claude scenarios.
The [application protocol guide](https://github.com/YuLab-SMU/Rho/blob/main/docs/COLLABORATION.md)
records the composed flow and its independent installation evidence. Component
tests do not establish browser, whole-product or signed-distribution acceptance.
