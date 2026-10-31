import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const folders = ['packages/contracts', ...['documents', 'files', 'r', 'requirements', 'tables', 'media', 'charts', 'agent', 'annotations', 'markdown', 'html', 'console'].map(id => 'plugins/' + id)];
for (const folder of folders) {
  await rm(new URL('../' + folder + '/dist', import.meta.url), { recursive: true, force: true });
  const result = spawnSync('npm', ['run', 'build', '--workspace', folder], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
