import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { observeExecutable } from '@rho-workspace/plugin-contracts';
import { observeNativeAvailability as observeR } from '@rho-workspace/plugin-r';
import { observeNativeAvailability as observeRequirements } from '@rho-workspace/plugin-requirements';

test('native catalog observation checks executable files without running them or changing owner behavior', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'rho-tool-'));
  try {
    const windows = process.platform === 'win32', executable = path.join(root, windows ? 'Rscript.exe' : 'Rscript'), marker = path.join(root, 'ran');
    await fs.writeFile(executable, '#!/bin/sh\ntouch "' + marker + '"\n', { mode: 0o755 });
    assert.equal((await observeExecutable('Rscript', root)).state, 'present');
    assert.equal((await observeR(executable)).state, 'present');
    // Windows has no executable bit: a file it does not start by its extension is no program.
    if (windows) {
      const plain = path.join(root, 'Rscript.txt');
      await fs.rename(executable, plain);
      assert.equal((await observeExecutable(plain)).state, 'missing');
      await fs.rename(plain, executable);
    } else {
      await fs.chmod(executable, 0o644);
      assert.equal((await observeExecutable(executable)).state, 'missing');
    }
    await fs.rm(executable);
    const missing = await observeR(executable);
    assert.equal(missing.state, 'missing');
    assert.deepEqual(missing.methods, ['action.submit']);
    assert.match(missing.body, /Reading objects.*still works/);
    assert.deepEqual((await observeRequirements(executable)).methods, ['requirements.check', 'requirements.prepare']);
    assert.equal((await observeExecutable('Rscript', root + path.delimiter + root, 1)).state, 'unknown');
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
