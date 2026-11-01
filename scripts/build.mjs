import { rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const folders = ['packages/contracts', ...['documents', 'files', 'r', 'requirements', 'tables', 'media', 'charts', 'agent', 'annotations', 'markdown', 'html', 'console', 'kernel', 'skills'].map(id => 'plugins/' + id)];
// On Windows npm is a .cmd shim that only a shell can start; npm's own CLI runs under this node
// there: the one npm named when it started this script, else the one installed beside node.
const cli = /npm-cli\.js$/.test(process.env.npm_execpath ?? '') ? process.env.npm_execpath : process.platform === 'win32' ? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : null;
for (const folder of folders) {
  await rm(new URL('../' + folder + '/dist', import.meta.url), { recursive: true, force: true });
  const args = ['run', 'build', '--workspace', folder];
  const result = cli ? spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' }) : spawnSync('npm', args, { stdio: 'inherit' });
  if (result.error) process.stderr.write(`npm could not start: ${result.error.message}\n`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
