// A Claude Code plugin directory assembled from the skills and hooks that selected plugins
// declare for the Claude Code sessions an application starts: a manifest, one SKILL.md per
// skill and hooks/hooks.json with the commands the application resolved. The directory is
// named by the digest of its content and never changes once written, so sessions that started
// from it keep reading the same skills. Nothing private is written into it.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest, requireThat } from '@rho-workspace/plugin-contracts';

// The protected resource is the session's own context and start-up: at most this many skills
// and hooks, each skill at most this large. More is refused before anything is written.
export const claudePluginLimits = { maxSkills: 32, maxHooks: 16, maxSkillBytes: 65536 };
export interface ClaudePluginSkill { name: string; description: string; content: string }
export interface ClaudePluginHook { event: 'PreToolUse' | 'PostToolUse'; matcher: string; command: { file: string; args: string[] }; timeoutSeconds?: number }
export interface ClaudePlugin { name: string; version: string; description: string; skills: ClaudePluginSkill[]; hooks: ClaudePluginHook[] }

const name = /^[a-z0-9][a-z0-9-]{0,63}$/;
// One shell word for any string: hook commands run through the shell.
const word = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

export async function writeClaudePlugin(parent: string, plugin: ClaudePlugin, limits = claudePluginLimits): Promise<string> {
  requireThat(name.test(plugin.name) && /^[0-9A-Za-z.+-]{1,64}$/.test(plugin.version) && plugin.description.length <= 1024, 'invalid', 'A Claude Code plugin needs a lowercase name, a version and a short description.');
  requireThat(plugin.skills.length <= limits.maxSkills && plugin.hooks.length <= limits.maxHooks, 'limit', 'Too many skills or hooks for one Claude Code plugin.', { limit: plugin.skills.length > limits.maxSkills ? 'maxSkills' : 'maxHooks' });
  for (const s of plugin.skills) requireThat(name.test(s.name) && s.description.length > 0 && s.description.length <= 1024 && !/[\r\n]/.test(s.description) && Buffer.byteLength(s.content) <= limits.maxSkillBytes, 'invalid', 'Each skill needs a lowercase name, a one-line description and content within maxSkillBytes.', { skill: s.name });
  requireThat(new Set(plugin.skills.map(s => s.name)).size === plugin.skills.length, 'invalid', 'Skill names must be unique.');
  for (const h of plugin.hooks) requireThat(['PreToolUse', 'PostToolUse'].includes(h.event) && /^[A-Za-z0-9_|*]{1,256}$/.test(h.matcher) && path.isAbsolute(h.command.file) && (h.timeoutSeconds ?? 10) > 0 && (h.timeoutSeconds ?? 10) <= 60, 'invalid', 'Each hook needs a known event, a tool matcher, an absolute command and a timeout of at most 60 s.');
  const files: Record<string, string> = {
    '.claude-plugin/plugin.json': JSON.stringify({ name: plugin.name, version: plugin.version, description: plugin.description }, null, 2) + '\n'
  };
  for (const s of plugin.skills) files[`skills/${s.name}/SKILL.md`] = `---\nname: ${s.name}\ndescription: ${JSON.stringify(s.description)}\n---\n\n${s.content.trimEnd()}\n`;
  if (plugin.hooks.length) {
    const hooks: Record<string, unknown[]> = {};
    for (const h of plugin.hooks) (hooks[h.event] ??= []).push({ matcher: h.matcher, hooks: [{ type: 'command', command: [h.command.file, ...h.command.args].map(word).join(' '), timeout: h.timeoutSeconds ?? 10 }] });
    files['hooks/hooks.json'] = JSON.stringify({ hooks }, null, 2) + '\n';
  }
  const target = path.join(parent, plugin.name + '-' + digest(canonical(files)).slice(0, 16));
  if (await fs.stat(path.join(target, '.claude-plugin', 'plugin.json')).then(() => true, () => false)) return target;
  // Written aside and renamed into place whole; a concurrent writer of the same content wins.
  const staging = path.join(parent, '.staging-' + randomUUID());
  try {
    for (const [file, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(staging, file)), { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(staging, file), text, { mode: 0o600 });
    }
    await fs.rename(staging, target).catch(async (e: any) => { if (!['EEXIST', 'ENOTEMPTY'].includes(e.code)) throw e; });
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
  return target;
}
