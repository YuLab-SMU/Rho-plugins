// Isolated consumers prove these are real npm boundaries, not barrel exports.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const source = path.resolve(process.argv[2] ?? '');
const manifest = JSON.parse(await fs.readFile(path.join(source, 'plugins.json'), 'utf8'));
const root = await fs.mkdtemp(path.join(tmpdir(), 'rho-plugin-install-'));
const contracts = manifest.packages.find(p => p.id === 'contracts');
const report = { status: 'running', packages: [] };
try {
  for (const item of manifest.packages.filter(p => p.id !== 'contracts')) {
    const directory = path.join(root, item.id); await fs.mkdir(directory);
    const installed = spawnSync('npm', ['install', '--prefix', directory, '--ignore-scripts', '--no-audit', '--no-fund', path.join(source, contracts.filename), path.join(source, item.filename)], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    assert.equal(installed.status, 0, installed.stderr);
    const script = `import assert from 'node:assert/strict';
import { plugin } from '${item.package}';
assert.equal(plugin.id, '${item.id}');
assert.equal(plugin.version, '${item.version}');
${['files', 'tables', 'media', 'r', 'requirements'].includes(item.id) ? `assert.ok(Object.keys(await import('${item.package}/contract')).length > 0);` : ''}
`;
    const file = path.join(directory, 'check.mjs'); await fs.writeFile(file, script);
    const result = spawnSync(process.execPath, [file], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const packages = await fs.readdir(path.join(directory, 'node_modules/@rho-workspace'));
    assert.deepEqual(packages.sort(), ['plugin-contracts', 'plugin-' + item.id].sort());
    for (const dependency of ['csv-parse', '@modelcontextprotocol/sdk']) {
      const exists = await fs.stat(path.join(directory, 'node_modules', dependency)).then(() => true, () => false);
      assert.equal(exists, dependency === 'csv-parse' ? item.id === 'tables' : item.id === 'agent');
    }
    assert.equal((await fs.lstat(path.join(directory, 'node_modules', item.package))).isSymbolicLink(), false);
    report.packages.push({ id: item.id, artifactSha256: item.sha256, state: 'passed' });
    process.stdout.write(item.id + ': isolated install/import passed\n');
  }
  report.status = 'passed';
} catch (e) { report.status = 'failed'; report.failure = e.message; process.exitCode = 1; }
await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ status: report.status, report: path.join(root, 'report.json'), failure: report.failure }) + '\n');
