import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { ClaudeAcpConversation, CodexAcpConversation } from '../plugins/agent/dist/conversation.js';
const fixture = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url));
// Short paths under /tmp; Windows has none.
const temporary = process.platform === 'win32' ? tmpdir() : '/tmp';
async function setup(extra = {}) {
  const root = await fs.mkdtemp(path.join(temporary, 'rho-acp-owner-')), log = path.join(root, 'calls.jsonl');
  const options = { cwd: root, mcpServers: [], command: { file: process.execPath, args: [fixture] }, env: { ACP_TEST_LOG: log, ...extra }, limits: { maxAgentTurns: 8, maxOutputBytes: 32768, maxLineBytes: 4096, stopGraceMs: 100, connectTimeoutMs: 3000 } };
  const drivers = [];
  return { options, create(sessionId, overrides = {}) { const driver = new ClaudeAcpConversation({ ...options, sessionId, ...overrides }); drivers.push(driver); return driver; },
    async calls() { return (await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse); },
    async close() { await Promise.all(drivers.map(x => x.close())); await fs.rm(root, { recursive: true, force: true }); } };
}
function turn(text, overrides = {}) {
  const events = [], identities = [], controller = new AbortController();
  return { events, identities, controller, request: { text, signal: controller.signal, async session(x) { identities.push(x); }, event(x) { events.push(x); }, async permission() { return 'allow'; }, ...overrides } };
}
test('ACP keeps one connection for multiple turns and loads only the recorded session after connection loss', async () => {
  const f = await setup();
  try {
    let driver = f.create(); const a = turn('hello 你好'), b = turn('again');
    assert.equal((await driver.run(a.request)).state, 'completed');
    assert.equal((await driver.run(b.request)).state, 'completed');
    assert.equal(a.identities[0].acpSessionId, 'original-session');
    assert.equal(a.identities[0].nativeSessionId, undefined, 'ACP identity is not fabricated as native identity');
    assert.equal((await f.calls()).filter(x => x.kind === 'spawn').length, 1);
    assert.ok(!JSON.stringify(a.events).includes('private reasoning'));
    const lost = turn('disconnect'); assert.equal((await driver.run(lost.request)).state, 'unknown');
    assert.ok(lost.events.some(x => x.step?.text === 'retained ')); await driver.close();
    driver = f.create('original-session'); const recovered = turn('new instruction');
    assert.equal((await driver.run(recovered.request)).state, 'completed');
    assert.ok(!JSON.stringify(recovered.events).includes('replayed history'));
    const calls = await f.calls();
    assert.equal(calls.filter(x => x.kind === 'session/new').length, 1);
    assert.equal(calls.filter(x => x.kind === 'session/load').length, 1);
    assert.equal(calls.filter(x => x.kind === 'effect').length, 1);
  } finally { await f.close(); }
});
test('session projection observes idle updates, separates replay, replaces plans and keeps native currency', async () => {
  const f = await setup(), observations = [];
  try {
    let acknowledged = false;
    const driver = f.create(undefined, { observe: value => { assert.ok(acknowledged); observations.push(value); } });
    const t = turn('observe', { async session() { acknowledged = true; } });
    assert.equal((await driver.run(t.request)).state, 'completed');
    // Tool steps retain what the Agent is doing: its own title, the ACP category
    // and one identifying input, never raw tool output.
    const read = t.events.find(e => e.step?.id === 'read-notes').step;
    assert.equal(read.title, 'Read the shared notes'); assert.equal(read.toolKind, 'read');
    assert.match(read.detail, /project-notes\.md$/);
    const run = t.events.find(e => e.step?.id === 'run-analysis').step;
    assert.equal(run.toolKind, 'execute'); assert.equal(run.detail, 'Rscript analysis.R --input data.csv');
    // The Agent's own words on what the command is for, one bounded line; a read has none.
    assert.equal(run.purpose, 'Fit the model'); assert.equal(read.purpose, undefined);
    const turnEvents = structuredClone(t.events);
    // The next message's durable acknowledgement may overlap a late update from
    // the previous turn. Reusing a connection is not a history replay phase.
    await driver.run(turn('reuse', { async session() { await new Promise(r => setTimeout(r, 80)); } }).request);
    for (let i = 0; i < 100 && observations.at(-1)?.info?.title !== 'Idle title 你好'; i++) await new Promise(r => setTimeout(r, 10));
    let last = observations.at(-1);
    assert.equal(last.info.title, 'Idle title 你好'); assert.equal(last.plan.entries.length, 1); assert.equal(last.plan.entries[0].content, 'Idle replacement');
    assert.equal(last.plan.origin, 'live'); assert.equal(last.usage.cost.currency, 'EUR');
    assert.equal(last.tools[0].outcome, 'returned'); assert.equal(last.tools[0].locations.length, 1);
    assert.deepEqual(t.events, turnEvents, 'idle observation does not mutate the ended turn');
    assert.ok(!JSON.stringify(observations).includes('private reasoning')); assert.ok(last.unrepresented > 0);
    await driver.close(); assert.equal(observations.at(-1).connected, false);
    const reloaded = [], next = f.create(last.sessionId, { observation: observations.at(-1), observe: v => reloaded.push(v) });
    const second = turn('continue'); assert.equal((await next.run(second.request)).state, 'completed');
    assert.equal(reloaded.at(-1).plan.origin, 'history'); assert.ok(reloaded.at(-1).sequence > last.sequence);
    assert.ok(!JSON.stringify(second.events).includes('Historical plan'));
  } finally { await f.close(); }
});
test('a different session cannot contaminate the retained projection', async () => {
  const f = await setup(), observations = [];
  try {
    const driver = f.create(undefined, { observe: v => observations.push(v) });
    assert.equal((await driver.run(turn('wrong-session').request)).state, 'unknown');
    assert.ok(observations.every(o => o.sessionId === 'original-session' && o.plan === null));
  } finally { await f.close(); }
});
test('ACP confirms cancellation from the original prompt response and keeps an unconfirmed stop unknown', async () => {
  for (const noAck of [false, true]) {
    const f = await setup(noAck ? { ACP_NO_CANCEL: '1' } : {});
    try {
      const driver = f.create(), t = turn('wait');
      t.request.event = e => { t.events.push(e); if (e.step?.id === 'slow') t.controller.abort(); };
      const result = await driver.run(t.request);
      assert.equal(result.state, noAck ? 'unknown' : 'stopped');
      if (!noAck) assert.equal(result.result.reason, 'cancelled');
      assert.equal((await f.calls()).filter(x => x.kind === 'session/prompt').length, 1);
    } finally { await f.close(); }
  }
});
test('the embedding application\'s instructions are appended to the Agent\'s system prompt when the session is created and loaded', async () => {
  const f = await setup();
  try {
    const instructions = 'This session was started in Rho as session c-1.';
    assert.equal((await f.create(undefined, { instructions }).run(turn('hello').request)).state, 'completed');
    assert.equal((await f.create('original-session', { instructions }).run(turn('again').request)).state, 'completed');
    assert.equal((await f.create(undefined).run(turn('plain').request)).state, 'completed');
    const sessions = (await f.calls()).filter(x => x.kind === 'session/new' || x.kind === 'session/load');
    const appended = { mode: 'append', content: [{ type: 'text', text: instructions }] };
    assert.deepEqual(sessions.map(x => [x.kind, x.systemPrompt ?? null]), [['session/new', appended], ['session/load', appended], ['session/new', null]]);
  } finally { await f.close(); }
});
test('a Claude session loads the plugin directories it is given, without their MCP discovery', async () => {
  const f = await setup();
  try {
    assert.equal((await f.create(undefined, { plugins: ['/tmp/rho-plugin-a'] }).run(turn('hello').request)).state, 'completed');
    assert.deepEqual((await f.calls()).find(x => x.kind === 'session/new').plugins, [{ type: 'local', path: '/tmp/rho-plugin-a', skipMcpDiscovery: true }]);
  } finally { await f.close(); }
});

test('a preferred setting applies to a new session over the value it replaces, never over a choice or a loaded session', async () => {
  const preferred = { mode: { value: 'auto', replaces: ['default'] }, effort: { value: 'max', replaces: ['high'] } };
  const sets = async (env, sessionId, overrides = {}) => {
    const f = await setup(env);
    try {
      assert.equal((await f.create(sessionId, { preferred, ...overrides }).run(turn('hello').request)).state, 'completed');
      return (await f.calls()).filter(c => c.kind === 'set').map(c => [c.configId, c.value]);
    } finally { await f.close(); }
  };
  assert.deepEqual(await sets({ ACP_MODE: 'default' }), [['mode', 'auto']], 'Manual becomes Auto; an unoffered setting is skipped');
  assert.deepEqual(await sets({ ACP_MODE: 'plan' }), [], 'a mode chosen in the Agent\'s own settings stays');
  assert.deepEqual(await sets({ ACP_MODE: 'default' }, undefined, { config: { mode: 'acceptEdits' } }), [['mode', 'acceptEdits']], 'the person\'s choice wins');
  assert.deepEqual(await sets({ ACP_MODE: 'default' }, undefined, { preferred: { mode: { value: 'bypass', replaces: ['default'] } } }), [], 'a value the Agent does not offer is skipped');
  assert.deepEqual(await sets({ ACP_MODE: 'default' }, 'original-session'), [], 'a loaded session keeps its mode');
});

test('Claude Code receives a step cap only when the embedding application sets one', async () => {
  const f = await setup();
  try {
    assert.equal((await f.create().run(turn('capped').request)).state, 'completed');
    const { maxAgentTurns, ...uncapped } = f.options.limits;
    assert.equal((await f.create(undefined, { limits: uncapped }).run(turn('uncapped').request)).state, 'completed');
    assert.deepEqual((await f.calls()).filter(x => x.kind === 'session/new').map(x => x.maxTurns), [maxAgentTurns, undefined]);
  } finally { await f.close(); }
});
test('a command step keeps its exit code and the last lines it printed, without terminal codes', async () => {
  const f = await setup();
  try {
    const driver = f.create(), t = turn('command');
    assert.equal((await driver.run(t.request)).state, 'completed');
    const step = id => Object.assign({}, ...t.events.filter(e => e.step?.id === id).map(e => e.step));
    const fit = step('fit'), bad = step('bad'), lost = step('lost');
    assert.equal(fit.detail, 'rtk python3 analysis.py'); assert.equal(fit.outcome, 'returned'); assert.equal(fit.exitCode, 0);
    assert.deepEqual({ lines: fit.output.lines, cut: fit.output.cut }, { lines: 30, cut: true });
    assert.equal(fit.output.text.split('\n').length, 20); assert.equal(fit.output.text.split('\n').at(-1), 'row 29 臭氧');
    assert.ok(!fit.output.text.includes('\u001b'));
    assert.equal(bad.outcome, 'rejected'); assert.equal(bad.exitCode, 1);
    assert.equal(bad.output.text, 'Error in lm(y ~ x): object not found\nExecution halted'); assert.equal(bad.output.cut, false);
    assert.equal(lost.exitCode, undefined, 'an unreported exit code is not invented'); assert.equal(lost.output.text, '');
    // A command is kept whole, so a person can read and run exactly what ran.
    assert.equal(step('script').detail, "cd data && python3 - <<'PY'\nimport csv\nprint(len(list(csv.reader(open('a.csv')))))\nPY");
  } finally { await f.close(); }
});

test('ACP does not send a prompt before durable session acceptance and refuses unsupported loading', async () => {
  const f = await setup();
  try {
    const t = turn('must not run', { async session() { throw new Error('storage failed'); } });
    assert.equal((await f.create().run(t.request)).state, 'failed');
    assert.equal((await f.calls()).filter(x => x.kind === 'session/prompt').length, 0);
    const bounded = f.create(undefined, { observe() { throw new Error('Projection full'); } });
    const result = await bounded.run(turn('not dispatched').request);
    assert.equal(result.state, 'failed'); assert.match(result.problem, /Projection full/); assert.equal(bounded.connected, false);
    assert.equal((await f.calls()).filter(x => x.kind === 'session/prompt').length, 0);
  } finally { await f.close(); }
  const g = await setup({ ACP_NO_LOAD: '1' });
  try {
    assert.equal((await g.create('original-session').run(turn('must not run').request)).state, 'failed');
    assert.equal((await g.calls()).filter(x => x.kind === 'session/new' || x.kind === 'session/prompt').length, 0);
  } finally { await g.close(); }
});
test('ACP forwards only offered permission choices and bounds output before an unterminated line grows', async () => {
  const f = await setup();
  try {
    const driver = f.create(); let permission;
    assert.equal((await driver.run(turn('permission', { async permission(p) { permission = p; return 'invented'; } }).request)).state, 'completed');
    assert.equal(permission.title, 'Write a test file');
    assert.equal((await f.calls()).find(x => x.kind === 'choice').result.outcome.outcome, 'cancelled');
    const t = turn('oversize');
    assert.equal((await driver.run(t.request)).state, 'unknown');
    assert.ok(t.events.some(x => x.type === 'limit' && x.reason === 'line-limit'));
  } finally { await f.close(); }
});

test('Codex uses the same ACP identity and cancellation contract without Claude session metadata', async () => {
  const f = await setup({ ACP_CAN_CLOSE: '1' }); let driver;
  try {
    driver = new CodexAcpConversation(f.options);
    const a = turn('first'); assert.equal((await driver.run(a.request)).state, 'completed');
    const b = turn('second'); assert.equal((await driver.run(b.request)).state, 'completed');
    const waiting = turn('wait', { event(e) { if (e.step?.id === 'slow') waiting.controller.abort(); } });
    assert.equal((await driver.run(waiting.request)).state, 'stopped');
    await driver.close();
    const calls = await f.calls(); assert.equal(calls.filter(c => c.kind === 'session/new').length, 1);
    assert.equal(calls.filter(c => c.kind === 'session/prompt').length, 3);
    assert.equal(calls.filter(c => c.kind === 'session/cancel').length, 1);
    assert.equal(calls.filter(c => c.kind === 'session/close').length, 1);
    assert.equal(calls.find(c => c.kind === 'session/new').claudeMetadata, false);
  } finally { await driver?.close(); await f.close(); }
});

test('session settings: offered settings are observed, chosen ones apply before the first message, changes apply between messages', async () => {
  const f = await setup({ ACP_CONFIG: '1', ACP_CAN_CLOSE: '1' }), observations = [];
  try {
    const driver = f.create(undefined, { config: { model: 'westlakehpc/glm-5.3-flash', effort: 'max' }, observe: v => observations.push(v) });
    const first = turn('which model');
    assert.equal((await driver.run(first.request)).state, 'completed');
    assert.equal(first.identities[0].model, 'westlakehpc/glm-5.3-flash', 'the identity names the model the session runs');
    assert.ok(first.events.some(e => e.type === 'model' && e.model === 'westlakehpc/glm-5.3-flash'));
    assert.ok(first.events.some(e => e.step?.text === 'model westlakehpc/glm-5.3-flash'), 'the setting applied before the message');
    let calls = await f.calls();
    assert.deepEqual(calls.filter(c => c.kind === 'set').map(c => [c.configId, c.value]), [['model', 'westlakehpc/glm-5.3-flash'], ['effort', 'max']]);
    assert.ok(calls.findIndex(c => c.kind === 'set') < calls.findIndex(c => c.kind === 'session/prompt'));
    const config = observations.at(-1).config;
    assert.equal(config.options.length, 3);
    const model = config.options.find(o => o.id === 'model');
    assert.equal(model.current, 'westlakehpc/glm-5.3-flash');
    assert.deepEqual(model.values.map(v => [v.value, v.group]), [['default', 'Routing group'], ['auto/deepseek-v4.1-flash', 'Routing group'], ['westlakehpc/glm-5.3-flash', 'WestlakeHPC']]);
    assert.equal(config.options.find(o => o.id === 'fast').current, false);
    // Between messages the person changes the model; the next message runs on it.
    const changed = await driver.configure('model', 'auto/deepseek-v4.1-flash');
    assert.equal(changed.options.find(o => o.id === 'model').current, 'auto/deepseek-v4.1-flash');
    assert.equal(observations.at(-1).config.origin, 'live');
    const second = turn('which model');
    assert.equal((await driver.run(second.request)).state, 'completed');
    assert.ok(second.events.some(e => e.step?.text === 'model auto/deepseek-v4.1-flash'));
    await assert.rejects(driver.configure('model', 'not-offered'), /does not offer not-offered for Model/);
    await assert.rejects(driver.configure('missing', 'x'), /does not offer the setting missing/);
    await driver.close();
    // A value the Agent does not offer fails the message before anything is sent.
    const refused = f.create(undefined, { config: { model: 'gone/model' } }), t = turn('never sent');
    const result = await refused.run(t.request);
    assert.equal(result.state, 'failed'); assert.match(result.problem, /does not offer gone\/model for Model\. Nothing was sent\./);
    calls = await f.calls();
    assert.ok(!calls.some(c => c.kind === 'session/prompt' && c.text === 'never sent'));
  } finally { await f.close(); }
});
test('inspect opens a session only to read its settings, removes it and ends the process', async () => {
  const f = await setup({ ACP_CONFIG: '1', ACP_CAN_CLOSE: '1' });
  try {
    const driver = f.create();
    const seen = await driver.inspect();
    assert.deepEqual(seen.adapter, { name: 'fault-fixture', version: '1' });
    assert.deepEqual(seen.options.map(o => o.id), ['model', 'effort', 'fast']);
    assert.equal(seen.omitted, 0);
    const calls = await f.calls();
    assert.deepEqual(calls.filter(c => c.kind !== 'spawn').map(c => c.kind), ['initialize', 'session/new', 'session/delete']);
    assert.equal(driver.connected, false);
    await assert.rejects(f.create('original-session').inspect(), /Inspect a new session/);
  } finally { await f.close(); }
});

test('Codex MCP spelling retains its operation and names a permission from the original tool update',async()=>{
 const f=await setup();
 try{
 let choice;const t=turn('rho-permission',{async permission(p){choice=p;return 'allow';}}),driver=f.create();
 assert.equal((await driver.run(t.request)).state,'completed');
 assert.equal(choice.title,'mcp.rho.rho_call');
 assert.ok(t.events.some(e=>e.step?.operation==='context.read'&&e.step?.tool==='mcp.rho.rho_call'));
 }finally{await f.close();}
});
test('ACP adapters drive the selected or installed client, not a bundled native one', async () => {
  const { acpEnvironment } = await import('../plugins/agent/dist/acp-command.js');
  assert.equal(acpEnvironment('claude', {}).CLAUDE_CODE_EXECUTABLE, 'claude');
  assert.equal(acpEnvironment('codex', {}).CODEX_PATH, 'codex');
  assert.equal(acpEnvironment('codex', { CODEX_PATH: '/opt/codex' }).CODEX_PATH, '/opt/codex');
  assert.equal(acpEnvironment('claude', { CLAUDE_CODE_EXECUTABLE: '/opt/claude' }, '/selected/claude').CLAUDE_CODE_EXECUTABLE, '/selected/claude');
  assert.equal(acpEnvironment('codex', { HOME: '/home/x' }).HOME, '/home/x');
});
test('a missing client fails the message with its name before the adapter starts', async () => {
  const { missingClient } = await import('../plugins/agent/dist/acp-command.js');
  const root = await fs.mkdtemp(path.join(temporary, 'rho-acp-client-')), bin = path.join(root, 'bin'); await fs.mkdir(bin);
  // A Windows program is named by its extension, and a file without one is none.
  const program = name => process.platform === 'win32' ? name + '.cmd' : name;
  try {
    assert.match(missingClient('codex', { PATH: bin }), /^Codex was not found on PATH \(codex\)\./);
    assert.match(missingClient('claude', { PATH: bin, CLAUDE_CODE_EXECUTABLE: path.join(bin, 'claude') }), /^Claude Code was not found at .*[\\/]bin[\\/]claude\./);
    await fs.writeFile(path.join(bin, program('codex')), '#!/bin/sh\n', { mode: 0o755 });
    assert.equal(missingClient('codex', { PATH: bin }), null);
    await fs.writeFile(path.join(bin, 'claude'), 'not executable', { mode: 0o644 });
    assert.notEqual(missingClient('claude', { PATH: bin }), null);
    const driver = new CodexAcpConversation({ cwd: root, mcpServers: [], env: { PATH: path.join(root, 'empty'), CODEX_PATH: '' }, limits: { maxAgentTurns: 8, maxOutputBytes: 32768, maxLineBytes: 4096, stopGraceMs: 100, connectTimeoutMs: 3000 } });
    const t = turn('hello'), done = await driver.run(t.request);
    assert.equal(done.state, 'failed'); assert.match(done.problem, /^Codex was not found on PATH/);
    assert.equal(t.events.some(e => e.type === 'started'), false, 'no adapter process was started');
    await driver.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('installed ACP Agents are found on PATH by their own command, starting nothing', async () => {
  const { installedAcpAgents, knownAcpAgent } = await import('../plugins/agent/dist/acp-command.js');
  const root = await fs.mkdtemp(path.join(temporary, 'rho-acp-known-')), bin = path.join(root, 'bin'), home = path.join(root, 'dsh');
  const program = name => process.platform === 'win32' ? name + '.cmd' : name;
  try {
    await fs.mkdir(bin);
    for (const name of ['kimi', 'dsh']) await fs.writeFile(path.join(bin, program(name)), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    // Harness serves ACP only from its acp profile, so its launcher alone is not listed. Windows
    // names the extension as PATHEXT spells it (.CMD), in a folder whose names ignore case.
    const same = file => process.platform === 'win32' ? file.toLowerCase() : file;
    assert.deepEqual(installedAcpAgents({ PATH: bin, DSH_HOME: home }).map(a => [a.id, same(a.command.file), a.command.args]), [['kimi', same(path.join(bin, program('kimi'))), ['acp']]]);
    await fs.mkdir(path.join(home, 'profiles', 'acp'), { recursive: true }); await fs.writeFile(path.join(home, 'profiles', 'acp', 'package.json'), '{}');
    assert.deepEqual(installedAcpAgents({ PATH: bin, DSH_HOME: home }).map(a => a.id), ['dsh', 'kimi']);
    assert.equal(knownAcpAgent({ file: path.join(bin, program('kimi')), args: ['acp'] })?.name, 'Kimi Code');
    assert.equal(knownAcpAgent({ file: path.join(bin, program('kimi')), args: [] }), null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('an Agent that exits before it answers is reported with the last line it printed', async () => {
  const { GenericAcpConversation } = await import('../plugins/agent/dist/conversation.js');
  const limits = { maxAgentTurns: 8, maxOutputBytes: 32768, maxLineBytes: 4096, stopGraceMs: 100, connectTimeoutMs: 5000 };
  const exits = new GenericAcpConversation({ cwd: temporary, mcpServers: [], limits, command: { file: process.execPath, args: ['-e', "process.stderr.write('usage: agent [options]\\n\\nUnknown argument: acp\\n'); process.exit(1)"] } });
  await assert.rejects(exits.inspect(), /^Error: The Agent exited before it answered \(exit 1\)\. It printed: Unknown argument: acp$/);
});
