import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as contracts from '@rho-workspace/plugin-contracts';

const root = fileURLToPath(new URL('..', import.meta.url));
const owners = ['packages/contracts', ...['documents', 'files', 'r', 'requirements', 'tables', 'media', 'charts', 'agent', 'annotations', 'console'].map(id => 'plugins/' + id)];

test('package imports stay within their owner and declared dependencies; contracts has no capability entry', async () => {
  for (const owner of owners) {
    const folder = path.join(root, owner);
    const manifest = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
    const dependencies = Object.keys(manifest.dependencies ?? {});
    // Optional browser/native entries declare their selected peer modules.
    const peers = Object.keys(manifest.peerDependencies ?? {});
    for (const peer of peers) assert.equal(manifest.peerDependenciesMeta?.[peer]?.optional, true, owner + ': peer must stay optional: ' + peer);
    if (peers.length) assert.equal(manifest.exports['./ui'], './dist/ui.js', owner);
    assert.ok(dependencies.every(d => d === '@rho-workspace/plugin-contracts' || !d.startsWith('@rho-workspace/')), owner);
    for (const name of await fs.readdir(path.join(folder, 'src'))) {
      const file = path.join(folder, 'src', name);
      // Browser entry files (ui.tsx and its ui-*.tsx parts) may use the optional UI peers.
      const browser = name.startsWith('ui') && name.endsWith('.tsx');
      // This selected reader mounts only the installed dsh persistence services.
      // Keep the literal-import check below, and do not allow these peers in other entries.
      const nativePeers = owner === 'plugins/agent' && name === 'activity-reader.ts'
        ? ['@deepseek-ai/cordis', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-persistence-jsonl'] : [];
      const source = ts.createSourceFile(file, await fs.readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function inspect(node) {
        const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
          : ts.isImportTypeNode(node) ? node.argument.literal
          : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require') ? node.arguments[0] : undefined;
        if (specifier) {
          assert.ok(ts.isStringLiteral(specifier), 'Only explicit imports: ' + file);
          const spec = specifier.text;
          if (name === 'contract.ts') assert.equal(spec, '@rho-workspace/plugin-contracts', 'Pure contract entries cannot load owner implementations or native/parser dependencies: ' + file);
          if (spec.startsWith('.')) {
            assert.ok(path.resolve(path.dirname(file), spec).startsWith(folder + path.sep), file + ': ' + spec);
            if (!name.startsWith('ui')) assert.ok(!/^\.\/ui(-|\.|$)/.test(spec), 'Headless entries cannot load the browser entry: ' + file);
          }
          else if (spec.startsWith('node:')) {
            if (owner === 'packages/contracts') assert.ok(['node:fs/promises', 'node:path', 'node:crypto'].includes(spec), 'Contracts cannot execute native processes: ' + spec);
          } else assert.ok(dependencies.some(d => spec === d || spec.startsWith(d + '/')) || (nativePeers.includes(spec) && peers.includes(spec)) || (browser && peers.some(d => !d.startsWith('@deepseek-ai/') && (spec === d || spec.startsWith(d + '/')))) || (browser && spec === 'react/jsx-runtime' && peers.includes('react')), file + ': undeclared dependency ' + spec);
        }
        ts.forEachChild(node, inspect);
      }
      inspect(source);
    }
  }
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'packages/contracts/package.json'), 'utf8'));
  assert.deepEqual(manifest.exports, { '.': './dist/index.js' });
  assert.deepEqual(manifest.dependencies ?? {}, {});
  // This is the deliberately bounded runtime surface, not an expanding catalog
  // of format validators, document state, planners or language environments.
  assert.deepEqual(Object.keys(contracts).sort(), [
    'Fault', 'atomicBytes', 'atomicJson', 'canonical', 'confined', 'declarationEnvelopeSchema',
    'digest', 'now', 'objectSchema', 'observeExecutable', 'publicResource', 'readJson', 'refSchema',
    'requireThat', 'stateDirectory', 'text', 'validateDeclarationEnvelope', 'version'
  ].sort());
});
