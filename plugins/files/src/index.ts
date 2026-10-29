import { skillPresentation, presentation, operationPresentation } from './presentation.js';
import { operationContracts } from './operations.js';
import { verifyFile, snapshotFile, readRange } from './byte-store.js';
import type { FilePaths } from './paths.js';
export { ProjectPaths, type FilePaths, type SourceFolder } from './paths.js';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { atomicBytes, atomicJson, canonical, confined, digest, Fault, now, readJson, requireThat, stateDirectory, type ResourceRef, objectSchema as obj, text } from '@rho-workspace/plugin-contracts';
import { validateDeclarationEnvelope, publicResource, type Resource, type ResourceStore, type Declaration } from '@rho-workspace/plugin-contracts';

const declaredSkill = (id: string, content: string, version = '1.0') => ({ id, version, content, digest: digest(content) });
export const fileLimits = { maxFileBytes: 64 * 1024 * 1024, maxResources: 1024, maxArtifactBytes: 512 * 1024 * 1024, maxReadBytes: 65536 };
export class Files {
  limits: typeof fileLimits;
  constructor(public root: string, public projectId: string, limits: Partial<typeof fileLimits> = {}, public validators: DeclarationValidator[] = [], private paths?: FilePaths) { this.limits = { ...fileLimits, ...limits }; }
  async sourceFile(relative: string, missing = false) { return this.paths ? this.paths.resolve(relative, missing) : { file: await confined(this.root, relative, missing), relative }; }
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
  // An observation is independent of the original path. Registration deliberately
  // retains its live-file check; capture imports verified bytes under a new identity.
  async capture(relative: string, options: { expectedDigest?: string; declaration?: Declaration; maxBytes?: number; describe?: (data: Buffer, path: string) => Declaration } = {}) {
    requireThat(!path.isAbsolute(relative) && !relative.split(/[\\/]/).some(p => ['..', '.rho', '.git'].includes(p)), 'scope', 'Capture an ordinary project file outside internal state.');
    const source = await this.sourceFile(relative);
    requireThat(await fs.realpath(source.file) === source.file, 'scope', 'A capture cannot follow a symbolic link.');
    const maximum = Math.min(options.maxBytes ?? 8 * 1024 * 1024, this.limits.maxFileBytes);
    const checked = await verifyFile(source.file, maximum, options.expectedDigest);
    const { data } = await readRange(source.file, maximum, checked.digest, 0, checked.bytes);
    const declaration = options.declaration ?? options.describe?.(data, source.relative) ?? { path: source.relative, kind: 'file', format: { mimeType: /\.(R|r|py|md|txt|json|csv|tsv|qmd|Rmd|sh|sql)$/.test(relative) ? 'text/plain' : 'application/octet-stream' } };
    requireThat(declaration.path === source.relative || declaration.path === relative, 'invalid', 'The declaration must name the captured file.');
    return this.captureBytes(data, { ...declaration, path: source.relative }, { kind: 'disk', path: source.relative }, checked.digest);
  }
  async captureBytes(data: Uint8Array, declaration: Declaration, source: Record<string, unknown>, expectedDigest?: string) {
    this.validateDeclaration(declaration);
    const version = digest(data);
    requireThat(!expectedDigest || expectedDigest === version, 'stale', 'Captured bytes differ from the expected version.');
    requireThat(data.length <= Math.min(this.limits.maxFileBytes, 8 * 1024 * 1024), 'limit', 'Capture exceeds the 8 MiB snapshot budget.');
    const id = digest(canonical({ capture: 1, declaration, version, source }));
    const old = (await this.list()).find(r => r.id === id);
    if (old) return publicResource(await this.resolve({ id, version }));
    const observedAt = now();
    const imported = await this.restore({ id, version, projectId: this.projectId, owner: 'rho-plugins.' + declaration.kind, kind: declaration.kind,
      path: declaration.path, bytes: data.length, storage: '', format: declaration.format, availability: 'available',
      provenance: { source: 'captured-observation', originalPath: declaration.path, observation: source, producerConfirmed: false }, coverage: { observedAt } }, data);
    requireThat(imported.state === 'available', 'conflict', 'A captured resource conflicts with retained bytes.');
    return publicResource(await this.resolve({ id, version }));
  }
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
    const { file: original } = await this.sourceFile(r.path);
    await verifyFile(original, this.limits.maxFileBytes, r.version);
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
    const { file: source, relative: normalized } = await this.sourceFile(relative);
    relative = normalized;
    const checked = await verifyFile(source, this.limits.maxFileBytes, expectedDigest), sha = checked.digest;
    const registry = await this.list();
    // Declaration identity is immutable even when equal bytes have different schemas.
    const id = digest(canonical([provenance.operationId, relative, declaration]));
    const old = registry.find(r => r.id === id);
    requireThat(old || registry.length < this.limits.maxResources, 'limit', 'Resource catalog is full; retained artifacts are preserved.', { limit: 'maxResources' });
    const snapshots = await stateDirectory(this.root, '.rho/plugins/snapshots');
    const storage = path.relative(this.root, path.join(snapshots, sha));
    try { await fs.access(path.join(snapshots, sha)); } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
      const remaining = this.limits.maxArtifactBytes - await this.storedBytes();
      requireThat(checked.bytes <= remaining, 'limit', 'Registered artifact storage budget reached; earlier snapshots are retained.', { limit: 'maxArtifactBytes', maximum: this.limits.maxArtifactBytes });
      await snapshotFile(source, snapshots, Math.min(this.limits.maxFileBytes, remaining), sha);
    }
    const resource: Resource = { id, version: sha, projectId: this.projectId, owner: 'rho-plugins.' + declaration.kind, kind: declaration.kind, path: relative, bytes: checked.bytes, provenance, coverage, availability, storage, format: declaration.format };
    await atomicJson(await this.registryFile(), [...registry.filter(r => r.id !== id), resource]);
    return resource;
  }
  async read(ref: ResourceRef, offset: number, maxBytes = this.limits.maxReadBytes) {
    requireThat(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= this.limits.maxReadBytes && Number.isSafeInteger(offset) && offset >= 0, 'limit', 'Resource read exceeds the configured byte page.', { limit: 'maxReadBytes', maximum: this.limits.maxReadBytes });
    const r = await this.resolve(ref);
    const { data, total } = await readRange(await confined(this.root, r.storage), this.limits.maxFileBytes, r.version, offset, maxBytes);
    const nextOffset = offset + data.length;
    return { resource: publicResource(r), encoding: 'base64', data: data.toString('base64'), offset, nextOffset, more: nextOffset < total, maxReadBytes: this.limits.maxReadBytes };
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
    const checked = await verifyFile(file, resources.limits.maxFileBytes);
    requireThat(checked.bytes === item.bytes && checked.digest === item.sha256, 'condition', 'Manifest entry failed byte verification.', { artifact: item.path });
  }
  const facts = await collectArtifacts(root, run.projectId, run, resources);
  return { ...facts, integrity: { ...facts.integrity, state: 'verified', files: declared.length, checkedAt: now(), manifestDigest: digest(JSON.stringify(manifest)) } };
}

const filesSkillContent = [
  'Keep resource identity and provenance explicit: bytes, a version, and where they came from.',
  'Use capability.list to discover resource.list, resource.read, resource.register and artifact.check.',
  '',
  '1. resource.register declares existing bytes with their kind and format, and requires',
  '   expectedDigest of the current content. The returned {id, version} names those exact',
  '   bytes; when the file changes, both change and old pages become stale on purpose.',
  'Use resource.capture for immutable historical evidence: a project path or an exact Documents buffer version. A capture records observed bytes, not their producer or scientific validity.',
  '2. resource.read is a bounded byte read with offset; resource.list reports retained',
  '   resources with availability. Reads never start a runtime and never execute R.',
  '3. artifact.check verifies the artifacts one run declared, against the completion',
  '   inventory the producer wrote. Without a declared inventory there is nothing to',
  '   check, and a missing inventory is not evidence of a missing artifact.',
  '4. resource.list and artifact.check return registered references for declared run',
  '   artifacts, including owner-state files. Bind those references directly to a view;',
  '   resource.register remains limited to ordinary project files.',
  '',
  'Declare a table key and namespace at registration if a later comparison or plot needs',
  'entity identity; an unkeyed table stays readable but has no identity to compare on.'
].join('\n');
const filesSkill = {
  ...declaredSkill('files.workspace', filesSkillContent, '1.1'),
  intent: 'Register existing bytes with explicit identity, read them bounded, and verify produced artifacts.',
  requires: ['resource.register', 'resource.read', 'resource.list', 'artifact.check'],
  example: {
    method: 'resource.register',
    input: {
      expectedDigest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      declaration: { path: 'data/points.csv', kind: 'table', format: { encoding: 'csv', columns: [{ name: 'id', type: 'string', nullValues: [] }, { name: 'value', type: 'number', nullValues: ['', 'NA'] }], key: { column: 'id', namespace: 'samples' } } }
    }
  },
  failureRecipes: [
    { kind: 'stale', message: 'Registered bytes no longer match the declaration digest.', next: 'Re-read the file and register the current digest as a new version; keep the old one for what already cited it.' },
    { kind: 'scope', message: 'Register a project file outside internal state.', next: 'Register project files only; an artifact under .rho is checked with artifact.check.' },
    { kind: 'invalid', message: 'Declared columns do not match the file.', next: 'Declare every column with its type and the null values that mean missing.' },
    { kind: 'condition', message: 'No complete artifact inventory has been declared.', next: 'Have the producer write the completion inventory, then call artifact.check.' }
  ],
  verify: { command: 'npm run test:files', description: 'A completion sidecar verifies immutable producer bytes, escaping output declarations are refused, and declared output directories exist before the producer runs.' }
};
export const plugin = {
  entryVersion: '1.0',
  id: 'files', package: '@rho-workspace/plugin-files', version: '0.5.0', requires: [], capabilities: ['files'], presentation,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })),
  skills: [{ ...filesSkill, presentation: skillPresentation }]
};
