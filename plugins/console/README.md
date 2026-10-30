# Console

`@rho-workspace/plugin-console` 0.1.0 records the commands a person runs in a
project folder and keeps what they print.

`ConsoleRunner` runs a typed command with the person's shell in the project folder
(or a folder inside it), in its own process group. A command keeps its `changeId`:
repeating the same identity returns the same record and never starts it twice.
Stop sends `SIGTERM` to the group and `SIGKILL` after a grace period.

How a command ended is what this process observed: an exit code or signal, a stop
it was asked for, or `unknown` when Rho closed while it ran. A command still
running after a restart is recorded as `continuing`; its later output is not kept.

Limits (`consoleLimits`, each configurable): at most 200 records (the oldest
finished ones go first), 4 commands at once, the first 1 MiB and the last 64 KiB of
each command's output (the bytes in between are counted, not kept), and 64 KiB per
output read. Past a limit a command is refused with the named limit.

State lives under `.rho/plugins/console/` in the project. The package grants no
authority: the application decides who may run commands. Rho lets only the person
at this machine run or stop them; an Agent runs its own commands with its own tools.

```sh
npm run build
npm pack --workspace plugins/console --ignore-scripts
```
