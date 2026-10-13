# Data handling

This policy describes the available evaluation and scientific consumers and the
data boundaries selected for future components. Individual components document
their actual inputs, outputs and retention; application assembly must verify the
chosen combination.

## Inputs and evidence

Evaluation reads caller-selected cases, public binaries and domain checker
commands. New evidence directories can contain task text, selected code, tool
replies, source/input digests, bounded stdout/stderr, checker reports, outcomes
and model observations. The evaluator does not collect the complete environment,
hidden reasoning or native credentials. Authentication remains with configured
native tools; credentials must not appear in commands or case files.
See [Evaluation](plugins/agent-eval/README.md) for limits and unscored scopes.

The [airway recipe](examples/real-r-analysis/README.md) reads an installed public
dataset and writes actual input matrices, models, package versions and scientific
outputs into a new selected directory. Its analysis does not install packages or
download data.

## Native execution and model services

Model trials use the configured Claude Code CLI and model service. Prompts,
selected code and tool observations may be sent under those tools' configurations
and retention policies. Offline baselines and artifact checks do not call a model.
A future Agent component must expose the actual context and service boundary of
its selected implementation.

Native code and checker commands run with the Host's OS authority. Core caller
namespaces distinguish records; they are not authentication or filesystem
containment. UI isolation does not restrict native program access. Selected
resources and existing authorization must be checked at the action boundary.

Reports and native output can contain private data or secrets printed by a tool.
Bounded retention does not provide general redaction. Review actual files before
sharing. Do not publish private projects or unredacted evidence in public Issues.

## Retention and resource state

Reports and scientific artifacts remain at their selected paths until explicitly
removed. Evaluations require new evidence directories. Regrading preserves the
original reports and writes separate judgments. Local ignored evidence is not a
permanent remote archive.

Future editor components own unsaved buffers and concurrent-write checks. Closing
a view does not establish that content was saved or that execution stopped.
Removing a checkout does not remove caller outputs, credentials, running Hosts
or provider records. Cleanup must target the actual owned resource explicitly.
