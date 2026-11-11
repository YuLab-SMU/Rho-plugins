import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listNativeSessions, nativeSession, readNativeSession } from '../plugins/agent/dist/native-sessions.js';

// Codex keeps every folder's sessions in one place. A session belongs to the project whose
// folder is its cwd, whichever project was listed before it in the same process.
test('a Codex session is listed only in its own project, in either order', async t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rho-native-')));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  const a = path.join(dir, 'a'), b = path.join(dir, 'b'), day = path.join(dir, 'codex/sessions/2026/11/11');
  for (const d of [a, b, day, path.join(dir, 'claude')]) fs.mkdirSync(d, { recursive: true });
  const sources = { codexHome: path.join(dir, 'codex'), claudeConfigDir: path.join(dir, 'claude') };
  const write = (id, cwd, prompt) => fs.writeFileSync(path.join(day, `rollout-2026-11-11T01-00-00-${id}.jsonl`), [
    { timestamp: '2026-11-11T01:00:00Z', type: 'session_meta', payload: { id, cwd, originator: 'codex_cli_rs' } },
    { timestamp: '2026-11-11T01:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: prompt } },
    { timestamp: '2026-11-11T01:00:02Z', type: 'event_msg', payload: { type: 'agent_message', message: 'Done.' } },
    { timestamp: '2026-11-11T01:00:03Z', type: 'event_msg', payload: { type: 'task_complete' } }
  ].map(l => JSON.stringify(l)).join('\n') + '\n');
  const inA = '019a0000-0000-7000-8000-00000000000a', inB = '019a0000-0000-7000-8000-00000000000b';
  write(inA, a, 'Explain a figure in A');
  write(inB, b, 'Fit a model in B');
  const titles = root => listNativeSessions(root, sources).sessions.map(s => s.title);

  assert.deepEqual(titles(b), ['Fit a model in B']);
  assert.deepEqual(titles(a), ['Explain a figure in A'], 'a session passed over for B is still listed for A');
  assert.match(listNativeSessions(a, sources).sessions[0].resume, /\/a' && codex resume /);
  assert.deepEqual(titles(b), ['Fit a model in B'], 'a session listed for A is not listed for B');
  assert.equal(nativeSession(b, 'codex', inA, sources), null);
  assert.equal(await readNativeSession(b, { session: inA }, sources), null, 'B cannot read A\'s session');
  assert.equal((await readNativeSession(a, { session: inA }, sources))?.session.title, 'Explain a figure in A');
});
