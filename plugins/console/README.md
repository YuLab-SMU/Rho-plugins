# Console

`@rho-workspace/plugin-console` 0.3.2 records the commands a person runs in a
project folder and keeps what they print, and gives the person a terminal there.

`ConsoleRunner` runs a typed command with the person's shell in the project folder
(or a folder inside it), in its own process group. A command keeps its `changeId`:
repeating the same identity returns the same record and never starts it twice.
Stop sends `SIGTERM` to the group and `SIGKILL` after a grace period.
On Windows the shell is cmd.exe unless one is named, on a console of its own without a
window; Stop raises Ctrl+Break on that console and ends the process tree after the grace
period. The shell there ends with Rho while the programs it started go on, so a command
running when Rho closed is `unknown` at the next start.

How a command ended is what this process observed: an exit code or signal, a stop
it was asked for, or `unknown` when Rho closed while it ran. A command still
running after a restart is recorded as `continuing`; its later output is not kept.

Limits (`consoleLimits`, each configurable): at most 200 records (the oldest
finished ones go first), 4 commands at once, the first 1 MiB and the last 64 KiB of
each command's output (the bytes in between are counted, not kept), and 64 KiB per
output read. Past a limit a command is refused with the named limit.

`events` gives each command as a timeline event, newest first: who ran it, while it ran, in
which folder and how it ended (`done`, `failed` for a non-zero exit, a signal or a command that
never started, `stopped`, `running` while it runs or continues outside Rho, `unknown`). The
descriptor names it as its `timeline` read (`console.events`).

`TerminalHost` is a shell on a pseudo-terminal, in the project folder (or a folder inside it):
what a terminal window gives the person, for a page to draw, and which an Agent may use too.
`open` starts it at a size, as a login shell with `TERM=xterm-256color`, recording who opened it;
`write` sends what is typed, and keeps the latest input from anyone other than the opener as
`typedBy`; `read` returns the bytes printed after an offset, in base64, and waits for output
when there is none; `screen` returns what the terminal shows as text, read by a terminal
emulator without a page (`@xterm/headless`): its last lines with wrapped lines joined, the
cursor and whether a full-screen program has the screen, after waiting, when asked, for output
past an offset to come and stop; `resize` sets the size; `close` hangs the shell up. A terminal lives while Rho runs and is not
kept across a restart: when Rho closes, each shell is hung up as if its window were closed.
A few lines of Python (`python3`, or the program named) open the pseudo-terminal on macOS and
Linux, so the package needs no compiled module; on Windows `open` is refused as unavailable.

A terminal records the commands run in it (`shell-marks.ts`, `terminal-commands.ts`). The shell
starts with Rho's startup files around the person's own, which give it a history of its own,
apart from the machine's shell history, and marks: escape sequences (OSC 6973) that terminals
ignore, each with a nonce only that shell holds, so a program printing one is ignored.

- **zsh, bash and fish** have hooks. zsh gets a `ZDOTDIR` whose files read the person's, as VS
  Code's terminal does; bash an init file that reads the login files; fish a file sourced by
  `--init-command` after its configuration. Before a command runs the shell marks its line and
  folder; before the next prompt, its exit status. zsh and bash keep their history under
  `.rho/plugins/console/history/`; fish keeps it by name in its own data folder, as
  `rho_<project hash>`.
- **sh, dash and ksh93** have no hooks. `ENV` names a file that reads the login files and the
  person's own `ENV` file (or `~/.kshrc`), then puts the marks in the prompt: the last status
  where it starts, the folder where it ends, and a mark after the continuation prompt. The command
  is the line typed after the prompt, read from the screen when the line feed that runs it
  arrives, and the lines after each continuation prompt. dash shows a line typed while a command
  runs only then, not again when it reads it, so the line shown after the prompt is checked
  against the lines typed: one typed after the prompt appears as typed; otherwise the oldest line
  typed before the prompt appeared is what ran, and what is shown is its output. A command it ran
  without a line feed (a `cd` typed ahead) is recorded at the next prompt. `/bin/sh` that is bash
  gets bash's hooks. A prompt the person sets later replaces the marks.
- **mksh, pdksh, tcsh, csh** and other shells are not marked (`recording` stays false). mksh and
  pdksh scroll a long line sideways as it is typed, so the screen does not show it whole; they
  still keep Rho's history file.

`commandList` returns the recorded commands, newest first from an offset: the line, the folder,
who typed it (everyone whose input reached the shell since the prompt before it, the first
first) and who entered it, how it ended, and the start of what it printed. What a command
printed is read from the terminal emulator line by line as each line feed completes one, so
carriage returns and colours are applied and nothing depends on the scrollback; the echo of a
line typed while it ran is not its output, and zsh's end-of-line mark is removed. What a
full-screen program (an editor, `top`, `less`) drew is kept as the screen it showed when it
left. When there is more than the record holds, or a screen, a file beside it keeps the first
512 KiB and the last 64 KiB, the bytes between counted, and the last 4 screens; `commandOutput`
reads it in pages of characters, with the place and size of the gap. Records are kept in
`terminal-commands.json` across restarts; one running when its terminal or Rho closed ended
unseen (`unknown`).

Limits (`terminalLimits`, each configurable): at most 4 terminals in a project at once (an ended
one makes room; with all of them live another is refused), the last 1 MiB of each one's output
(a reader asking for older bytes is told how many are gone), 256 KiB and 25 s of waiting per
read, 64 KiB per write, and for `screen` 2000 lines kept above the screen, at most 500 lines per
reading and 400 ms of quiet before a waiting one returns. For the recorded commands
(`commandLimits`): 500 records (the oldest go first, with their files), each line up to 4096
characters, the first 16 KiB of output in the record, 512 KiB first and 64 KiB last in its file,
4 screens, 64 MiB of such files in a project (past it the oldest are let go and their records say
so), at most 200 records per listing and 64 Ki characters per read of output.

State lives under `.rho/plugins/console/` in the project. The package grants no
authority: the application decides who may run commands. Rho lets only the person
at this machine run or stop them, and lets an Agent open a terminal, read its screen and type in
it, close only those it opened, and leaves the raw output and the size to the page that draws it.

The optional browser entry `./ui` (React as an optional peer) gives a page the person's
command line and records to place among its own, such as the Agent's commands:
`useCommands` reads the newest 50 records again as the page's cursor moves, and says when
the Console is off for the project; `useCommandLine` keeps one identity for the same words
until they run, so Run pressed again after a failed request never starts a command twice,
and `prepare` puts a command from elsewhere in the line to check; `CommandLine` draws the
line and `CommandRecord` one command, its output read as it arrives (at most 256 KiB shown,
read again every 700 ms while it runs), with the page's own line under it, such as the files
that changed while it ran. `useTerminalCommands` reads the newest 50 terminal commands as the
cursor moves, and `TerminalCommandRecord` draws one, naming who typed it through the page's
`who`; given the page's client, it reads all that is kept of the output in pages of 64 Ki
characters, and the full screens, when asked. `TerminalOutput` is that part alone, for a page
that shows the command elsewhere. They add their own styles once, in the page's variables.

```sh
npm run build
npm pack --workspace plugins/console --ignore-scripts
```
