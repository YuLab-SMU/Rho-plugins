import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { atomicBytes, atomicJson, canonical, confined, digest, Fault, now, readJson, requireThat, stateDirectory, type ResourceRef } from './common.js';
import { validateDeclaration, type Declaration, type TableFormat } from './declarations.js';
export interface Resource {
  id: string; version: string; projectId: string; owner: string; kind: 'file' | 'table' | 'media' | 'object' | 'plot' | 'model'; path: string; bytes: number;
  provenance: Record<string, any>; coverage: Record<string, any>; availability: 'available' | 'partial' | 'missing' | 'unknown'; storage: string; format?: Record<string, any> | string;
}
export const publicResource = ({ storage, ...resource }: Resource) => resource;
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
  async register(relative: string, provenance: Record<string, any>, availability: Resource['availability'], coverage: Record<string, any> = {}, declaration: Declaration = { path: relative, kind: 'file', format: { mimeType: 'application/octet-stream' } }, expectedDigest?: string) {
    validateDeclaration(declaration);
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
  async rows(ref: ResourceRef): Promise<{ resource: Resource; rows: Record<string, any>[]; columns: TableFormat['columns']; entityKey: string | null; namespace: string | null }> {
    const { r, data } = await this.bytes(ref);
    requireThat(r.kind === 'table' && typeof r.format === 'object', 'unavailable', 'Typed reads require an explicit table declaration. Historical bytes remain readable.');
    const f = r.format as TableFormat;
    validateDeclaration({ path: r.path, kind: 'table', format: f });
    let rows: Record<string, any>[];
    if (f.encoding === 'json-rows') {
      const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
      requireThat(Array.isArray(parsed.rows) && (!parsed.inputs || Array.isArray(parsed.inputs) && parsed.inputs.length <= 2), 'invalid', 'Invalid declared JSON rows.');
      for (const input of parsed.inputs ?? []) await this.resolve(input);
      rows = parsed.rows;
    } else {
      const records: string[][] = parse(data, { bom: true, skip_empty_lines: true, max_record_size: 1024 * 1024 });
      const header = records.shift() ?? [];
      requireThat(canonical(header) === canonical(f.columns.map(c => c.name)), 'condition', 'CSV headers do not match the declared columns.');
      requireThat(records.length <= this.limits.maxRows, 'limit', 'Table exceeds the row reader budget.', { limit: 'maxRows' });
      rows = records.map(values => Object.fromEntries(f.columns.map((c, i) => {
        const value = values[i]!;
        if (c.nullValues.includes(value)) return [c.name, null];
        if (c.type === 'number') { requireThat(value.trim() !== '' && Number.isFinite(Number(value)), 'condition', 'A table value violates its declared numeric type.', { column: c.name }); return [c.name, Number(value)]; }
        if (c.type === 'boolean') { requireThat(['TRUE', 'FALSE', 'true', 'false'].includes(value), 'condition', 'A table value violates its declared boolean type.', { column: c.name }); return [c.name, value.toLowerCase() === 'true']; }
        return [c.name, value];
      })));
    }
    requireThat(rows.length <= this.limits.maxRows, 'limit', 'Table exceeds the row reader budget.', { limit: 'maxRows' });
    requireThat(rows.every(row => row && canonical(Object.keys(row).sort()) === canonical(f.columns.map(c => c.name).sort()) && f.columns.every(c => row[c.name] === null || typeof row[c.name] === c.type && (c.type !== 'number' || Number.isFinite(row[c.name])))), 'condition', 'Rows violate the declared table schema.');
    if (f.key) requireThat(rows.every(row => typeof row[f.key!.column] === 'string' && row[f.key!.column].length > 0) && new Set(rows.map(row => row[f.key!.column])).size === rows.length, 'condition', 'Declared entity keys must be nonempty and unique.');
    return { resource: r, rows, columns: f.columns, entityKey: f.key?.column ?? null, namespace: f.key?.namespace ?? null };
  }
  async page(ref: ResourceRef, offset: number, limit: number, sort?: any, filter?: any) {
    requireThat(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= this.limits.maxPageRows, 'limit', 'Table page exceeds the row budget.', { limit: 'maxPageRows', maximum: this.limits.maxPageRows });
    const table = await this.rows(ref); let rows = table.rows;
    if (filter) {
      const col = table.columns.find(c => c.name === filter.column);
      requireThat(col, 'invalid', 'Filter column is unavailable.');
      requireThat(filter.op === 'isNull' || filter.value === null || typeof filter.value === col.type, 'invalid', 'Filter value does not match the column type.');
      requireThat(!['lt', 'gt'].includes(filter.op) || col.type === 'number' && typeof filter.value === 'number', 'invalid', 'Ordered filters require a numeric column and value.');
      rows = rows.filter(r => filter.op === 'isNull' ? r[col.name] === null : filter.op === 'eq' ? r[col.name] === filter.value : r[col.name] !== null && (filter.op === 'lt' ? r[col.name] < filter.value : r[col.name] > filter.value));
    }
    if (sort) {
      requireThat(table.columns.some(c => c.name === sort.column), 'invalid', 'Sort column is unavailable.');
      rows = [...rows].sort((a, b) => {
        const x = a[sort.column], y = b[sort.column];
        const tie = () => table.entityKey ? String(a[table.entityKey]).localeCompare(String(b[table.entityKey])) : 0;
        if (x === null || y === null) return x === y ? tie() : x === null ? 1 : -1;
        return (x === y ? 0 : x < y ? -1 : 1) * (sort.direction === 'desc' ? -1 : 1) || tie();
      });
    }
    return { resource: publicResource(table.resource), columns: table.columns, total: table.rows.length, filtered: rows.length, offset, nextOffset: Math.min(rows.length, offset + limit), more: offset + limit < rows.length, rows: rows.slice(offset, offset + limit), entityKey: table.entityKey, namespace: table.namespace };
  }
  async plot(ref: ResourceRef, x: string, y: string, maxPoints = this.limits.maxPoints) {
    requireThat(Number.isSafeInteger(maxPoints) && maxPoints > 0 && maxPoints <= this.limits.maxPoints, 'limit', 'Plot request exceeds the point budget.', { limit: 'maxPoints', maximum: this.limits.maxPoints });
    const table = await this.rows(ref);
    requireThat(table.entityKey, 'condition', 'Entity interaction requires an explicit unique key and namespace.');
    requireThat([x, y].every(name => table.columns.some(c => c.name === name && c.type === 'number')), 'invalid', 'Declare numeric scatter coordinate fields.');
    const stride = Math.max(1, Math.ceil(table.rows.length / maxPoints));
    return { resource: publicResource(table.resource), spec: { type: 'scatter', entityKey: table.entityKey, namespace: table.namespace, x, y, missing: 'null' }, points: table.rows.filter((_, i) => i % stride === 0).map(r => ({ key: r[table.entityKey!], x: r[x], y: r[y] })), originalPoints: table.rows.length, downsampled: stride > 1, method: stride > 1 ? 'deterministic-stride' : 'none' };
  }
  async compare(left: ResourceRef, right: ResourceRef, options: { leftKey: string; rightKey: string; leftNamespace: string; rightNamespace: string; mapping: 'equal-string'; leftField: string; rightField: string; join: 'left' | 'inner' | 'full' }) {
    const a = await this.rows(left), b = await this.rows(right);
    requireThat(options.mapping === 'equal-string' && a.entityKey && b.entityKey && a.entityKey === options.leftKey && b.entityKey === options.rightKey && a.namespace === options.leftNamespace && b.namespace === options.rightNamespace, 'condition', 'Comparison requires explicit keys and the current input namespaces.');
    requireThat(['left', 'inner', 'full'].includes(options.join) && a.columns.some(c => c.name === options.leftField && c.type === 'number') && b.columns.some(c => c.name === options.rightField && c.type === 'number'), 'invalid', 'Declare a supported join and numeric comparison fields.');
    const ar = new Map(a.rows.map(r => [r[a.entityKey!], r])), br = new Map(b.rows.map(r => [r[b.entityKey!], r]));
    const keys = options.join === 'full' ? [...new Set([...ar.keys(), ...br.keys()])] : [...ar.keys()].filter(k => options.join !== 'inner' || br.has(k));
    requireThat(keys.length <= this.limits.maxRows, 'limit', 'Comparison output exceeds the row budget.', { limit: 'maxRows' });
    const rows = keys.map(key => ({ key, x: ar.get(key)?.[options.leftField] ?? null, y: br.get(key)?.[options.rightField] ?? null }));
    const key = digest(canonical([left, right, options]));
    const relative = '.rho/plugins/comparisons/' + key + '.json';
    await stateDirectory(this.root, '.rho/plugins/comparisons');
    await atomicJson(await confined(this.root, relative, true), { inputs: [left, right], rows });
    const format: TableFormat = { encoding: 'json-rows', columns: [{ name: 'key', type: 'string', nullValues: [] }, { name: 'x', type: 'number', nullValues: [] }, { name: 'y', type: 'number', nullValues: [] }], key: { column: 'key', namespace: 'comparison:' + key } };
    return publicResource(await this.register(relative, { operationId: 'comparison:' + key, inputs: [left, right], transform: options, sources: [a.resource.provenance, b.resource.provenance] }, 'available', { total: rows.length, missingX: rows.filter(r => r.x === null).length, missingY: rows.filter(r => r.y === null).length }, { path: relative, kind: 'table', format }));
  }
  async object(ref: ResourceRef) {
    const { r, data } = await this.bytes(ref);
    requireThat(r.kind === 'object' && typeof r.format === 'object' && r.format.observation === 'exported-snapshot', 'invalid', 'Select an exported object snapshot.');
    requireThat(data.length <= this.limits.maxReadBytes, 'limit', 'Object snapshot exceeds the structured read budget; bounded byte reads remain available.', { limit: 'maxReadBytes' });
    return { resource: publicResource(r), observation: 'exported-snapshot', value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) };
  }
  async media(ref: ResourceRef) {
    const r = await this.resolve(ref);
    requireThat(r.kind === 'media' && typeof r.format === 'object', 'invalid', 'Select declared original media.');
    return { resource: publicResource(r), original: ref, ...r.format, rendering: 'unavailable' };
  }
}
