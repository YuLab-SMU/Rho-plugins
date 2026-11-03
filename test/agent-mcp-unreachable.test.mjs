import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The bridge an Agent starts for a grant, when the service at its address is not running: the
// connection is refused, nothing reaches the service, and the Agent is told so.
const bridge = fileURLToPath(new URL('../plugins/agent/dist/mcp.js', import.meta.url));
test('a call to a service that is not running is unavailable with nothing delivered, not an unknown outcome', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rho-bridge-'));
  const port = await new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
  const url = 'http://127.0.0.1:' + port, file = path.join(directory, 'agent-x.json');
  await fs.writeFile(file, JSON.stringify({ url, token: 't', projectId: 'p', externalSessionId: 'codex', methods: ['capability.index'], profile: 'layered-business', apiVersion: '2.0' }), { mode: 0o600 });
  const child = spawn(process.execPath, [bridge], { env: { ...process.env, RHO_AGENT_CONNECTION: file }, stdio: ['pipe', 'pipe', 'inherit'] });
  try {
    let output = '';
    const answered = new Promise((resolve, reject) => {
      child.stdout.on('data', chunk => { output += chunk; const line = output.split('\n').find(l => l.includes('"id":2')); if (line) resolve(JSON.parse(line)); });
      child.once('exit', code => reject(new Error('the bridge exited with ' + code)));
    });
    for (const message of [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'rho_index', arguments: {} } }]) child.stdin.write(JSON.stringify(message) + '\n');
    const reply = await answered;
    assert.equal(reply.result.isError, true);
    const { error } = JSON.parse(reply.result.content[0].text);
    assert.equal(error.kind, 'unavailable');
    assert.deepEqual(error.details, { url, delivered: false });
    assert.match(error.message, new RegExp(`^Rho is not running at ${url}, so this call did not reach it and nothing ran\\.`));
  } finally { child.kill(); await fs.rm(directory, { recursive: true, force: true }); }
});
