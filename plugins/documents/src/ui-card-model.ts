// What a Documents card shows below the full editor: one passage, one change,
// the outline or one section. DOM-free so anchor mapping and the hidden notes
// are checked in Node. Every form reads the same shared buffer as the editor.
import { currentRanges, diff, groups, type Buffer, type Group, type HistoryEntry } from './ui-model.js';

// How one change group reads in a list of changes.
export function describe(group: Pick<Group, 'kind' | 'active' | 'lines'>) {
  if (group.kind === 'undo-own') return 'Undid their edit';
  if (group.kind === 'revert') return 'Reverted a change';
  if (group.kind === 'undo') return 'Undid the last edit';
  if (!group.active) return 'Edit, since reverted';
  if (!group.lines) return 'Edit, since overwritten';
  return group.lines[0] === group.lines[1] ? `Changed line ${group.lines[0]}` : `Changed lines ${group.lines[0]}–${group.lines[1]}`;
}

// The changed span of one edit with the rest of its first and last lines.
export function excerpt(before: string, after: string) {
  const edit = diff(before, after);
  const start = edit?.from ?? 0, end = edit ? before.length - edit.to : before.length;
  const lineStart = before.lastIndexOf('\n', start - 1) + 1;
  const tailA = before.indexOf('\n', before.length - end);
  return { lead: before.slice(lineStart, start), removed: before.slice(start, before.length - end), inserted: after.slice(start, after.length - end), trail: before.slice(before.length - end, tailA < 0 ? before.length : tailA) };
}

// A UTF-16 range in the document as it was at `version`.
export interface Anchor { from: number; to: number; version: number }
export interface Placed { status: 'current' | 'edited' | 'rewritten' | 'unknown'; from: number; to: number; by?: string; before?: string }
export interface Section { title: string; level: number; from: number; to: number }
export interface Span { from: number; to: number }

// Card sizes. The protected resource is the space a card takes in the task view;
// a form parameter may lower or raise each value up to its maximum, and what does
// not fit is named in the hidden note instead of being drawn.
export const documentCardLimits = { passageParagraphs: 1, maxPassageParagraphs: 3, summaryParagraphs: 6, maxSummaryParagraphs: 20, summaryChanges: 3, maxChanges: 10, outlineSections: 8, maxOutlineSections: 30, quoteChars: 14 };

export function readAnchor(value: unknown): Anchor | null {
  const a = value as Partial<Anchor> | null;
  return a && Number.isSafeInteger(a.from) && Number.isSafeInteger(a.to) && Number.isSafeInteger(a.version) && a.from! >= 0 && a.to! >= a.from! ? { from: a.from!, to: a.to!, version: a.version! } : null;
}
export function limit(params: Record<string, unknown>, name: string, fallback: number, maximum: number) {
  const value = params[name];
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}

// Follows an anchor through the retained edits made after its version. When the
// anchored text was replaced, the card shows what now stands there and who wrote it.
export function placeAnchor(buffer: Pick<Buffer, 'content' | 'version' | 'history'>, anchor: Anchor): Placed {
  const history = buffer.history ?? [];
  const unknown: Placed = { status: 'unknown', from: 0, to: 0 };
  if (anchor.version > buffer.version) return unknown;
  // Every version after the anchor must be retained, or the place is not known.
  const retained = new Set(history.map(e => e.version));
  for (let v = anchor.version + 1; v <= buffer.version; v++) if (!retained.has(v)) return unknown;
  let from = anchor.from, to = anchor.to, status: Placed['status'] = 'current', by: string | undefined, before: string | undefined;
  for (const entry of history.filter(e => e.version > anchor.version)) {
    // Edits carry pre-change offsets in ascending order; apply from the end.
    for (const edit of [...entry.edits].reverse()) {
      const delta = edit.insert.length - (edit.to - edit.from);
      if (edit.to <= from) { from += delta; to += delta; continue; }
      if (edit.from >= to) continue;
      if (edit.from <= from && edit.to >= to) {
        // The whole anchored text was replaced: point at the replacement.
        before ??= edit.removed.slice(from - edit.from, to - edit.from);
        from = edit.from; to = edit.from + edit.insert.length; status = 'rewritten'; by = entry.author;
        continue;
      }
      // Part of it was changed: the anchor now spans the kept text and the insert.
      const nextFrom = Math.min(from, edit.from), nextTo = edit.to >= to ? edit.from + edit.insert.length : to + delta;
      from = nextFrom; to = Math.max(nextFrom, nextTo);
      if (status === 'current') { status = 'edited'; by = entry.author; }
    }
  }
  if (to > buffer.content.length) return unknown;
  return { status, from, to, ...(by ? { by } : {}), ...(before !== undefined ? { before } : {}) };
}

// Markdown ATX headings. Text before the first heading is an untitled section.
export function sections(content: string): Section[] {
  const out: Section[] = [];
  const pattern = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/gm;
  for (let m; (m = pattern.exec(content));) out.push({ title: m[2]!.trim(), level: m[1]!.length, from: m.index, to: content.length });
  for (let i = 0; i < out.length - 1; i++) out[i]!.to = out[i + 1]!.from;
  if (!out.length || out[0]!.from > 0 && content.slice(0, out[0]!.from).trim()) out.unshift({ title: '', level: 0, from: 0, to: out[0]?.from ?? content.length });
  return out;
}
export function sectionAt(list: Section[], at: number) { return list.findLast(s => s.from <= at) ?? list[0]; }

// Paragraphs are runs of non-blank lines; heading lines are not paragraphs.
export function paragraphs(content: string, span: Span = { from: 0, to: content.length }): Span[] {
  const out: Span[] = [];
  let open: Span | null = null;
  for (let start = span.from; start < span.to;) {
    const newline = content.indexOf('\n', start), end = newline < 0 || newline > span.to ? span.to : newline;
    const line = content.slice(start, end);
    if (!line.trim() || /^#{1,6}[ \t]/.test(line)) open = null;
    else if (open) open.to = end;
    else out.push(open = { from: start, to: end });
    start = end + 1;
  }
  return out;
}

export function where(content: string, at: number) {
  const list = sections(content), section = sectionAt(list, at)!;
  const inSection = paragraphs(content, section);
  const index = inSection.findIndex(p => at >= p.from && at <= p.to);
  return { section, sections: list, paragraphs: inSection, paragraph: index < 0 ? Math.max(0, inSection.findLastIndex(p => p.from <= at)) : index };
}

// Text the Agent wrote that is still in the buffer, from active edit groups only.
export function agentSpans(buffer: Buffer) {
  const live = new Set(groups(buffer).filter(g => g.active && g.author.startsWith('agent:')).flatMap(g => g.changeIds));
  return currentRanges(buffer.history ?? [], e => e.kind === 'edit' && live.has(e.changeId));
}
export function touches(spans: Span[], span: Span) { return spans.some(r => r.from < span.to && r.to > span.from); }

// Active edit groups with the place their text now occupies.
export function placedGroups(buffer: Buffer): (Group & { spans: Span[] })[] {
  const history: HistoryEntry[] = buffer.history ?? [];
  return groups(buffer).filter(g => g.kind === 'edit').map(g => ({ ...g, spans: currentRanges(history, e => g.changeIds.includes(e.changeId)) }));
}
export function marksBySection(buffer: Buffer, me?: string) {
  const list = sections(buffer.content), placed = placedGroups(buffer).filter(g => g.active);
  return list.map(section => ({ section, agent: placed.filter(g => g.author.startsWith('agent:') && touches(g.spans, section)).length, mine: placed.filter(g => !!me && g.author === me && touches(g.spans, section)).length }));
}

export function quote(text: string, chars = documentCardLimits.quoteChars) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return [...flat].length > chars ? [...flat].slice(0, chars).join('') + '…' : flat;
}
export const sectionName = (section: Section | undefined) => section?.title || 'Opening';
export const count = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// What a form leaves out, counted from the whole document.
export function hiddenNote(form: string, show: string, facts: { paragraphsInSection?: number; shownParagraphs?: number; sections: number; shownSections?: number; olderChanges?: number }) {
  if (form === 'card' && show === 'change') return 'Not shown: the text around this change';
  if (form === 'compare') return 'Not shown: changes outside this one';
  const parts: string[] = [];
  if (form === 'card' && show === 'outline') {
    const more = facts.sections - (facts.shownSections ?? facts.sections);
    return 'Not shown: all text' + (more > 0 ? ' · ' + count(more, 'more section') : '');
  }
  const rest = (facts.paragraphsInSection ?? 0) - (facts.shownParagraphs ?? 0), others = facts.sections - 1;
  if (rest > 0) parts.push(count(rest, 'more paragraph') + ' in this section');
  if (others > 0) parts.push(count(others, 'other section'));
  if (facts.olderChanges) parts.push(count(facts.olderChanges, 'earlier change'));
  return parts.length ? 'Not shown: ' + parts.join(' · ') : '';
}

// Which card the Agent meant when it did not say: an anchor is a passage, a
// named change is that change, otherwise the document's outline.
export const documentShows = ['passage', 'change', 'outline'] as const;
export function showOf(params: Record<string, unknown>) {
  if (typeof params.show === 'string' && (documentShows as readonly string[]).includes(params.show)) return params.show as typeof documentShows[number];
  return readAnchor(params.anchor) ? 'passage' : typeof params.group === 'string' ? 'change' : 'outline';
}
// A change named by its group or by one of its change ids.
export function findGroup(buffer: Buffer, id: unknown) {
  if (typeof id !== 'string') return undefined;
  const list = groups(buffer);
  return list.find(g => g.changeIds.includes(id)) ?? list.findLast(g => g.groupId === id);
}
// Where the item points: its anchor when still known, else the named section.
export function focusOf(buffer: Buffer, params: Record<string, unknown>) {
  const anchor = readAnchor(params.anchor), placed = anchor ? placeAnchor(buffer, anchor) : null;
  const list = sections(buffer.content);
  if (placed && placed.status !== 'unknown') return { placed, at: placed.from, sections: list };
  const named = typeof params.section === 'string' ? list.find(s => s.title === params.section) : undefined;
  return { placed, at: named?.from ?? 0, sections: list };
}
