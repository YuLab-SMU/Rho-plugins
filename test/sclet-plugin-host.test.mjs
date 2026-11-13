import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../examples/sclet-plugin/host.mjs';

const validationId = 'a'.repeat(64);

function harness() {
  const calls = [];
  const ctx = {
    invocationId: validationId,
    changeId: operation => 'change-' + operation,
    async call(method, args) { calls.push({ method, args }); return { cell: { cellId: 'cell-1', outputs: [] } }; },
  };
  return { calls, ctx };
}

const kernel = calls => calls.filter(call => call.method === 'kernel.run');
const single = calls => { const runs = kernel(calls); assert.equal(runs.length, 1); return runs[0].args; };

test('ledger and profile go through GetAIAgentPayload and return the payload with its policy', async () => {
  const { calls, ctx } = harness();
  await run('ledger', { object: 'sce', includeArtifacts: true }, ctx);
  const ledger = single(calls);
  assert.match(ledger.code, /sclet::GetAIAgentPayload\(sce, what="ledger", include_artifacts=TRUE, detail="summary"\)/);
  assert.match(ledger.code, /jsonlite::toJSON\(sclet::GetAIAgentPayload/);

  const fallback = harness();
  await run('ledger', { object: 'sce' }, fallback.ctx);
  assert.match(single(fallback.calls).code, /include_artifacts=FALSE/);

  const profile = harness();
  await run('profile', { object: 'sce' }, profile.ctx);
  assert.match(single(profile.calls).code, /sclet::GetAIAgentPayload\(sce, what="profile"\)/);
});

test('report reads the recorded report through GetAIAgentPayload and prints a delimited policy line', async () => {
  const { calls, ctx } = harness();
  await run('report', { object: 'sce', recordId: 'rec-1' }, ctx);
  const code = single(calls).code;
  assert.match(code, /payload <- sclet::GetAIAgentPayload\(sce, what="report", record_id="rec-1"\)/);
  assert.match(code, /report <- payload\$payload\$report/);
  assert.match(code, /if \(is\.null\(report\)\) report <- payload\$payload/);
  assert.match(code, /if \(is\.character\(report\)\) cat\(report, "\\n"\)/);
  assert.match(code, /cat\("Outbound policy:", jsonlite::toJSON\(payload\$policy/);

  const active = harness();
  await run('report', { object: 'sce' }, active.ctx);
  assert.match(single(active.calls).code, /record_id=NULL/);
});

test('design reads profile and ledger metadata without touching colData values', async () => {
  const { calls, ctx } = harness();
  await run('design', { object: 'sce' }, ctx);
  const code = single(calls).code;
  assert.equal((code.match(/sclet::GetAIProfile\(/g) || []).length, 1);
  assert.match(code, /design=profile\$design/);
  assert.match(code, /profile\$dataset\$col_data\$columns/);
  assert.match(code, /ledger\$analysis_story\$design_confirmations/);
  assert.match(code, /fingerprint=ledger\$fingerprint/);
  assert.doesNotMatch(code, /colData\(/);
  assert.doesNotMatch(code, /assay\(/);
});

test('confirm-design calls ConfirmAIDesignSemantics and reassigns the same R variable', async () => {
  const { calls, ctx } = harness();
  await run('confirm-design', { object: 'sce', design: { batch: 'batch_id' } }, ctx);
  const code = single(calls).code;
  assert.match(code, /design <- jsonlite::fromJSON\(/);
  assert.match(code, /sclet::ConfirmAIDesignSemantics\(sce, design=design\)/);
  assert.match(code, /assign\("sce", updated, envir=\.GlobalEnv\)/);
  assert.match(code, /list\(fingerprint=ledger\$fingerprint, confirmations=ledger\$analysis_story\$design_confirmations\)/);
  assert.match(code, /batch_id/);
  assert.doesNotMatch(code, /GetAIProfile/);

  const invalid = harness();
  await assert.rejects(run('confirm-design', { object: 'sce' }, invalid.ctx), /design object/);
  assert.equal(kernel(invalid.calls).length, 0);
});

test('execute still hands sclet its validation and the one-use confirmation token', async () => {
  const { calls, ctx } = harness();
  await run('execute', { validationId }, ctx);
  const code = single(calls).code;
  assert.match(code, /if \(isTRUE\(selected\$used\)\)/);
  assert.match(code, /selected\$used <- TRUE/);
  assert.match(code, /validation=selected\$validation/);
  assert.match(code, /dry_run=FALSE/);
  assert.match(code, /confirmation=selected\$validation\$confirmation_token/);
});

test('an unknown operation throws before any R is submitted', async () => {
  const { calls, ctx } = harness();
  await assert.rejects(run('unknown', {}, ctx), /Unknown sclet operation/);
  assert.equal(kernel(calls).length, 0);
});

test('check probes the sclet API version the plugin depends on', async () => {
  const { calls, ctx } = harness();
  await run('check', {}, ctx);
  assert.match(single(calls).code, /cat\("GetAIAgentPayload:", requireNamespace\("sclet", quietly=TRUE\) && exists\("GetAIAgentPayload", asNamespace\("sclet"\)\), "\\n"\)/);
});

test('every kernel.run is one local() R cell with waitMs 0 and a stable changeId', async () => {
  const cases = [
    ['check', {}],
    ['skill', { name: 'sclet-driver' }],
    ['ledger', { object: 'sce' }],
    ['profile', { object: 'sce' }],
    ['design', { object: 'sce' }],
    ['confirm-design', { object: 'sce', design: { batch: 'batch_id' } }],
    ['registry', { object: 'sce' }],
    ['validate', { object: 'sce', plan: { task: 't', context_fingerprint: 'f', actions: [{ id: 's1', action: 'x' }] } }],
    ['execute', { validationId }],
    ['record', { object: 'sce', recordId: 'rec-1', result: { task: 't', answer: 'a', findings: [], evidence: [] } }],
    ['report', { object: 'sce' }],
  ];
  for (const [operation, input] of cases) {
    const first = harness();
    await run(operation, input, first.ctx);
    assert.ok(first.calls.every(call => call.method === 'kernel.run'));
    const args = single(first.calls);
    assert.equal(args.language, 'r');
    assert.equal(args.waitMs, 0);
    assert.match(args.code, /^local\(\{\n/);
    assert.equal(args.changeId, first.ctx.changeId(operation));

    const again = harness();
    await run(operation, input, again.ctx);
    assert.equal(single(again.calls).changeId, args.changeId);
  }
});
