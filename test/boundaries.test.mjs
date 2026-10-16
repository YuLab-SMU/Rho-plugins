import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as contracts from '@rho-workspace/plugin-contracts';

const root = fileURLToPath(new URL('..', import.meta.url));
const owners = ['packages/contracts', ...['documents', 'files', 'r', 'requirements', 'tables', 'media', 'charts', 'agent', 'annotations'].map(id => 'plugins/' + id)];

test('package imports stay within their owner and declared dependencies; contracts has no capability entry', async () => {
  for (const owner of owners) {
    const folder = path.join(root, owner);
    const manifest = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
    const dependencies = Object.keys(manifest.dependencies ?? {});
    assert.ok(dependencies.every(d => d === '@rho-workspace/plugin-contracts' || !d.startsWith('@rho-workspace/')), owner);
    for (const name of await fs.readdir(path.join(folder, 'src'))) {
      const file = path.join(folder, 'src', name);
      const source = ts.createSourceFile(file, await fs.readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function inspect(node) {
        const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
          : ts.isImportTypeNode(node) ? node.argument.literal
          : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require') ? node.arguments[0] : undefined;
        if (specifier) {
          assert.ok(ts.isStringLiteral(specifier), 'Only explicit imports: ' + file);
          const spec = specifier.text;
          if (name === 'contract.ts') assert.equal(spec, '@rho-workspace/plugin-contracts', 'Pure contract entries cannot load owner implementations or native/parser dependencies: ' + file);
          if (spec.startsWith('.')) assert.ok(path.resolve(path.dirname(file), spec).startsWith(folder + path.sep), file + ': ' + spec);
          else if (spec.startsWith('node:')) {
            if (owner === 'packages/contracts') assert.ok(['node:fs/promises', 'node:path', 'node:crypto'].includes(spec), 'Contracts cannot execute native processes: ' + spec);
          } else assert.ok(dependencies.some(d => spec === d || spec.startsWith(d + '/')), file + ': undeclared dependency ' + spec);
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
    'digest', 'now', 'objectSchema', 'publicResource', 'readJson', 'refSchema',
    'requireThat', 'stateDirectory', 'text', 'validateDeclarationEnvelope', 'version'
  ].sort());
});
