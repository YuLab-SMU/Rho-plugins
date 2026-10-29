import { skillPresentation, presentation, operationPresentation, viewPresentation } from './presentation.js';
import { operationContracts } from './operations.js';
import { parse } from 'csv-parse/sync';
import { atomicJson, canonical, confined, digest, publicResource, requireThat, stateDirectory, validateDeclarationEnvelope as validateEnvelope, type Declaration, type Resource, type ResourceRef, type ResourceStore } from '@rho-workspace/plugin-contracts';
import type { TableFormat } from './contract.js';

const declaredSkill = (id: string, content: string, version = '1.0') => ({ id, version, content, digest: digest(content) });
export type { TableFormat } from './contract.js';
export const tableLimits = { maxRows: 100000, maxPageRows: 1000 };
// Opening an observed CSV supplies a lexical view, with no guessed numeric,
// missing-value or entity semantics. The usual table reader validates all rows.
export function lexicalCsvDeclaration(data: Buffer, relative: string): Declaration {
  requireThat(data.length <= 8 * 1024 * 1024, 'limit', 'CSV preview exceeds 8 MiB.');
  const records: string[][] = parse(data, { bom: true, skip_empty_lines: true, max_record_size: 1024 * 1024, to: 1 });
  const declaration: Declaration = { path: relative, kind: 'table', format: { encoding: 'csv', columns: (records[0] ?? []).map(name => ({ name, type: 'string', nullValues: [] })), key: null } };
  validateTableDeclaration(declaration); return declaration;
}
export function validateTableDeclaration(d: Declaration) {
  validateEnvelope(d); requireThat(d.kind === 'table', 'invalid', 'Select a table declaration.');
    const f = d.format as TableFormat;
    requireThat(['csv', 'json-rows'].includes(f.encoding) && Array.isArray(f.columns) && f.columns.length > 0 && f.columns.length <= 256, 'invalid', 'Declare a supported table encoding and columns.');
    requireThat(new Set(f.columns.map(c => c.name)).size === f.columns.length && f.columns.every(c => c.name && ['string', 'number', 'boolean'].includes(c.type) && Array.isArray(c.nullValues) && c.nullValues.length <= 16 && c.nullValues.every(n => typeof n === 'string')), 'invalid', 'Column names, types and null encodings must be explicit and unique.');
    requireThat(f.key === null || f.key?.namespace && f.columns.some(c => c.name === f.key!.column && c.type === 'string'), 'invalid', 'Entity keys require a declared string column and namespace.');
}
export const declarationValidator = { kind: 'table', validate: validateTableDeclaration };
export class Tables {
  async anchor(ref: import('@rho-workspace/plugin-contracts').ResourceRef, entities: string[]) {
    const data = await this.rows(ref);
    requireThat(data.entityKey && Array.isArray(entities) && entities.length > 0 && new Set(entities).size === entities.length && entities.every(id => typeof id === 'string' && data.rows.some(row => row[data.entityKey!] === id)), 'invalid', 'Choose unique stable entity keys present in the exact table version.');
    return { kind: 'table', resource: ref, namespace: data.namespace, entityKey: data.entityKey, rows: data.rows.filter(row => entities.includes(row[data.entityKey!])) };
  }
  limits: typeof tableLimits;
  constructor(public files: Pick<ResourceStore, 'root' | 'bytes' | 'resolve' | 'register'>, limits: Partial<typeof tableLimits> = {}) { this.limits = { ...tableLimits, ...limits }; }
  async rows(ref: ResourceRef): Promise<{ resource: Resource; rows: Record<string, any>[]; columns: TableFormat['columns']; entityKey: string | null; namespace: string | null }> {
    const { r, data } = await this.files.bytes(ref);
    requireThat(r.kind === 'table' && typeof r.format === 'object', 'unavailable', 'Typed reads require an explicit table declaration. Historical bytes remain readable.');
    const f = r.format as TableFormat;
    validateTableDeclaration({ path: r.path, kind: 'table', format: f });
    let rows: Record<string, any>[];
    if (f.encoding === 'json-rows') {
      const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
      requireThat(Array.isArray(parsed.rows) && (!parsed.inputs || Array.isArray(parsed.inputs) && parsed.inputs.length <= 2), 'invalid', 'Invalid declared JSON rows.');
      for (const input of parsed.inputs ?? []) await this.files.resolve(input);
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
  async compare(left: ResourceRef, right: ResourceRef, options: { leftKey: string; rightKey: string; leftNamespace: string; rightNamespace: string; mapping: 'equal-string'; leftField?: string; rightField?: string; fields?: Array<{ leftField: string; rightField: string }>; join: 'left' | 'inner' | 'full' }) {
    const a = await this.rows(left), b = await this.rows(right);
    requireThat(options.mapping === 'equal-string' && a.entityKey && b.entityKey && a.entityKey === options.leftKey && b.entityKey === options.rightKey && a.namespace === options.leftNamespace && b.namespace === options.rightNamespace, 'condition', 'Comparison requires explicit keys and the current input namespaces.');
    const fields = options.fields ?? [{ leftField: options.leftField!, rightField: options.rightField! }];
    requireThat(fields.length > 0 && fields.length <= 16 && new Set(fields.map(f => JSON.stringify([f.leftField, f.rightField]))).size === fields.length, 'invalid', 'Select one to sixteen distinct numeric field pairs.');
    requireThat(['left', 'inner', 'full'].includes(options.join) && fields.every(f => a.columns.some(c => c.name === f.leftField && c.type === 'number') && b.columns.some(c => c.name === f.rightField && c.type === 'number')), 'invalid', 'Declare a supported join and numeric comparison fields.');
    const ar = new Map(a.rows.map(r => [r[a.entityKey!], r])), br = new Map(b.rows.map(r => [r[b.entityKey!], r]));
    const keys = options.join === 'full' ? [...new Set([...ar.keys(), ...br.keys()])] : [...ar.keys()].filter(k => options.join !== 'inner' || br.has(k));
    requireThat(keys.length <= this.limits.maxRows, 'limit', 'Comparison output exceeds the row budget.', { limit: 'maxRows' });
    const rows = keys.map(key => {
      if (!options.fields) return { key, x: ar.get(key)?.[options.leftField!] ?? null, y: br.get(key)?.[options.rightField!] ?? null };
      const row: Record<string, any> = { key, left_present: ar.has(key), right_present: br.has(key), changed: ar.has(key) !== br.has(key) };
      fields.forEach((f, i) => { const x = ar.get(key)?.[f.leftField] ?? null, y = br.get(key)?.[f.rightField] ?? null;
        row['before_' + i] = x; row['after_' + i] = y; row['delta_' + i] = x !== null && y !== null ? y - x : null;
        requireThat(row['delta_' + i] === null || Number.isFinite(row['delta_' + i]), 'condition', 'A numeric difference exceeds the finite numeric range.', { key, field: f.leftField });
        row.changed ||= x !== y;
      }); return row;
    });
    const key = digest(canonical([left, right, options]));
    const relative = '.rho/plugins/comparisons/' + key + '.json';
    await stateDirectory(this.files.root, '.rho/plugins/comparisons');
    await atomicJson(await confined(this.files.root, relative, true), { inputs: [left, right], rows });
    const format: TableFormat = { encoding: 'json-rows', columns: options.fields ? [{ name: 'key', type: 'string', nullValues: [] }, ...['left_present', 'right_present', 'changed'].map(name => ({ name, type: 'boolean' as const, nullValues: [] })), ...fields.flatMap((_, i) => ['before_', 'after_', 'delta_'].map(n => ({ name: n + i, type: 'number' as const, nullValues: [] })))] : [{ name: 'key', type: 'string', nullValues: [] }, { name: 'x', type: 'number', nullValues: [] }, { name: 'y', type: 'number', nullValues: [] }], key: { column: 'key', namespace: 'comparison:' + key } };
    return publicResource(await this.files.register(relative, { operationId: 'comparison:' + key, inputs: [left, right], transform: options, sources: [a.resource.provenance, b.resource.provenance] }, 'available', { total: rows.length, missingX: rows.filter(r => (r as any).x === null).length, missingY: rows.filter(r => (r as any).y === null).length, ...(options.fields ? { changed: rows.filter(r => (r as any).changed).length, added: keys.filter(k => !ar.has(k)).length, removed: keys.filter(k => !br.has(k)).length } : {}) }, { path: relative, kind: 'table', format }));
  }
}
const tablesSkillContent = [
  'Read and compare typed tables through stable resource identities.',
  'Use capability.list to discover data.page, data.compare and resource.register.',
  '',
  '1. Register the bytes first with resource.register and keep the returned {id, version}.',
  '   A version names exact bytes: if the file changed, the version changes and the old',
  '   pages become stale rather than silently mixing.',
  '2. data.page takes offset and limit, an optional sort and an optional filter. It never',
  '   addresses rows by position as identity: identity is the declared entity key, and an',
  '   unkeyed table is readable but has none, so do not fabricate one.',
  '3. data.compare joins two keyed tables and returns a new resource with provenance.',
  '   The join is left, inner or full on declared key columns and namespaces.',
  '4. Nulls stay nulls. A declared null value is not an empty string, and a comparison',
  '   that finds no value on one side reports no value, not "absent from the file".',
  '',
  'Reads are bounded observations: they never execute R and never change a resource.'
].join('\n');
const tablesSkill = {
  ...declaredSkill('tables.workspace', tablesSkillContent, '1.1'),
  intent: 'Page and compare a typed table without inventing identity from row order.',
  requires: ['resource.register', 'data.page', 'data.compare'],
  example: {
    method: 'data.page',
    input: { resource: { id: '4702434457c0465d6dfbb54793b62d327c9aa4f419be2f5fc6cf92c6918eeaf1', version: '3f9d2b0e1a4c5f6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5' }, offset: 0, limit: 50, sort: { column: 'score', direction: 'desc' } }
  },
  failureRecipes: [
    { kind: 'stale', message: 'Resource version changed.', next: 'Register or re-read the current version; save the new {id, version} before paging again.' },
    { kind: 'limit', message: 'Page size exceeds the configured limit.', next: 'Ask for fewer rows; the earlier rows stay readable.' },
    { kind: 'invalid', message: 'Filter or sort names an unknown column.', next: 'Use a declared column name from the registration, not a positional index.' },
    { kind: 'condition', message: 'Compare needs two keyed tables in declared namespaces.', next: 'Declare a key column and namespace at registration before comparing.' }
  ],
  verify: { command: 'npm run test:tables', description: 'Declared types keep leading zeros and literal NA, joins retain nulls, namespaces and both input versions, and unkeyed tables never fabricate keys.' }
};
export const plugin = { entryVersion: '1.0', id: 'tables', package: '@rho-workspace/plugin-tables', version: '0.5.0', requires: ['files'], capabilities: ['tables'], presentation,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })), skills: [{ ...tablesSkill, presentation: skillPresentation }],
  components: [{ id: 'rho.table', version: '0.2.0', owner: 'rho-plugins.table', bindings: { data: 'table' }, ui: './ui', presentation: viewPresentation, propsSchema: { type: 'object', additionalProperties: false, properties: { title: { type: 'string', minLength: 1 } }, required: ['title'] } }] };
