import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
test('the recipe plots the supported single-bootstrap observation', async () => {
  const recipe = await readFile(new URL('./analyze.R', import.meta.url), 'utf8');
  const call = recipe.match(/hist\(x, breaks =[\s\S]*?main = paste0\(symbol, " \(", length\(x\), " valid\)"\)\)/)?.[0];
  assert.ok(call);
  const result = spawnSync(process.env.RHO_RSCRIPT ?? 'Rscript', ['--vanilla', '-'], { input: `pdf(NULL)\nx <- 2; symbol <- 'KLF15'\nh <- ${call}\nstopifnot(sum(h$counts)==1L)\ndev.off()\n`, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('the recipe records the actual submitted script digest under spaced Unicode paths', async () => {
  const recipe = await readFile(new URL('./analyze.R', import.meta.url), 'utf8');
  const a = recipe.indexOf('  script_arg <-'), b = recipe.indexOf('  summary <-', a);
  const root = await mkdtemp(path.join(tmpdir(), 'rho script 中文 ')), file = path.join(root, 'actual script.R');
  const code = recipe.slice(a, b) + '\ncat(script_sha)\n'; await writeFile(file, code);
  const result = spawnSync(process.env.RHO_RSCRIPT ?? 'Rscript', ['--vanilla', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), createHash('sha256').update(code).digest('hex'));
});
