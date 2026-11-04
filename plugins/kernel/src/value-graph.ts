// How each result came about, as a graph of values: the data files read at the top, the results at
// the bottom (the files written and the plots drawn, else the values nothing reads), and the values
// between, one node per name. A name made
// and then changed is one node, made where it was first made and changed where the rest were.
// Functions and constants (values made from literals alone) are not nodes: they are named on the
// values that use them, and what a function reads goes to those values. So is a value made from
// one other and used only to change it (a mask or a row index). What leads to no result is listed
// apart. Built from a script read as text, or from a live session's records (a cell that makes its
// values over several statements is read statement by statement). Nothing here runs code.
import type { Language } from './explore-code.js';
import { cellLabel, lineage, type LineageCell } from './lineage.js';
import { scriptFlow, type ScriptFlow, type ScriptStep } from './script-flow.js';
import { statements } from './statements.js';

export type GraphKind = 'input' | 'value' | 'output' | 'plot';
// Where a node is made: lines of a script, or lines of a cell's code.
export interface Making { from: number; to: number; code: string; cell?: { cellId: string; number: number; label: string } }
export interface GraphNode {
  id: string; kind: GraphKind; name: string;
  // What the code says it is, when a comment says so (see markersAbove).
  means?: string;
  // One line on how it was made: the code that gives it its value, else its cell's purpose.
  how: string;
  made: Making[];
  // The functions, constants and helpers it uses, by name.
  uses: string[];
  parents: string[]; children: string[];
  // In a session: what its cell read that was made again since, so it is not drawn as read.
  stale?: string[];
}
export interface ValueGraph {
  nodes: Map<string, GraphNode>;
  results: string[]; inputs: string[];
  // What leads to no result.
  others: string[];
  // Where each function, constant and helper is made, and what the code says it is, for the code behind a value.
  folded: Map<string, { made: Making[]; means?: string }>;
  // Statements that make nothing, steps past a limit, and a script too long to read.
  quiet: number; cut: number; tooLong: boolean;
}

const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const assignment = (name: string) => new RegExp('^\\s*`?' + escaped(name) + '`?\\s*(?::[^=\\n]*)?(?:<<-|<-|=(?!=))\\s*');
// What the statement that assigns a name gives it, as text.
function assigned(code: string, name: string, language: Language) {
  const lines = code.split('\n'), re = assignment(name);
  for (const s of statements(code, language)) {
    const m = re.exec(lines[s.from - 1]!);
    if (m) return [lines[s.from - 1]!.slice(m[0].length), ...lines.slice(s.from, s.to)].join('\n').trim();
  }
  return null;
}
// One line on how a value is made: what its assignment gives it, else the statement's first line.
function howOf(code: string, name: string, language: Language) {
  const first = (code.split('\n').find(l => l.trim() && !/^\s*#/.test(l)) ?? '').trim();
  const rest = assigned(code, name, language);
  if (rest === null) {
    const def = language === 'python' && code.split('\n').find(l => new RegExp('^\\s*(?:async\\s+)?def\\s+' + escaped(name) + '\\b').test(l));
    return def ? def.trim().replace(/:\s*$/, '') : first;
  }
  if (/^(?:function\s*\(|\\\()/.test(rest)) return 'function' + (rest.match(/\([^)]*\)/)?.[0] ?? '()');
  return rest.split('\n').map(l => l.trim()).join(' ');
}
// Where in a step that makes several values one of them is made: the statement that assigns it,
// else the whole step.
function narrowed(making: Making, name: string, language: Language): Making {
  const lines = making.code.split('\n'), re = assignment(name);
  for (const s of statements(making.code, language)) if (re.test(lines[s.from - 1]!)) return { ...making, from: making.from + s.from - 1, to: making.from + s.to - 1, code: lines.slice(s.from - 1, s.to).join('\n') };
  return making;
}
// The line that names a file, else the statement's first line.
const howFile = (code: string, path: string) => code.split('\n').find(l => l.includes(path))?.trim() ?? (code.split('\n').find(l => l.trim() && !/^\s*#/.test(l)) ?? '').trim();

// A constant: its assignment gives it only literals, and calls that are given only literals and do
// not read anything (c(), paste0(), theme(), dict(); not read.csv() of a URL).
const literalNames = new Set(['TRUE', 'FALSE', 'T', 'F', 'NULL', 'NA', 'Inf', 'NaN', 'pi', 'LETTERS', 'letters', 'month.name', 'month.abb', 'True', 'False', 'None']);
const fetches = /read|load|fetch|download|scan|query|import|open|connect|request|url|get$|^get|^data$|^source$/i;
function literal(code: string, name: string, language: Language) {
  const rest = assigned(code, name, language);
  if (rest === null) return false;
  const plain = rest.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/#.*$/gm, '');
  for (const w of plain.matchAll(/([\p{L}_.][\p{L}\p{N}_.]*)\s*(\(|=(?!=))?/gu)) {
    if (/^\.?\d/.test(w[1]!) || w[2] === '=' || (w[2] === '(' ? !fetches.test(w[1]!) : literalNames.has(w[1]!))) continue;
    return false;
  }
  return true;
}

interface Draft extends GraphNode { fn: boolean; language: Language }
function builder(language: Language) {
  const nodes = new Map<string, Draft>();
  const node = (id: string, kind: GraphKind, name: string, how: string) => {
    let n = nodes.get(id);
    if (!n) nodes.set(id, n = { id, kind, name, how, made: [], uses: [], parents: [], children: [], fn: false, language });
    else if (how && !n.how) n.how = how;
    return n;
  };
  const make = (id: string, kind: GraphKind, name: string, making: Making | null, how: string, parents: string[], fn = false, stale: string[] = []) => {
    const n = node(id, kind, name, how);
    if (stale.length) n.stale = [...new Set([...n.stale ?? [], ...stale])];
    if (making && !n.made.some(m => m.from === making.from && m.cell?.cellId === making.cell?.cellId)) n.made.push(making);
    if (fn) n.fn = true;
    for (const p of parents) {
      if (p === id || n.parents.includes(p)) continue;
      n.parents.push(p);
      if (p.startsWith('in:')) node(p, 'input', p.slice(3), '');
    }
  };
  // What the code says a node is: the first meaning given, where it has none yet.
  const means = (id: string, text: string | undefined) => { const n = nodes.get(id); if (n && text && !n.means) n.means = text; };
  const finish = (rest: Pick<ValueGraph, 'quiet' | 'cut' | 'tooLong'>): ValueGraph => {
    for (const n of nodes.values()) n.parents = n.parents.filter(p => nodes.has(p));
    const relink = () => {
      for (const n of nodes.values()) n.children = [];
      for (const n of nodes.values()) for (const p of n.parents) nodes.get(p)!.children.push(n.id);
    };
    relink();
    // Functions and constants something uses become what its users use.
    const folded = new Map<string, { made: Making[]; means?: string }>();
    const gone = new Set([...nodes.values()].filter(n => n.kind === 'value' && n.children.length > 0
      && (n.fn || (n.parents.length === 0 && n.made.length === 1 && literal(n.made[0]!.code, n.name, n.language)))).map(n => n.id));
    const expand = (ids: string[], seen = new Set<string>()): { parents: string[]; uses: string[] } => {
      const parents: string[] = [], uses: string[] = [];
      for (const id of ids) {
        if (!gone.has(id)) { parents.push(id); continue; }
        if (seen.has(id)) continue;
        seen.add(id);
        const n = nodes.get(id)!, inner = expand(n.parents, seen);
        uses.push(n.name, ...inner.uses); parents.push(...inner.parents);
      }
      return { parents, uses };
    };
    for (const n of nodes.values()) {
      if (gone.has(n.id)) continue;
      const { parents, uses } = expand(n.parents);
      n.parents = [...new Set(parents)].filter(p => p !== n.id);
      n.uses = [...new Set([...n.uses, ...uses])];
    }
    for (const id of gone) { const n = nodes.get(id)!; folded.set(n.name, { made: n.made, means: n.means }); nodes.delete(id); }
    relink();
    // A value made from one other and used only to change it is part of that one.
    for (let again = true; again;) {
      again = false;
      for (const v of nodes.values()) {
        if (v.kind !== 'value' || v.children.length !== 1) continue;
        const t = nodes.get(v.children[0]!)!;
        if (t.kind !== 'value' || !v.parents.length || !v.parents.every(p => p === t.id)) continue;
        t.uses = [...new Set([...t.uses, v.name, ...v.uses])];
        t.parents = t.parents.filter(p => p !== v.id);
        folded.set(v.name, { made: v.made, means: v.means }); nodes.delete(v.id); relink(); again = true;
        break;
      }
    }
    const all = [...nodes.values()];
    const made = all.filter(n => n.kind === 'output' || n.kind === 'plot').map(n => n.id);
    const ends = all.filter(n => n.kind === 'value' && !n.children.length).map(n => n.id);
    const results = made.length ? made : ends;
    const behind = new Set<string>();
    const up = (id: string) => { if (behind.has(id)) return; behind.add(id); for (const p of nodes.get(id)!.parents) up(p); };
    for (const r of results) up(r);
    return { nodes: new Map(all.map(({ fn: _, language: __, ...n }) => [n.id, n])), results, inputs: all.filter(n => n.kind === 'input').map(n => n.id),
      others: all.filter(n => !behind.has(n.id)).map(n => n.id), folded, ...rest };
  };
  return { make, means, finish };
}

// A script read as text: each step makes its values and the files it writes, from what the step
// reads.
export function scriptGraph(flow: ScriptFlow, language: Language): ValueGraph {
  const b = builder(language);
  const idOf = (link: string) => (link.startsWith('wrote:') ? 'out:' : 'v:') + link.slice(6).replace(/@\d+$/, '');
  for (const step of flow.steps) {
    const making: Making = { from: step.from, to: step.to, code: step.cell.code };
    const parents = [...flow.links.filter(l => l.to === step.id).map(l => idOf(l.from)), ...step.reads.map(p => 'in:' + p)];
    for (const n of step.nodes) {
      const file = n.kind === 'file', own = step.nodes.length > 1 && !file ? narrowed(making, n.name, language) : making, id = (file ? 'out:' : 'v:') + n.name;
      b.make(id, file ? 'output' : 'value', n.name, own, file ? howFile(step.cell.code, n.name) : howOf(step.cell.code, n.name, language), parents, step.functions.includes(n.name));
      b.means(id, flow.means.get((file ? 'file:' : 'value:') + n.name));
    }
    for (const p of step.reads) b.means('in:' + p, flow.means.get('file:' + p));
  }
  return b.finish(flow);
}

// A live session's records: each cell makes what is still there from what it read as it is now. A
// cell whose code makes its values over several statements is read statement by statement, so
// each value comes from what its own statements read; what the record has and no statement was
// seen to read goes to everything the cell made. What a cell made that was made again since is
// not here; a value with no record of its making was already in the session.
export interface SessionCell extends LineageCell { language: Language }
export function sessionGraph(cells: SessionCell[], values: Array<{ name: string; type?: string }>, language: Language): ValueGraph & { omitted: { values: number; plots: number; files: number } } {
  const graph = lineage(cells, values.map(v => v.name)), b = builder(language);
  // What an earlier cell's code says its values are, read once per cell.
  const meaningsOfCell = new Map<string, ScriptFlow['means']>();
  const meanOfCell = (c: LineageCell) => { if (!meaningsOfCell.has(c.cellId)) meaningsOfCell.set(c.cellId, scriptFlow(c.code, language).means); return meaningsOfCell.get(c.cellId)!; };
  const functions = new Set(values.filter(v => v.type === 'function' || v.type === 'closure').map(v => v.name));
  const written = new Set(graph.steps.flatMap(s => s.nodes.filter(n => n.id.startsWith('wrote:')).map(n => n.name)));
  const fileNode = (path: string) => (written.has(path) ? 'out:' : 'in:') + path;
  const idOf = (link: string) => (link.startsWith('wrote:') ? 'out:' : 'v:') + link.slice(6);
  for (const step of graph.steps) {
    if (!step.cell) { for (const n of step.nodes) b.make('v:' + n.name, 'input', n.name, null, 'Already in the session', []); continue; }
    const cell = step.cell as SessionCell, where = (c: LineageCell) => ({ cellId: c.cellId, number: c.number, label: cellLabel(c) });
    const whole = (c: LineageCell): Making => ({ from: 1, to: c.code.split('\n').length, code: c.code, cell: where(c) });
    const into = [...graph.links.filter(l => l.to === step.id).map(l => idOf(l.from)), ...step.reads.map(fileNode)];
    const current = new Set(step.nodes.map(n => n.name));
    const flow = scriptFlow(cell.code, cell.language, undefined, cell.used ?? []);
    const stepOf = (link: string) => flow.steps.find(s => s.id === 'lines:' + link.slice(link.lastIndexOf('@') + 1));
    // What a statement read: the session's values and files as the record has them, and what the
    // statements before it made, through what this cell made that the session no longer holds.
    const partsOf = (s: ScriptStep, seen = new Set<string>()): string[] => {
      if (seen.has(s.id)) return [];
      seen.add(s.id);
      return [...flow.links.filter(l => l.to === s.id).flatMap(l => {
        const name = l.from.slice(6).replace(/@\d+$/, ''), before = stepOf(l.from);
        return l.from.startsWith('wrote:') ? [fileNode(name)] : current.has(name) ? ['v:' + name] : before ? partsOf(before, seen) : [];
      }), ...flow.outside.filter(o => o.to === s.id).map(o => 'v:' + o.name).filter(id => into.includes(id)), ...s.reads.map(fileNode)];
    };
    const own = new Map<string, ScriptStep[]>(), key = (kind: string, name: string) => (kind === 'file' ? 'f:' : 'v:') + name;
    if (flow.steps.length > 1) for (const s of flow.steps) for (const n of s.nodes) own.set(key(n.kind, n.name), [...own.get(key(n.kind, n.name)) ?? [], s]);
    const seen = new Set([...own.values()].flat().flatMap(s => partsOf(s)));
    const unseen = into.filter(id => !seen.has(id)), readInCell = new Set(flow.links.map(l => l.from));
    const ends: string[] = [];
    for (const n of step.nodes) {
      if (n.kind === 'plot') continue;
      const kind = n.kind === 'value' ? 'value' : 'output', id = (kind === 'value' ? 'v:' : 'out:') + n.name, meant = flow.means.get((kind === 'value' ? 'value:' : 'file:') + n.name);
      const steps = own.get(key(n.kind, n.name));
      for (const c of step.earlier) if (c.defined?.includes(n.name)) {
        b.make(id, kind, n.name, whole(c), kind === 'value' ? howOf(c.code, n.name, cell.language) : howFile(c.code, n.name), []);
        b.means(id, meanOfCell(c).get('value:' + n.name));
      }
      if (steps) {
        const first = steps[0]!, last = steps.at(-1)!, how = kind === 'value' ? howOf(first.cell.code, n.name, cell.language) : howFile(first.cell.code, n.name);
        for (const s of steps) {
          const making: Making = { from: s.from, to: s.to, code: s.cell.code, cell: where(cell) };
          b.make(id, kind, n.name, s.nodes.length > 1 && kind === 'value' ? narrowed(making, n.name, cell.language) : making, how, [...partsOf(s), ...unseen], functions.has(n.name) || s.functions.includes(n.name), step.stale);
        }
        b.means(id, meant);
        if (kind === 'value' && !readInCell.has(`value:${n.name}@${last.from}`)) ends.push(id);
      } else {
        const how = flow.steps.length === 1 ? (kind === 'value' ? howOf(cell.code, n.name, cell.language) : howFile(cell.code, n.name)) : cell.purpose ?? cellLabel(cell);
        b.make(id, kind, n.name, whole(cell), how, into, functions.has(n.name), step.stale);
        b.means(id, meant);
        if (kind === 'value') ends.push(id);
      }
    }
    for (const p of step.reads) b.means(fileNode(p), flow.means.get('file:' + p));
    // A plot comes from what the statements that make nothing read (plot(fit), print(p); not rm()
    // or a check), as the statements before them made it; else from what the cell made last, else
    // what it read.
    const lines = cell.code.split('\n');
    const drawing = flow.quietReads.filter(q => !/^\s*(?:rm|remove|del|stopifnot|assert|message|cat|warning|stop)\b/.test(lines[q.from - 1] ?? '')).map(q => ({ ...q, parts: q.used.flatMap(name => {
      const before = [...flow.steps].reverse().find(s => s.from < q.from && s.nodes.some(n => n.kind === 'value' && n.name === name));
      return !before ? (into.includes('v:' + name) ? ['v:' + name] : []) : current.has(name) ? ['v:' + name] : partsOf(before);
    }) })).filter(q => q.parts.length);
    for (const n of step.nodes) if (n.kind === 'plot') {
      b.make(n.id, 'plot', `${n.name} · ${cell.language === 'r' ? 'R' : 'Python'} ${cell.number}`, whole(cell),
        drawing.length ? lines.slice(drawing.at(-1)!.from - 1, drawing.at(-1)!.to).join(' ').trim() : cell.purpose ?? cellLabel(cell),
        drawing.length ? drawing.flatMap(q => q.parts) : ends.length ? ends : into, false, step.stale);
      b.means(n.id, drawing.at(-1)?.means);
    }
  }
  // The newest results first.
  const done = b.finish({ quiet: 0, cut: 0, tooLong: false }), ran = (id: string) => Math.max(0, ...done.nodes.get(id)!.made.map(m => m.cell?.number ?? 0));
  return { ...done, results: [...done.results].sort((x, y) => ran(y) - ran(x)), omitted: graph.omitted };
}

// What a node comes from and what comes of it, each holding the node.
export function graphPath(graph: ValueGraph, id: string) {
  const reach = (next: (n: GraphNode) => string[]) => {
    const seen = new Set<string>([id]), queue = [id];
    while (queue.length) for (const o of next(graph.nodes.get(queue.pop()!)!)) if (!seen.has(o) && graph.nodes.has(o)) { seen.add(o); queue.push(o); }
    return seen;
  };
  return { up: reach(n => n.parents), down: reach(n => n.children) };
}

// Rows from the data down: a node sits one row below the lowest of what it comes from; within a
// row, nodes sit near the middle of what they come from, else in the order they were made.
export function graphRows(graph: ValueGraph, shown: Set<string>): string[][] {
  const depth = new Map<string, number>(), visiting = new Set<string>();
  const parents = (id: string) => graph.nodes.get(id)!.parents.filter(p => shown.has(p));
  const rowOf = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = Math.max(-1, ...parents(id).map(rowOf)) + 1;
    visiting.delete(id); depth.set(id, d);
    return d;
  };
  const at = (n: GraphNode) => n.made[0] ? (n.made[0].cell?.number ?? 0) * 1e5 + n.made[0].from : -1;
  const ordered = [...shown].map(id => graph.nodes.get(id)!).sort((a, b) => at(a) - at(b) || a.name.localeCompare(b.name));
  const rows: string[][] = [];
  for (const n of ordered) (rows[rowOf(n.id)] ??= []).push(n.id);
  const kept = rows.filter(Boolean), place = new Map<string, number>();
  kept.forEach(row => row.forEach((id, i) => place.set(id, i / Math.max(1, row.length - 1))));
  for (const row of kept.slice(1)) {
    const middle = (id: string) => { const ps = parents(id).map(p => place.get(p)!); return ps.length ? ps.reduce((s, x) => s + x, 0) / ps.length : place.get(id)!; };
    row.sort((a, b) => middle(a) - middle(b));
    row.forEach((id, i) => place.set(id, i / Math.max(1, row.length - 1)));
  }
  return kept;
}

// The lines behind a node and in front of it: where it is made (here), where what it comes from
// and the functions, constants and helpers they use are made (from), and where what comes of it is
// made (into).
export type MarkKind = 'here' | 'from' | 'into';
export function graphMarks(graph: ValueGraph, id: string): Array<Making & { kind: MarkKind }> {
  const node = graph.nodes.get(id);
  if (!node) return [];
  const { up, down } = graphPath(graph, id), out: Array<Making & { kind: MarkKind }> = [];
  const add = (kind: MarkKind, made: Making[]) => { for (const m of made) out.push({ ...m, kind }); };
  add('here', node.made);
  for (const n of up) { const u = graph.nodes.get(n)!; if (n !== id) add('from', u.made); for (const use of u.uses) add('from', graph.folded.get(use)?.made ?? []); }
  for (const n of down) if (n !== id) add('into', graph.nodes.get(n)!.made);
  return out;
}

// The node made at a line (of a cell's code, when it names one), if any: of those, the one made in
// the fewest lines there.
export function graphNodeAt(graph: ValueGraph, line: number, cellId?: string) {
  let best: GraphNode | null = null, span = Infinity;
  for (const n of graph.nodes.values()) for (const m of n.made) {
    if (m.cell?.cellId !== cellId || line < m.from || line > m.to || m.to - m.from >= span) continue;
    best = n; span = m.to - m.from;
  }
  return best;
}
