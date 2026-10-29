// Line-based three-way merge of two changes to one base text: the buffer's unsaved edits and
// what reached the file on disk. Changes to different lines are both kept; insertions at the
// same place are both kept, the disk's first; any other overlap is a conflict and nothing is
// merged. The comparison table is bounded: past maxCells a changed region is compared as one
// block, which can only turn a merge into a conflict, never into a wrong merge.
export const mergeLimits = { maxCells: 1_000_000 };
interface Hunk { start: number; end: number; lines: string[] }
const lines = (text: string) => text ? text.split(/(?<=\n)/) : [];
const same = (a: string[], b: string[]) => a.length === b.length && a.every((line, i) => line === b[i]);
// The spans of `base` that `next` replaces, from a longest common subsequence of lines.
function hunks(base: string[], next: string[], maxCells: number): Hunk[] {
  let head = 0, tail = 0;
  while (head < base.length && head < next.length && base[head] === next[head]) head++;
  while (tail < base.length - head && tail < next.length - head && base[base.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  const a = base.slice(head, base.length - tail), b = next.slice(head, next.length - tail);
  if (!a.length && !b.length) return [];
  if (!a.length || !b.length || (a.length + 1) * (b.length + 1) > maxCells) return [{ start: head, end: head + a.length, lines: b }];
  const width = b.length + 1, table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
  const out: Hunk[] = [];
  let i = 0, j = 0, open: Hunk | null = null;
  const close = () => { if (open) { out.push(open); open = null; } };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { close(); i++; j++; continue; }
    open ??= { start: head + i, end: head + i, lines: [] };
    if (j < b.length && (i === a.length || table[i * width + j + 1]! >= table[(i + 1) * width + j]!)) open.lines.push(b[j++]!);
    else { i++; open.end = head + i; }
  }
  close();
  return out;
}
export function mergeText(base: string, ours: string, theirs: string, limits = mergeLimits): string | null {
  if (ours === theirs) return ours;
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  const original = lines(base), mine = hunks(original, lines(ours), limits.maxCells), disk = hunks(original, lines(theirs), limits.maxCells);
  const out: string[] = [];
  let at = 0, i = 0, j = 0;
  const take = (h: Hunk) => { out.push(...original.slice(at, h.start), ...h.lines); at = h.end; };
  while (i < mine.length || j < disk.length) {
    const x = mine[i], y = disk[j];
    if (!y) { take(x!); i++; continue; }
    if (!x) { take(y); j++; continue; }
    const xEmpty = x.start === x.end, yEmpty = y.start === y.end;
    if (x.start === y.start && x.end === y.end && same(x.lines, y.lines)) { take(x); i++; j++; }
    else if (xEmpty && yEmpty && x.start === y.start) { take({ start: x.start, end: x.end, lines: [...y.lines, ...x.lines] }); i++; j++; }
    // Changes to neighbouring lines are distinct; an insertion at the edge of another change is not.
    else if (x.end < y.start || (x.end === y.start && !xEmpty && !yEmpty)) { take(x); i++; }
    else if (y.end < x.start || (y.end === x.start && !xEmpty && !yEmpty)) { take(y); j++; }
    else return null;
  }
  out.push(...original.slice(at));
  return out.join('');
}
