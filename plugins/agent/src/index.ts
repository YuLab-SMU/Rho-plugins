import { presentation, operationPresentation } from './presentation.js';
import { operationContracts } from './operations.js';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, canonical, digest, now, objectSchema as obj, publicResource, readJson, requireThat, stateDirectory, text, type DocumentSnapshotSource, type ResourceStore, type TableReader, type ResourceRef } from '@rho-workspace/plugin-contracts';

const declaredSkill = (id: string, content: string, version = '1.0') => ({ id, version, content, digest: digest(content) });
export { retainAgentIntent } from './agent-intents.js';

export const agentLimits = { maxContexts: 128, maxBindings: 64, maxActivities: 256, maxContextBytes: 1024 * 1024 };
export interface ContextSources {
  documents?: DocumentSnapshotSource;
  files?: Pick<ResourceStore, 'resolve' | 'read'>;
  tables?: TableReader;
  media?: { region(ref: ResourceRef, region: any): Promise<any> };
  annotations?: { read(id: string): Promise<any> };
}
export class AgentContext {
  limits: typeof agentLimits;
  constructor(public root: string, public projectId: string, public sources: ContextSources, limits: Partial<typeof agentLimits> = {}) {
    this.limits = { ...agentLimits, ...limits };
  }
  // Keep the existing on-disk identities. Moving the owner does not migrate or
  // reinterpret acknowledged context, binding or tool receipts.
  private async directory() { return stateDirectory(this.root, '.rho/rho'); }
  async bindings(principal: string) {
    return (await readJson<any[]>(path.join(await this.directory(), 'bindings.json'), [])).filter(x => x.principal === principal);
  }
  async binding(method: string, principal: string, externalSessionId: string) {
    const file = path.join(await this.directory(), 'bindings.json');
    const bindings = await readJson<any[]>(file, []);
    const key = digest(principal + ':' + externalSessionId);
    let binding = bindings.find(x => x.id === key);
    if (!binding) {
      requireThat(bindings.length < this.limits.maxBindings, 'limit', 'Binding retention is full.', { limit: 'maxBindings' });
      binding = { id: key, projectId: this.projectId, principal, externalSessionId, adapter: 'claude-code-mcp', status: 'connected', at: now() };
      bindings.push(binding);
    }
    binding.status = method === 'binding.close' ? 'disconnected' : 'connected'; binding.at = now();
    await atomicJson(file, bindings); return binding;
  }
  async activity(principal: string) {
    const activity = await readJson<any>(path.join(await this.directory(), 'activity.json'), { cursor: 0, entries: [] });
    return { cursor: activity.cursor, retainedFrom: activity.entries[0]?.cursor ?? activity.cursor + 1, entries: activity.entries.filter((x: any) => x.principal === principal) };
  }
  async recordActivity(principal: string, method: string, body: any, result: any, errorKind?: string) {
    const file = path.join(await this.directory(), 'activity.json');
    const retained = await readJson<any>(file, { cursor: 0, entries: [] });
    retained.entries.push({ cursor: ++retained.cursor, principal, method, at: now(), outcome: errorKind ? 'rejected' : 'returned',
      ...(errorKind ? { errorKind } : {}), ...(body.operationId ? { operationId: body.operationId } : {}),
      ...(body.documentId ? { documentId: body.documentId } : {}), ...(result?.version ? { returnedVersion: result.version } : {}),
      ...(body.contextId ? { contextId: body.contextId } : {}), ...(body.skillId ? { skillId: body.skillId } : {}), ...(body.annotationId ? { annotationId: body.annotationId } : {}) });
    retained.entries = retained.entries.slice(-this.limits.maxActivities); await atomicJson(file, retained);
  }
  async createContext(b: any, principal: string) {
    requireThat(b.document || b.resource || b.annotations?.length, 'invalid', 'Choose explicit source objects or submitted feedback.');
    const directory = await stateDirectory(this.root, '.rho/rho/contexts');
    const requestDigest = digest(canonical({ b, principal }));
    const stableId = b.changeId ? digest(canonical([principal, b.changeId])) : null;
    if (stableId) {
      requireThat(b.expectedVersion === 0, 'invalid', 'New context requires expectedVersion zero.');
      const existing = await readJson<any>(path.join(directory, stableId + '.json'), null);
      if (existing) { requireThat(existing.requestDigest === requestDigest, 'conflict', 'Context changeId names different immutable content.'); return { contextId: stableId, ...existing }; }
    }
    requireThat(!b.annotations?.length || stableId, 'invalid', 'Feedback context needs a stable changeId and expectedVersion.');
    const context: any = { projectId: this.projectId, principal, at: now(), delivery: 'not-fetched', preparation: 'prepared', requestDigest, ...(b.changeId ? { changeId: b.changeId, version: 1 } : {}) };
    if (b.annotations?.length) {
      requireThat(this.sources.annotations, 'unavailable', 'Annotations owner is required for feedback context.');
      context.annotations = [];
      for (const ref of b.annotations) {
        const thread = await this.sources.annotations.read(ref.annotationId);
        requireThat(thread.version === ref.version, 'stale', 'Feedback version changed.', { annotationId: ref.annotationId, actualVersion: thread.version });
        context.annotations.push(thread);
      }
    }
    if (b.document) {
      requireThat(this.sources.documents, 'unavailable', 'The documents plugin is required for document context.');
      const snapshot = await this.sources.documents.snapshot(b.document.documentId, b.document.version);
      const from = b.document.from ?? 0, to = b.document.to ?? snapshot.code.length;
      const boundary = (n: number) => !(n > 0 && n < snapshot.code.length && /[\uD800-\uDBFF]/.test(snapshot.code[n - 1]!) && /[\uDC00-\uDFFF]/.test(snapshot.code[n]!));
      requireThat(Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && from <= to && to <= snapshot.code.length && boundary(from) && boundary(to), 'invalid', 'Context text range is outside complete UTF-16 boundaries.');
      context.document = { source: snapshot.source, sha256: snapshot.sha256, from, to, text: snapshot.code.slice(from, to) };
    }
    if (b.resource) {
      const files = this.sources.files;
      requireThat(files, 'unavailable', 'The files plugin is required for resource context.');
      const metadata = await files.resolve(b.resource);
      if (b.region) {
        requireThat(this.sources.media, 'unavailable', 'The media plugin is required for coordinate context.');
        context.region = await this.sources.media.region(b.resource, b.region);
      }
      if (metadata.kind === 'table') {
        requireThat(this.sources.tables, 'unavailable', 'The tables plugin is required for entity context.');
        const data = await this.sources.tables.rows(b.resource);
        requireThat(data.entityKey, 'condition', 'Entity context requires an explicit unique key and namespace.');
        const selected = b.entities ?? [];
        requireThat(selected.length > 0 && selected.every((id: string) => data.rows.some(r => r[data.entityKey!] === id)), 'stale', 'Choose stable entities present in this resource version.');
        context.resource = { reference: b.resource, metadata: publicResource(data.resource), rows: data.rows.filter(r => selected.includes(r[data.entityKey!])) };
      } else {
        requireThat(!b.entities?.length, 'invalid', 'Entity selection requires a table resource.');
        const page = await files.read(b.resource, 0);
        const bytes = Buffer.from(page.data, 'base64'); let content;
        try { content = { encoding: 'utf8', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; }
        catch { content = { encoding: 'base64', data: page.data }; }
        context.resource = { reference: b.resource, metadata: page.resource, ...content, offset: page.offset, nextOffset: page.nextOffset, more: page.more };
      }
    }
    requireThat(!b.region || b.resource, 'invalid', 'Coordinate context requires a media resource.');
    const contextId = stableId ?? digest(canonical(context));
    requireThat(Buffer.byteLength(JSON.stringify(context)) <= this.limits.maxContextBytes, 'limit', 'Context package exceeds its byte budget.', { limit: 'maxContextBytes' });
    requireThat((await fs.readdir(directory)).length < this.limits.maxContexts, 'limit', 'Context retention is full.', { limit: 'maxContexts' });
    await atomicJson(path.join(directory, contextId + '.json'), context); return { contextId, ...context };
  }
  async readContext(contextId: string, principal: string) {
    requireThat(/^[a-f0-9]{64}$/.test(contextId), 'invalid', 'Invalid context identity.');
    const file = path.join(await stateDirectory(this.root, '.rho/rho/contexts'), contextId + '.json');
    const context = await readJson<any>(file);
    context.delivery = 'tool-fetched'; context.fetchedBy = principal; context.fetchedAt = now();
    await atomicJson(file, context);
    return { contextId, ...context, responses: await this.responses(context) };
  }
  async contextStates(principal: string) {
    const directory = await stateDirectory(this.root, '.rho/rho/contexts');
    const names = (await fs.readdir(directory)).filter(n => /^[a-f0-9]{64}\.json$/.test(n));
    requireThat(names.length <= this.limits.maxContexts, 'limit', 'Context observation exceeds retention budget.');
    const states = [];
    for (const name of names) {
      requireThat((await fs.stat(path.join(directory, name))).size <= this.limits.maxContextBytes, 'limit', 'Context observation exceeds byte budget.');
      const context = await readJson<any>(path.join(directory, name));
      if (context.principal === principal || context.fetchedBy === principal) states.push({ contextId: name.slice(0, -5), preparation: context.preparation ?? 'prepared', delivery: context.delivery, ...(context.fetchedBy ? { fetchedBy: context.fetchedBy, fetchedAt: context.fetchedAt } : {}), responses: await this.responses(context) });
    }
    return states;
  }
  private async responses(context: any) {
    const responses = [];
    for (const frozen of context.annotations ?? []) {
      try {
        const thread = await this.sources.annotations?.read(frozen.annotationId);
        const messages = thread?.messages.filter((m: any) => m.replyTo && frozen.messages.some((f: any) => f.id === m.replyTo)) ?? [];
        responses.push({ annotationId: frozen.annotationId, state: messages.length ? 'explicit-linked-response' : 'no-linked-response', messageIds: messages.map((m: any) => m.id) });
      } catch { responses.push({ annotationId: frozen.annotationId, state: 'unavailable' }); }
    }
    return responses;
  }
}
const agentSkill = declaredSkill('agent.workspace', 'Use capability.list to discover context.create/context.read and binding operations. Prepare exact source snapshots, then use the tool result as context; reading is not understanding or completion.');
export const plugin = { entryVersion: '1.0', id: 'agent', package: '@rho-workspace/plugin-agent', version: '0.4.0', requires: [], capabilities: ['agent-context'], presentation,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })),
  skills: [agentSkill],
  agent: { id: 'claude-code-mcp', transport: 'stdio', modelLoop: 'external-client', contextDelivery: 'pull-tool-result', proactivePush: 'unsupported' }
};
