import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { observeSessionFiles } from '../plugins/agent/dist/session-files.js';
import { SessionObserver } from '../plugins/agent/dist/session-observation.js';

test('file references observe current bytes, exclude outside/internal/link paths and retain limits', async () => {
  const base = await fs.mkdtemp('/tmp/rho-session-files-'), root = path.join(base, 'project');
  try {
    await fs.mkdir(root); await fs.writeFile(path.join(root, 'notes.md'), '你好');
    await fs.writeFile(path.join(root, 'large.txt'), '12345'); await fs.writeFile(path.join(base, 'private'), 'secret');
    await fs.symlink(path.join(base, 'private'), path.join(root, 'link'));
    const paths = ['../private', '.rho/state', 'notes.md', 'notes.md', 'link', 'large.txt', 'missing'];
    const r = await observeSessionFiles(root, paths.map((path, i) => ({ path, session: 'a', tool: 't' + i })), { maxFiles: 4, maxFileBytes: 6 });
    assert.equal(r.omitted, 2); assert.equal(r.files[0].references.length, 2);
    assert.equal(r.files[0].sha256, createHash('sha256').update('你好').digest('hex'));
    assert.equal(r.files.find(f => f.path === 'link').state, 'unavailable'); assert.equal(r.files.at(-1).state, 'missing');
    assert.ok(!JSON.stringify(r).includes('secret'));
    assert.equal((await observeSessionFiles(root, [{ path: 'large.txt', session: 'a', tool: 'b' }], { maxFiles: 1, maxFileBytes: 2 })).files[0].state, 'file-byte-limit');
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});
test('projection limits keep partial plans and explicitly count omitted updates', () => {
  const seen = [], observer = new SessionObserver(v => seen.push(v), undefined, { maxPlanEntries: 1, maxTextChars: 8, maxTools: 1, maxLocations: 1 });
  observer.update({ sessionId: 's', update: { sessionUpdate: 'plan', entries: [{ content: 'long Unicode 你好', status: 'pending', priority: 'high' }, { content: 'two', status: 'pending', priority: 'low' }] } }, 'initial');
  assert.equal(seen.length, 0, 'pre-ack observations remain bounded and unpublished'); observer.attached('s');
  assert.equal(seen[0].plan.entries.length, 1); assert.equal(seen[0].plan.omitted, 1); assert.equal(seen[0].omitted, 2);
  observer.update({ sessionId: 's', update: { sessionUpdate: 'plan', entries: [] } }, 'live');
  assert.deepEqual(seen.at(-1).plan.entries, [], 'empty replacement clears a plan');
  observer.update({ sessionId: 's', update: { sessionUpdate: 'plan', entries: [{ content: '1234567🧬tail', status: 'pending', priority: 'low' }] } }, 'live');
  assert.equal(seen.at(-1).plan.entries[0].content, '1234567…', 'truncation does not split a Unicode surrogate pair');
});
