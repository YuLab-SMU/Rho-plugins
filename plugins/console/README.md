# Console

`@rho-workspace/plugin-console` 0.2.0 records the commands a person runs in a
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

The optional browser entry `./ui` (React as an optional peer) gives a page the person's
command line and records to place among its own, such as the Agent's commands:
`useCommands` reads the newest 50 records again as the page's cursor moves, and says when
the Console is off for the project; `useCommandLine` keeps one identity for the same words
until they run, so Run pressed again after a failed request never starts a command twice,
and `prepare` puts a command from elsewhere in the line to check; `CommandLine` draws the
line and `CommandRecord` one command, its output read as it arrives (at most 256 KiB shown,
read again every 700 ms while it runs), with the page's own line under it, such as the files
that changed while it ran. They add their own styles once, in the page's variables.

```sh
npm run build
npm pack --workspace plugins/console --ignore-scripts
```
