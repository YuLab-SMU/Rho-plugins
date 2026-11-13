# sclet in Rho

This package adapts the installed sclet public API to Rho's shared R Notebook.
sclet owns SCE state, registry, validation, provenance, reports and scientific
interpretation. Rho owns installation, views and caller/project boundaries.
No model provider or aisdk is required for these external-Agent operations.
Use the operations in this order: `profile` → `design` → (`confirm-design`) →
`validate` → `execute` → `record` → `report`.

1. Read `extension.describe` for `yulab.sclet`. Retain its digest. `sessions`
   reads existing sessions without starting one. Deliberately call `check` to
   probe sclet, SingleCellExperiment and jsonlite in the chosen R environment.
   Missing packages are not installed automatically. Use the user's existing
   authorized native package workflow, in the same library as this R session.
2. `skill` with `name: sclet-driver` reads the installed sclet owner's current
   guidance. Also read sclet-analysis and sclet-claims when they apply. Load the
   user's SCE using Notebook; the plugin does not invent data or a question.
3. `ledger` names that existing R variable and routes through
   GetAIAgentPayload, returning its payload plus the outbound policy (redacted
   fields, whether user consent is required, warnings, token estimate,
   fingerprint). Read `registry` for actual actions and parameter schemas.
   Request `includeArtifacts: true` for recorded findings. Read `profile` for the
   value-free dataset profile. `design` returns design candidates, colData column
   names, recorded design confirmations and the ledger fingerprint; it never
   returns colData values. `confirm-design` records the user's own role → column
   map through ConfirmAIDesignSemantics; roles are never inferred from column
   names. Matrices stay in R. The input object is never copied into application
   state.
4. `validate` takes `object` and `plan` with `task`, `context_fingerprint` from
   the current ledger, and `actions`. It calls new_sclet_ai_plan and
   ValidateAIPlan, then returns a validationId and the native validation facts.
   Do not replace an old fingerprint automatically. Correct the cause of a
   failed validation; respect scientific choices still needing user input.
5. `execute` takes the validationId when the analysis is authorized. The adapter
   consumes sclet's one-use validation token and retains the returned SCE,
   including partial state. It adds no separate Rho approval. The owner checks
   the current object and plan again. A validation cannot execute twice.
6. Inspect the original cell. Execution records are not AI result records.
   Record your supported interpretation using `record` (object, recordId, result)
   through sclet RecordAIResult with audit_claims enabled; cite actual recorded
   evidence and never invent findings. Then read `report`, which returns the
   report text plus an `Outbound policy:` line. Report text is free-form, not
   validated evidence, and needs user consent before it is sent to a model
   provider; do not send it automatically. Execution status,
   success_assessment, evidence integrity and scientific conclusions are separate.
   Plan the next round from the new ledger. A plan has no automatic replanning.

All operations that submit R return a Notebook cell immediately. Observe `cell`
with its cellId until it ends; do not resubmit to wait. Use a stable changeId for
extension.call. After a lost reply repeat that exact request or use extension.read;
pending/unknown receipts never re-execute. R can continue after a plugin view
closes, is disabled or is removed. Stop/interrupt uses Notebook's existing controls.

Validated plans live in `.rho_sclet_plans` in the same R session (32 by default;
validate accepts maxPlans up to 128 and refuses without eviction at the limit).
An R restart loses them. Retain checkpoints with the user's ordinary R saveRDS
workflow and data dependencies; loading a checkpoint needs a fresh validation.
This adapter does not provide durable R sessions, scientific approval or automatic
environment provisioning. It declares native execution and runs with the user's
OS authority; its process boundary is not an OS sandbox.
