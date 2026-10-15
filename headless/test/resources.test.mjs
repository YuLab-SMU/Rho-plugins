import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Resources, Documents } from '../../dist/index.js';
const ref = r => ({ id: r.id, version: r.version });
test('typed pages retain NA, stable gene selection and missing comparison Y', async () => {
  // Contract fixtures only; actual statistical evidence is in real-r-analysis.
  const root = await fs.mkdtemp(path.join(tmpdir(), 'rho-data-'));
  const data = new Resources(root, 'test', { maxPageRows: 2, maxPoints: 1 });
  await fs.writeFile(path.join(root, 'baseline.csv'), 'gene_id,symbol,baseMean,log2FoldChange,padj\ng1,KLF15,5,2,\ng2,OTHER,10,-1,0.01\n');
  const a = await data.register('baseline.csv', { operationId: 'baseline' }, 'partial', { observedRows: 2 });
  await fs.writeFile(path.join(root, 'shrink.csv'), 'gene_id,symbol,baseMean,log2FoldChange,padj\ng1,KLF15,5,1.2,\n');
  const b = await data.register('shrink.csv', { operationId: 'shrink', baseline: ref(a) }, 'available');
  const page = await data.page(ref(a), 0, 2, { column: 'log2FoldChange', direction: 'asc' });
  assert.deepEqual(page.rows.map(r => r.gene_id), ['g2', 'g1']); assert.equal(page.rows[1].padj, null);
  await assert.rejects(data.page(ref(a), 0, 3), { kind: 'limit' });
  await assert.rejects(data.page(ref(a), 0, 2, undefined, { column: 'baseMean', op: 'gt', value: '5' }), { kind: 'invalid' });
  const c = await data.compare(ref(a), ref(b));
  const joined = await data.page(ref(c), 0, 2);
  assert.equal(joined.rows[1].y, null); assert.equal(c.coverage.missingY, 1);
  assert.equal((await data.plot(ref(c))).downsampled, true);
  await fs.appendFile(path.join(root, 'shrink.csv'), 'g2,OTHER,10,-0.5,0.01\n');
  await assert.rejects(data.page(ref(c), 0, 2), { kind: 'stale' });
});
test('earlier snapshot bytes count toward storage budget and invalid UTF-8 stays intact', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'rho-data-limit-'));
  const data = new Resources(root, 'test', { maxArtifactBytes: 8 });
  await fs.writeFile(path.join(root, 'a.txt'), 'first');
  const a = await data.register('a.txt', { operationId: 'a' }, 'partial');
  await fs.writeFile(path.join(root, 'a.txt'), 'second');
  await assert.rejects(data.register('a.txt', { operationId: 'a' }, 'partial'), { kind: 'limit' });
  assert.equal((await data.list())[0].version, a.version);
  await fs.writeFile(path.join(root, 'invalid.R'), Buffer.from([0xff, 0xfe]));
  await assert.rejects(new Documents(root).open('invalid.R', 'human'), { kind: 'invalid' });
  assert.deepEqual(await fs.readFile(path.join(root, 'invalid.R')), Buffer.from([0xff, 0xfe]));
});
