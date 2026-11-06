import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectDshSession, observeDshSession, externalProjectPath } from '../plugins/agent/dist/dsh-session.js';
import { listExternalSessions, readExternalSession, saveExternalSession } from '../plugins/agent/dist/external-session.js';
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rho-observed-')));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const header = { id: 'session-native', version: 4, cwd: root, createdAt: 1000 };
  const events = [], add = (type, data) => events.push({ seq: events.length, time: 1000 + events.length, type, data });
  return { root, header, events, add };
}
test('native identity joins prompts, calls, receipts and deliverables without input or runtime state', t => {
  const f = fixture(t), { root, header, events, add } = f;
  assert.deepEqual(listExternalSessions(root), { sessions: [], omitted: 0 });
  assert.equal(fs.existsSync(path.join(root, '.rho')), false, 'reading creates no state');
  add('turn/start', { turn: 1 }); add('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '换配色' }] });
  add('user/message', { source: { kind: 'runtime' }, content: 'injected secret context' });
  add('assistant/message', { turn: 1, message: { content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'Changing the palette.' }] } });
  add('tool/call', { turn: 1, callId: 'call-one', name: 'mcp__rho__rho_call', arguments: JSON.stringify({ operation: 'resource.register', input: { path: 'results/火山.png', authorization: 'Bearer keep-private', token: 'also-private' } }) });
  add('tool/result', { message: { toolCallId: 'call-one', content: JSON.stringify({ ok: true, value: { path: 'results/火山.png', id: 'a'.repeat(64), version: 'b'.repeat(64), projectId: 'p' } }) } });
  add('tool/call', { turn: 1, callId: 'call-two', name: 'shell', arguments: JSON.stringify({ command: 'Rscript scripts/volcano.R /outside/private.R' }) });
  add('job/settled', { toolCall: { rootCallId: 'call-two' }, detail: 'exit code: 3' });
  add('deliverables/presented', { turn: 1, callId: 'show', files: [{ path: path.join(root, 'results/火山.png') }, { path: path.join(root, 'scripts/volcano.R') }, { path: '/outside/private.R' }] });
  add('assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'Done.' }] } });
  add('turn/end', { turn: 1, reason: { kind: 'completed' } });
  const a = observeDshSession(root, header, events), b = observeDshSession(root, header, events);
  assert.equal(a.id, b.id); assert.equal(listExternalSessions(root).sessions.length, 1);
  const read = readExternalSession(root, { session: a.id }), turn = read.turns[0];
  assert.equal(turn.prompt, '换配色'); assert.equal(turn.reply, 'Done.'); assert.equal(turn.messages[0].text, 'Changing the palette.');
  assert.equal(turn.tools[0].outcome, 'returned'); assert.equal(turn.tools[1].outcome, 'unknown'); assert.equal(turn.tools[1].exitCode, 3);
  assert.deepEqual(turn.tools[1].paths, ['scripts/volcano.R']);
  assert.equal(turn.results.length, 2); assert.equal(turn.results[0].toolId, 'call-one'); assert.equal(turn.results[0].version, 'b'.repeat(64));
  assert.doesNotMatch(JSON.stringify(read), /private reasoning|injected secret|keep-private|also-private/);
  const saved = fs.readFileSync(path.join(root, '.rho/agent/external', a.id + '.json'));
  assert.throws(() => observeDshSession(root, header, events.slice(0, -1)), /backwards/);
  const conflict = structuredClone(events); conflict[1].data.content[0].text = 'rewritten';
  assert.throws(() => observeDshSession(root, header, conflict), /conflicts/);
  conflict.push({ seq: conflict.length, time: 2000, type: 'session/title', data: { title: 'wrong' } });
  assert.throws(() => observeDshSession(root, header, conflict), /prefix conflicts/);
  assert.deepEqual(fs.readFileSync(path.join(root, '.rho/agent/external', a.id + '.json')), saved);
  add('session/title', { title: 'Updated native title' }); observeDshSession(root, header, events);
  assert.equal(listExternalSessions(root).sessions[0].title, 'Updated native title');
});
test('stale observations preserve unknown outcomes, paging, limits and explicit omissions', t => {
  const { root, header, events, add } = fixture(t);
  for (let i = 1; i <= 205; i++) { add('turn/start', { turn: i }); add('user/message', { source: { kind: 'user' }, content: 'q' + i }); if (i < 205) add('turn/end', { turn: i, reason: { kind: 'completed' } }); }
  for (let i = 0; i < 258; i++) add('tool/call', { turn: 205, callId: 'c' + i, name: 'read', arguments: '{}' });
  const record = projectDshSession(root, header, events, new Date(0).toISOString()); saveExternalSession(root, record);
  const read = readExternalSession(root, { session: record.summary.id });
  assert.equal(read.session.state, 'unknown'); assert.equal(read.session.omittedTurns, 5); assert.equal(read.first, 196);
  assert.equal(read.turns.at(-1).tools[0].outcome, 'unknown'); assert.equal(read.turns.at(-1).omittedTools, 2);
  assert.equal(readExternalSession(root, { session: record.summary.id, before: read.first, limit: 20 }).first, 176);
  assert.throws(() => projectDshSession(root, header, Array(32769).fill({})), /source limits/);
});
test('project containment and native version are checked before retaining content', t => {
  const { root, header, events, add } = fixture(t); add('turn/start', { turn: 1 });
  for (const p of ['../out.R', '/out.R', '.rho/private.json', '.git/config', '']) assert.equal(externalProjectPath(root, p), null);
  assert.throws(() => projectDshSession(root, { ...header, cwd: os.tmpdir() }, events), /does not match/);
  assert.throws(() => projectDshSession(root, { ...header, version: 3 }, events), /does not match/);
  assert.throws(() => projectDshSession(root, header, [{ ...events[0], seq: 1 }]), /missing or reordered/);
  fs.mkdirSync(path.join(root, '.rho')); fs.symlinkSync(os.tmpdir(), path.join(root, '.rho/agent'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => observeDshSession(root, header, events), /stay in the project/);
  assert.equal(listExternalSessions(root).omitted, 1);
});
test('a live lock is not stolen and corrupt records are not overwritten', t => {
  const { root, header, events, add } = fixture(t); add('turn/start', { turn: 1 });
  const value = observeDshSession(root, header, events), file = path.join(root, '.rho/agent/external', value.id + '.json');
  fs.writeFileSync(file + '.lock', String(process.pid));
  assert.throws(() => observeDshSession(root, header, events), /busy/); fs.unlinkSync(file + '.lock');
  fs.writeFileSync(file, '{broken'); assert.throws(() => observeDshSession(root, header, events)); assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
