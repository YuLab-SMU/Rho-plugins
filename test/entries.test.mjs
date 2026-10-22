import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const ids = ['documents', 'files', 'r', 'requirements', 'tables', 'media', 'charts', 'agent', 'annotations'];
test('every owner ships versioned operations and digest-checked Skills in its npm entry', async () => {
  const methods = new Set();
  for (const id of ids) {
    const { plugin } = await import('@rho-workspace/plugin-' + id);
    assert.equal(plugin.entryVersion, '1.0');
    assert.ok(plugin.operations.length > 0);
    for (const o of plugin.operations) {
      assert.equal(methods.has(o.method), false, o.method); methods.add(o.method);
      assert.equal(o.version, '2.0'); assert.ok(o.inputSchema); assert.ok(o.outputSchema);
      assert.equal('projectId' in o.inputSchema.properties, false);
      assert.ok(Array.isArray(o.requires)); assert.ok(['read', 'metadata', 'document', 'file', 'native'].includes(o.effect));
    }
    for (const skill of plugin.skills) {
      assert.equal(createHash('sha256').update(skill.content).digest('hex'), skill.digest);
      assert.ok(skill.content.includes(skill.id === 'agent.feedback' ? 'feedback.read' : skill.id === 'agent.presentation' ? 'workspace.enhance' : 'capability.list')); assert.ok(skill.version);
    }
    assert.equal(plugin.skills.length, id === 'agent' ? 3 : 1);
    assert.equal(new Set(plugin.skills.map(s => s.id)).size, plugin.skills.length);
  }
});
