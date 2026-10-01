import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifySnapshot} from '../sdk/verify-snapshot.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
verifySnapshot(root);
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--offline', '--no-deps', '--format-version=1'], {cwd: root, encoding: 'utf8'}));
const publicNames = new Set(['rho-plugin-sdk', 'rho-plugin-protocol', 'rho-process-engine']);
for (const pkg of metadata.packages) for (const dependency of pkg.dependencies) {
  if (!dependency.path) continue;
  assert.ok(dependency.path.startsWith(`${root}${path.sep}`), `${pkg.name} reads another checkout`);
  const relative = path.relative(root, dependency.path).split(path.sep).join('/');
  assert.ok(relative.startsWith('plugins/') || relative === 'vendor/jet-core' ||
    (relative.startsWith('crates/') && publicNames.has(dependency.name)),
    `${pkg.name} imports a private core implementation: ${dependency.name}`);
}
console.log('Plugin source closure uses only its owners and the pinned public core dependency.');
