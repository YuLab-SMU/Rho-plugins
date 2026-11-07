import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentIcon, agentIconById, agentName, icons } from '@rho-workspace/plugin-agent-icons';

test('names reported by Agents and their clients find their marks', () => {
  const cases = {
    'claude-code': 'claude-code', '@zed-industries/claude-code-acp': 'claude-code', 'ClaudeCode': 'claude-code',
    'codex-mcp-client': 'codex', 'codex-acp': 'codex', 'OpenCode': 'opencode', 'opencode-oc-study2': 'opencode',
    'deepseek-harness-acp': 'deepseek-harness', 'dsh-deepseek-agent': 'deepseek-harness', 'DeepSeek V4.1': 'deepseek',
    'hermes-agent-yonghe': 'hermes', 'WorkBuddy.Agent': 'workbuddy', 'GPT-5.6': 'openai', 'Anthropic': 'anthropic',
    'claude-sonnet-4.5': 'anthropic', 'github-copilot': 'github-copilot', 'Copilot': 'copilot', 'qwen-code': 'qwen-code', 'Qwen3': null,
  };
  for (const [name, id] of Object.entries(cases)) assert.equal(agentIcon(name)?.id ?? null, id, name);
});

test('an alias matches whole words only', () => {
  for (const name of ['My-research-agent', 'dshell', 'xiayh', 'metadata-agent', 'sparkle', 'mcp']) assert.equal(agentIcon(name), null, name);
});

test('Agent products are named as themselves; other names stay as given', () => {
  assert.equal(agentName('hermes-agent-yonghe'), 'Hermes Agent');
  assert.equal(agentName('dsh-deepseek-agent'), 'DeepSeek Harness');
  assert.equal(agentName('WorkBuddy.Agent'), 'WorkBuddy');
  assert.equal(agentName('DeepSeek V4.1'), 'DeepSeek V4.1');
  assert.equal(agentName('My-research-agent'), 'My-research-agent');
});

test('every icon is an inert image', () => {
  assert.ok(icons.length >= 60);
  for (const icon of icons) {
    assert.match(icon.src, /^data:image\/(svg\+xml,|png;base64,)/, icon.id);
    if (icon.src.startsWith('data:image/svg')) {
      const svg = decodeURIComponent(icon.src.slice('data:image/svg+xml,'.length));
      assert.doesNotMatch(svg, /<script|\son[a-z]+\s*=|href\s*=\s*["'](?!#)/i, icon.id);
      assert.match(svg, /^<svg width="24" height="24"/, icon.id);
    }
  }
  assert.equal(agentIconById('deepseek-harness')?.src, agentIconById('deepseek')?.src);
});
