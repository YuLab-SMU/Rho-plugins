import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { writeClaudePlugin } from '../plugins/agent/dist/conversation.js';

const plugin = (extra = {}) => ({ name: 'rho', version: '0.4.16', description: 'Selected in Rho', skills: [{ name: 'documents', description: 'Change a file: through its buffer', content: '# Buffers\n\nUse document.edit.\n' }],
  hooks: [{ event: 'PreToolUse', matcher: 'Edit|Write', command: { file: "/opt/node's bin/node", args: ['/srv/hook.js'] }, timeoutSeconds: 10 }], ...extra });

test('a Claude Code plugin directory holds the manifest, the skills and the resolved hook commands, named by content', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'rho-claude-plugin-'));
  const dir = await writeClaudePlugin(parent, plugin());
  assert.match(path.basename(dir), /^rho-[a-f0-9]{16}$/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, '.claude-plugin/plugin.json'), 'utf8')), { name: 'rho', version: '0.4.16', description: 'Selected in Rho' });
  assert.equal(await fs.readFile(path.join(dir, 'skills/documents/SKILL.md'), 'utf8'), '---\nname: documents\ndescription: "Change a file: through its buffer"\n---\n\n# Buffers\n\nUse document.edit.\n');
  const hooks = JSON.parse(await fs.readFile(path.join(dir, 'hooks/hooks.json'), 'utf8'));
  assert.deepEqual(hooks, { hooks: { PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: "'/opt/node'\\''s bin/node' '/srv/hook.js'", timeout: 10 }] }] } });
  // The same declaration reuses the directory; a different one gets its own.
  assert.equal(await writeClaudePlugin(parent, plugin()), dir);
  const other = await writeClaudePlugin(parent, plugin({ hooks: [] }));
  assert.notEqual(other, dir);
  await assert.rejects(fs.stat(path.join(other, 'hooks')), { code: 'ENOENT' });
  assert.deepEqual((await fs.readdir(parent)).filter(n => n.startsWith('.staging-')), []);
  await assert.rejects(writeClaudePlugin(parent, plugin({ skills: [{ name: 'Bad Name', description: 'x', content: '' }] })), e => e.kind === 'invalid');
  await assert.rejects(writeClaudePlugin(parent, plugin({ skills: [{ name: 'two', description: 'line\nbreak', content: '' }] })), e => e.kind === 'invalid');
  await assert.rejects(writeClaudePlugin(parent, plugin({ hooks: [{ event: 'PreToolUse', matcher: 'Edit', command: { file: 'node', args: [] } }] })), e => e.kind === 'invalid');
  await assert.rejects(writeClaudePlugin(parent, plugin(), { maxSkills: 0, maxHooks: 16, maxSkillBytes: 65536 }), e => e.kind === 'limit');
});
