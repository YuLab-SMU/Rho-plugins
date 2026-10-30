// Edits the formatting controls make to a Markdown text, as plain text in and one change
// out. The text stays Markdown exactly as written around the change: nothing is reflowed or
// renumbered beyond the lines the command names.

export type FormatCommand = 'bold' | 'italic' | 'h1' | 'h2' | 'bullet' | 'number' | 'task';
export interface FormatChange { from: number; to: number; insert: string; anchor: number; head: number }

const taskLine = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;
// A to-do on a line of the text, ticked or cleared. Null when that line holds no to-do, so a
// line that moved since the view was drawn is left alone.
export function toggleTask(text: string, line: number): string | null {
  const lines = text.split('\n'), current = lines[line];
  const match = current === undefined ? null : taskLine.exec(current);
  if (!match) return null;
  lines[line] = match[1] + (match[2] === ' ' ? 'x' : ' ') + match[3] + current!.slice(match[0].length);
  return lines.join('\n');
}

const markers: Partial<Record<FormatCommand, string>> = { bold: '**', italic: '*' };
const prefixes: Partial<Record<FormatCommand, (n: number) => string>> = { h1: () => '# ', h2: () => '## ', bullet: () => '- ', number: n => n + '. ', task: () => '- [ ] ' };
// What a line already starts with: its indent, then a heading, to-do, bullet or number mark.
const block = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;
const kindOf = (mark: string) => !mark ? null : /^#\s/.test(mark) ? 'h1' : /^##\s/.test(mark) ? 'h2' : /^#/.test(mark) ? 'heading' : /\[/.test(mark) ? 'task' : /^\d/.test(mark) ? 'number' : 'bullet';

export function formatChange(text: string, from: number, to: number, command: FormatCommand): FormatChange {
  const marker = markers[command];
  if (marker) {
    const m = marker.length, selected = text.slice(from, to);
    const inside = selected.length >= 2 * m && selected.startsWith(marker) && selected.endsWith(marker) && !(m === 1 && selected.startsWith('**') && !selected.startsWith('***'));
    if (inside) return { from, to, insert: selected.slice(m, -m), anchor: from, head: to - 2 * m };
    const around = from >= m && text.slice(from - m, from) === marker && text.slice(to, to + m) === marker && !(m === 1 && (text[from - 2] === '*' || text[to + 1] === '*'));
    if (around) return { from: from - m, to: to + m, insert: selected, anchor: from - m, head: to - m };
    return { from, to, insert: marker + selected + marker, anchor: from + m, head: to + m };
  }
  const prefix = prefixes[command]!;
  const start = text.lastIndexOf('\n', from - 1) + 1, nextBreak = text.indexOf('\n', Math.max(to - (to > from && text[to - 1] === '\n' ? 1 : 0), from));
  const end = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(start, end).split('\n');
  const parsed = lines.map(line => { const match = block.exec(line)!; return { indent: match[1]!, kind: kindOf(match[2] ?? ''), rest: line.slice(match[0].length) }; });
  // Every line already this kind: the command takes the mark off; otherwise it puts it on.
  const off = parsed.every(p => p.kind === command || (!p.rest.trim() && parsed.length > 1));
  let n = 0;
  const insert = parsed.map((p, i) => off ? p.indent + p.rest : !p.rest.trim() && lines.length > 1 ? lines[i]! : p.indent + prefix(++n) + p.rest).join('\n');
  return { from: start, to: end, insert, anchor: start, head: start + insert.length };
}
