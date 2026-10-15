import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { atomicBytes, atomicJson, canonical, confined, digest, Fault, now, readJson, requireThat, stateDirectory, type ResourceRef } from './common.js';
export interface Resource {
  id: string; version: string; projectId: string; owner: string; kind: 'file' | 'table' | 'plot' | 'model'; path: string; bytes: number;
  provenance: Record<string, any>; coverage: Record<string, any>; availability: 'available' | 'partial' | 'missing' | 'unknown'; storage: string; format?: string;
}
export const publicResource = ({ storage, format, ...resource }: Resource) => resource;
export const resourceLimits = { maxFileBytes: 64 * 1024 * 1024, maxResources: 1024, maxArtifactBytes: 512 * 1024 * 1024, maxRows: 100000, maxPageRows: 1000, maxPoints: 20000, maxReadBytes: 65536 };
export class Resources {
  limits: typeof resourceLimits;
  constructor(public root: string, public projectId: string, limits: Partial<typeof resourceLimits> = {}) { this.limits = { ...resourceLimits, ...limits }; }
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
  async register(relative: string, provenance: Record<string, any>, availability: Resource['availability'], coverage: Record<string, any> = {}) {
    const source = await confined(this.root, relative);
    const stat = await fs.stat(source);
    requireThat(stat.isFile() && stat.size <= this.limits.maxFileBytes, 'limit', 'Artifact exceeds the configured read limit.', { limit: 'maxFileBytes', maximum: this.limits.maxFileBytes });
    const data = await fs.readFile(source); const sha = digest(data);
    const registry = await this.list();
    const id = digest(provenance.operationId + ':' + relative);
    const old = registry.find(r => r.id === id);
    requireThat(old || registry.length < this.limits.maxResources, 'limit', 'Resource catalog is full; retained artifacts are preserved.', { limit: 'maxResources' });
    const snapshots = await stateDirectory(this.root, '.rho/plugins/snapshots');
    const storage = path.relative(this.root, path.join(snapshots, sha));
    try { await fs.access(path.join(snapshots, sha)); } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
      requireThat(await this.storedBytes() + data.length <= this.limits.maxArtifactBytes, 'limit', 'Registered artifact storage budget reached; earlier snapshots are retained.', { limit: 'maxArtifactBytes', maximum: this.limits.maxArtifactBytes });
      await atomicBytes(path.join(snapshots, sha), data);
    }
    const kind = relative.endsWith('.csv') || relative.endsWith('.comparison.json') ? 'table' : relative.endsWith('.rds') ? 'model' : relative.endsWith('.pdf') ? 'plot' : 'file';
    const resource: Resource = { id, version: sha, projectId: this.projectId, owner: 'rho-plugins.airway', kind, path: relative, bytes: data.length, provenance, coverage, availability, storage, format: relative.endsWith('.comparison.json') ? 'comparison' : undefined };
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
  async rows(ref: ResourceRef): Promise<{ resource: Resource; rows: Record<string, any>[]; columns: { name: string; type: string }[]; entityKey: string | null }> {
    const { r, data } = await this.bytes(ref);
    requireThat(r.kind === 'table', 'invalid', 'This resource is not table data.');
    if (r.format === 'comparison') {
      const parsed = JSON.parse(data.toString());
      // A comparison remains bound to BOTH current input versions.
      for (const input of parsed.inputs) await this.resolve(input);
      return { resource: r, rows: parsed.rows, columns: parsed.columns, entityKey: 'gene_id' };
    }
    const strings: Record<string, string>[] = parse(data, { columns: true, bom: true, skip_empty_lines: true, max_record_size: 1024 * 1024 });
    requireThat(strings.length <= this.limits.maxRows, 'limit', 'Table exceeds the bounded in-memory row reader.', { limit: 'maxRows' });
    const names = strings.length ? Object.keys(strings[0]!) : [];
    const columns = names.map(name => ({ name, type: ['gene_id', 'symbol', 'analysis_id', 'sample_id', 'cell', 'dex'].includes(name) ? 'string' : name === 'beta_converged' ? 'boolean' : strings.every(row => ['', 'NA'].includes(row[name]!) || Number.isFinite(Number(row[name]))) ? 'number' : 'string' }));
    const rows = strings.map(row => Object.fromEntries(columns.map(col => [col.name, ['', 'NA'].includes(row[col.name]!) ? null : col.type === 'number' ? Number(row[col.name]) : col.type === 'boolean' ? row[col.name] === 'TRUE' : row[col.name]])));
    const entityKey = names.includes('gene_id') && new Set(rows.map(r => r.gene_id)).size === rows.length && rows.every(r => typeof r.gene_id === 'string') ? 'gene_id' : null;
    return { resource: r, rows, columns, entityKey };
  }
  async page(ref: ResourceRef, offset: number, limit: number, sort?: any, filter?: any) {
    requireThat(limit <= this.limits.maxPageRows, 'limit', 'Table page exceeds the row budget.', { limit: 'maxPageRows', maximum: this.limits.maxPageRows });
    const table = await this.rows(ref); let rows = table.rows;
    if (filter) {
      const col = table.columns.find(c => c.name === filter.column);
      requireThat(col, 'invalid', 'Filter column is unavailable.');
      requireThat(filter.op === 'isNull' || filter.value === null || typeof filter.value === col.type, 'invalid', 'Filter value does not match the column type.');
      requireThat(!['lt', 'gt'].includes(filter.op) || col.type === 'number', 'invalid', 'Ordered filters require a numeric column.');
      rows = rows.filter(r => filter.op === 'isNull' ? r[col.name] === null : filter.op === 'eq' ? r[col.name] === filter.value : r[col.name] !== null && (filter.op === 'lt' ? r[col.name] < filter.value : r[col.name] > filter.value));
    }
    if (sort) {
      requireThat(table.columns.some(c => c.name === sort.column), 'invalid', 'Sort column is unavailable.');
      rows = [...rows].sort((a, b) => {
        const x = a[sort.column], y = b[sort.column];
        if (x === null || y === null) return x === y ? String(a.gene_id).localeCompare(String(b.gene_id)) : x === null ? 1 : -1;
        return (x === y ? 0 : x < y ? -1 : 1) * (sort.direction === 'desc' ? -1 : 1) || String(a.gene_id).localeCompare(String(b.gene_id));
      });
    }
    return { resource: publicResource(table.resource), columns: table.columns, total: table.rows.length, filtered: rows.length, offset, nextOffset: Math.min(rows.length, offset + limit), more: offset + limit < rows.length, rows: rows.slice(offset, offset + limit), entityKey: table.entityKey };
  }
  async plot(ref: ResourceRef, maxPoints = this.limits.maxPoints) {
    requireThat(maxPoints <= this.limits.maxPoints, 'limit', 'Plot request exceeds the point budget.', { limit: 'maxPoints', maximum: this.limits.maxPoints });
    const table = await this.rows(ref);
    requireThat(table.entityKey === 'gene_id', 'condition', 'Interactive gene plots require unique stable gene identities.');
    const comparison = table.columns.some(c => c.name === 'y');
    requireThat(comparison || table.columns.some(c => c.name === 'baseMean') && table.columns.some(c => c.name === 'log2FoldChange'), 'invalid', 'This table does not expose registered scatter coordinates.');
    const stride = Math.max(1, Math.ceil(table.rows.length / maxPoints));
    return { resource: publicResource(table.resource), spec: { type: 'scatter', entityKey: 'gene_id', x: comparison ? 'x' : 'baseMean', y: comparison ? 'y' : 'log2FoldChange', missing: 'null', source: 'component-table-data' }, points: table.rows.filter((_, i) => i % stride === 0).map(r => ({ gene_id: r.gene_id, symbol: r.symbol, x: comparison ? r.x : r.baseMean, y: comparison ? r.y : r.log2FoldChange })), originalPoints: table.rows.length, downsampled: stride > 1, method: stride > 1 ? 'deterministic-stride' : 'none' };
  }
  async compare(baseline: ResourceRef, shrinkage: ResourceRef) {
    const a = await this.rows(baseline), b = await this.rows(shrinkage);
    requireThat(a.entityKey === 'gene_id' && b.entityKey === 'gene_id', 'condition', 'Comparison inputs require unique stable gene identities.');
    requireThat(a.columns.some(c => c.name === 'log2FoldChange') && b.columns.some(c => c.name === 'log2FoldChange'), 'invalid', 'Both inputs must expose gene fold changes.');
    requireThat(b.resource.provenance.baseline?.id === baseline.id && b.resource.provenance.baseline?.version === baseline.version, 'condition', 'Shrinkage was not derived from the selected baseline version.');
    const byId = new Map(b.rows.map(r => [r.gene_id, r]));
    const rows = a.rows.map(r => ({ gene_id: r.gene_id, symbol: r.symbol, x: r.log2FoldChange, y: byId.get(r.gene_id)?.log2FoldChange ?? null }));
    const columns = [{ name: 'gene_id', type: 'string' }, { name: 'symbol', type: 'string' }, { name: 'x', type: 'number' }, { name: 'y', type: 'number' }];
    const key = digest(canonical([baseline, shrinkage]));
    const relative = '.rho/plugins/comparisons/' + key + '.comparison.json';
    await stateDirectory(this.root, '.rho/plugins/comparisons');
    await atomicJson(await confined(this.root, relative, true), { inputs: [baseline, shrinkage], columns, rows });
    return publicResource(await this.register(relative, { operationId: 'comparison:' + key, inputs: [baseline, shrinkage], contrast: 'dex:trt:untrt', models: [a.resource.provenance, b.resource.provenance] }, 'available', { total: rows.length, missingY: rows.filter(r => r.y === null).length }));
  }
}
