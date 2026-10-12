# Core CLI evaluation adapter

This guide describes the plugin's restricted test entry, not a new Core contract.
`CONTRACT.md` is read from the selected binary's public `capability --contract`.
The controller supplies the test socket and caller; each command invokes the
real public CLI and preserves its exit code and raw response.

Use one complete `./rho-core` command per Bash call. Commands, predeclared jobs
and report requirements appear in the trial prompt. `lookup` adds `--record` to
retrieve actual execution facts. `submit` accepts only the existing jobs; it
does not authorize arbitrary code, another executor or another caller.

Exit 3 means the request was not delivered. Exit 4 means the reply was lost after
sending; look up the original request before deciding how to continue. A command
sequence is not a transaction. Neither a missing reply nor a failed later command
authorizes replaying earlier effects under a new identity.

The plugin starts and closes only its own disposable Host. The Agent cannot
start, stop or replace a Host. Capability checks are mechanical observations;
they do not establish scientific correctness or open-ended summary quality.
