#!/usr/bin/env node
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { Transform, type Readable, type Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { acpCommand, acpEnvironment, missingClient, type AcpAgent } from './acp-command.js';
import { ExternalAcpObserver } from './external-acp.js';
import { stopAcpProcess } from './acp-process.js';
import { ownGroup } from './process-group.js';
export function runExternalAcp(project: string, agent: AcpAgent) {
  const env = acpEnvironment(agent, { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1', ...process.env }), missing = missingClient(agent, env);
  if (missing) { process.stderr.write(missing + '\n'); process.exitCode = 1; return; }
  const observer = new ExternalAcpObserver(project, agent, () => process.stderr.write('Rho external observation is unavailable; the original ACP connection continues.\n'));
  const command = acpCommand(agent);
  // On Windows an inherited stream would put the adapter on its client's console, which the
  // Ctrl+Break that stops it would reach too; there its diagnostics are passed on instead.
  const windows = process.platform === 'win32';
  const child = spawn(command.file, command.args, { cwd: project, env, ...ownGroup, stdio: ['pipe', 'pipe', windows ? 'pipe' : 'inherit'] }) as ChildProcessByStdio<Writable, Readable, Readable | null>;
  if (windows) child.stderr?.pipe(process.stderr);
  let closing = false;
  const stop = () => { if (closing) return; closing = true; observer.close(); child.stdin.end(); if (child.pid) void stopAcpProcess(child.pid, 5000); };
  const tap = (observe: (message: any) => void) => {
    let buffer = Buffer.alloc(0), skipping = false;
    return new Transform({ transform(chunk: Buffer, _encoding, callback) {
      let from = 0;
      for (let i = 0; i < chunk.length; i++) if (chunk[i] === 10) {
        const part = chunk.subarray(from, i); from = i + 1;
        if (!skipping && buffer.length + part.length <= 4 * 1024 * 1024) {
          try { observe(JSON.parse(Buffer.concat([buffer, part]).toString('utf8'))); } catch { observer.unavailable(); }
        } else observer.unavailable();
        buffer = Buffer.alloc(0); skipping = false;
      }
      const rest = chunk.subarray(from);
      if (buffer.length + rest.length > 4 * 1024 * 1024) { buffer = Buffer.alloc(0); skipping = true; observer.unavailable(); }
      else if (!skipping) buffer = Buffer.concat([buffer, rest]);
      // Forward unchanged bytes even if the optional observation cannot continue.
      callback(null, chunk);
    } });
  };
  process.stdin.pipe(tap(m => observer.client(m))).pipe(child.stdin);
  child.stdout.pipe(tap(m => observer.agentMessage(m))).pipe(process.stdout);
  child.stdin.on('error', () => stop()); process.stdout.on('error', () => stop());
  process.stdin.once('end', stop); process.once('SIGTERM', stop); process.once('SIGINT', stop);
  child.once('error', () => { observer.close(); process.stderr.write('The selected ACP agent could not start.\n'); process.exitCode = 1; process.stdin.destroy(); });
  child.once('close', code => { stop(); process.exitCode = code ?? 1; process.stdin.destroy(); });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const { values } = parseArgs({ options: { project: { type: 'string' }, agent: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) process.stdout.write('rho-agent-acp --project /absolute/project --agent claude|codex\nInput and permissions stay in the external ACP client.\n');
  else if (!values.project || !['claude', 'codex'].includes(values.agent ?? '')) { process.stderr.write('Select --project and --agent claude|codex.\n'); process.exitCode = 2; }
  else runExternalAcp(values.project, values.agent as AcpAgent);
}
