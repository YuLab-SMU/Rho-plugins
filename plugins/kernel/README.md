# Notebook

`@rho-workspace/plugin-kernel` 0.2.0 keeps a live R session and a live Python
session for a project, which an Agent and the person share, on this machine or on a
server reached with ssh.

`KernelHost` runs each cell in its language's resident process, in the project
folder: what one cell defines is there for the next, whoever ran it. R code runs
top-level expression by top-level expression in the global environment, printing
visible values as the console does, and the first error stops the rest of the cell.
Python code runs in one namespace and shows the value of a cell's last expression.
Each cell keeps what it printed, as it is printed, with its messages, warnings and
error in their place among the printed lines, and the plots it made (R base and grid
graphics, and matplotlib figures in Python, as PNG files). R draws on one recording
device that stays open for the session, as the console's does: a later cell can draw
over an earlier cell's plot (a line over its points) and reports the plot it changed,
and each page is recorded before a new one starts, so a sourced script that draws two
plots keeps both. Calls that only set graphics state (`par`, `palette`, `layout`) do not
make a page new. Python closes its figures after each cell. After each cell the
session lists its variables with their type, size and a one-line summary.
Each cell also names the values it made or changed (`defined`) and, when neither list
was cut, those it removed (`removed`). It names the values it read (`used`): the names
its code mentions, other than as a whole assignment's target, that the session held
before it ran. The arguments of a function, lambda or comprehension and what it assigns
for itself are its own (in R only `<<-` assigns from within a function), and the field
after `$` or `@` is part of its value. A name the cell assigned before it mentions it (in an
earlier statement, or a loop's variable in its body) is the cell's own, so a cell run
again does not read the value it replaces. A value changed in place (`m$x <- …`,
`d['b'] = …`, `x += 1`) counts as defined. It names the project paths its string
literals named that existed before it ran or after (`files`, each `read`, or `wrote`
when the file appeared or its size or modification time changed), as paths within the
project; a path outside the project is left out, and so is a string used as a key or an
index (`d['raw']`, `ann[, c("Locus.Tag")]`). A folder's path ends in `/`: it was
written to when it appeared or its entries changed, and a folder holding another named
path is left to that path. These come from the code as written, without running it
again: a name built at run time, a file named by a variable or one written by a function
the cell called is not seen. A value of an S4 class that `readRDS` has just loaded is
listed with its size at once, as printing it would show it.

`inspect` reads one value of a live session as its session describes it, by name and
by a path of parts within it (a list's element, a column, a model's component, an
attribute), with the code that reaches it (`fit$coefficients`, `d['b']`). It answers
what kind of thing the value is (table, model, vector, list, function, single value or
other), its class, size and facts, and a page of it: a table's rows with each column's
type, missing count and summary, sorted by a column on request; a model's formula, fit
statistics and coefficients (R `lm`, `glm` and other fits with `coef`, `htest`;
statsmodels results; scikit-learn estimators); a vector's elements and, when
categorical, its counts; a list's parts; a function's code; and otherwise the value as
printed. Reading never starts a session, answers `busy` while a cell runs or waits,
runs nothing the person wrote except the value's own printing and changes nothing; a
cell asked for during a reading waits for it.

A cell keeps its `changeId` per caller: repeating the same identity returns the same
cell and never runs it twice. Cells run one at a time in their session, in the order
they came. Running the first cell of a language starts that session; reading never
starts one. Interrupt sends `SIGINT` and stops the running cell while the session and
its values remain. Stop ends the session (`SIGTERM`, then `SIGKILL` after a grace
period); the running cell ends with an error and waiting cells are not run.

A session can run on a server. A place names an ssh destination (a Host in the
person's ssh config, `user@host` or `ssh://user@host:port`), a folder there (absolute
or `~/…`) and setup lines run in that folder before a session starts (`module load R`,
`conda activate env`). The project chooses where each language's next session starts
(`use`, this machine unless chosen); a cell may name a place for a session that is not
live yet, and a cell naming another place than the live session's is refused, since
its values stay where they are. ssh runs as the person's own setup has it (their
config, keys and agent) in batch mode, so it never asks for a password or accepts a
new host key; when it cannot log in, what it said is the session's problem. One
connection per server is shared (`ControlMaster`, sockets in `/tmp/rho-ssh-<uid>`).
The session runs in a login shell (`bash -lc`), so module systems and conda set up R
and Python as the person's terminal there has them, and what that shell prints on the
way in is not taken as an answer. A login whose character set is not UTF-8 (no locale,
or the client's locale not installed there) takes a UTF-8 `LC_CTYPE` the server has, so
text keeps its characters; a set `LC_ALL` is kept. The runner is sent on the session's own input and
kept in `~/.cache/rho/kernel/` under its digest; nothing else is installed. Its answers
come on ssh's standard output and what the code prints on its standard error, so a
server session's printed standard output and error are one stream. Plots are drawn in
the session's temporary folder there and sent with their answers. Interrupt and stop
signal the session's process group on the server through the shared connection. When
the connection is lost (ssh ends with 255), the session ends as `disconnected`: the
running cell is `unknown` and its process on the server was not seen to end; nothing
is run again. A check connects and reports the system, the machine's name, the folder
as the server resolves it, R with jsonlite and Python with matplotlib. A session
reports the machine it runs on (`host`) and its folder. Lineage paths in a server
session are within its place's folder.

A place's files are listed and copied within its folder only: a path with `..`, or one
that leads out through a link, is refused, and a link is not copied. A listing names
entries with kind, size and modification time (whole seconds); listing uses GNU `find`
or BSD `stat`. A copy lands in the project at `remote/<place>/<path>` with its size,
time on the server and SHA-256 digest; a copy that was changed here since it was made
is not replaced, and a file that changed while it was copied is refused. A place a
session runs in is not removed.

Variables live only in their process. When Rho closes, its sessions end with it: the
next start records each as ended (`rho-closed`), a cell that was running as
`unknown` and a waiting one as `not-run`, and runs nothing again.

Limits (`kernelLimits`, each configurable): one session per language, at most 16
cells waiting in each, cells of at most 64 KiB of code, the first 256 KiB of each
cell's output (the rest is counted and the cell marked cut), at most 8 plots of at
most 4 MiB per cell, 500 kept cells (the oldest finished ones go first, with their
plots), 200 listed variables, 32 files named per cell (`lineageLimits`) and a 10 minute wait for a cell. A session that is not
ready within 30 seconds (90 on a server) is ended. At most 16 places are named; a check
ends after 60 seconds, a listing after 30 with at most 500 entries from 1 MiB, a signal
after 15; files larger than 64 MiB are not copied and a copy ends after 10 minutes; the
newest 500 copies are recorded. Past a limit a cell is refused with the named
limit. Reading a value shows at most 50 columns, pages of 50 rows, elements or parts
(at most 200 when asked), 200 parts beside a page, cells of 120 characters and 16 KiB
of printed text, each marked when cut; a table of more than a million rows is not
sorted, with the reason. A reading is interrupted after 10 seconds (`timeout`) and
the session goes on. Memory and time used by the code itself are not bounded here.

The R session needs R with the `jsonlite` package; the Python session needs Python
3, and matplotlib for figures; on a server they need the same there, with `bash`,
`head -c` and `ps`, and on this machine OpenSSH. State lives under
`.rho/plugins/kernel/` in the project. The package grants no authority: the
application decides who may run, interrupt or stop.

```sh
npm run build
npm pack --workspace plugins/kernel --ignore-scripts
```
