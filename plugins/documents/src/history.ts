import { digest, requireThat } from '@rho-workspace/plugin-contracts';

export interface Delta { from: number; to: number; insert: string; removed: string }
export interface EditRecord {
  changeId: string; requestDigest: string; author: string; kind: 'edit' | 'undo' | 'undo-own' | 'revert';
  undoGroup: string; groupId: string; version: number; revision: number; at: string;
  beforeDigest: string; afterDigest: string; edits: Delta[]; reverts: string[];
}
export const boundary = (text: string, at: number) => !(at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]!) && /[\uDC00-\uDFFF]/.test(text[at]!));

export function apply(text: string, edits: Delta[]) {
  let end = -1, previous = -1;
  for (const edit of edits) {
    requireThat(Number.isSafeInteger(edit.from) && Number.isSafeInteger(edit.to) && edit.from >= 0 && edit.to >= edit.from && edit.to <= text.length && edit.from >= end && edit.from !== previous && boundary(text, edit.from) && boundary(text, edit.to) && text.slice(edit.from, edit.to) === edit.removed, 'conflict', 'The recorded edit no longer matches this text.');
    end = edit.to; previous = edit.from;
  }
  for (const edit of [...edits].reverse()) text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  return text;
}
export function inverse(edits: Delta[]): Delta[] {
  let shift = 0;
  return compact(edits.map(edit => {
    const from = edit.from + shift;
    shift += edit.insert.length - (edit.to - edit.from);
    return { from, to: from + edit.insert.length, insert: edit.removed, removed: edit.insert };
  }));
}
function compact(edits: Delta[]) {
  const result: Delta[] = [];
  for (const edit of edits) {
    const prior = result.at(-1);
    if (prior?.from === edit.from) { prior.to = edit.to; prior.insert += edit.insert; prior.removed += edit.removed; }
    else result.push({ ...edit });
  }
  return result;
}
export function snapshot(content: string, history: EditRecord[], index: number, maxBytes = Infinity) {
  const check = (text: string) => {
    requireThat(Buffer.byteLength(text) <= maxBytes, 'limit', 'Historical document text exceeds the buffer byte limit.', { limit: 'maxBufferBytes', maximum: maxBytes });
    requireThat(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text), 'invalid', 'Historical document text contains an unpaired surrogate.');
  };
  check(content);
  for (let i = history.length - 1; i > index; i--) {
    const entry = history[i]!;
    requireThat(digest(content) === entry.afterDigest, 'condition', 'Retained document history does not match the buffer.');
    content = apply(content, inverse(entry.edits));
    check(content);
    requireThat(digest(content) === entry.beforeDigest, 'condition', 'Retained document history has an invalid before digest.');
  }
  return content;
}
export function validateHistory(content: string, version: number, revision: number, history: EditRecord[], maxBytes: number) {
  const id = (s: unknown) => typeof s === 'string' && /^[A-Za-z0-9._:@-]{1,128}$/.test(s);
  const ids = new Set<string>();
  for (let i = 0; i < history.length; i++) {
    const e = history[i]!;
    requireThat(id(e.changeId) && !ids.has(e.changeId) && id(e.groupId) && typeof e.author === 'string' && e.author.length > 0 && typeof e.undoGroup === 'string' && e.undoGroup.length > 0 && typeof e.at === 'string' && /^[a-f0-9]{64}$/.test(e.requestDigest) && ['edit', 'undo', 'undo-own', 'revert'].includes(e.kind) && Number.isSafeInteger(e.version) && e.version > 1 && (i === 0 || e.version === history[i - 1]!.version + 1) && Number.isSafeInteger(e.revision) && e.revision > 0 && e.revision <= revision && (i === 0 || e.revision > history[i - 1]!.revision) && Array.isArray(e.edits) && Array.isArray(e.reverts) && e.reverts.every(id) && new Set(e.reverts).size === e.reverts.length && !e.reverts.includes(e.changeId) && !e.reverts.some(target => history.slice(i + 1).some(later => later.changeId === target)), 'invalid', 'Invalid retained document change history.');
    ids.add(e.changeId);
  }
  requireThat(!history.length || history.at(-1)!.version === version, 'invalid', 'History does not end at the current buffer version.');
  // Reconstructing the oldest before text verifies every retained delta/digest.
  snapshot(content, history, -1, maxBytes);
}

// Status is derived from explicit compensating mutations, including a legacy
// global undo of a compensation. Labels never determine author identity.
export function statuses(history: EditRecord[]) {
  const state = new Map<string, string | null>(history.map(e => [e.changeId, null]));
  for (const entry of [...history].reverse()) {
    if (state.get(entry.changeId) !== null) continue;
    for (const id of entry.reverts) if (state.has(id)) state.set(id, state.get(id) === null ? entry.changeId : null);
  }
  return state;
}
export function summarize(history: EditRecord[]) {
  const state = statuses(history);
  return history.map(({ edits, ...entry }) => ({ ...entry, revertedBy: state.get(entry.changeId) ?? null }));
}
function minimize(edit: Delta): Delta {
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(edit.removed.length, edit.insert.length) && edit.removed[prefix] === edit.insert[prefix]) prefix++;
  while (!boundary(edit.removed, prefix) || !boundary(edit.insert, prefix)) prefix--;
  while (suffix < Math.min(edit.removed.length, edit.insert.length) - prefix && edit.removed[edit.removed.length - suffix - 1] === edit.insert[edit.insert.length - suffix - 1]) suffix++;
  while (!boundary(edit.removed, edit.removed.length - suffix) || !boundary(edit.insert, edit.insert.length - suffix)) suffix--;
  return { from: edit.from + prefix, to: edit.to - suffix, removed: edit.removed.slice(prefix, edit.removed.length - suffix), insert: edit.insert.slice(prefix, edit.insert.length - suffix) };
}

// Compose a contiguous input group with transient source pieces. This is only
// owner-side undo calculation, not a second buffer or a collaboration engine.
export function compose(before: string, entries: EditRecord[]): Delta[] {
  const pieces: { text: string; origin: number | null }[] = before ? [{ text: before, origin: 0 }] : [];
  const split = (at: number) => {
    let offset = 0;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]!;
      if (at === offset) return i;
      if (at < offset + p.text.length) {
        const n = at - offset;
        pieces.splice(i, 1, { text: p.text.slice(0, n), origin: p.origin }, { text: p.text.slice(n), origin: p.origin === null ? null : p.origin + n });
        return i + 1;
      }
      offset += p.text.length;
    }
    requireThat(at === offset, 'condition', 'Undo group ranges do not match retained history.');
    return pieces.length;
  };
  for (const entry of entries) for (const edit of [...entry.edits].reverse()) {
    const first = split(edit.from), last = split(edit.to);
    pieces.splice(first, last - first, ...(edit.insert ? [{ text: edit.insert, origin: null }] : []));
  }
  const edits: Delta[] = [];
  let offset = 0, insert = '';
  const flush = (to: number) => {
    if (to !== offset || insert) edits.push({ from: offset, to, insert, removed: before.slice(offset, to) });
    insert = ''; offset = to;
  };
  for (const piece of pieces) {
    if (piece.origin === null) insert += piece.text;
    else { flush(piece.origin); offset += piece.text.length; }
  }
  flush(before.length);
  return edits.map(minimize).filter(e => e.insert !== e.removed);
}

export function transport(edits: Delta[], later: EditRecord[]): Delta[] {
  return compact(edits.map(edit => {
    let from = edit.from, to = edit.to;
    for (const entry of later) {
      let shift = 0;
      for (const e of entry.edits) {
        if (from === to && e.from === from && e.to === from) requireThat(false, 'conflict', 'A later insertion occupies the same undo boundary.');
        if (e.to <= from) shift += e.insert.length - (e.to - e.from);
        else if (e.from >= to) continue;
        else requireThat(false, 'conflict', 'Later edits overlap the requested change; the current buffer is retained.', { laterChangeId: entry.changeId });
      }
      from += shift; to += shift;
    }
    return { ...edit, from, to };
  }));
}
