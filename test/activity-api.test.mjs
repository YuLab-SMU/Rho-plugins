import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../packages/contracts/dist/index.js';
import { Files } from '../plugins/files/dist/index.js';
import { Tables, lexicalCsvDeclaration, declarationValidator } from '../plugins/tables/dist/index.js';
import { readAgentActivity, activityOutputs, captureActivityArtifact } from '../plugins/agent/dist/activity-api.js';

test('activity projection uses read-only pages and preserves loss without exposing native storage paths', async () => {
  const seen = [];
  const call = async (method, args) => {
    seen.push({ method, args });
    if (method === 'activity-list') return { streams: [{ source: { stream_id: 's', producer: 'dsh', session_id: 'native', metadata: { normalizer: 'rho-agent-activity/1', source: '/private/native/path' } }, next_sequence: 9, retained_from: 7, dropped_events: 6 }] };
    return { entries: [{ cursor: 8, event: { sequence: 7, kind: 'tool.returned', data: {} } }], next_cursor: 8, more: true, gap: true };
  };
  const result = await readAgentActivity(call, 's', 3);
  assert.equal(result.page.gap, true); assert.equal(result.page.more, true);
  assert.equal(result.page.nextCursor, 8); assert.equal(result.streams[0].droppedEvents, 6);
  assert.doesNotMatch(JSON.stringify(result), /private\/native/);
  assert.deepEqual(seen.map(x => x.method), ['activity-list', 'activity-read']);
  await assert.rejects(readAgentActivity(call, 'other'), /not available/);
});

test('observed CSV captures exact bytes through Files and preserves lexical values without invented entities', async () => {
  const root = await fs.realpath(await fs.mkdtemp('/tmp/rho-observed-'));
  try {
    await fs.mkdir(path.join(root, 'outputs'));
    const source = 'id,value\n001,NA\n002,3.5\n';
    await fs.writeFile(path.join(root, 'outputs/table.csv'), source);
    const files = new Files(root, 'p', {}, [declarationValidator]);
    const outputs = await activityOutputs(root, 'outputs');
    assert.equal(outputs.files[0].producer_confirmed, false);
    const first = await captureActivityArtifact(root, 'p', 'outputs/table.csv', digest(source), files, lexicalCsvDeclaration);
    const page = await new Tables(files).page(first, 0, 20);
    assert.deepEqual(page.rows, [{ id: '001', value: 'NA' }, { id: '002', value: '3.5' }]);
    assert.equal(page.entityKey, null);
    assert.equal((await files.resolve(first)).provenance.producerConfirmed, false);
    await fs.writeFile(path.join(root, 'outputs/table.csv'), 'id,value\n003,changed\n');
    await assert.rejects(captureActivityArtifact(root, 'p', 'outputs/table.csv', digest(source), files, lexicalCsvDeclaration), /changed/);
    assert.deepEqual((await new Tables(files).page(first, 0, 20)).rows, page.rows);
    const nextSource = await fs.readFile(path.join(root, 'outputs/table.csv'));
    const next = await captureActivityArtifact(root, 'p', 'outputs/table.csv', digest(nextSource), files, lexicalCsvDeclaration);
    assert.notEqual(next.id, first.id);
    assert.deepEqual((await new Tables(files).page(first, 0, 20)).rows, page.rows);
    await fs.symlink('/etc/passwd', path.join(root, 'outputs/link.csv'));
    await assert.rejects(captureActivityArtifact(root, 'p', 'outputs/link.csv', digest(source), files, lexicalCsvDeclaration));
    await assert.rejects(activityOutputs(root, '.rho'), /internal state/);
    await assert.rejects(activityOutputs(root, '../outside'), /inside/);
    await assert.rejects(activityOutputs(root, path.join(root, 'outputs')), /inside/);
    assert.throws(() => lexicalCsvDeclaration(Buffer.from('a,a\n1,2\n'), 'bad.csv'), /unique/);
    // One file is observed on its own: at the project root, beside more files than an
    // output scan reads, and without a digest it is the current bytes.
    await fs.writeFile(path.join(root, 'top.csv'), 'id,value\n9,9\n');
    for (let i = 0; i < 70; i++) await fs.writeFile(path.join(root, 'outputs', `extra-${i}.txt`), String(i));
    const top = await captureActivityArtifact(root, 'p', 'top.csv', undefined, files, lexicalCsvDeclaration);
    assert.equal(top.version, digest('id,value\n9,9\n'));
    assert.deepEqual((await new Tables(files).page(top, 0, 20)).rows, [{ id: '9', value: '9' }]);
    const again = await captureActivityArtifact(root, 'p', 'outputs/table.csv', undefined, files, lexicalCsvDeclaration);
    assert.equal(again.id, next.id);
    await assert.rejects(captureActivityArtifact(root, 'p', 'missing.csv', undefined, files, lexicalCsvDeclaration), /not in the project/);
    await assert.rejects(captureActivityArtifact(root, 'p', '.rho/x.csv', undefined, files, lexicalCsvDeclaration), /internal state/);
    await fs.writeFile(path.join(root, 'outputs/report.pdf'), '%PDF-1.7');
    await assert.rejects(captureActivityArtifact(root, 'p', 'outputs/report.pdf', digest('%PDF-1.7'), files, lexicalCsvDeclaration), /compatible viewer/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
