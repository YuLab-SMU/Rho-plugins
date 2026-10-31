import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { SkillsHost, parseSkill, skillsLimits, plugin } from '@rho-workspace/plugin-skills';

async function project() { return fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'rho-skills-'))); }
const file = (root, name) => path.join(root, '.claude', 'skills', name, 'SKILL.md');
const agent = 'agent:a', person = 'browser:local';

test('a project skill is written as Agents load it, with each change\'s author, reason and evidence', async t => {
  const root = await project(), changed = [];
  const host = new SkillsHost(root, { onChange: () => changed.push(1) });
  t.after(() => host.close());
  assert.deepEqual((await host.list()).skills, []);

  const made = await host.change({ name: 'coculture-fits', description: 'Use when fitting swarming area against the mix frequency of a co-culture.', body: '# Co-culture fits\n\n- Fit the co-culture mixes only; strains grown alone are controls.\n', reason: 'The person said the mono-cultures are not points on the series.', evidence: [{ kind: 'cell', ref: 'k-0123456789abcdef', label: 'Frequency fits' }], expectedVersion: null, changeId: 'c1' }, agent);
  const text = await fs.readFile(file(root, 'coculture-fits'), 'utf8');
  assert.match(text, /^---\nname: coculture-fits\ndescription: "Use when fitting swarming area/);
  assert.deepEqual(parseSkill(text).description, 'Use when fitting swarming area against the mix frequency of a co-culture.');
  assert.equal(made.skill.version, made.change.after);
  assert.equal(made.change.kind, 'recorded'); assert.equal(made.change.by, agent); assert.equal(made.change.before, null);
  assert.ok(made.change.diff.lines.some(l => l.op === '+' && l.text.includes('co-culture mixes only')));
  assert.equal(changed.length, 1);

  // The same changeId returns the same change and writes nothing again; another request under it is refused.
  const again = await host.change({ name: 'coculture-fits', description: 'Use when fitting swarming area against the mix frequency of a co-culture.', body: '# Co-culture fits\n\n- Fit the co-culture mixes only; strains grown alone are controls.\n', reason: 'The person said the mono-cultures are not points on the series.', evidence: [{ kind: 'cell', ref: 'k-0123456789abcdef', label: 'Frequency fits' }], expectedVersion: null, changeId: 'c1' }, agent);
  assert.equal(again.change.id, made.change.id); assert.equal(changed.length, 1);
  await assert.rejects(host.change({ name: 'coculture-fits', body: 'other', reason: 'r', expectedVersion: null, changeId: 'c1' }, agent), { kind: 'conflict' });

  // A change is made on the version read; a stale one is refused and the file stays.
  await assert.rejects(host.change({ name: 'coculture-fits', body: 'x', reason: 'r', expectedVersion: null, changeId: 'c2' }, agent), { kind: 'conflict' });
  const second = await host.change({ name: 'coculture-fits', body: '# Co-culture fits\n\n- Fit the co-culture mixes only; strains grown alone are controls.\n- Give a mix as the fraction of ΔrhlI, not a ratio.\n', reason: 'The person reads mixes as fractions.', expectedVersion: made.skill.version, changeId: 'c2' }, agent);
  assert.equal(second.skill.description, made.skill.description, 'the description stays when it is not given');
  assert.deepEqual([second.change.added, second.change.removed], [1, 0]);

  const read = await host.read('coculture-fits');
  assert.deepEqual(read.changes.map(c => c.id), [second.change.id, made.change.id]);
  assert.deepEqual(read.changes[1].evidence, [{ kind: 'cell', ref: 'k-0123456789abcdef', label: 'Frequency fits' }]);
  assert.equal(read.outside, null);
  const listed = (await host.list()).skills[0];
  assert.deepEqual([listed.name, listed.changes, listed.last.id, listed.outside, listed.problem], ['coculture-fits', 2, second.change.id, false, null]);
});

test('a change made outside Rho is seen, kept before the next change, and not undone from here', async t => {
  const root = await project(), host = new SkillsHost(root);
  t.after(() => host.close());
  const made = await host.change({ name: 'rnaseq', description: 'Use for differential expression against wild type.', body: '- Use the lab\'s DESeq2 results.\n', reason: 'The person said so.', expectedVersion: null, changeId: 'r1' }, agent);
  await fs.appendFile(file(root, 'rnaseq'), '- Strain 97 is ΔrhlI.\n');
  const listed = (await host.list()).skills[0];
  assert.equal(listed.outside, true);
  const read = await host.read('rnaseq');
  assert.equal(read.outside.since, made.change.after);
  assert.deepEqual(read.outside.diff.lines.filter(l => l.op === '+').map(l => l.text), ['- Strain 97 is ΔrhlI.']);
  await assert.rejects(host.undo({ name: 'rnaseq', change: made.change.id, changeId: 'u0' }, person), { kind: 'conflict' });

  const next = await host.change({ name: 'rnaseq', body: '- Use the lab\'s DESeq2 results.\n- Strain 97 is ΔrhlI.\n- Refit only when asked.\n', reason: 'Refits are asked for.', expectedVersion: read.skill.version, changeId: 'r2' }, agent);
  const kinds = (await host.read('rnaseq')).changes.map(c => c.kind);
  assert.deepEqual(kinds, ['recorded', 'outside', 'recorded'], 'the outside edit is kept before the change written over it');
  const outside = (await host.read('rnaseq')).changes[1];
  assert.equal(outside.by, 'outside');
  await assert.rejects(host.undo({ name: 'rnaseq', change: outside.id, changeId: 'u1' }, person), { kind: 'invalid' }, 'a change made outside Rho is undone where it was made');
  assert.equal(next.change.before, outside.after);
});

test('the newest change is undone, a removal too, and an undo is a change of its own', async t => {
  const root = await project(), host = new SkillsHost(root);
  t.after(() => host.close());
  const one = await host.change({ name: 'qc', description: 'Use when filtering cells before clustering.', body: '- Keep cells with 200 or more genes.\n', reason: 'Seed.', expectedVersion: null, changeId: 'q1' }, agent);
  const two = await host.change({ name: 'qc', body: '- Keep cells with 500 or more genes.\n', reason: 'Raised after the person saw empty droplets.', expectedVersion: one.skill.version, changeId: 'q2' }, agent);
  await assert.rejects(host.undo({ name: 'qc', change: one.change.id, changeId: 'u1' }, person), { kind: 'conflict' });
  const undone = await host.undo({ name: 'qc', change: two.change.id, changeId: 'u2' }, person);
  assert.equal(undone.change.kind, 'undone'); assert.equal(undone.change.undoes, two.change.id); assert.equal(undone.change.by, person);
  assert.equal(undone.skill.version, one.skill.version);
  assert.match(await fs.readFile(file(root, 'qc'), 'utf8'), /200 or more genes/);
  assert.equal((await host.read('qc')).changes.find(c => c.id === two.change.id).undoneBy, undone.change.id);
  await assert.rejects(host.undo({ name: 'qc', change: two.change.id, changeId: 'u3' }, person), { kind: 'conflict' });

  const gone = await host.change({ name: 'qc', remove: true, reason: 'Merged into the clustering skill.', expectedVersion: one.skill.version, changeId: 'q3' }, agent);
  assert.equal(gone.skill, null); assert.equal(gone.change.kind, 'removed');
  await assert.rejects(fs.access(file(root, 'qc')));
  const listed = await host.list();
  assert.deepEqual([listed.skills.length, listed.removed.map(s => s.name), listed.removed[0].description], [0, ['qc'], 'Use when filtering cells before clustering.']);
  const back = await host.undo({ name: 'qc', change: gone.change.id, changeId: 'u4' }, person);
  assert.equal(back.skill.version, one.skill.version);
});

test('size and count limits refuse a change and leave the skill as it was; links are refused', async t => {
  const root = await project(), host = new SkillsHost(root, { limits: { maxSkills: 2, maxSkillBytes: 400 } });
  t.after(() => host.close());
  const made = await host.change({ name: 'a', description: 'Use for a.', body: '- one\n', reason: 'r', expectedVersion: null, changeId: 'a1' }, agent);
  await assert.rejects(host.change({ name: 'a', body: 'x'.repeat(500), reason: 'r', expectedVersion: made.skill.version, changeId: 'a2' }, agent), e => e.kind === 'limit' && /at most 400/.test(e.message));
  assert.equal((await host.read('a')).skill.version, made.skill.version);
  await host.change({ name: 'b', description: 'Use for b.', body: '- two\n', reason: 'r', expectedVersion: null, changeId: 'b1' }, agent);
  await assert.rejects(host.change({ name: 'c', description: 'Use for c.', body: '- three\n', reason: 'r', expectedVersion: null, changeId: 'c1' }, agent), { kind: 'limit' });
  await assert.rejects(host.change({ name: 'Bad Name', description: 'x', body: 'x', reason: 'r', expectedVersion: null, changeId: 'n1' }, agent), { kind: 'invalid' });
  await assert.rejects(host.change({ name: 'a', body: (await host.read('a')).skill.body, reason: 'r', expectedVersion: made.skill.version, changeId: 'a3' }, agent), { kind: 'invalid' }, 'nothing would change');

  const other = await project(), outsider = await project();
  await fs.mkdir(path.join(other, '.claude'));
  await fs.symlink(outsider, path.join(other, '.claude', 'skills'));
  const linked = new SkillsHost(other);
  t.after(() => linked.close());
  await assert.rejects(linked.change({ name: 'x', description: 'Use for x.', body: '- x\n', reason: 'r', expectedVersion: null, changeId: 'x1' }, agent), { kind: 'scope' });
  assert.deepEqual(await fs.readdir(outsider), []);
  assert.equal(skillsLimits.maxSkillBytes, 32 * 1024);
});

test('skills written by hand are listed with what Agents would make of them', async t => {
  const root = await project(), host = new SkillsHost(root);
  t.after(() => host.close());
  await fs.mkdir(path.join(root, '.claude', 'skills', 'lab-manual'), { recursive: true });
  await fs.writeFile(file(root, 'lab-manual'), '---\nname: lab-manual\ndescription: >\n  Operating manual for the lab cluster. Use whenever\n  running compute there.\n---\n\n# Manual\n');
  await fs.mkdir(path.join(root, '.claude', 'skills', 'misnamed'), { recursive: true });
  await fs.writeFile(file(root, 'misnamed'), '---\nname: other\ndescription: x\n---\n');
  const { skills } = await host.list();
  assert.deepEqual(skills.map(s => [s.name, s.description, s.changes, s.outside, !!s.problem]), [['lab-manual', 'Operating manual for the lab cluster. Use whenever running compute there.', 0, true, false], ['misnamed', 'x', 0, true, true]]);
  assert.equal((await host.read('lab-manual')).outside.since, null);
  assert.deepEqual(plugin.operations.map(o => o.method), ['skills.list', 'skills.read', 'skills.change', 'skills.undo']);
  assert.ok(plugin.skills[0].content.includes('never results'));
});
