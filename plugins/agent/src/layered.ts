import { Ajv, type ValidateFunction } from 'ajv';
import { canonical, digest, requireThat } from '@rho-workspace/plugin-contracts';
export interface LayeredPorts {
  invoke(method: string, input: any, contractRef?: string): Promise<any>;
  retain(method: string, input: any): Promise<void>;
  // Optional: keep retained knowledge for the next process under the same connection.
  remember?(object: any): Promise<void>;
  forget?(ref: string): Promise<void>;
}
// Complete immutable knowledge only. Live task/resource/authorization state is
// never satisfied from this cache. Bodies are named by the digest of their own
// content, so a body copied by an earlier process is still the same knowledge; the
// service re-checks the current contract reference on every call, so a kept body
// cannot authorize execution the composition no longer offers.
export class LayeredMcp {
  private cache = new Map<string, { object: any; bytes: number; validate?: ValidateFunction }>();
  private used = 0;
  constructor(public connection: { profile: string; methods: string[]; pluginFilter?: string[] }, public ports: LayeredPorts, public maxEntries = 128, public maxBytes = 4194304) {
    requireThat(['layered-business', 'layered-presentation'].includes(connection.profile) && Number.isSafeInteger(maxEntries) && maxEntries > 0 && maxEntries <= 128 && Number.isSafeInteger(maxBytes) && maxBytes > 0, 'invalid', 'Invalid selected layered profile or knowledge-cache budget.');
  }
  private get(ref: string) { const record = this.cache.get(ref); if (record) { this.cache.delete(ref); this.cache.set(ref, record); } return record; }
  // Returns true only for a body this cache now holds; a body too large for the budget
  // is returned to the caller but is never remembered as proof of anything.
  private put(object: any): boolean {
    requireThat(object && ['contract', 'skill'].includes(object.kind) && digest(canonical(object.content)) === object.ref, 'condition', 'Resolved object is not the complete immutable body named by its reference.');
    if (this.get(object.ref)) return true;
    let validate;
    if (object.kind === 'contract') {
      requireThat(object.content.inputSchema && object.content.outputSchema && object.content.definitions && Array.isArray(object.content.requiredSkillRefs), 'condition', 'Complete input/output schema and dependency closure are required.');
      try { const ajv = new Ajv({ strict: false, allowUnionTypes: true, validateFormats: false }); validate = ajv.compile({ ...object.content.inputSchema, definitions: object.content.definitions }); ajv.compile({ ...object.content.outputSchema, definitions: object.content.definitions }); }
      catch { requireThat(false, 'condition', 'Resolved contract has an incomplete or unsupported schema dependency.'); }
    } else requireThat(digest(object.content.content) === object.content.digest, 'condition', 'Resolved Skill digest changed.');
    const bytes = Buffer.byteLength(JSON.stringify(object));
    if (bytes > this.maxBytes) return false;
    const old = this.cache.get(object.ref); if (old) { this.used -= old.bytes; this.cache.delete(object.ref); }
    while (this.cache.size >= this.maxEntries || this.used + bytes > this.maxBytes) { const key = this.cache.keys().next().value!; this.used -= this.cache.get(key)!.bytes; this.cache.delete(key); }
    this.cache.set(object.ref, { object, bytes, validate }); this.used += bytes;
    return true;
  }
  // Knowledge an earlier process kept under this connection. Each body is checked as if it
  // had just been resolved, so a corrupt or superseded file can only be ignored, never trusted.
  seed(objects: any[]) {
    let kept = 0;
    for (const object of objects) { try { if (this.put(object)) kept++; } catch { /* not knowledge this cache may hold */ } }
    return kept;
  }
  async index(input: any) {
    const role = this.connection.profile === 'layered-presentation' ? 'presentation' : this.connection.methods.includes('binding.activity.append') ? 'adapter' : 'business';
    return this.ports.invoke('capability.index', { role, query: { after: 0, cursor: input.cursor ?? null, limit: 20, maxBytes: input.maxBytes ?? 16384, ...(input.owner ? { owner: input.owner } : {}), ...(input.search ? { search: input.search } : {}) } });
  }
  async resolve(input: any) {
    const knownRefs = (input.knownRefs ?? []).filter((ref: string) => this.get(ref));
    const result = await this.ports.invoke('capability.resolve', { cursor: null, maxBytes: 16384, ...input, knownRefs });
    // Kept knowledge outlives this process only as far as it was actually retained here.
    if (result.ok) for (const object of result.value.items) if (this.put(object)) await this.ports.remember?.(object).catch(() => {});
    return result;
  }
  async call(input: any) {
    const record = this.get(input.contractRef), object = record?.object;
    requireThat(object?.kind === 'contract' && object.content.method === input.operation, 'condition', 'Resolve this complete selected contract first; summary, stale references and partial pages cannot authorize execution.');
    requireThat(this.connection.methods.includes(input.operation) && (this.connection.profile !== 'layered-presentation' || ['workspace.observe', 'workspace.enhance'].includes(input.operation)), 'scope', 'Selected profile does not grant this operation.');
    requireThat(!this.connection.pluginFilter || object.content.owner === 'rho' || this.connection.pluginFilter.includes(object.content.owner), 'scope', 'Selected plugin filter excludes this operation.');
    requireThat(object.content.requiredSkillRefs.every((ref: string) => this.get(ref)?.object.kind === 'skill'), 'condition', 'Relevant complete guidance is missing from the bounded cache. Resolve again without its knownRef.');
    requireThat(!Object.hasOwn(input.input, 'projectId') && record!.validate!(input.input), 'invalid', 'Input does not match the complete selected contract; project identity is supplied by the private connection.');
    await this.ports.retain(input.operation, input.input);
    const result = await this.ports.invoke(input.operation, input.input, input.contractRef);
    // A contract the composition no longer offers is not knowledge to keep across messages.
    if (!result.ok && ['stale', 'unavailable', 'scope', 'unauthorized'].includes(result.error.kind)) { this.used -= record!.bytes; this.cache.delete(input.contractRef); await this.ports.forget?.(input.contractRef).catch(() => {}); }
    return result;
  }
}
