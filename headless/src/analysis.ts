import * as fs from 'node:fs/promises';
import path from 'node:path';
import { confined, digest, now, readJson, requireThat, stateDirectory } from './common.js';
import { Documents } from './documents.js';
import { libraryPrefix, type Environment } from './requirements.js';
import { Resources, publicResource } from './resources.js';
import { validateDeclaration, type Declaration } from './declarations.js';
export interface ActionPlan { code: string; args: string[]; source: Record<string, any>; output: string | null; completion?: string | null }
export async function planExecution(root: string, input: any, operationId: string, environment: Environment, resources: Resources, documents = new Documents(root)): Promise<ActionPlan> {
  root = await fs.realpath(root);
  let snapshot;
  if (input.script.kind === 'buffer') snapshot = await documents.snapshot(input.script.documentId, input.script.version);
  else {
    requireThat(!input.script.path.split('/').some((p: string) => ['.rho', '.git'].includes(p)), 'scope', 'Select a script outside internal owner state.');
    const file = await confined(root, input.script.path);
    requireThat((await fs.stat(file)).size <= documents.limits.maxBufferBytes, 'limit', 'Saved script exceeds the buffer byte limit.', { limit: 'maxBufferBytes' });
    let code: string;
    try { code = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(file)); }
    catch { requireThat(false, 'invalid', 'Saved script is not valid UTF-8.'); }
    requireThat(digest(code) === input.script.digest, 'stale', 'Saved script bytes changed before submission.');
    snapshot = { code, sha256: digest(code), source: { kind: 'disk', path: input.script.path } };
  }
  const parent = await stateDirectory(root, '.rho/plugins/runs/' + digest(operationId));
  const output = path.join(parent, 'artifacts');
  requireThat(new Set(input.artifacts.map((d: Declaration) => d.path)).size === input.artifacts.length, 'invalid', 'Output paths must be unique.');
  for (const d of input.artifacts) { validateDeclaration(d); await confined(parent, 'artifacts/' + d.path, true); }
  const completionPath = input.completion === null ? null : await confined(parent, input.completion, true);
  const inputs = [], args = [output];
  for (const arg of input.args) {
    if (typeof arg === 'string') args.push(arg);
    else { const r = await resources.resolve(arg.resource); inputs.push(arg.resource); args.push(await confined(root, r.storage)); }
  }
  return { code: libraryPrefix(environment) + snapshot.code, args, source: { ...snapshot.source, sha256: snapshot.sha256, inputs, artifacts: input.artifacts, completion: input.completion, requirements: input.requirements }, output: path.relative(root, output), completion: completionPath && path.relative(root, completionPath) };
}
async function completion(root: string, run: any, resources: Resources) {
  if (!run.plan.completion) return null;
  const location = await confined(root, run.plan.completion, true);
  try {
    requireThat((await fs.stat(location)).size <= resources.limits.maxReadBytes, 'limit', 'Completion manifest exceeds its byte budget.', { limit: 'maxReadBytes' });
    const manifest = await readJson<any>(location);
    requireThat(manifest.schemaVersion === 1 && manifest.complete === true && Array.isArray(manifest.artifacts) && manifest.artifacts.length <= 128, 'condition', 'Completion manifest is invalid.');
    requireThat(manifest.artifacts.every((x: any) => typeof x.path === 'string' && /^[a-f0-9]{64}$/.test(x.sha256) && Number.isSafeInteger(x.bytes) && x.bytes >= 0) && new Set(manifest.artifacts.map((x: any) => x.path)).size === manifest.artifacts.length, 'condition', 'Completion inventory has invalid or duplicate entries.');
    return manifest;
  } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
}
export async function collectArtifacts(root: string, projectId: string, run: any, resources: Resources) {
  // Historical frozen operations remain observable without the removed recipe.
  if (!Array.isArray(run.plan.source.artifacts)) return { resources: (await resources.list()).filter(r => r.provenance.operationId === run.operationId).map(publicResource), integrity: run.integrity, domain: run.domain };
  if (!run.plan.output) return { resources: [], integrity: { state: 'not-applicable' }, domain: { state: 'unchecked' } };
  const manifest = await completion(root, run, resources), collected = [], missing = [];
  for (const d of run.plan.source.artifacts as Declaration[]) {
    const relative = path.join(run.plan.output, d.path);
    try {
      await confined(path.join(root, run.plan.output), d.path);
      collected.push(publicResource(await resources.register(relative, { operationId: run.operationId, core: run.core, action: run.action, actionVersion: run.actionVersion, codeDigest: digest(run.plan.code), source: run.plan.source, inputs: run.plan.source.inputs }, manifest ? 'available' : 'partial', { completionDeclaration: manifest ? 'present' : 'absent', observedAt: now() }, { ...d, path: relative })));
    } catch (e: any) { if (e.code !== 'ENOENT') throw e; missing.push(d.path); }
  }
  return { resources: collected, integrity: { state: manifest ? 'declared' : 'incomplete', missing, completionDeclaration: manifest ? 'present' : 'absent' }, domain: { state: 'unchecked', scope: 'Project check reports are separate declared resources; no domain judgment is inferred.' } };
}
export async function verifyArtifacts(root: string, run: any, resources: Resources) {
  requireThat(Array.isArray(run.plan.source.artifacts), 'unavailable', 'Historical checks remain recorded; install the explicit project consumer to run its checkers again.');
  const manifest = await completion(root, run, resources);
  requireThat(manifest, 'condition', 'No complete artifact inventory has been declared.');
  const declared = run.plan.source.artifacts as Declaration[];
  requireThat(manifest.artifacts.length === declared.length && declared.every(d => manifest.artifacts.some((x: any) => x.path === d.path)), 'condition', 'Completion inventory must cover exactly the selected artifact declarations.');
  for (const item of manifest.artifacts) {
    const file = await confined(await confined(root, run.plan.output), item.path);
    requireThat((await fs.stat(file)).size <= resources.limits.maxFileBytes, 'limit', 'Manifest entry exceeds the file limit.', { limit: 'maxFileBytes' });
    const bytes = await fs.readFile(file);
    requireThat(bytes.length === item.bytes && digest(bytes) === item.sha256, 'condition', 'Manifest entry failed byte verification.', { artifact: item.path });
  }
  const facts = await collectArtifacts(root, run.projectId, run, resources);
  return { ...facts, integrity: { state: 'verified', files: declared.length, checkedAt: now(), manifestDigest: digest(JSON.stringify(manifest)) } };
}
