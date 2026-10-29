#!/usr/bin/env node
// Claude Code PreToolUse hook declared by Documents. A native Edit or Write works from the
// file on disk; when that file has unsaved text in a Rho buffer, the Agent would neither see
// nor keep it. The hook refuses that one native write and names the buffer to change instead.
// Every other file, and anything the hook cannot read, passes unchanged: the native permission
// flow and the owner's merge of disk changes still apply. It reads only this owner's records
// in the project, never creates them, and needs no connection or credential.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { digest } from '@rho-workspace/plugin-contracts';
import { Documents, mergeText, span } from './index.js';

// maxProposalBytes bounds the ready document.edit input placed in the refusal; past it the
// refusal only names the buffer and the Agent reads it itself.
export const hookLimits = { maxInputBytes: 65536, maxLevels: 32, maxProposalBytes: 16384 };
const tools = new Set(['Edit', 'Write', 'MultiEdit']);

// The nearest folder at or above the session's folder that holds Documents records.
async function projectRoot(cwd: string) {
  let at = path.resolve(cwd);
  for (let level = 0; level < hookLimits.maxLevels; level++) {
    const stat = await fs.lstat(path.join(at, '.rho', 'plugins', 'documents')).catch(() => null);
    if (stat?.isDirectory()) return at;
    const up = path.dirname(at);
    if (up === at) return null;
    at = up;
  }
  return null;
}

// What the native tool would have written from the disk text it read; null when that is not
// determined (the text to replace is missing, or found more than once without replace_all).
function intended(tool: string, input: any, disk: string): string | null {
  const replace = (text: string | null, e: any) => {
    if (text === null || typeof e?.old_string !== 'string' || !e.old_string || typeof e.new_string !== 'string') return null;
    const parts = text.split(e.old_string);
    if (e.replace_all === true) return parts.length > 1 ? parts.join(e.new_string) : null;
    return parts.length === 2 ? parts[0] + e.new_string + parts[1] : null;
  };
  if (tool === 'Write') return typeof input?.content === 'string' ? input.content : null;
  if (tool === 'Edit') return replace(disk, input);
  if (tool === 'MultiEdit' && Array.isArray(input?.edits)) return input.edits.reduce((text: string | null, e: any) => replace(text, e), disk);
  return null;
}
// The native change carried into the buffer: merged by line with its unsaved text against the
// disk text the Agent read, as one document.edit input. Null when the disk no longer matches the
// buffer's base, the change is not determined or it touches the same lines as that text.
async function proposal(documents: Documents, doc: any, file: string, tool: string, input: any) {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size > documents.limits.maxBufferBytes) return null;
  const bytes = await fs.readFile(file);
  if (digest(bytes) !== doc.diskDigest) return null;
  let disk: string;
  try { disk = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
  const theirs = intended(tool, input, disk);
  const merged = theirs === null ? null : mergeText(disk, doc.content, theirs);
  if (merged === null) return null;
  if (merged === doc.content) return 'present';
  const { removed, ...edit } = span(doc.content, merged);
  const ready = JSON.stringify({ documentId: doc.id, expectedVersion: doc.version, expectedRevision: doc.revision, edits: [edit] });
  return Buffer.byteLength(ready) <= hookLimits.maxProposalBytes ? ready : null;
}

async function decide(input: any) {
  if (input?.hook_event_name !== 'PreToolUse' || !tools.has(input.tool_name)) return null;
  const file = input.tool_input?.file_path, cwd = input.cwd;
  if (typeof file !== 'string' || !path.isAbsolute(file) || typeof cwd !== 'string') return null;
  const root = await projectRoot(cwd);
  if (!root) return null;
  // Compared as real paths: the file may not exist yet, its folder must.
  const real = path.join(await fs.realpath(path.dirname(file)), path.basename(file));
  const relative = path.relative(await fs.realpath(root), real);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const documents = new Documents(root), doc = await documents.find(relative.split(path.sep).join('/'));
  if (!doc?.dirty) return null;
  const ready = await proposal(documents, doc, real, input.tool_name, input.tool_input);
  const unsaved = `${doc.path} has unsaved text in Rho that is not on disk, so a native ${input.tool_name} would work from an older file and leave that text out. `;
  const after = ' Your edit stays unsaved beside that text and shows in Rho at once; saving writes that text too, so save only when the file must be on disk, and say so.';
  const reason = ready === 'present' ? unsaved + 'The shared buffer already has this change; there is nothing to edit.' + after
    : ready ? unsaved + 'Make this change in the shared buffer instead: resolve document.edit using rho_index/rho_resolve and rho_call it with this input and a new changeId. '
      + 'It is your ' + input.tool_name + ' applied to the current buffer, keeping that text: ' + ready + '. If it is refused as stale, rho_call document.read and edit from the current text.' + after
    : unsaved + 'Make this change in the shared buffer instead. Resolve document.read and document.edit using rho_index/rho_resolve, then rho_call document.read with '
      + JSON.stringify({ documentId: doc.id }) + ' to see the current text, and document.edit with the expectedVersion and expectedRevision it returns and a new changeId. Keep the text you did not write.' + after;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}

async function main() {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > hookLimits.maxInputBytes) throw new Error('Hook input exceeds maxInputBytes.');
    chunks.push(chunk);
  }
  const decision = await decide(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (decision) await new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify(decision), e => e ? reject(e) : resolve()));
}
main().catch(() => { process.stderr.write('Rho Documents could not check this file for unsaved text; the native tool proceeds.\n'); });
