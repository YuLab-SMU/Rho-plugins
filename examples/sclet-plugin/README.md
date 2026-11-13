# sclet: an independently installed Rho plugin

This optional package adapts [sclet](https://github.com/YuLab-SMU/sclet) to Rho's
third-party plugin API 1. It is outside the selected base plugin catalog and adds
no sclet/R dependency to Rho. It has its own npm manifest, host, Skill and prebuilt
view, and can move to another repository without changing the application.

Install from a local checkout with a Rho build containing the third-party API:

```sh
rho plugin add /absolute/Rho-plugins/examples/sclet-plugin
rho plugin check /absolute/Rho-plugins/examples/sclet-plugin
```

Or install a public Git revision using
`git+https://github.com/YuLab-SMU/Rho-plugins.git#COMMIT:examples/sclet-plugin`.
This source package is version 0.1.0; it has not been published to npm. The
[Rho guide](https://github.com/YuLab-SMU/Rho/blob/main/docs/THIRD-PARTY-PLUGINS.md)
explains installation, development, contribution and runtime boundaries.

## Use

Open **Plugins → sclet → Open**, or let your Agent read the [Skill](SKILL.md).
Reading sessions starts nothing. **Check R packages** deliberately submits an R
cell and reports sclet, SingleCellExperiment and jsonlite in that session's
library. Install missing packages with your existing R workflow; this plugin
does not provision environments or require aisdk/model credentials.

Load a SingleCellExperiment in Notebook. Name its R variable in the plugin to
read its ledger or registry. Validate a plan using the current ledger fingerprint,
then execute the returned validationId. The original Notebook cell is retained
and observed; the returned SCE replaces that same variable, including partial
state. An already submitted validation is never executed again.

**Data profile** and **Read design** are read-only. The profile is value-free.
The design read returns candidate design roles, colData column names, recorded
confirmations and the ledger fingerprint, never column values. When a
design-gated action needs roles, fill in the **Confirm design** JSON (role →
colData column) and confirm; sclet records your declaration rather than guessing
from column names.

Execution produces an execution record, not an AI result report. Record your
supported interpretation with `record` (RecordAIResult, claim auditing enabled),
then read it by its **Report ID**. Leaving Report ID empty asks sclet for its
active result and can report that none exists. The ledger, profile and report
reads route through sclet's GetAIAgentPayload and include an outbound policy
(redacted fields, whether user consent is required, warnings, token estimate,
fingerprint); the workbench adds a warning line when the policy redacts fields or
requires consent. Report text is free-form and needs user consent before it is
sent to a model provider. Scientific evidence and claims are sclet's
responsibility; the adapter never invents them from an exit status.

Disable, remove or close the view without stopping R or deleting data. Native
session shutdown and interruption use Notebook's existing controls. Validation
records live in `.rho_sclet_plans` in that R session; its configurable `maxPlans`
default is 32 and maximum 128, with refusal rather than eviction at the limit.
An R restart loses these records. Use normal R checkpoints and validate again.

## Observed scope

Requires a sclet build that exports `GetAIAgentPayload()` (source tree after
2026-11-13); **Check R packages** reports it as `GetAIAgentPayload: TRUE|FALSE`
so an older install is visible before a read fails.

Tested with sclet 1.1.0 at commit
`3e03720fea17ee30bb598cce3bc94dc0c728fc44`, R 4.5.2 and SingleCellExperiment
1.32.0 on macOS arm64. A disposable 200-gene, 60-cell synthetic SCE completed
normalization, selection of 50 variable features, scaling and five-component
PCA. Missing sclet was reported before the isolated library was selected; old
fingerprints were refused afterward. A no-biological-claims interpretation was
recorded and its report passed sclet's citation/claim self-check. This is software
integration evidence, not scientific validation. See Rho's
[episode](https://github.com/YuLab-SMU/Rho/blob/main/docs/THIRD-PARTY-PLUGINS-EPISODE.md).

The ledger/profile/report cells were additionally replayed against a
temporarily installed sclet in one R process (profile → design → confirm-design
→ validate → execute → record → report), and the report's outbound policy line
asked for consent; that is still software integration evidence.

The host runs trusted native code with the user's OS permissions. Its disposable
process and opaque-origin UI are not an OS sandbox. No Core execution guarantee,
automatic dependency installation or durable R recovery is added.
