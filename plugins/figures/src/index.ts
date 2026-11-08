import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson, confined, digest, now, readJson, requireThat, stateDirectory } from '@rho-workspace/plugin-contracts';
import { operationContracts } from './operations.js';
import { operationPresentation, presentation, skillPresentation } from './presentation.js';
import { figureSummary, markName, markRow, matchMarks, parseMark, parseRecord, type MarkRef, type Where } from './record.js';

export { parseRecord, figureSummary, markRow, matchMarks, markName, parseMark, elementMarks } from './record.js';
export type { FigureRecord, FigureLayer, FigureSource, MarkRef, MarkRow, Where } from './record.js';

// The R file a live R session sources to describe what its plots draw (see r/figures.R), and the
// Python file a live Python session runs to describe its matplotlib figures (py/figures.py). The
// Notebook's host hands them to each local session it starts.
export const rExtension = fileURLToPath(new URL('../r/figures.R', import.meta.url));
export const pythonExtension = fileURLToPath(new URL('../py/figures.py', import.meta.url));

// Where a figure record comes from: the Notebook cell that drew it, the plot's output and the
// record's bytes, as the kernel kept them.
export interface FigureCell { cellId: string; number: number; by: string; purpose: string | null; code: string; language: string; endedAt: string | null; sessionId: string }
// A figure saved to a project file (ggsave, png() and dev.off(), savefig) is found by the file's bytes: saved(sha256) returns the
// record of the newest cell that saved them.
export interface FigureSourcePort {
  record(cellId: string, plot: number): Promise<{ cell: FigureCell; output: unknown; bytes: Uint8Array }>;
  saved?(sha256: string): Promise<{ cell: FigureCell; output: unknown; bytes: Uint8Array }>;
}
// A figure is named by the cell and plot that drew it, or by the project file it was saved as: its
// path (the file as it is now) or the SHA-256 of the bytes a page shows.
export type FigureRef = { cellId?: string; plot?: number; path?: string; sha256?: string };
const sha256Pattern = /^[a-f0-9]{64}$/;
async function fileDigest(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

// The protected resource is the project's state folder. A selection keeps at most
// maxSelectionMarks marks and a note of maxNoteChars; the newest keptSelections of each figure
// are kept and older ones are removed. A read returns at most maxRows rows (defaultRows unless
// asked) and names at most matchMarks of the marks a condition matched, saying how many there
// were in all.
export const figureLimits = { maxSelectionMarks: 5000, maxNoteChars: 500, keptSelections: 32, maxRows: 500, defaultRows: 50, matchMarks: 5000 };
export type FigureLimits = typeof figureLimits;
// A selection names its figure as the figure is named: a cell's plot, or a saved file's path and
// SHA-256 with the cell that saved it.
export interface Selection { selectionId: string; cellId: string; plot?: number; path?: string; sha256?: string; digest: string; by: string; at: string; changeId: string; note: string; count: number; layers: Array<{ layer: number; geom: string; marks: number }>; marks: string[] }

export class Figures {
  private limits: FigureLimits;
  constructor(private root: string, private port: FigureSourcePort, limits: Partial<FigureLimits> = {}) { this.limits = { ...figureLimits, ...limits }; }
  private folder(key: string) { return stateDirectory(this.root, `.rho/plugins/figures/${key}`); }

  // The record a reference names, with the name its selections are kept under.
  private async resolve(ref: FigureRef) {
    if (ref.cellId !== undefined || ref.plot !== undefined) {
      requireThat(typeof ref.cellId === 'string' && Number.isInteger(ref.plot) && ref.path === undefined && ref.sha256 === undefined, 'invalid', 'Name a figure by cellId and plot, or by path or sha256 of a saved file.');
      const found = await this.port.record(ref.cellId!, ref.plot!);
      return { ...found, id: { cellId: ref.cellId!, plot: ref.plot! }, key: `${ref.cellId}-${ref.plot}`, parts: [ref.cellId!, String(ref.plot)] };
    }
    requireThat(ref.path !== undefined || ref.sha256 !== undefined, 'invalid', 'Name a figure by cellId and plot, or by path or sha256 of a saved file.');
    requireThat(this.port.saved, 'not_found', 'Figures saved to files are not kept here.');
    let sha256 = ref.sha256;
    if (sha256 === undefined) {
      const file = await confined(this.root, ref.path!);
      const stat = await fs.stat(file).catch(() => null);
      requireThat(stat?.isFile(), 'not_found', `${ref.path} is not a file in the project.`);
      sha256 = await fileDigest(file);
    }
    requireThat(sha256Pattern.test(sha256), 'invalid', 'sha256 is the hex SHA-256 of the file\'s bytes.');
    const found = await this.port.saved(sha256);
    const saved = found.output as { path?: string };
    return { ...found, id: { path: ref.path ?? saved.path ?? '', sha256, cellId: found.cell.cellId }, key: `file-${sha256.slice(0, 32)}`, parts: ['file', sha256] };
  }

  private async selections(key: string) {
    const folder = await this.folder(key);
    const names = (await fs.readdir(folder)).filter(n => /^f-[a-f0-9]{16}\.json$/.test(n));
    const all = await Promise.all(names.map(n => readJson<Selection>(path.join(folder, n)).catch(() => null)));
    return all.filter((s): s is Selection => !!s).sort((a, b) => b.at.localeCompare(a.at));
  }

  async read(input: FigureRef & { form?: 'summary' | 'view' | 'selections'; marks?: string[]; selection?: string; where?: Where[]; limit?: number }) {
    const { cell, output, bytes, id, key } = await this.resolve(input);
    const record = parseRecord(bytes), figureDigest = digest(bytes);
    const selections = await this.selections(key);
    const view = input.form === 'view';
    if (input.form === 'selections') return { figure: { ...id, digest: figureDigest }, selections };
    const result: Record<string, unknown> = {
      figure: { ...id, digest: figureDigest, cell: { number: cell.number, by: cell.by, purpose: cell.purpose, language: cell.language, endedAt: cell.endedAt, code: view ? undefined : cell.code }, output },
      selections: selections.map(s => view ? s : { ...s, marks: undefined }),
      ...(view ? { record } : { summary: figureSummary(record) }),
    };
    let refs: MarkRef[] | null = null;
    if (input.selection) {
      const chosen = selections.find(s => s.selectionId === input.selection);
      requireThat(chosen, 'not_found', 'This figure keeps no such selection; it may have been one of the oldest and removed.');
      refs = chosen.marks.map(m => parseMark(m)!).filter(Boolean);
    }
    if (input.marks) {
      const named = input.marks.map(m => parseMark(m));
      requireThat(named.every(r => r && r.layer < record.figure.layers.length && r.mark < record.figure.layers[r.layer]!.marks), 'invalid', 'A mark names no layer or row of this figure. Marks are "layer.row", both from 0, as figure.read names them.');
      refs = named as MarkRef[];
    }
    if (input.where) {
      const known = new Set([...record.sources.flatMap(s => s.columns.map(c => c.name)), ...record.marks.flatMap(m => m.columns.map(c => c.name))]);
      for (const w of input.where) requireThat(known.has(w.column), 'invalid', `No source or built column is named ${w.column}. The summary lists each source's columns and each layer's built columns.`);
      const matched = matchMarks(record, input.where, this.limits.matchMarks);
      result.matched = { total: matched.total, marks: matched.marks.map(markName), cut: matched.total > matched.marks.length };
      if (!refs) refs = matched.marks;
    }
    if (refs) {
      const limit = Math.min(input.limit ?? this.limits.defaultRows, this.limits.maxRows);
      result.rowsTotal = refs.length;
      result.rows = refs.slice(0, limit).map(r => markRow(record, r)).filter(Boolean);
    }
    return result;
  }

  // A selection never changes once kept. The same changeId from the same principal names the
  // same selection; with other marks it is refused.
  async select(input: FigureRef & { marks: string[]; note?: string; changeId: string }, by: string) {
    const { bytes, id, key, parts } = await this.resolve(input);
    const record = parseRecord(bytes), figureDigest = digest(bytes);
    const marks = [...new Set(input.marks)];
    requireThat(marks.length <= this.limits.maxSelectionMarks, 'limit', `A selection keeps at most ${this.limits.maxSelectionMarks} marks.`, { limit: 'maxSelectionMarks', maximum: this.limits.maxSelectionMarks });
    const refs = marks.map(m => parseMark(m));
    requireThat(refs.every(r => r && r.layer < record.figure.layers.length && r.mark < record.figure.layers[r.layer]!.marks), 'invalid', 'A mark names no layer or row of this figure. Marks are "layer.row", both from 0, as figure.read names them.');
    const note = (input.note ?? '').trim();
    requireThat(note.length <= this.limits.maxNoteChars, 'limit', `A note has at most ${this.limits.maxNoteChars} characters.`);
    const selectionId = 'f-' + digest([...parts, by, input.changeId].join('\u0000')).slice(0, 16);
    const folder = await this.folder(key), file = path.join(folder, selectionId + '.json');
    const known = await readJson<Selection | null>(file, null);
    if (known) {
      requireThat(known.marks.length === marks.length && known.marks.every((m, i) => m === marks[i]) && known.note === note, 'conflict', 'This change identity already names a different selection.');
      return { selection: known };
    }
    const byLayer = new Map<number, number>();
    for (const r of refs) byLayer.set(r!.layer, (byLayer.get(r!.layer) ?? 0) + 1);
    const selection: Selection = { selectionId, ...id, digest: figureDigest, by, at: now(), changeId: input.changeId, note, count: marks.length,
      layers: [...byLayer].map(([layer, n]) => ({ layer, geom: record.figure.layers[layer]!.geom, marks: n })), marks };
    await atomicJson(file, selection);
    const all = await this.selections(key);
    for (const old of all.slice(this.limits.keptSelections)) await fs.rm(path.join(folder, old.selectionId + '.json'), { force: true });
    return { selection };
  }

  // A short reading of one selection, for a message that carries it: what it is and its first rows.
  async brief(ref: FigureRef, selectionId: string, rows: number) {
    const read = await this.read({ ...ref, selection: selectionId, limit: rows });
    const selection = (read.selections as Selection[]).find(s => s.selectionId === selectionId)!;
    const figure = read.figure as { cellId: string; plot?: number; path?: string; sha256?: string; cell: { number: number; purpose: string | null } };
    return { cellId: figure.cellId, ...(figure.plot !== undefined ? { plot: figure.plot } : { path: figure.path, sha256: figure.sha256 }), cell: figure.cell.number, purpose: figure.cell.purpose, selectionId, count: selection.count, note: selection.note, layers: selection.layers,
      rows: (read.rows as ReturnType<typeof markRow>[]).map(r => r && ({ mark: r.mark, geom: r.geom, ...(Object.keys(r.facets).length ? { facets: r.facets } : {}), ...(r.values ? { values: r.values } : { built: r.built }) })) };
  }
}

const content = [
  'Plots drawn in the project\'s live R session are kept as figures: every ggplot (ggplot2 and what is built on it, such as ggtree, enrichplot, Seurat and patchwork) is described after its cell, with each drawn point, bar, box, line or label bound to the built row it draws and, where the layer\'s statistic keeps its input rows, to the row of the plot\'s data. A page drawn with base graphics (plot, points, text, barplot, abline) is described from what it drew: each drawn part is a layer (points, text, rect, lines, abline) whose marks keep the values they were drawn at, in the data\'s units, and points or labels whose x and y are two columns of a table in the session (a data frame, a DataFrame, a matrix) are bound to its rows, directly or through -log10, log10, log2, log2(x + 1) or log1p; the layer\'s mapping names those columns (y: "-log10(padj)"), and its notes say how many marks were drawn elsewhere (clipped to the axis), or that an earlier layer of the plot draws the same column on the same axis through another transform, so the two layers place their marks on different scales. A ComplexHeatmap is described cell by cell: each cell names its row, column, value and slice, and its row of the matrix. A figure drawn with matplotlib in the live Python session (and what draws through it: seaborn, pandas .plot) is described from its artists: scatter points, line vertices, bars, heatmap cells (pcolormesh, seaborn heatmap and clustermap), segments, polygons and text labels are marks keeping the values they were drawn at; points, lines and labels whose x and y are two columns of a table in the session (a DataFrame, a Series, a 2-D array), directly or through -log10, log10, log2, log2(x + 1) or log1p, are bound to its rows, and the layer\'s mapping says which (y: "-log10(padj)"); a label drawn at a bound point names that point\'s row, or is bound by its text; a heatmap cell names its row, column and value, and its row of the session table drawn. A layer\'s notes say what the describer noticed: marks drawn elsewhere than their values, a column drawn on the same axis through another transform than an earlier layer of the plot draws it, or heatmap labels that name other rows than the values beside them; the cell\'s plot output carries them. A cell\'s plot output names its layers and marks when it was described, or figureProblem when it was not; other grid drawings and images (imshow) stay pictures. A ggplot the cell saved to a project file with ggsave(), a page drawn on a file the cell opened with png(), pdf() or svg() and closed with dev.off() (plotMA, a heatmap\'s draw(), a ggplot\'s print()), or a matplotlib figure saved with savefig(), is kept as a figure of that file too (the cell\'s saved list): name it by {path} instead of {cellId, plot} in both operations. It holds while the file keeps the bytes the cell saved; a file written again since is a picture.',
  '',
  '1. figure.read {cellId, plot} returns the summary: each layer (counted from 0) with its geom, stat, mapping, constants, the data source its marks came from, how many marks it drew and whether they are bound to rows or groups (and why not); the plots, panels and facets; legend scales; and each source\'s columns and key column. Use it to check that a plot shows what you meant: the marks drawn against the source\'s rows, a mapping, a layer drawn from computed values.',
  '2. Rows behind marks: pass marks ["L.M"] (layer L, built row M), selection (the person\'s selection named in their message), or where [{column, op, value}] with op eq, ne, lt, le, gt, ge, in or contains, on a source column or a built column (count, x). Each row gives the mark\'s built values and its source row with the key column (a gene, a cell barcode, a tree node).',
  '3. To point the person at marks, figure.select {cellId, plot, marks, note, changeId}: they are shown highlighted in the plot with your note. It changes neither the plot nor its data; draw a new plot to change what is shown.',
  '',
  'A mark is named only within its figure. Speak about the same things across figures by the source key (gene, barcode, ID). An R figure is drawn again from the plot object at 7 × 5 in, so labels placed at random (ggrepel) may sit slightly differently from the picture; a matplotlib figure is drawn at its own size. A selected mark is what was drawn; what it means is still for you and the person to establish.',
].join('\n');
export const plugin = {
  entryVersion: '1.0' as const, id: 'figures', package: '@rho-workspace/plugin-figures', version: '0.5.1', requires: ['kernel'], capabilities: ['figures'], presentation,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })),
  skills: [{ id: 'figures.read', version: '1.0', content, digest: digest(content), presentation: skillPresentation,
    intent: 'Read what a plot drew and the rows behind its marks, and point the person at marks.', requires: ['figure.read', 'figure.select'],
    example: { method: 'figure.read', input: { cellId: 'k-0123456789abcdef', plot: 1, where: [{ column: 'padj', op: 'lt', value: 0.01 }], limit: 20 } },
    failureRecipes: [
      { kind: 'not_found', message: 'This plot is a picture only: nothing described what it draws.', next: 'Only ggplot2, base graphics and ComplexHeatmap pages, and matplotlib figures, drawn in a Notebook cell are described. Draw it with one of them to make its marks selectable, or read the picture with kernel.plot.' },
      { kind: 'not_found', message: 'No Notebook cell saved a figure as this file with these bytes: it is a picture only.', next: 'Save the plot in a Notebook cell (kernel.run): ggsave(), png() or pdf() and dev.off() in R, savefig() in Python. A file written by a script outside the live session is not described, nor a PDF of several pages.' },
      { kind: 'invalid', message: 'A mark names no layer or row of this figure.', next: 'Read the summary first; marks are "layer.row" counted from 0 within this figure.' },
    ],
    verify: { command: 'npm run test:figures', description: 'Describes real ggplot2, ggtree, Seurat-style and patchwork plots in R, and matplotlib and seaborn figures in Python, and reads, matches and selects their marks.' } }],
  components: [] as unknown[],
};
