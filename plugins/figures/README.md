# Figures

`@rho-workspace/plugin-figures` 0.4.0 keeps the plots a project's live R or Python session
draws as figures whose marks know the rows they were drawn from. It is built into Rho and
needs the Notebook (`kernel`).

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

A page drawn with base graphics (`plot`, `points`, `text`, `barplot`, `abline`, `image` and
the functions built on them) is described from its recording. gridGraphics makes the page
into grobs named after what drew them, and each drawn part in a plot's window is a layer:
points, text, rect, lines, polygon, segments, circles or a reference line. Each element is a
mark that keeps the values it was drawn at, in the data's units (a log axis is read back).
A bar is named by the axis label at its middle. Axes, boxes and titles are drawn and not
bound. Points, labels and lines whose x and y are two columns of a table in the session (a
data frame, a Bioconductor `DataFrame`, a numeric matrix or a named vector) are bound to its
rows, value for value and in the table's order. Rows that were not drawn are skipped. The
layer's `mapping` names the two columns, and its `notes` count marks drawn at another
value, such as points clipped to the axis limit. A part drawn from computed values matches
no table and keeps only its drawn values.

A ComplexHeatmap is described from the heatmap list it laid out. `draw()` starts the page
before it lays the heatmaps out, so the describer keeps the frame of its method when the
page starts and reads the laid-out list when the cell ends: the rows and columns in the order
and slices drawn, and the matrix. The page is drawn again from its recording, and each cell
rectangle of a heatmap body is a mark naming its row, column, value and slices, with the
matrix row as its source (named after the session's matrix when one is identical). Cells
drawn as one image (`use_raster`) are not bound; annotations, dendrograms and names are
drawn and not bound.

A matplotlib figure in a live Python session (and what draws through matplotlib: seaborn,
pandas `.plot`) is described by `py/figures.py`, which the Notebook's host hands to each local
Python session. matplotlib keeps what each Axes drew as artists, so nothing is read from
pixels: a scatter's points are a collection with their offsets, a line keeps its vertices,
each bar is a rectangle, a heatmap (`pcolormesh`, seaborn's `heatmap` and `clustermap`) a mesh
of cells, a label its text and position. Each artist is given an id for the drawing, the
figure is written as SVG at its own size, and the elements matplotlib wrote for each artist
are named after its marks; when they cannot be matched one for one, the layer says why. An
artist drawn `rasterized=True` (a large scatter, to keep its file small) is drawn as vectors
for the figure; the figure and its picture are left as the code made them.

- Points, line vertices and labels keep the values they were drawn at, in the data's units
  (a log axis reads in counts). Where their x and y are two columns of a table in the session
  (a DataFrame, a numeric Series with its index, a 2-D numeric array), they are bound to its
  rows in the table's order, skipping rows not drawn. A position drawn through `-log10`,
  `log10`, `log2`, `log2(x + 1)` or `log1p` of a column is matched through it, and the
  layer's mapping says so (`y: -log10(padj)`). Marks all drawn at one value of the other axis
  (genes not tested, drawn at 0) are bound by their own axis alone, and noted. Tables the
  cell's code assigns, then those it reads, are compared first. A DataFrame is keyed by its
  text index (named after the index's name), else a unique text column.
- A label (`ax.text`, `ax.annotate`) drawn at a bound point's position names that point's row,
  whatever order the labels were drawn in; otherwise one whose text names rows of a table
  another layer of the plot is bound to is bound by its text, wherever it was moved to. A text
  placed in the axes' own coordinates (a note in a corner) is a layer of its own.
- A heatmap cell names its row, column and value. When a table of the session holds the same
  values, also with rows and columns reordered (a clustered heatmap), the cell's source row
  is that table's row, and tick labels that name other rows of it than the values they sit
  beside are noted (*29 of 30 rows are labelled with another row of heat_z: row 1 is labelled
  SPARCL1 and draws the values of PDPN*). Otherwise the drawn matrix is the source, named by
  its tick labels; labels set on the cells' edges, one for each, are read in their order and
  noted.
- A bar is named by the category drawn at its middle; positions on an axis of categories are
  named by their category. Horizontal and vertical reference lines (`axhline`, `axvline`)
  keep their intercept. Segments and polygons keep their ends and extents.
- The legend and colour bar are the plot's scales; a seaborn facet's title (`dex = trt`) is
  its facet.
- What the describer notices (marks drawn elsewhere than their values, labels naming other
  rows) is kept as the layer's `notes`, carried in the cell's plot output for the Agent and
  shown under the figure.

A figure saved with `savefig()` to a file in the project is kept as a figure of that file,
like a ggplot saved with `ggsave()`: the Notebook's runner watches `Figure.savefig`, the figure
is described as it was saved (with its `bbox_inches`), and the cell's `saved` list names the
file with its bytes when the cell ends, also when the cell closed the figure.

Other grid drawings and images drawn with `imshow` stay pictures. A plot output nothing
described has neither `figure` nor `figureProblem`: nothing failed, nothing described them.

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

The protected resource is the session's time and the project's state folder.

| Limit | Value | When it is exceeded |
| --- | --- | --- |
| Marks in a figure (`maxMarks`) | 30 000 | The plot stays a picture; `figureProblem` says why. |
| Time to describe (`maxSeconds`) | 20 s | Describing stops; the plot stays a picture. |
| Record size (`maxBytes`, kernel `maxFigureBytes`) | 16 MiB | The record is not kept; `figureProblem` says how large it was. |
| Columns kept for a source or a layer (`maxColumns`) | 40 | Later columns are left out of the record. |
| Session tables compared with a base graphics or matplotlib layer (`maxTables`) | 64 | Later tables are not compared; the layer keeps its drawn values. |
| Numeric columns of one table compared with a matplotlib layer (`maxComparedColumns`) | 64 | Later columns are not compared. A table with fewer rows than the layer's marks is not compared. |
| Cells of one compared table (`maxTableCells`) | 5 000 000 | A larger table is not compared. |
| Characters of a text value (`maxCellChars`) | 160 | The value is cut and ends with `…`. |
| Marks in a selection | 5 000 | The selection is refused. |
| Saved files described per cell (kernel `maxPlots`) | 8 | Later files stay pictures. |
| Selections kept per figure | 32 | The oldest are removed. |
| Rows in one read | 500 (50 by default) | The rest are counted in `rowsTotal`. |

## Check

```sh
npm run test:figures
```

It describes real ggplot2 and patchwork plots, base graphics pages and a ComplexHeatmap in
R, and matplotlib and seaborn figures in Python, through the Notebook and reads, matches and
selects their marks. It saves plots with
`ggsave()` as PNG and PDF and reads them by path and by bytes until the file is written
again. Without R and ggplot2, svglite, xml2 and jsonlite the checks are skipped, not passed;
so are the base graphics check without gridGraphics and the heatmap check without
ComplexHeatmap. The Python checks run `RHO_PYTHON` (else `python3`) and are skipped without
matplotlib, numpy and pandas; the seaborn check without seaborn.
