import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { AgentContext } from '../plugins/agent/dist/index.js';
test('activity retains exact object metadata, never text, and exposes its bounded gap after restart', async () => {
  const root = await fs.mkdtemp('/tmp/rho-activity-');
  try {
    const owner = new AgentContext(root, 'project', {}, { maxActivities: 2 });
    await owner.recordActivity('agent:test', 'document.open', { path: 'private.md' }, { id: 'a'.repeat(64), version: 3, content: 'private content' });
    const first = await owner.activity('agent:test');
    assert.equal(first.entries[0].documentId, 'a'.repeat(64)); assert.equal(first.entries[0].returnedVersion, 3);
    assert.equal(JSON.stringify(first).includes('private'), false);
    const ref = { id: 'b'.repeat(64), version: 'c'.repeat(64), forbidden: 'private content' };
    await owner.recordActivity('agent:test', 'data.page', { resource: ref, filter: 'private content' }, { rows: ['private content'] });
    await owner.recordActivity('agent:test', 'action.output', { operationId: 'run', stream: 'stderr' }, { content: 'private content' });
    const read = await new AgentContext(root, 'project', {}).activity('agent:test');
    assert.equal(read.retainedFrom, 2); assert.equal(read.cursor, 3);
    assert.deepEqual(read.entries[0].resource, { id: ref.id, version: ref.version }); assert.equal(read.entries[1].stream, 'stderr');
    assert.equal(JSON.stringify(read).includes('private'), false);
    assert.equal((await owner.activity('agent:other')).entries.length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
