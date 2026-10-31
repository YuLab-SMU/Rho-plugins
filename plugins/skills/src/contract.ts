import { objectSchema as obj, text, version } from '@rho-workspace/plugin-contracts';

// A project skill is one SKILL.md in the project's .claude/skills/<name>/ folder, the form Agents
// load skills from: a name, a one-line description of when it applies, and its text. Its version
// is the digest of the file's bytes. Each change Rho makes to one is kept with who made it, why,
// from what, and the versions before and after, so it can be read back and undone. Changes made
// to the file elsewhere are seen, not attributed: they read as changed outside Rho.
export const skillName = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' };
export const changeId = { type: 'string', pattern: '^[A-Za-z0-9._:@-]{1,128}$' };
export const changeRef = { type: 'string', pattern: '^sc-[a-f0-9]{16}$' };
const time = { type: 'string', minLength: 1 };
const count = { type: 'integer', minimum: 0 };
const maybe = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

// What a change came from: a Notebook cell, a conversation, a file in the project, an annotation,
// a place on a server, or a short note. A reference is kept as given; it grants nothing.
export const evidenceKinds = ['cell', 'conversation', 'file', 'annotation', 'place', 'note'] as const;
export const evidenceSchema = obj({ kind: { enum: [...evidenceKinds] }, ref: { type: 'string', minLength: 1, maxLength: 256 }, label: { type: 'string', maxLength: 200 } }, ['kind', 'ref']);
// recorded: written through Rho; removed: the skill taken away; undone: a change put back;
// outside: the file was found changed by something other than Rho (an editor, Git, an Agent's own
// file tools) and is kept as it was found.
export const changeKinds = ['recorded', 'removed', 'undone', 'outside'] as const;
export const changeSummarySchema = obj({
  id: changeRef, changeId: maybe(changeId), skill: skillName, kind: { enum: [...changeKinds] }, by: text, at: time,
  reason: { type: 'string' }, evidence: { type: 'array', items: evidenceSchema },
  before: maybe(version), after: maybe(version), undoes: maybe(changeRef), undoneBy: maybe(changeRef),
  added: count, removed: count,
});
// The lines a change added and removed, with two lines of context; a longer unchanged run is one
// line holding how many lines it folds. Past the limit the rest is left out and cut is set.
export const diffLineSchema = obj({ op: { enum: [' ', '+', '-', '…'] }, text: { type: 'string' } });
export const diffSchema = obj({ lines: { type: 'array', items: diffLineSchema }, cut: { type: 'boolean' } });
export const changeSchema = obj({ ...changeSummarySchema.properties, diff: diffSchema });
export const skillSummarySchema = obj({
  name: skillName, description: { type: 'string' }, version: maybe(version), bytes: count, modifiedAt: maybe(time),
  // Changes kept for it, its newest change, and whether the file differs from the newest version Rho recorded.
  changes: count, last: maybe(changeSummarySchema), outside: { type: 'boolean' },
  problem: maybe({ type: 'string' }),
});
export const skillSchema = obj({ name: skillName, description: { type: 'string' }, body: { type: 'string' }, version, bytes: count, modifiedAt: time });
export const limitsSchema = obj({ maxSkills: count, maxSkillBytes: count });
export const outsideSchema = obj({ since: maybe(version), added: count, removed: count, diff: diffSchema });
export { text, version };
