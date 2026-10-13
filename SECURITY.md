# Security policy

Report suspected vulnerabilities privately through the
[Rho project security advisory channel](https://github.com/YuLab-SMU/Rho/security/advisories/new).
Include the affected component/source version, platform, impact, reproduction
steps and the least sensitive evidence needed to investigate.

Do not publish unpatched vulnerabilities, API keys, signing tokens, personal data,
private project content or unredacted diagnostics. Maintainers coordinate
validation, mitigation and disclosure; no fixed response deadline is promised.

## Trust boundaries

Components own native preconditions and resource checks. Every CLI, MCP, Agent or
UI entry must apply the same checks of existing authorization and project scope.
Models and retrieved content cannot grant new authority. Typed UI validation does
not establish authorization, resource freshness or scientific truth.

Native programs run with the Host's OS authority. Core caller namespaces and
bounded output retention are not a native sandbox. Isolated HTML surfaces need
an explicit message and permission boundary; their isolation does not sandbox
native R/Python execution.

Managed request identity, unknown outcomes, partial results and no-replay
continuation must remain observable. Reads do not start or recover runtimes.
Verification uses disposable projects and owned Hosts, preserving user sessions.
See [Architecture](docs/ARCHITECTURE.md), [Privacy](PRIVACY.md) and each consumer's
instructions for its actual implemented limits.

This repository supplies development source. Component checks, application
assembly, official distribution and installation are separate acceptance claims.
