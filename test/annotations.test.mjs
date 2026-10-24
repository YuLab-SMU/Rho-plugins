import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Documents } from '../plugins/documents/dist/index.js';
import { Annotations } from '../plugins/annotations/dist/index.js';

test('explicit reply outputs resolve in their owner; retries and archives preserve exact links', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'rho-answer-links-'));
  try {
    const documents = new Documents(root);
    let draft = await documents.open('question.md', 'browser:test');
    draft = await documents.edit(draft.id, 1, [{ from: 0, to: 0, insert: 'Why this row?' }], 'question', 'browser:test');
    const ref = { id: 'a'.repeat(64), version: 'b'.repeat(64) }, output = { id: 'c'.repeat(64), version: 'd'.repeat(64) };
    let resolves = 0;
    const annotations = new Annotations(root, { documents, tables: { anchor: async () => ({ kind: 'table', resource: ref, namespace: 'rows', entityKey: 'id', rows: [{ id: '001' }] }) }, files: { resolve: async r => { resolves++; if (r.version !== output.version) throw Object.assign(new Error('Wrong version'), { kind: 'stale' }); } } });
    const thread = await annotations.create({ annotationId: 'question', expectedVersion: 0, changeId: 'ask', anchor: { kind: 'table', resource: ref, entities: ['001'] }, draft: { documentId: draft.id, version: draft.version } }, 'browser:test');
    const input = { annotationId: 'question', expectedVersion: 1, changeId: 'answer', replyTo: thread.messages[0].id, draft: { documentId: draft.id, version: draft.version }, resources: [output] };
    await assert.rejects(annotations.reply({ ...input, resources: [{ ...output, version: 'e'.repeat(64) }] }, 'agent:test'), e => e.kind === 'stale');
    assert.equal((await annotations.read('question')).version, 1);
    const answered = await annotations.reply(input, 'agent:test');
    assert.deepEqual(answered.messages[1].resources, [output]);
    assert.deepEqual(answered.anchor, thread.anchor);
    await annotations.reply(input, 'agent:test');
    assert.equal(resolves, 2); // One refused resolution, one write; retry reads its receipt.
    assert.equal((await annotations.read('question')).messages.length, 2);
    await assert.rejects(annotations.reply({ ...input, resources: [] }, 'agent:test'), e => e.kind === 'conflict');
    const bad = await annotations.state(); bad[0].messages[1].resources[0].version = '../outside';
    await assert.rejects(annotations.prepareRestore(bad), e => e.kind === 'invalid');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('owner-frozen UTF-16 feedback, conditional explicit replies and bounded retention', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'rho-annotations-'));
  try {
    const documents = new Documents(root);
    let source = await documents.open('source.md', 'human');
    source = await documents.edit(source.id, 1, [{ from: 0, to: 0, insert: 'a🧬b' }], 'init', 'human');
    let draft = await documents.open('feedback.md', 'human');
    draft = await documents.edit(draft.id, 1, [{ from: 0, to: 0, insert: 'explain this' }], 'init', 'human');
    const annotations = new Annotations(root, { documents }, { maxThreads: 1, maxMessages: 2 });
    const input = { annotationId: 'feedback', changeId: 'create', expectedVersion: 0, anchor: { kind: 'document', documentId: source.id, version: source.version, from: 1, to: 3 }, draft: { documentId: draft.id, version: draft.version } };
    await assert.rejects(annotations.create({ ...input, anchor: { ...input.anchor, from: 2 } }, 'human'), e => e.kind === 'invalid');
    const first = await annotations.create(input, 'human');
    assert.deepEqual(await annotations.create(input, 'human'), first);
    assert.equal(first.source.text, '🧬');
    await documents.edit(source.id, source.version, [{ from: 1, to: 3, insert: 'changed' }], 'later', 'human');
    const read = await annotations.read('feedback');
    assert.equal(read.source.text, '🧬'); assert.equal(read.sourceStatus.state, 'version-differs');
    await assert.rejects(annotations.create({ ...input, annotationId: 'over' }, 'human'), e => e.kind === 'limit');
    const reply = await annotations.reply({ annotationId: 'feedback', changeId: 'reply', expectedVersion: 1, replyTo: first.messages[0].id, draft: { documentId: source.id, version: 3 } }, 'agent');
    assert.equal(reply.messages[1].replyTo, first.messages[0].id); assert.equal(reply.messages[1].author, 'agent');
    await assert.rejects(annotations.reply({ annotationId: 'feedback', changeId: 'over', expectedVersion: 2, replyTo: first.messages[0].id, draft: { documentId: draft.id, version: 2 } }, 'agent'), e => e.kind === 'limit');
    assert.equal((await annotations.read('feedback')).version, 2);
    const archived = await annotations.state();
    const malformed = structuredClone(archived);
    malformed[0].messages[1].replyTo = 'absent-message';
    const restoredRoot = await fs.mkdtemp(path.join(tmpdir(), 'rho-annotations-restore-'));
    try {
      const target = new Annotations(restoredRoot, { documents });
      await assert.rejects(target.restore(malformed), e => e.kind === 'invalid');
      assert.deepEqual(await target.state(), []);
      assert.equal((await target.restore(archived))[0].state, 'available');
      assert.deepEqual(await target.state(), archived);
    } finally { await fs.rm(restoredRoot, { recursive: true, force: true }); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
