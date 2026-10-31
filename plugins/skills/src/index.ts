import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicBytes, atomicJson, confined, digest, now, readJson, requireThat, stateDirectory } from '@rho-workspace/plugin-contracts';
import { operationContracts } from './operations.js';
import { operationPresentation, presentation } from './presentation.js';
import type { changeKinds, evidenceKinds } from './contract.js';

export type ChangeKind = typeof changeKinds[number];
export interface Evidence { kind: typeof evidenceKinds[number]; ref: string; label?: string }
export interface ChangeRecord {
  id: string; changeId: string | null; skill: string; kind: ChangeKind; by: string; at: string;
  reason: string; evidence: Evidence[]; before: string | null; after: string | null;
  undoes: string | null; undoneBy: string | null; added: number; removed: number;
  // What the caller asked for, so a repeated changeId can be told from a different request.
  request: string | null;
}
export interface DiffLine { op: ' ' | '+' | '-' | '…'; text: string }
export interface Diff { lines: DiffLine[]; cut: boolean }
export interface Skill { name: string; description: string; body: string; version: string; bytes: number; modifiedAt: string }

// The protected resources are the Agent's context and the project's state folder. A project
// holds at most maxSkills skills and each SKILL.md at most maxSkillBytes, since every Agent here
// reads them: a change past either is refused and the skill stays as it was. At most maxChanges
// changes are kept; the oldest go first and are counted. A read returns readChanges changes (50
// at most) and a difference of at most maxDiffLines lines, the rest counted as cut.
export const skillsLimits = { maxSkills: 24, maxSkillBytes: 32 * 1024, maxChanges: 1000, readChanges: 20, maxDiffLines: 400 };
export type SkillsLimits = typeof skillsLimits;
// Where Agents load a project's skills from (Claude Code reads this folder by itself).
export const skillsFolder = '.claude/skills';
const namePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const id = () => 'sc-' + randomBytes(8).toString('hex');

// The frontmatter's name and description, as a skill file states them. A description may be one
// line or a folded or literal block (description: > and indented lines).
export function parseSkill(content: string): { name: string | null; description: string | null; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return { name: null, description: null, body: content };
  const fields = new Map<string, string>(), lines = match[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]!);
    if (!field) continue;
    let value = field[2]!.trim();
    if (/^[>|][-+]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]!) || lines[i + 1] === '')) block.push(lines[++i]!.trim());
      value = value.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim();
    } else if (/^".*"$/.test(value)) { try { value = JSON.parse(value); } catch { /* kept as written */ } }
    else if (/^'.*'$/.test(value)) value = value.slice(1, -1).replace(/''/g, "'");
    fields.set(field[1]!, value);
  }
  return { name: fields.get('name') ?? null, description: fields.get('description') ?? null, body: content.slice(match[0].length).replace(/^\r?\n/, '') };
}
// A skill file as Agents read it; the description is a double-quoted YAML string, so any text is safe.
export const composeSkill = (name: string, description: string, body: string) => `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trim()}\n`;

// Lines added and removed between two texts (a longest common subsequence of lines), with two
// lines of context around each change. Texts too long to compare line by line read as replaced.
export function lineDiff(before: string | null, after: string | null, maxLines: number): Diff & { added: number; removed: number } {
  const a = before === null ? [] : before.replace(/\n$/, '').split('\n'), b = after === null ? [] : after.replace(/\n$/, '').split('\n');
  const ops: DiffLine[] = [];
  if (a.length * b.length > 4_000_000) { for (const t of a) ops.push({ op: '-', text: t }); for (const t of b) ops.push({ op: '+', text: t }); }
  else {
    const n = a.length, m = b.length, table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { ops.push({ op: ' ', text: a[i]! }); i++; j++; }
      else if (j < m && (i === n || table[i]![j + 1]! >= table[i + 1]![j]!)) ops.push({ op: '+', text: b[j++]! });
      else ops.push({ op: '-', text: a[i++]! });
    }
  }
  const added = ops.filter(o => o.op === '+').length, removed = ops.filter(o => o.op === '-').length;
  // Context: kept lines within two of a change stay; a longer kept run becomes one folded line.
  const near = ops.map((o, k) => o.op !== ' ' || ops.slice(Math.max(0, k - 2), k + 3).some(x => x.op !== ' '));
  const lines: DiffLine[] = [];
  for (let k = 0; k < ops.length;) {
    if (near[k]) { lines.push(ops[k]!); k++; continue; }
    let run = 0; while (k < ops.length && !near[k]) { run++; k++; }
    lines.push({ op: '…', text: String(run) });
  }
  return { lines: lines.slice(0, maxLines), cut: lines.length > maxLines, added, removed };
}

// The skills of one project: SKILL.md files under .claude/skills, each change written through
// here kept with its author, reason, evidence and the versions before and after (stored by digest
// in the project's state folder). Writes are serial; reads never write.
export class SkillsHost {
  private writing: Promise<unknown> = Promise.resolve();
  constructor(private root: string, private options: { limits?: Partial<SkillsLimits>; onChange?: () => void } = {}) {}
  private get limits(): SkillsLimits { return { ...skillsLimits, ...this.options.limits }; }
  private async state() { return stateDirectory(this.root, '.rho/plugins/skills'); }
  private async journal(): Promise<{ changes: ChangeRecord[]; dropped: number }> { return readJson(path.join(await this.state(), 'changes.json'), { changes: [], dropped: 0 }); }
  private async keep(content: string) {
    const folder = path.join(await this.state(), 'versions'), version = digest(content), file = path.join(folder, version);
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    try { await fs.access(file); } catch { await atomicBytes(file, content); }
    return version;
  }
  private async kept(version: string | null) {
    if (version === null) return null;
    try { return await fs.readFile(path.join(await this.state(), 'versions', version), 'utf8'); } catch { return null; }
  }
  // The skill's file as it is now, or null when it is not there. Links are refused: a skill is
  // read and written only inside the project.
  private async file(name: string, allowMissing = true) {
    requireThat(namePattern.test(name), 'invalid', 'A skill name is lowercase letters, digits and hyphens, at most 64.');
    return confined(this.root, `${skillsFolder}/${name}/SKILL.md`, allowMissing);
  }
  private async current(name: string): Promise<{ content: string; version: string; modifiedAt: string } | null> {
    const file = await this.file(name);
    try {
      const [content, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
      return { content, version: digest(content), modifiedAt: stat.mtime.toISOString() };
    } catch (e: any) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; }
  }
  private skill(name: string, now: { content: string; version: string; modifiedAt: string }): Skill {
    const parsed = parseSkill(now.content);
    return { name, description: parsed.description ?? '', body: parsed.body, version: now.version, bytes: Buffer.byteLength(now.content), modifiedAt: now.modifiedAt };
  }
  private summary = ({ request, ...change }: ChangeRecord) => change;
  private async withDiff(change: ChangeRecord) {
    const diff = lineDiff(await this.kept(change.before), await this.kept(change.after), this.limits.maxDiffLines);
    return { ...this.summary(change), diff: { lines: diff.lines, cut: diff.cut } };
  }

  async list() {
    const { changes } = await this.journal(), limits = this.limits;
    const names = new Set<string>();
    let folder: string | null = null;
    try { folder = await confined(this.root, skillsFolder); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    if (folder) for (const entry of await fs.readdir(folder, { withFileTypes: true })) if (entry.isDirectory() && namePattern.test(entry.name)) names.add(entry.name);
    const of = (name: string) => changes.filter(c => c.skill === name);
    type Summary = { name: string; description: string; version: string | null; bytes: number; modifiedAt: string | null; changes: number; last: Omit<ChangeRecord, 'request'> | null; outside: boolean; problem: string | null };
    const skills: Summary[] = [], removed: Summary[] = [];
    for (const name of [...names].sort()) {
      const mine = of(name), last = mine.at(-1) ?? null;
      let present: Awaited<ReturnType<SkillsHost['current']>> = null, problem: string | null = null;
      try { present = await this.current(name); } catch (e: any) { problem = e?.message ?? 'Its file could not be read.'; }
      if (!present && !problem) continue;
      const parsed = present ? parseSkill(present.content) : null;
      if (parsed && (parsed.name !== name || !parsed.description)) problem = parsed.name !== name ? `Its frontmatter names it ${parsed.name ?? 'nothing'}; Agents may not load it as ${name}.` : 'It has no description, so Agents cannot tell when it applies.';
      skills.push({ name, description: parsed?.description ?? '', version: present?.version ?? null, bytes: present ? Buffer.byteLength(present.content) : 0, modifiedAt: present?.modifiedAt ?? null,
        changes: mine.length, last: last && this.summary(last), outside: !!present && present.version !== (last?.after ?? null), problem });
    }
    for (const name of [...new Set(changes.map(c => c.skill))].filter(n => !skills.some(s => s.name === n)).sort()) {
      const mine = of(name), last = mine.at(-1)!;
      removed.push({ name, description: parseSkill((await this.kept(mine.findLast(c => c.after)?.after ?? null)) ?? '').description ?? '', version: null, bytes: 0, modifiedAt: null, changes: mine.length, last: this.summary(last), outside: false, problem: null });
    }
    return { folder: skillsFolder, skills, removed, limits: { maxSkills: limits.maxSkills, maxSkillBytes: limits.maxSkillBytes } };
  }

  async read(name: string, limit?: number) {
    const { changes } = await this.journal(), present = await this.current(name);
    const mine = changes.filter(c => c.skill === name).reverse(), shown = mine.slice(0, Math.min(limit ?? this.limits.readChanges, 50));
    requireThat(present || mine.length, 'not_found', `There is no skill named ${name} in this project.`);
    const last = mine[0] ?? null;
    let outside = null;
    if (present && present.version !== (last?.after ?? null)) {
      const diff = lineDiff(await this.kept(last?.after ?? null), present.content, this.limits.maxDiffLines);
      outside = { since: last?.after ?? null, added: diff.added, removed: diff.removed, diff: { lines: diff.lines, cut: diff.cut } };
    }
    return { skill: present && this.skill(name, present), changes: await Promise.all(shown.map(c => this.withDiff(c))), omitted: mine.length - shown.length, outside };
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writing.then(work, work);
    this.writing = next.catch(() => {});
    return next;
  }
  private async record(journal: { changes: ChangeRecord[]; dropped: number }, change: Omit<ChangeRecord, 'id' | 'at' | 'added' | 'removed' | 'undoneBy'>, before: string | null, after: string | null) {
    const diff = lineDiff(before, after, 0);
    const record: ChangeRecord = { ...change, id: id(), at: now(), added: diff.added, removed: diff.removed, undoneBy: null };
    journal.changes.push(record);
    const over = journal.changes.length - this.limits.maxChanges;
    if (over > 0) { journal.changes.splice(0, over); journal.dropped += over; }
    return record;
  }
  // A file found changed since the newest recorded version is kept as found before anything is
  // written over it, so its history has no gap and nothing it held is lost.
  private async noticeOutside(journal: { changes: ChangeRecord[]; dropped: number }, name: string, present: { content: string; version: string } | null) {
    const last = journal.changes.filter(c => c.skill === name).at(-1) ?? null;
    if ((present?.version ?? null) === (last?.after ?? null)) return;
    if (present) await this.keep(present.content);
    await this.record(journal, { changeId: null, skill: name, kind: 'outside', by: 'outside', reason: present ? 'Changed outside Rho' : 'Removed outside Rho', evidence: [], before: last?.after ?? null, after: present?.version ?? null, undoes: null, request: null },
      await this.kept(last?.after ?? null), present?.content ?? null);
  }
  private async write(name: string, content: string | null) {
    const file = await this.file(name);
    if (content === null) {
      await fs.rm(file, { force: true });
      await fs.rmdir(path.dirname(file)).catch(() => {});
      return;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Checked again once the folders exist, so a link among them is refused before anything is written.
    await confined(this.root, `${skillsFolder}/${name}`);
    await atomicBytes(file, content);
  }

  async change(input: { name: string; description?: string; body?: string; remove?: boolean; reason: string; evidence?: Evidence[]; expectedVersion: string | null; changeId: string }, by: string) {
    return this.serial(async () => {
      const journal = await this.journal(), limits = this.limits;
      const request = digest(JSON.stringify([input.name, input.description ?? null, input.body ?? null, !!input.remove, input.reason, input.evidence ?? [], input.expectedVersion]));
      const known = journal.changes.find(c => c.changeId === input.changeId && c.by === by);
      if (known) {
        requireThat(known.request === request, 'conflict', 'This changeId already names a different change.');
        const present = await this.current(input.name);
        return { skill: present && this.skill(input.name, present), change: await this.withDiff(known) };
      }
      requireThat(input.remove ? input.body === undefined : input.body !== undefined, 'invalid', 'Give the skill\'s text, or remove: true without one.');
      const present = await this.current(input.name);
      requireThat((present?.version ?? null) === input.expectedVersion, 'conflict', present ? 'The skill changed since that version. Read it again and make the change on its current version.' : 'There is no such skill now. Create it with expectedVersion null.', { current: present?.version ?? null });
      let next: string | null = null;
      if (!input.remove) {
        const description = input.description ?? (present && parseSkill(present.content).description);
        requireThat(description, 'invalid', 'A new skill needs a description: one line saying when it applies.');
        next = composeSkill(input.name, description, input.body!);
        const bytes = Buffer.byteLength(next);
        requireThat(bytes <= limits.maxSkillBytes, 'limit', `The skill would be ${bytes} bytes; a project skill holds at most ${limits.maxSkillBytes}, since every Agent here reads it. Shorten it: merge entries, drop those that no longer apply, or move details into a file the skill names.`, { limit: 'maxSkillBytes', maximum: limits.maxSkillBytes, bytes });
        requireThat(next !== present?.content, 'invalid', 'That is the skill as it is; nothing would change.');
        if (!present) requireThat((await this.list()).skills.length < limits.maxSkills, 'limit', `This project has ${limits.maxSkills} skills, the most it holds. Merge two, or remove one that no longer applies.`, { limit: 'maxSkills', maximum: limits.maxSkills });
      } else requireThat(present, 'not_found', `There is no skill named ${input.name} to remove.`);
      await this.noticeOutside(journal, input.name, present);
      if (next !== null) await this.keep(next);
      await this.write(input.name, next);
      const record = await this.record(journal, { changeId: input.changeId, skill: input.name, kind: input.remove ? 'removed' : 'recorded', by, reason: input.reason.trim(), evidence: input.evidence ?? [], before: present?.version ?? null, after: next === null ? null : digest(next), undoes: null, request }, present?.content ?? null, next);
      await atomicJson(path.join(await this.state(), 'changes.json'), journal);
      this.options.onChange?.();
      const after = await this.current(input.name);
      return { skill: after && this.skill(input.name, after), change: await this.withDiff(record) };
    });
  }

  async undo(input: { name: string; change: string; changeId: string }, by: string) {
    return this.serial(async () => {
      const journal = await this.journal(), request = digest(JSON.stringify(['undo', input.name, input.change]));
      const known = journal.changes.find(c => c.changeId === input.changeId && c.by === by);
      if (known) {
        requireThat(known.request === request, 'conflict', 'This changeId already names a different change.');
        const present = await this.current(input.name);
        return { skill: present && this.skill(input.name, present), change: await this.withDiff(known) };
      }
      const mine = journal.changes.filter(c => c.skill === input.name), target = mine.find(c => c.id === input.change);
      requireThat(target, 'not_found', 'That change is not one of this skill\'s kept changes.');
      requireThat(target.kind !== 'outside', 'invalid', 'A change made outside Rho is undone where it was made, or by recording the text you want.');
      requireThat(!target.undoneBy, 'conflict', 'That change was already undone.');
      requireThat(mine.at(-1)!.id === target.id, 'conflict', 'This skill has changed since. Undo its newest change first.');
      const present = await this.current(input.name);
      requireThat((present?.version ?? null) === target.after, 'conflict', 'The skill was changed outside Rho since. It stays as it is; record the text you want, or undo where it was changed.', { current: present?.version ?? null });
      const restored = await this.kept(target.before);
      requireThat(target.before === null || restored !== null, 'unavailable', 'The version before that change is no longer kept, so it cannot be put back.');
      await this.write(input.name, restored);
      const record = await this.record(journal, { changeId: input.changeId, skill: input.name, kind: 'undone', by, reason: target.reason, evidence: target.evidence, before: target.after, after: target.before, undoes: target.id, request }, present?.content ?? null, restored);
      target.undoneBy = record.id;
      await atomicJson(path.join(await this.state(), 'changes.json'), journal);
      this.options.onChange?.();
      const after = await this.current(input.name);
      return { skill: after && this.skill(input.name, after), change: await this.withDiff(record) };
    });
  }

  async close() { await this.writing.catch(() => {}); }
}

const content = [
  'Project skills are how work is done in this project: the methods the person chose, the conventions they keep and the traps its work ran into.',
  'Each is a SKILL.md in the project\'s .claude/skills folder, read by the person and by every Agent here, in this conversation and later ones.',
  '- Before you analyse, list the project\'s skills (skills.list) and read those whose description fits the task (skills.read). Follow them over your general practice, and say in your answer which you followed.',
  '- Record in a project skill (skills.change) when the person corrects a method choice or says how they work, when you find the cause of a failure and the fix that works, or when you make a choice that changes results and the person accepts it.',
  '- Record how to work, never results: no answers, values or data. Write each entry so it can be followed: what to do and when, in a line or two, with why if it is not obvious.',
  '- Record a rule the person states in their terms and with their scope. Do not widen it, and do not fold another rule into its examples: an example that applies two rules at once becomes a third rule nobody stated.',
  '- Keep one skill per method area, named for it, with a description saying when it applies. Keep it short: merge entries and drop those that no longer apply.',
  '- Give each change a one-sentence reason and its evidence: the cell it came from (kind cell, its cellId), a file (kind file, its project path), or what the person said in their words (kind note). Use kind conversation only with the id of a Rho conversation.',
  '- Read the skill first and pass its version as expectedVersion; a conflict means it changed, so read it again. A refused size means shorten it.',
  '- A skill guides; it grants nothing and never widens what you may read, write or run. The person sees every change with who made it and why, and can undo it.',
].join('\n');
export const plugin = { entryVersion: '1.0' as const, id: 'skills', package: '@rho-workspace/plugin-skills', version: '0.1.0', requires: [] as string[], capabilities: ['skills'], presentation,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })),
  skills: [{ id: 'skills.project', version: '1.0', content, digest: digest(content), presentation: { displayName: 'Project skills', description: 'How to read the project\'s skills before working and record what the person decides and what the work teaches.' },
    intent: 'Follow how this project is done, and keep it as the person decides and the work teaches.', requires: ['skills.list', 'skills.read', 'skills.change'],
    example: { method: 'skills.list', input: {} },
    failureRecipes: [
      { kind: 'conflict', message: 'The skill changed since that version.', next: 'Read it again with skills.read and make the change on its current version.' },
      { kind: 'limit', message: 'The skill would be larger than a project skill holds.', next: 'Shorten it: merge entries and drop those that no longer apply, then change it again.' },
    ],
    verify: { command: 'npm run test:skills', description: 'Creates, changes, undoes and removes project skills, sees a change made outside Rho, and keeps each change\'s author, reason and evidence.' } }],
};
