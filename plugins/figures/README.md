# Figures

`@rho-workspace/plugin-figures` 0.2.0 keeps the plots a project's live R session draws as
figures whose marks know the rows they were drawn from. It is built into Rho and needs the
Notebook (`kernel`).

## What it does

The Notebook's host hands `r/figures.R` to each local R session it starts. When a cell ends,
the session draws each ggplot page again, off screen, and writes a figure record
(`rho.figure/1`) next to the plot's PNG. Every ggplot is described the same way, whatever
built it: ggplot2 itself and packages built on it (ggtree, enrichplot, Seurat, patchwork
compositions, ggrepel labels). Nothing in the describer knows a package or a domain.

- Each layer's geom is cloned for the drawing, so the plot's own objects are not changed.
  The clone numbers the rows ggplot2 built (`handle_na`) and tags each panel's grob with
  the plot, layer, panel and rows it drew (`draw_layer`). The picture is rendered as SVG
  through svglite, and each drawn element is given `data-rho="unit.element"`.
- A drawn element stands for one built row (a point, a bar, a text label, a segment) or
  for a group (a line, a polygon, a box). A label drawn in several parts (a ggrepel label
  and its halo) is bound by its text. Parts that cannot be matched are reported in the
  layer's `unbound` reasons; they are never guessed.
- An extra aesthetic carries each data row's number through the layer's statistic. Where
  the statistic keeps its input rows (identity, jitter, most position adjustments), a mark
  links to its row of the plot's data; where it computes new rows (counts, boxes,
  densities) the mark keeps its computed values and no row. The source's key is its row
  names, else a unique text column, else a numeric `id` or `node` column.
- Positions are read back through the scale's inverse, so a box on `scale_y_log10()` reads
  in counts. The statistic still ran on the transformed values: the median drawn between
  1100 and 1200 on a log scale is their geometric mean, and that is what is recorded.
- The session is left as the cell left it: the random number state is restored, and the
  describer's own output, messages and warnings are discarded.

A ggplot saved to a project file with `ggsave()` in a Notebook cell is kept as a figure of
that file. When the page starts on ggsave's device, `saved_page()` names the plot, ggsave's
file and the device's size; when the cell ends the page is described at that size and the
record is kept with the cell's plots. The cell's `saved` list names the file with its bytes
and SHA-256. A page that shows the file names it by those bytes, so the figure holds only
while the file keeps them: once anything writes the file again it is a picture, until a
cell saves it as a figure again. A file outside the project is not kept, nor one a session on
a server saved. A file written with `png()` or `pdf()` and `print()` is not found, because
nothing names its file.

Base graphics, grid drawings that are not ggplots (ComplexHeatmap) and Python plots stay
pictures. Their plot output has neither `figure` nor `figureProblem`: nothing failed,
nothing described them.

## Who uses it

- **The person** points at a mark to read its row, clicks or drags to select marks in the
  Notebook and in the Plots view, reads the selected rows in a table, and asks the Agent
  about them. The selection is kept and travels with the next message.
- **The Agent** sees each plot output's summary (layers, marks, how many are bound) in
  `kernel.run` and `kernel.read`. It reads the figure with `figure.read`, finds marks by
  condition (`where`), reads the rows of the person's selection, and points back with
  `figure.select`. Its marks are shown highlighted, with its note, on the original plot.

## Operations

A figure is named by `{cellId, plot}`, a plot a cell drew, or by a file a cell saved it as:
`{path}` reads the file as it is now, `{sha256}` names exact bytes (a page passes the
version it shows).

`figure.read {cellId, plot | path | sha256, form?, marks?, selection?, where?, limit?}` returns the summary
of a figure (or, with `form: 'view'`, the whole record for drawing it), the selections kept
for it, and rows for marks named directly, by a kept selection or by a condition.

`figure.select {cellId, plot | path | sha256, marks, note?, changeId}` keeps a selection. It is
immutable and named by the figure, the principal and its `changeId`; a saved file's selections
follow its bytes: the same request returns the same
selection, and the same `changeId` with other marks is refused.

## Limits

The protected resource is the R session's time and the project's state folder.

| Limit | Value | When it is exceeded |
| --- | --- | --- |
| Marks in a figure (`maxMarks`) | 30 000 | The plot stays a picture; `figureProblem` says why. |
| Time to describe (`maxSeconds`) | 20 s | Describing stops; the plot stays a picture. |
| Record size (`maxBytes`, kernel `maxFigureBytes`) | 16 MiB | The record is not kept; `figureProblem` says how large it was. |
| Columns kept for a source or a layer (`maxColumns`) | 40 | Later columns are left out of the record. |
| Characters of a text value (`maxCellChars`) | 160 | The value is cut and ends with `…`. |
| Marks in a selection | 5 000 | The selection is refused. |
| Saved files described per cell (kernel `maxPlots`) | 8 | Later files stay pictures. |
| Selections kept per figure | 32 | The oldest are removed. |
| Rows in one read | 500 (50 by default) | The rest are counted in `rowsTotal`. |

## Check

```sh
npm run test:figures
```

It describes real ggplot2 and patchwork plots in R through the Notebook and reads, matches
and selects their marks, and saves plots with `ggsave()` as PNG and PDF and reads them by
path and by bytes until the file is written again. Without R and ggplot2, svglite, xml2 and jsonlite the checks are
skipped, not passed.
