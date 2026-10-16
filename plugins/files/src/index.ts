import * as fs from 'node:fs/promises';
import path from 'node:path';
import { atomicBytes, atomicJson, canonical, confined, digest, Fault, now, readJson, requireThat, stateDirectory, type ResourceRef } from '@rho-workspace/plugin-contracts';
import { validateDeclarationEnvelope, publicResource, type Resource, type ResourceStore, type Declaration } from '@rho-workspace/plugin-contracts';
export const fileLimits = { maxFileBytes: 64 * 1024 * 1024, maxResources: 1024, maxArtifactBytes: 512 * 1024 * 1024, maxReadBytes: 65536 };
export class Files {
  limits: typeof fileLimits;
  constructor(public root: string, public projectId: string, limits: Partial<typeof fileLimits> = {}, public validators: DeclarationValidator[] = []) { this.limits = { ...fileLimits, ...limits }; }
  validateDeclaration(declaration: Declaration) {
    validateDeclarationEnvelope(declaration);
    if (declaration.kind === 'file') {
      requireThat(typeof (declaration.format as any).mimeType === 'string' && (declaration.format as any).mimeType.length > 0, 'invalid', 'Declare the original file media type.');
      return;
    }
    const validator = this.validators.find(v => v.kind === declaration.kind);
    requireThat(validator, 'unavailable', 'The resource type plugin is not selected.', { kind: declaration.kind });
    validator.validate(declaration);
  }
  private async registryFile() { this.root = await fs.realpath(this.root); return path.join(await stateDirectory(this.root, '.rho/plugins'), 'resources.json'); }
  async list() { return readJson<Resource[]>(await this.registryFile(), []); }
  private async storedBytes() {
    let bytes = 0, files = 0;
    const walk = async (dir: string) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        requireThat(!e.isSymbolicLink(), 'scope', 'Artifact storage contains a symbolic link.');
        if (e.isDirectory()) await walk(path.join(dir, e.name));
        else { files++; bytes += (await fs.stat(path.join(dir, e.name))).size; }
        requireThat(files <= this.limits.maxResources * 8, 'limit', 'Artifact snapshot retention is full.', { limit: 'maxResources', multiplier: 8 });
      }
    };
    for (const name of ['snapshots', 'restored']) await walk(await stateDirectory(this.root, '.rho/plugins/' + name));
    return bytes;
  }
  async restore(metadata: Resource, data: Uint8Array) {
    requireThat(/^[a-f0-9]{64}$/.test(metadata.id) && digest(data) === metadata.version && metadata.bytes === data.length, 'condition', 'Restored resource identity or bytes failed verification.');
    requireThat(data.length <= this.limits.maxFileBytes, 'limit', 'Restored resource exceeds the file byte limit.', { limit: 'maxFileBytes' });
    const registry = await this.list();
    const existing = registry.find(r => r.id === metadata.id);
    if (existing) return { resource: { id: existing.id, version: existing.version }, state: existing.version === metadata.version ? 'available' : 'conflict' };
    requireThat(registry.length < this.limits.maxResources && await this.storedBytes() + data.length <= this.limits.maxArtifactBytes, 'limit', 'Restored resources exhaust the artifact budget.', { limit: 'maxArtifactBytes' });
    const directory = await stateDirectory(this.root, '.rho/plugins/restored/' + metadata.id);
    const target = path.join(directory, metadata.version);
    await atomicBytes(target, data);
    const relative = path.relative(this.root, target);
    const r: Resource = { ...metadata, path: relative, storage: relative, projectId: this.projectId, provenance: { ...metadata.provenance, restoredFrom: { projectId: metadata.projectId, path: metadata.path } } };
    await atomicJson(await this.registryFile(), [...registry, r]);
    return { resource: { id: r.id, version: r.version }, state: 'available' };
  }
  async resolve(ref: ResourceRef) {
    const r = (await this.list()).find(x => x.id === ref.id);
    requireThat(r, 'not_found', 'Resource is not registered in this project.', { resource: ref });
    requireThat(r.version === ref.version, 'stale', 'Resource version has changed.', { resource: ref, actualVersion: r.version });
    const original = await confined(this.root, r.path);
    requireThat((await fs.stat(original)).size <= this.limits.maxFileBytes, 'limit', 'Source artifact exceeds its file byte budget.', { limit: 'maxFileBytes' });
    const bytes = await fs.readFile(original);
    requireThat(digest(bytes) === r.version, 'stale', 'Source artifact changed after resource registration.', { resource: ref });
    return r;
  }
  async bytes(ref: ResourceRef) {
    const r = await this.resolve(ref);
    const stored = await confined(this.root, r.storage);
    requireThat((await fs.stat(stored)).size <= this.limits.maxFileBytes, 'limit', 'Stored artifact exceeds its file byte budget.', { limit: 'maxFileBytes' });
    const data = await fs.readFile(stored);
    requireThat(data.length <= this.limits.maxFileBytes && digest(data) === r.version, 'condition', 'Stored resource bytes failed integrity verification.');
    return { r, data };
  }
  async register(relative: string, provenance: Record<string, any>, availability: Resource['availability'], coverage: Record<string, any> = {}, declaration: Declaration = { path: relative, kind: 'file', format: { mimeType: 'application/octet-stream' } }, expectedDigest?: string) {
    this.validateDeclaration(declaration);
    const source = await confined(this.root, relative);
    const stat = await fs.stat(source);
    requireThat(stat.isFile() && stat.size <= this.limits.maxFileBytes, 'limit', 'Artifact exceeds the configured read limit.', { limit: 'maxFileBytes', maximum: this.limits.maxFileBytes });
    const data = await fs.readFile(source); const sha = digest(data);
    requireThat(!expectedDigest || sha === expectedDigest, 'stale', 'File bytes changed before resource registration.');
    const registry = await this.list();
    // Declaration identity is immutable even when equal bytes have different schemas.
    const id = digest(canonical([provenance.operationId, relative, declaration]));
    const old = registry.find(r => r.id === id);
    requireThat(old || registry.length < this.limits.maxResources, 'limit', 'Resource catalog is full; retained artifacts are preserved.', { limit: 'maxResources' });
    const snapshots = await stateDirectory(this.root, '.rho/plugins/snapshots');
    const storage = path.relative(this.root, path.join(snapshots, sha));
    try { await fs.access(path.join(snapshots, sha)); } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
      requireThat(await this.storedBytes() + data.length <= this.limits.maxArtifactBytes, 'limit', 'Registered artifact storage budget reached; earlier snapshots are retained.', { limit: 'maxArtifactBytes', maximum: this.limits.maxArtifactBytes });
      await atomicBytes(path.join(snapshots, sha), data);
    }
    const resource: Resource = { id, version: sha, projectId: this.projectId, owner: 'rho-plugins.' + declaration.kind, kind: declaration.kind, path: relative, bytes: data.length, provenance, coverage, availability, storage, format: declaration.format };
    await atomicJson(await this.registryFile(), [...registry.filter(r => r.id !== id), resource]);
    return resource;
  }
  async read(ref: ResourceRef, offset: number, maxBytes = this.limits.maxReadBytes) {
    requireThat(maxBytes <= this.limits.maxReadBytes && offset >= 0, 'limit', 'Resource read exceeds the configured byte page.', { limit: 'maxReadBytes', maximum: this.limits.maxReadBytes });
    const { r, data } = await this.bytes(ref);
    requireThat(offset <= data.length, 'invalid', 'Offset is beyond the resource.');
    const nextOffset = Math.min(data.length, offset + maxBytes);
    return { resource: publicResource(r), encoding: 'base64', data: data.subarray(offset, nextOffset).toString('base64'), offset, nextOffset, more: nextOffset < data.length };
  }
}

export { publicResource, type Resource } from '@rho-workspace/plugin-contracts';
export interface DeclarationValidator { kind: string; validate(declaration: Declaration): void }

async function completion(root: string, run: any, resources: ResourceStore) {
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
export async function collectArtifacts(root: string, projectId: string, run: any, resources: ResourceStore) {
  // Historical frozen operations remain observable without the removed recipe.
  if (!Array.isArray(run.plan.source.artifacts)) return { resources: (await resources.list()).filter(r => r.provenance.operationId === run.operationId).map(publicResource), integrity: run.integrity, domain: run.domain };
  if (!run.plan.output) return { resources: [], integrity: { state: 'not-applicable' }, domain: { state: 'unchecked' } };
  const manifest = await completion(root, run, resources);
  const collected: Omit<Resource, 'storage'>[] = [], missing: string[] = [], unavailable: { path: string; kind: string; reason: string }[] = [];
  for (const d of run.plan.source.artifacts as Declaration[]) {
    const relative = path.join(run.plan.output, d.path);
    try {
      await confined(path.join(root, run.plan.output), d.path);
      collected.push(publicResource(await resources.register(relative, { operationId: run.operationId, core: run.core, action: run.action, actionVersion: run.actionVersion, codeDigest: digest(run.plan.code), source: run.plan.source, inputs: run.plan.source.inputs }, manifest ? 'available' : 'partial', { completionDeclaration: manifest ? 'present' : 'absent', observedAt: now() }, { ...d, path: relative })));
    } catch (e: any) {
      if (e instanceof Fault && e.kind === 'unavailable') { unavailable.push({ path: d.path, kind: d.kind, reason: e.message }); continue; }
      if (e.code !== 'ENOENT') throw e; missing.push(d.path);
    }
  }
  const retained = (await resources.list()).filter(r => r.provenance.operationId === run.operationId && !collected.some(c => c.id === r.id)).map(publicResource);
  return { resources: [...collected, ...retained], integrity: { state: manifest && !unavailable.length ? 'declared' : 'incomplete', missing, ...(unavailable.length ? { unavailable } : {}), completionDeclaration: manifest ? 'present' : 'absent' }, domain: { state: 'unchecked', scope: 'Project check reports are separate declared resources; no domain judgment is inferred.' } };
}
export async function verifyArtifacts(root: string, run: any, resources: ResourceStore) {
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
  return { ...facts, integrity: { ...facts.integrity, state: 'verified', files: declared.length, checkedAt: now(), manifestDigest: digest(JSON.stringify(manifest)) } };
}

export const plugin = { id: 'files', package: '@rho-workspace/plugin-files', version: '0.4.0', requires: [], capabilities: ['files'] };
