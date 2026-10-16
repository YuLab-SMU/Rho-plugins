import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
const root = fileURLToPath(new URL('..', import.meta.url));
const ids = ['documents', 'files', 'r', 'requirements', 'tables', 'media', 'charts', 'agent', 'annotations'];
const { values } = parseArgs({ options: { destination: { type: 'string' }, plugins: { type: 'string' } } });
const selected = values.plugins === undefined ? ids : values.plugins.split(',').filter(Boolean);
if (new Set(selected).size !== selected.length || selected.some(id => !ids.includes(id))) throw new Error('Select unique known plugin IDs.');
const destination = path.resolve(values.destination ?? path.join(root, 'work/plugins-' + Date.now()));
await fs.mkdir(destination, { recursive: true });
function run(args) {
  const result = spawnSync('npm', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}
run(['run', 'build']);
const packages = [];
for (const id of ['contracts', ...selected]) {
  const folder = id === 'contracts' ? 'packages/contracts' : 'plugins/' + id;
  const manifest = JSON.parse(await fs.readFile(path.join(root, folder, 'package.json'), 'utf8'));
  const result = JSON.parse(run(['pack', '--workspace', folder, '--ignore-scripts', '--json', '--pack-destination', destination]))[0];
  if (result.files.some(f => !/^(dist\/|package.json$|README.md$|LICENSE$)/.test(f.path) || /\.R$/.test(f.path))) throw new Error('Unexpected packaged input: ' + id);
  for (const file of result.files.filter(f => /^dist\/.*\.(js|json)$/.test(f.path))) {
    const code = await fs.readFile(path.join(root, folder, file.path), 'utf8');
    if (/DESeq2|airway|apeglm|dexamethasone|real-r-analysis|agent-eval/i.test(code)) throw new Error('Project/evaluation code leaked into ' + id + ': ' + file.path);
  }
  packages.push({ id, package: manifest.name, version: manifest.version, filename: result.filename, bytes: result.size, sha256: createHash('sha256').update(await fs.readFile(path.join(destination, result.filename))).digest('hex'), integrity: result.integrity, files: result.files.map(f => f.path) });
}
await fs.writeFile(path.join(destination, 'plugins.json'), JSON.stringify({ selected, packages }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ destination, selected, packages }) + '\n');
