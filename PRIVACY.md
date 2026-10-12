# Plugin data handling

Updated: 2026-10-12. This page covers the selected evaluation plugin and real R
recipe on this branch. Historical application, SDK and plugin-runtime behavior
belongs to the archived source and its original policies.

## Inputs and evidence

The evaluation entry runs caller-selected public binaries and Owner checker
commands. Its new evidence directories can contain code, task text, tool replies,
source and input digests, bounded stdout/stderr, Owner reports, trial outcomes
and model observations. It does not collect a complete environment or credentials.
Commands and case files must not contain credentials. Authentication remains
with the configured native tools. See the
[evaluation README](plugins/agent-eval/README.md) for limits and unscored scopes.

The R recipe reads the installed public airway dataset and records actual inputs,
models, versions and scientific outputs in a new caller-selected directory. Its
analysis script does not install packages or download data. See the
[recipe](examples/real-r-analysis/README.md) for exact artifacts and boundaries.

## Native tools and sharing

Model trials use the caller's configured Claude Code CLI and model service.
Prompts, selected code and tool observations may therefore be sent under those
tools' configurations and retention policies. Offline baselines and R artifact
checks do not invoke a model. Executed code and checker commands run with the
user's OS permissions; this repository does not provide an OS sandbox.

Code, reports and program output can contain private data or secrets printed by
a native tool. Bounded retention is not general-purpose redaction. Review actual
files before sharing. Local ignored evidence is not a permanent remote archive.

## Retention

Reports and scientific artifacts remain at their chosen paths until explicitly
removed. New evaluations do not overwrite original reports; regrading keeps the
original judgment and writes a separate result. Removing this source checkout
is not a cleanup of caller-selected outputs, native credentials or model-provider
records. Do not publish private projects or unredacted evidence in an Issue.
