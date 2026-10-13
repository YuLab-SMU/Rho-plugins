# Restricted Core CLI trial entry

The selected binary supplies `CONTRACT.md` through its public
`capability --contract`. The controller supplies the owned test Host and caller.
Each entry command invokes the real public CLI and retains its exit code and raw
response. This guide defines trial restrictions, not another Core contract.

Use one complete `./rho-core` command per Bash call. The trial prompt defines
commands, predefined jobs and report requirements. `lookup --record` retrieves
actual execution facts. `submit` accepts only the declared jobs; it grants no
authority to submit arbitrary code, choose another executor or change the caller.

Exit 3 means the request was not delivered. Exit 4 means the reply was lost after
sending; query the original request before choosing continuation. Command sequences
are not transactions. A missing reply or later failure does not authorize replay
of earlier effects under a new identity.

The controller starts and closes only its disposable Host. The Agent cannot
start, stop or replace Hosts. Capability queries are mechanical observations,
with no claim of scientific correctness or open-ended summary quality.
