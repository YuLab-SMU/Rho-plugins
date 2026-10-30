# Notebook

`@rho-workspace/plugin-kernel` 0.1.0 keeps a live R session and a live Python
session for a project, which an Agent and the person share.

`KernelHost` runs each cell in its language's resident process, in the project
folder: what one cell defines is there for the next, whoever ran it. R code runs
top-level expression by top-level expression in the global environment, printing
visible values as the console does, and the first error stops the rest of the cell.
Python code runs in one namespace and shows the value of a cell's last expression.
Each cell keeps what it printed, as it is printed, with its messages, warnings and
error in their place among the printed lines, and the plots it made (R base and grid
graphics, and matplotlib figures in Python, as PNG files). After each cell the
session lists its variables with their type, size and a one-line summary.

A cell keeps its `changeId` per caller: repeating the same identity returns the same
cell and never runs it twice. Cells run one at a time in their session, in the order
they came. Running the first cell of a language starts that session; reading never
starts one. Interrupt sends `SIGINT` and stops the running cell while the session and
its values remain. Stop ends the session (`SIGTERM`, then `SIGKILL` after a grace
period); the running cell ends with an error and waiting cells are not run.

Variables live only in their process. When Rho closes, its sessions end with it: the
next start records each as ended (`rho-closed`), a cell that was running as
`unknown` and a waiting one as `not-run`, and runs nothing again.

Limits (`kernelLimits`, each configurable): one session per language, at most 16
cells waiting in each, cells of at most 64 KiB of code, the first 256 KiB of each
cell's output (the rest is counted and the cell marked cut), at most 8 plots of at
most 4 MiB per cell, 500 kept cells (the oldest finished ones go first, with their
plots), 200 listed variables and a 10 minute wait for a cell. A session that is not
ready within 30 seconds is ended. Past a limit a cell is refused with the named
limit. Memory and time used by the code itself are not bounded here.

The R session needs R with the `jsonlite` package; the Python session needs Python
3, and matplotlib for figures. State lives under
`.rho/plugins/kernel/` in the project. The package grants no authority: the
application decides who may run, interrupt or stop.

```sh
npm run build
npm pack --workspace plugins/kernel --ignore-scripts
```
