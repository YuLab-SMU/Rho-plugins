import * as fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, canonical, digest, now, publicResource, readJson, requireThat, stateDirectory, type DocumentSnapshotSource, type ResourceStore, type TableReader, type ResourceRef } from '@rho-workspace/plugin-contracts';
export { retainAgentIntent } from './agent-intents.js';

export const agentLimits = { maxContexts: 128, maxBindings: 64, maxActivities: 256, maxContextBytes: 1024 * 1024 };
export interface ContextSources {
  documents?: DocumentSnapshotSource;
  files?: Pick<ResourceStore, 'resolve' | 'read'>;
  tables?: TableReader;
  media?: { region(ref: ResourceRef, region: any): Promise<any> };
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
      ...(body.contextId ? { contextId: body.contextId } : {}) });
    retained.entries = retained.entries.slice(-this.limits.maxActivities); await atomicJson(file, retained);
  }
  async createContext(b: any, principal: string) {
    requireThat(b.document || b.resource, 'invalid', 'Choose an explicit document or resource.');
    const context: any = { projectId: this.projectId, principal, at: now(), delivery: 'not-fetched' };
    if (b.document) {
      requireThat(this.sources.documents, 'unavailable', 'The documents plugin is required for document context.');
      const snapshot = await this.sources.documents.snapshot(b.document.documentId, b.document.version);
      const from = b.document.from ?? 0, to = b.document.to ?? snapshot.code.length;
      requireThat(from <= to && to <= snapshot.code.length, 'invalid', 'Context text range is outside the buffer.');
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
    const contextId = digest(canonical(context));
    requireThat(Buffer.byteLength(JSON.stringify(context)) <= this.limits.maxContextBytes, 'limit', 'Context package exceeds its byte budget.', { limit: 'maxContextBytes' });
    const directory = await stateDirectory(this.root, '.rho/rho/contexts');
    requireThat((await fs.readdir(directory)).length < this.limits.maxContexts, 'limit', 'Context retention is full.', { limit: 'maxContexts' });
    await atomicJson(path.join(directory, contextId + '.json'), context); return { contextId, ...context };
  }
  async readContext(contextId: string, principal: string) {
    const file = path.join(await stateDirectory(this.root, '.rho/rho/contexts'), contextId + '.json');
    const context = await readJson<any>(file);
    context.delivery = 'tool-fetched'; context.fetchedBy = principal; context.fetchedAt = now();
    await atomicJson(file, context); return { contextId, ...context };
  }
}
export const plugin = { id: 'agent', package: '@rho-workspace/plugin-agent', version: '0.4.0', requires: [], capabilities: ['agent-context'], agent: { id: 'claude-code-mcp', transport: 'stdio', modelLoop: 'external-client', contextDelivery: 'pull-tool-result', proactivePush: 'unsupported' } };
