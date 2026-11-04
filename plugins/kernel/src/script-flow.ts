// How the values of a script are made, read from its text alone, as the Data flow draws a
// session's cells: each top-level statement makes the values it assigns outside its functions,
// reads the script's values it mentions (a name an earlier statement made, outside what a function
// keeps for itself) and reads or writes the project files its strings name, as the call it hands
// them to does (read.csv, write.csv, ggsave, pd.read_csv, to_csv, open(…, "w")). A statement that
// changes only what the step before made, or one that makes something from nothing after another
// that did, joins that step. A statement that makes and writes nothing (a print, a library call, a
// check) is not drawn. Imports and library() calls are not values. Nothing runs: what a script
// builds by name at run time (assign(), get(), exec(), a path pasted from parts) is not seen.
import type { Language } from './explore-code.js';
import type { Lineage, LineageCell, LineageLink, LineageNode, LineageStep } from './lineage.js';
import { statements } from './statements.js';

export interface ScriptStep extends LineageStep {
  cell: LineageCell;
  // Its lines, the values it changes (they were there before it) and those it makes as functions.
  from: number; to: number; changed: string[]; functions: string[];
}
export interface ScriptFlow extends Lineage {
  steps: ScriptStep[];
  // Statements that make and write nothing, and steps past the limit, are counted.
  quiet: number; cut: number;
  // Past the byte limit the script is not read.
  tooLong: boolean;
}
// The protected resource is the reader's page: a script larger than `bytes` is not read, and at
// most `steps` steps are drawn; the rest are counted.
export const scriptFlowLimits = { bytes: 512 * 1024, steps: 150 };

type Kind = 'name' | 'string' | 'number' | 'op' | 'open' | 'close' | 'newline';
interface Token { kind: Kind; text: string; line: number; head: boolean; f?: boolean }

const rOps = ['<<-', '->>', ':::', '|>', '<-', '->', '<=', '>=', '==', '!=', '&&', '||', '::'];
const pyOps = ['**=', '//=', '>>=', '<<=', '...', '->', ':=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=', '==', '!=', '<=', '>=', '**', '//', '<<', '>>'];
const rName = /[\p{L}.][\p{L}\p{N}._]*/uy, pyName = /[\p{L}_][\p{L}\p{N}_]*/uy;
const rNumber = /(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[Li]?/y;
const pyNumber = /(?:0[xXoObB][0-9a-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[jJ]?/y;
const pyString = /([rRbBuUfF]{0,2})("""|'''|"|')/y, rRaw = /[rR](["'])(-*)([([{])/y;
const at = (re: RegExp, text: string, i: number) => { re.lastIndex = i; return re.exec(text); };

function tokenize(text: string, language: Language): Token[] {
  const out: Token[] = [];
  let i = 0, line = 1, head = true;
  const push = (kind: Kind, value: string, f?: boolean) => { out.push({ kind, text: value, line, head, ...f ? { f } : {} }); head = false; };
  // A string's text runs to its closing quote; its lines count.
  const quoted = (from: number, close: string, escapes: boolean) => {
    let j = from;
    while (j < text.length && !text.startsWith(close, j)) { if (escapes && text[j] === '\\') j++; j++; }
    return j;
  };
  while (i < text.length) {
    const c = text[i]!;
    if (c === '\n') { out.push({ kind: 'newline', text: '\n', line, head: false }); line++; head = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') { i++; continue; }
    if (c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '\\' && language === 'python' && /^\\\r?\n/.test(text.slice(i, i + 3))) { i = text.indexOf('\n', i) + 1; line++; continue; }
    let m: RegExpExecArray | null;
    if (language === 'r' && (m = at(rRaw, text, i))) {
      const close = ({ '(': ')', '[': ']', '{': '}' } as Record<string, string>)[m[3]!]! + m[2] + m[1];
      const start = i + m[0].length, end = quoted(start, close, false), body = text.slice(start, end);
      push('string', body); line += body.split('\n').length - 1; i = end + close.length; continue;
    }
    if (language === 'python' && (m = at(pyString, text, i)) && (!m[1] || /^(?:[rRuUfFbB]|[rR][bBfF]|[bBfF][rR])$/.test(m[1]))) {
      const start = i + m[0].length, end = quoted(start, m[2]!, !/[rR]/.test(m[1]!)), body = text.slice(start, end);
      push('string', body, /[fF]/.test(m[1]!)); line += body.split('\n').length - 1; i = end + m[2]!.length; continue;
    }
    if (c === '"' || c === "'" || (language === 'r' && c === '`')) {
      const end = quoted(i + 1, c, true), body = text.slice(i + 1, end);
      push(c === '`' ? 'name' : 'string', body); line += body.split('\n').length - 1; i = end + 1; continue;
    }
    if ((m = at(language === 'r' ? rNumber : pyNumber, text, i)) && m[0] && (/\d/.test(c) || /^\.\d/.test(m[0]))) { push('number', m[0]); i += m[0].length; continue; }
    if ((m = at(language === 'r' ? rName : pyName, text, i))) { push('name', m[0]); i += m[0].length; continue; }
    if (language === 'r' && c === '%' && (m = at(/%[^%\n]*%/y, text, i))) { push('op', m[0]); i += m[0].length; continue; }
    if ('([{'.includes(c)) { push('open', c); i++; continue; }
    if (')]}'.includes(c)) { push('close', c); i++; continue; }
    const op = (language === 'r' ? rOps : pyOps).find(o => text.startsWith(o, i)) ?? c;
    push('op', op); i += op.length;
  }
  return out;
}

// Each token's bracket depth (an open and its close share theirs), the innermost bracket around
// it and where that opened, and each bracket's partner.
function brackets(toks: Token[]) {
  const depth: number[] = [], inner: string[] = [], openAt: number[] = [], match: number[] = toks.map(() => -1), stack: number[] = [];
  toks.forEach((t, k) => {
    if (t.kind === 'close') { const o = stack.pop(); if (o !== undefined) { match[o] = k; match[k] = o; } }
    depth[k] = stack.length; openAt[k] = stack.at(-1) ?? -1; inner[k] = stack.length ? toks[stack.at(-1)!]!.text : '';
    if (t.kind === 'open') stack.push(k);
  });
  return { depth, inner, openAt, match };
}

interface Made { defined: string[]; changed: Set<string>; used: string[]; files: Array<{ path: string; how: 'read' | 'wrote' }>; functions: string[]; paths: Map<string, string> }

// A string that names a file: with a folder, any extension; alone, one of the usual ones.
const usual = /\.(csv|tsv|txt|tab|dat|gz|bz2|xz|zip|rds|rda|rdata|qs|json|jsonl|ya?ml|toml|xml|html?|md|xlsx?|parquet|feather|arrow|h5|hdf5|h5ad|loom|mtx|npy|npz|pkl|pickle|joblib|mat|sav|dta|sqlite|db|png|pdf|svg|jpe?g|tiff?|gif|eps|ps|r|py|ipynb|fasta|fa|fastq|fq|bam|sam|vcf|bed|gtf|gff3?|log)$/i;
export function looksLikePath(s: string) {
  if (!s || s.length >= 512 || /[\n\r\t]|:\/\//.test(s) || !/^[\p{L}\p{N}_@~.\/\\: +-]+$/u.test(s)) return false;
  return /\//.test(s) ? /[^/]\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(s) : usual.test(s) && /\p{L}/u.test(s.replace(usual, ''));
}
// What a call does with a path it is given, by its name.
const builds = new Set(['file.path', 'paste0', 'paste', 'here', 'path', 'normalizePath', 'path.expand', 'join', 'Path', 'PurePath', 'joinpath', 'abspath', 'expanduser', 'normpath', 'fspath', 'str']);
const writes = /^(write|save|ggsave|export|dump|dput|sink|fwrite|png|pdf|svg|jpeg|tiff|bmp|cairo_pdf|cairo_ps|postscript|dev\.copy|dir\.create|file\.create|to_|savefig|savez|savetxt|imwrite|imsave|mkdir|makedirs)|_write$|[._](write|save)/i;
const reads = /^(read|load|fread|vroom|scan|source|import|open|imread|fromfile|genfromtxt|readRDS|readLines|readxl|Read10X|qread)|[._](read|load)/i;

// What one statement makes, reads and names. `paths` holds the script's values that are a file's
// path (out <- "results/x.csv"), so a call given one reads or writes that file.
function analyze(toks: Token[], language: Language, lineIndent: number[], paths: Map<string, string>): Made {
  const { depth, inner, openAt, match } = brackets(toks);
  const nextOf = (k: number) => { let j = k + 1; while (toks[j]?.kind === 'newline') j++; return j; };
  const prevOf = (k: number) => { let j = k - 1; while (toks[j]?.kind === 'newline') j--; return j; };
  const keywords = language === 'r' ? rKeywords : pyKeywords;
  const isName = (k: number) => toks[k]?.kind === 'name' && !keywords.has(toks[k]!.text);
  // Where an expression starting at k ends: a newline that ends a line (not one inside brackets or
  // after an operator), a ; or , at its depth, or the bracket that closes around it.
  const endOf = (k: number) => {
    const d = depth[k]!;
    for (let j = k; j < toks.length; j++) {
      const t = toks[j]!;
      if (t.kind === 'close' && depth[j]! < d) return j - 1;
      if (depth[j] !== d) continue;
      if (t.text === ';' || t.text === ',') return j - 1;
      if (t.kind === 'newline' && (inner[j] === '{' || inner[j] === '') && j > k) {
        const before = toks[prevOf(j)];
        if (!(before && (before.kind === 'open' || (before.kind === 'op' && before.text !== '...')))) return j - 1;
      }
    }
    return toks.length - 1;
  };
  // Scopes: a function's (or lambda's, class's or comprehension's) tokens and the names it keeps.
  const scopes: Array<{ from: number; to: number; own: Set<string> }> = [];
  const within = (k: number) => scopes.filter(s => k > s.from && k <= s.to);
  // Assignments outside any scope: the name, whether it is bare (x <- …), where its target is and
  // where the assignment ends.
  const top: Array<{ name: string; bare: boolean; at: number; end: number }> = [];
  const targets = new Set<number>();
  const assign = (name: string, k: number, bare: boolean, end: number, global = false) => {
    const holders = within(k);
    if (bare) targets.add(k);
    if (holders.length && !global) for (const s of holders) s.own.add(name);
    else top.push({ name, bare, at: k, end });
  };
  const functions: string[] = [];

  if (language === 'r') {
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k]!;
      if (!((t.kind === 'name' && t.text === 'function') || (t.kind === 'op' && t.text === '\\'))) continue;
      const open = nextOf(k);
      if (toks[open]?.text !== '(' || match[open]! < 0) continue;
      const close = match[open]!, own = new Set<string>();
      for (let j = open + 1; j < close; j++) if (depth[j] === depth[open]! + 1 && toks[j]!.kind === 'name' && [',', ')', '='].includes(toks[nextOf(j)]?.text ?? '')) own.add(toks[j]!.text);
      const body = nextOf(close);
      const to = toks[body]?.text === '{' && match[body]! >= 0 ? match[body]! : endOf(body);
      scopes.push({ from: k, to, own });
    }
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k]!;
      if (t.kind === 'name' && t.text === 'for' && toks[nextOf(k)]?.text === '(') {
        const v = nextOf(nextOf(k));
        if (isName(v) && toks[nextOf(v)]?.text === 'in') assign(toks[v]!.text, v, true, match[nextOf(k)]!);
        continue;
      }
      if (t.kind !== 'op' || !['<-', '<<-', '=', '->', '->>'].includes(t.text)) continue;
      if (t.text === '=' && inner[k] !== '{' && inner[k] !== '') continue;
      let s: number, e: number;
      if (t.text === '->' || t.text === '->>') {
        s = nextOf(k); e = s;
        for (;;) {
          const n = nextOf(e);
          if (toks[n]?.kind === 'open' && toks[n]!.text !== '{' && match[n]! >= 0) e = match[n]!;
          else if (['$', '@'].includes(toks[n]?.text ?? '') && toks[nextOf(n)]) e = nextOf(n);
          else break;
        }
      } else {
        e = prevOf(k); s = e;
        while (s >= 0) {
          const u = toks[s]!;
          if (u.kind === 'close') {
            const o = match[s]!, before = toks[prevOf(o)];
            if (o < 0 || (u.text === ')' && before && ['if', 'for', 'while', 'function'].includes(before.text)) || u.text === '}') { s++; break; }
            s = prevOf(o); continue;
          }
          if (u.kind === 'name' || u.kind === 'string') {
            const p = toks[prevOf(s)];
            if (p && ['$', '@', '::', ':::'].includes(p.text)) { s = prevOf(prevOf(s)); continue; }
            break;
          }
          s++; break;
        }
        if (s < 0) s = 0;
      }
      if (s > e || !toks[s]) continue;
      const side: number[] = [];
      for (let j = s; j <= e; j++) if (toks[j]!.kind !== 'newline') side.push(j);
      const bare = side.length === 1 && (toks[s]!.kind === 'name' || toks[s]!.kind === 'string');
      const named = bare ? s : side.find(j => toks[j]!.kind === 'name' && !keywords.has(toks[j]!.text) && toks[nextOf(j)]?.text !== '(' && !['$', '@', '::', ':::'].includes(toks[prevOf(j)]?.text ?? '') && !['::', ':::'].includes(toks[nextOf(j)]?.text ?? ''));
      if (named === undefined) continue;
      const end = t.text.startsWith('-') ? e : endOf(nextOf(k));
      assign(toks[named]!.text, named, bare, end, t.text === '<<-' || t.text === '->>');
      const value = nextOf(k);
      if (bare && !within(k).length && (toks[value]?.text === 'function' || (toks[value]?.kind === 'op' && toks[value]!.text === '\\'))) functions.push(toks[named]!.text);
    }
  } else {
    // The simple statements, each from its first token: a line's first token outside brackets,
    // and what follows a ; or a block header's colon.
    const compound = new Set(['if', 'elif', 'else', 'for', 'while', 'with', 'try', 'except', 'finally', 'def', 'class', 'async', 'match', 'case']);
    const starts: number[] = [];
    let from = -1;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k]!;
      if (t.kind === 'newline') { if (depth[k] === 0) from = -1; continue; }
      if (from < 0) { from = k; starts.push(k); continue; }
      if (depth[k] === 0 && t.text === ';') { from = -1; continue; }
      if (depth[k] === 0 && t.text === ':' && compound.has(toks[from]!.text) && !toks.slice(from, k).some(u => u.text === 'lambda')) from = -1;
    }
    const simple = starts.map((s, i) => {
      let e = (starts[i + 1] ?? toks.length) - 1;
      while (e > s && (toks[e]!.kind === 'newline' || (depth[e] === 0 && (toks[e]!.text === ';' || (toks[e]!.text === ':' && compound.has(toks[s]!.text)))))) e--;
      return { s, e };
    });
    const indent = (k: number) => lineIndent[toks[k]!.line - 1] ?? 0;
    // def and class: their parameters and their body, by indentation; lambdas; comprehensions.
    for (const { s, e } of simple) {
      let k = s;
      if (toks[k]!.text === 'async') k = nextOf(k);
      if (toks[k]!.text !== 'def' && toks[k]!.text !== 'class') continue;
      const name = nextOf(k), own = new Set<string>();
      const open = nextOf(name);
      if (toks[open]?.text === '(' && toks[k]!.text === 'def') for (let j = open + 1; j < match[open]!; j++) if (depth[j] === depth[open]! + 1 && toks[j]!.kind === 'name' && [',', ')', '=', ':'].includes(toks[nextOf(j)]?.text ?? '')) own.add(toks[j]!.text);
      let to = e;
      for (let j = e + 1; j < toks.length; j++) {
        const u = toks[j]!;
        if (u.kind === 'newline') continue;
        if (u.head && depth[j] === 0 && indent(j) <= indent(s)) break;
        to = j;
      }
      if (isName(name)) {
        if (!within(name).length && toks[k]!.text === 'def') functions.push(toks[name]!.text);
        assign(toks[name]!.text, name, true, to);
      }
      scopes.push({ from: name, to, own });
    }
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k]!;
      if (t.kind === 'name' && t.text === 'lambda') {
        const own = new Set<string>();
        let j = k + 1;
        for (; j < toks.length && !(toks[j]!.text === ':' && depth[j] === depth[k]); j++) if (toks[j]!.kind === 'name') own.add(toks[j]!.text);
        scopes.push({ from: k, to: endOf(j + 1), own });
      }
      if (t.kind === 'open' && match[k]! > k) {
        const own = new Set<string>();
        for (let j = k + 1; j < match[k]!; j++) {
          if (depth[j] !== depth[k]! + 1 || toks[j]!.text !== 'for') continue;
          for (let v = j + 1; v < match[k]! && toks[v]!.text !== 'in'; v++) if (toks[v]!.kind === 'name') own.add(toks[v]!.text);
        }
        if (own.size) scopes.push({ from: k, to: match[k]!, own });
      }
    }
    // Targets: of =, augmented and annotated assignment, :=, for … in, with … as, except … as.
    // Imports bind names that are not the script's values.
    const declared = new Set<string>();
    const element = (a: number, b: number, end: number, change = false) => {
      const parts: Array<[number, number]> = [];
      let p = a;
      for (let j = a; j <= b + 1; j++) if (j > b || (toks[j]!.text === ',' && depth[j] === depth[a])) { if (p <= j - 1) parts.push([p, j - 1]); p = j + 1; }
      for (let [x, y] of parts) {
        while (toks[x]?.kind === 'newline') x++;
        if (toks[x]?.text === '*') x++;
        if (x > y) continue;
        if (toks[x]!.kind === 'open' && match[x] === y) { element(x + 1, y - 1, end, change); continue; }
        if (x === y && isName(x)) { assign(toks[x]!.text, x, !change, end); continue; }
        if (isName(x)) assign(toks[x]!.text, x, false, end);
      }
    };
    for (const { s, e } of simple) {
      const first = toks[s]!.text;
      if (first === 'import' || first === 'from') {
        for (let j = s; j <= e; j++) if (isName(j) && toks[j - 1]?.text !== '.' && toks[j + 1]?.text !== '.') {
          const inner = within(j);
          for (const sc of inner) sc.own.add(toks[j]!.text);
          targets.add(j);
        }
        continue;
      }
      if (first === 'global' || first === 'nonlocal') { for (let j = s + 1; j <= e; j++) if (isName(j)) { declared.add(toks[j]!.text); targets.add(j); } continue; }
      let k = s;
      if (first === 'async') k = nextOf(k);
      if (toks[k]!.text === 'for') {
        let j = k + 1; while (j <= e && toks[j]!.text !== 'in') j++;
        element(k + 1, j - 1, e);
        continue;
      }
      if (toks[k]!.text === 'with' || toks[k]!.text === 'except') {
        for (let j = k; j <= e; j++) if (toks[j]!.text === 'as' && depth[j] === depth[k]) element(j + 1, Math.min(e, Math.max(j + 1, endOf(j + 1))), e);
        continue;
      }
      for (let j = s; j <= e; j++) if (toks[j]!.text === ':=' && isName(j - 1)) assign(toks[j - 1]!.text, j - 1, true, e);
      if (compound.has(toks[k]!.text)) continue;
      const ops = [];
      for (let j = s; j <= e; j++) if (depth[j] === depth[s] && toks[j]!.kind === 'op' && (toks[j]!.text === '=' || /^(?:[-+*/%&|^@]|\*\*|\/\/|>>|<<)=$/.test(toks[j]!.text))) ops.push(j);
      let a = s;
      for (const op of ops) {
        let b = op - 1;
        // An annotation (x: int = …) leaves the name.
        for (let j = a; j < op; j++) if (toks[j]!.text === ':' && depth[j] === depth[s]) { b = j - 1; break; }
        element(a, b, e, toks[op]!.text !== '=');
        a = op + 1;
      }
    }
    for (const sc of scopes) for (const name of declared) sc.own.delete(name);
  }

  // In R, the names in aes() and vars() and in a formula's argument (y ~ x) are a table's columns.
  const columns = new Set<number>();
  if (language === 'r') for (let o = 0; o < toks.length; o++) {
    if (toks[o]!.text !== '(' || match[o]! < 0) continue;
    const aes = ['aes', 'aes_', 'vars'].includes(toks[prevOf(o)]?.text ?? '');
    let a = o + 1;
    for (let j = o + 1; j <= match[o]!; j++) {
      if (j < match[o]! && !(toks[j]!.text === ',' && depth[j] === depth[o]! + 1)) continue;
      if (aes || toks.slice(a, j).some((u, i) => u.text === '~' && depth[a + i] === depth[o]! + 1)) for (let x = a; x < j; x++) columns.add(x);
      a = j + 1;
    }
  }
  // Reads: names outside what a scope keeps, not a field or an argument's name, not a target, and
  // not one this statement assigned before (once that assignment ended).
  const used: string[] = [];
  for (let k = 0; k < toks.length; k++) {
    if (!isName(k) || targets.has(k) || columns.has(k)) continue;
    const name = toks[k]!.text, prev = toks[prevOf(k)], next = toks[nextOf(k)];
    if (language === 'r' && prev && ['$', '@', '::', ':::'].includes(prev.text)) continue;
    if (language === 'r' && next && ['::', ':::'].includes(next.text)) continue;
    if (language === 'python' && toks[k - 1]?.text === '.') continue;
    if (next?.text === '=' && inner[k] === '(') continue;
    if (within(k).some(s => s.own.has(name))) continue;
    if (top.some(a => a.name === name && a.end < k && a.at !== k)) continue;
    if (!used.includes(name)) used.push(name);
  }
  // The files its strings name, as read or written by the call they are given to.
  const how = (k: number): 'read' | 'wrote' | null => {
    for (let o = openAt[k]!; o >= 0; o = openAt[o]!) {
      const open = toks[o]!;
      if (open.text !== '(') return null;
      const callee = toks[prevOf(o)];
      if (!callee || callee.kind !== 'name') return null;
      if (builds.has(callee.text)) continue;
      if (callee.text === 'open' && language === 'python') {
        for (let j = o + 1; j < match[o]!; j++) if (j !== k && toks[j]!.kind === 'string' && depth[j] === depth[o]! + 1 && /^[rwxabt+]{1,3}$/.test(toks[j]!.text)) return /[wxa]/.test(toks[j]!.text) ? 'wrote' : 'read';
        return 'read';
      }
      const file = toks[prevOf(k)]?.text === '=' ? toks[prevOf(prevOf(k))]?.text : undefined;
      if (file === 'file' && ['cat', 'capture.output', 'print'].includes(callee.text)) return 'wrote';
      return writes.test(callee.text) ? 'wrote' : reads.test(callee.text) ? 'read' : null;
    }
    return null;
  };
  const files: Made['files'] = [];
  const name = (path: string, h: 'read' | 'wrote' | null) => { if (h && !files.some(f => f.path === path && f.how === h)) files.push({ path, how: h }); };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]!;
    if (t.kind === 'string' && !t.f && inner[k] !== '[' && !(language === 'python' && inner[k] === '{' && toks[nextOf(k)]?.text === ':') && looksLikePath(t.text.replace(/^\.\//, ''))) name(t.text.replace(/^\.\//, ''), how(k));
    else if (isName(k) && paths.has(t.text) && !targets.has(k)) name(paths.get(t.text)!, how(k));
  }
  // A value that is a path: name <- "x/y.csv", or file.path("x", "y.csv").
  const own = new Map<string, string>();
  for (const a of top) {
    if (!a.bare) continue;
    const value: Token[] = [];
    for (let j = nextOf(nextOf(a.at)); j <= a.end && j < toks.length; j++) if (toks[j]!.kind !== 'newline') value.push(toks[j]!);
    const strings = value.filter(v => v.kind === 'string');
    const joined = value.length === 1 && strings.length === 1 ? strings[0]!.text
      : value[0]?.kind === 'name' && builds.has(value[0].text) && value[1]?.text === '(' && strings.length && value.every(v => v.kind === 'string' || [',', '(', ')'].includes(v.text) || v === value[0]) ? strings.map(s => s.text.replace(/\/$/, '')).join('/') : null;
    if (joined && looksLikePath(joined)) own.set(a.name, joined);
  }
  for (const [n, p] of own) paths.set(n, p);
  const defined = [...new Set(top.map(a => a.name))];
  const changed = new Set(top.filter(a => !a.bare || used.includes(a.name)).map(a => a.name));
  for (const n of defined) if (!own.has(n)) paths.delete(n);
  return { defined, changed, used, files, functions: functions.filter(f => defined.includes(f)), paths: own };
}
const rKeywords = new Set(['if', 'else', 'repeat', 'while', 'function', 'for', 'in', 'next', 'break', 'TRUE', 'FALSE', 'NULL', 'Inf', 'NaN', 'NA', 'NA_integer_', 'NA_real_', 'NA_character_', 'NA_complex_', 'library', 'require', 'requireNamespace', 'suppressPackageStartupMessages']);
const pyKeywords = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'self']);

// The script's steps, in order, with lines from each value (and written file) to the steps that
// read that version of it.
export function scriptFlow(text: string, language: Language, limits = scriptFlowLimits): ScriptFlow {
  const empty: ScriptFlow = { steps: [], links: [], layers: 0, omitted: { values: 0, plots: 0, files: 0 }, quiet: 0, cut: 0, tooLong: false };
  if (new TextEncoder().encode(text).length > limits.bytes) return { ...empty, tooLong: true };
  const lines = text.split('\n'), lineIndent = lines.map(l => l.length - l.trimStart().length);
  const toks = tokenize(text, language), paths = new Map<string, string>();
  let quiet = 0, t = 0;
  interface Group { from: number; to: number; defined: string[]; changed: Set<string>; used: string[]; reads: string[]; wrote: string[]; functions: string[] }
  const groups: Group[] = [], known = new Set<string>();
  for (const statement of statements(text, language)) {
    while (t < toks.length && toks[t]!.line < statement.from) t++;
    const start = t;
    while (t < toks.length && toks[t]!.line <= statement.to) t++;
    const made = analyze(toks.slice(start, t), language, lineIndent, paths);
    // Only the script's own values are read from it; the rest are the session's or a package's.
    const used = made.used.filter(n => known.has(n));
    const wrote = made.files.filter(f => f.how === 'wrote').map(f => f.path), read = made.files.filter(f => f.how === 'read').map(f => f.path);
    for (const n of made.defined) known.add(n);
    if (!made.defined.length && !wrote.length) { quiet++; continue; }
    const last = groups.at(-1);
    const continues = last && !wrote.length && !last.wrote.length && (
      // It changes only what the step made, or it makes something from nothing after a step that did.
      made.defined.every(n => last.defined.includes(n) && made.changed.has(n)) ||
      (!used.length && !read.length && !last.used.length && !last.reads.length && !made.defined.some(n => last.defined.includes(n))));
    if (continues) {
      last.to = statement.to;
      for (const n of used) if (!last.defined.includes(n) && !last.used.includes(n)) last.used.push(n);
      for (const n of made.defined) if (!last.defined.includes(n)) last.defined.push(n);
      for (const p of read) if (!last.reads.includes(p)) last.reads.push(p);
      for (const f of made.functions) if (!last.functions.includes(f)) last.functions.push(f);
      continue;
    }
    groups.push({ from: statement.from, to: statement.to, defined: [...made.defined], changed: made.changed, used, reads: read, wrote, functions: made.functions });
  }
  const kept = groups.slice(0, limits.steps);
  // Who made each value and wrote each file so far, as the steps go.
  const maker = new Map<string, string>(), writer = new Map<string, string>(), links: LineageLink[] = [];
  const steps: ScriptStep[] = kept.map(g => {
    const id = 'lines:' + g.from;
    const cell: LineageCell = { cellId: 'L' + g.from, number: g.from, state: 'done', code: lines.slice(g.from - 1, g.to).join('\n'), purpose: null, plots: 0, defined: g.defined, used: g.used, files: [...g.reads.map(path => ({ path, how: 'read' as const })), ...g.wrote.map(path => ({ path, how: 'wrote' as const }))] };
    const reads: string[] = [];
    for (const n of g.used) { const from = maker.get(n); if (from) links.push({ from, to: id }); }
    for (const p of g.reads) { const from = writer.get(p); if (from) links.push({ from, to: id }); else reads.push(p); }
    const changed = g.defined.filter(n => maker.has(n) && (g.changed.has(n) || g.used.includes(n)));
    const nodes: LineageNode[] = [...g.defined.map(n => ({ id: `value:${n}@${g.from}`, kind: 'value' as const, name: n, step: id })), ...g.wrote.map(p => ({ id: `wrote:${p}@${g.from}`, kind: 'file' as const, name: p, step: id }))];
    for (const n of g.defined) maker.set(n, `value:${n}@${g.from}`);
    for (const p of g.wrote) writer.set(p, `wrote:${p}@${g.from}`);
    return { id, kind: 'cell', cell, earlier: [], nodes, reads, latest: false, unknownInputs: false, stale: [], layer: 0, order: 0, from: g.from, to: g.to, changed, functions: g.functions };
  });
  return { steps, links, layers: 0, omitted: { values: 0, plots: 0, files: 0 }, quiet, cut: groups.length - kept.length, tooLong: false };
}

// The step a line is in, if any.
export const scriptStepAt = (flow: ScriptFlow, line: number) => flow.steps.find(s => s.from <= line && line <= s.to) ?? null;
