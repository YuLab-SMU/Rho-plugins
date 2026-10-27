import { layeredSchemas } from './layered-contract.js';
import { skillPresentation, presentation, operationPresentation } from './presentation.js';
import { operationContracts } from './operations.js';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, canonical, digest, now, objectSchema as obj, publicResource, readJson, requireThat, stateDirectory, text, type DocumentSnapshotSource, type ResourceStore, type TableReader, type ResourceRef } from '@rho-workspace/plugin-contracts';

const declaredSkill = (id: string, content: string, version = '1.0') => ({ id, version, content, digest: digest(content) });
export { ClaudeCodeObserver } from './claude-native.js';
export { NativeActivity, nativeActivityLimits } from './native.js';
export { FeedbackDelivery, agentDeliveryLimits } from './delivery.js';
export { retainAgentIntent } from './agent-intents.js';
export { readAgentActivity, activityOutputs, captureActivityArtifact } from './activity-api.js';
export { readExternalAcp } from './external-acp.js';
export { observeSessionFiles } from './session-files.js';

// One run as the host read it for a context. The error text is the end of the retained
// stderr: `from` is its byte offset, `retainedBytes` how much Core kept, `truncated` whether
// Core dropped output it observed.
export interface RunContext {
  operationId: string; action: string; actionVersion: string; execution: string; acceptedAt: string; submittedBy: string;
  exit: string | null; stop: { state: string; by: string } | null; repairOf: string | null;
  error: { stream: 'stderr'; text: string; from: number; retainedBytes: number; observedBytes: number; truncated: boolean } | null;
  script: { kind: string; path?: string; digest?: string; documentId?: string; version?: number } | null;
  args: string[]; declared: Array<{ path: string; present: boolean; bytes: number }>; output: string | null;
}
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
  async binding(method: string, principal: string, externalSessionId: string, attachment?: any) {
    const file = path.join(await this.directory(), 'bindings.json');
    const bindings = await readJson<any[]>(file, []);
    const key = digest(principal + ':' + externalSessionId);
    let binding = bindings.find(x => x.id === key);
    if (!binding) {
      requireThat(bindings.length < this.limits.maxBindings, 'limit', 'Binding retention is full.', { limit: 'maxBindings' });
      binding = { id: key, projectId: this.projectId, principal, externalSessionId, adapter: 'claude-code-mcp', status: 'connected', at: now() };
      bindings.push(binding);
    }
    if (attachment) {
      requireThat(!binding.attachment || canonical(binding.attachment) === canonical(attachment), 'conflict', 'A native binding cannot change its task or adapter attachment.');
      binding.attachment = structuredClone(attachment);
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
      ...(body.documentId ? { documentId: body.documentId } : method === 'document.open' && result?.id ? { documentId: result.id } : {}), ...(result?.version ? { returnedVersion: result.version } : {}),
      ...(body.resource?.id && body.resource?.version ? { resource: { id: body.resource.id, version: body.resource.version } } : {}),
      ...(body.compositionId ? { compositionId: body.compositionId } : {}),
      ...(method === 'action.output' && ['stdout', 'stderr'].includes(body.stream) ? { stream: body.stream } : {}),
      ...(body.contextId ? { contextId: body.contextId } : {}), ...(body.skillId ? { skillId: body.skillId } : {}), ...(body.annotationId ? { annotationId: body.annotationId } : {}) });
    retained.entries = retained.entries.slice(-this.limits.maxActivities); await atomicJson(file, retained);
  }
  // A run is not this owner's to read: the host resolves its facts (state, exit, the end
  // of its error stream, the files it was asked to write) and they are frozen here as given.
  async createContext(b: any, principal: string, facts: { run?: RunContext } = {}) {
    requireThat(b.document || b.resource || b.annotations?.length || b.run, 'invalid', 'Choose explicit source objects, a run or submitted feedback.');
    requireThat(!b.run || facts.run?.operationId === b.run.operationId, 'unavailable', "The host did not supply this run's facts.");
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
    if (b.run) context.run = facts.run;
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
    requireThat(!context.feedbackTarget || context.feedbackTarget.principal === principal, 'scope', 'This feedback context belongs to its original business principal.');
    context.delivery = 'tool-fetched'; context.fetchedBy = principal; context.fetchedAt = now();
    await atomicJson(file, context);
    return { contextId, ...context, responses: await this.responses(context) };
  }
  // Internal owner entry for an already committed immutable message. Unlike
  // legacy context.create, it does not require the thread's latest version.
  async prepareFeedbackContext(ref: any, changeId: string, target: { principal: string; bindingId: string; externalSessionId: string }) {
    requireThat(this.sources.annotations, 'unavailable', 'Feedback needs its Annotations owner.');
    const directory = await stateDirectory(this.root, '.rho/rho/contexts');
    const contextId = digest(canonical([target.principal, changeId]));
    const requestDigest = digest(canonical({ ref, changeId, target }));
    const file = path.join(directory, contextId + '.json');
    const existing = await readJson<any>(file, null);
    if (existing) { requireThat(existing.requestDigest === requestDigest, 'conflict', 'Feedback context identity names different content or target.'); return { contextId, ...existing }; }
    const thread = await this.sources.annotations.read(ref.annotationId), message = thread.messages.find((m: any) => m.id === ref.messageId);
    requireThat(message && thread.messages.indexOf(message) + 1 === ref.submittedVersion, 'stale', 'Original committed feedback message is unavailable.');
    const frozen = { annotationId: thread.annotationId, version: ref.submittedVersion, anchor: thread.anchor, source: thread.source, messages: [message] };
    const context = { projectId: this.projectId, principal: target.principal, at: now(), delivery: 'not-fetched', preparation: 'prepared', requestDigest, changeId, version: 1, feedbackTarget: target, annotations: [frozen] };
    requireThat(Buffer.byteLength(JSON.stringify(context) + '\n') <= this.limits.maxContextBytes, 'limit', 'Feedback context exceeds maxContextBytes.');
    requireThat((await fs.readdir(directory)).length < this.limits.maxContexts, 'limit', 'Context retention is full.');
    await atomicJson(file, context); return { contextId, ...context };
  }
  async peekContext(contextId: string) {
    requireThat(/^[a-f0-9]{64}$/.test(contextId), 'invalid', 'Invalid context identity.');
    const file = path.join(await stateDirectory(this.root, '.rho/rho/contexts'), contextId + '.json');
    requireThat((await fs.stat(file)).size <= this.limits.maxContextBytes, 'limit', 'Context exceeds maxContextBytes.');
    return { contextId, ...await readJson<any>(file) };
  }
  async contextStates(principal: string) {
    const directory = await stateDirectory(this.root, '.rho/rho/contexts');
    const names = (await fs.readdir(directory)).filter(n => /^[a-f0-9]{64}\.json$/.test(n));
    requireThat(names.length <= this.limits.maxContexts, 'limit', 'Context observation exceeds retention budget.');
    const states = [];
    for (const name of names) {
      requireThat((await fs.stat(path.join(directory, name))).size <= this.limits.maxContextBytes, 'limit', 'Context observation exceeds byte budget.');
      const context = await readJson<any>(path.join(directory, name));
      if (context.principal === principal || context.fetchedBy === principal) states.push({ contextId: name.slice(0, -5), preparation: context.preparation ?? 'prepared', delivery: context.delivery, ...(context.run?.operationId ? { run: context.run.operationId } : {}), ...(context.fetchedBy ? { fetchedBy: context.fetchedBy, fetchedAt: context.fetchedAt } : {}), responses: await this.responses(context) });
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
const agentSkillContent = [
  'Prepare exact context and work through one registered native binding.',
  'Use capability.list to discover context.create, context.read and the binding operations.',
  '',
  '1. context.create freezes an exact source snapshot: a document range at one version, a',
  '   table selection at one resource version, or one run (its state, exit, the end of',
  '   its stderr, its script and declared files). It prepares facts; it does not decide',
  '   what they mean.',
  '2. Fetch that context with context.read and use the tool result as your context. Reading',
  '   is not understanding, and neither is task completion.',
  '3. binding.open attaches one native session to one task and role. The attachment names',
  '   the adapter registration and its transport capabilities; nothing else starts a',
  '   native session.',
  '4. Keep original identities. After a lost acknowledgement query the owner instead of',
  '   opening a second binding under a new identity.'
].join('\n');
const agentSkill = {
  ...declaredSkill('agent.workspace', agentSkillContent, '1.2'),
  intent: 'Give a native session exact prepared context and keep its binding identity.',
  requires: ['context.create', 'context.read', 'binding.open', 'binding.list', 'binding.activity'],
  example: { method: 'context.create', input: { document: { documentId: '5df1e6280c70fa8475dfd6bb1a6165b302443640224c893510eed728058adac0', version: 1, from: 0, to: 12 } } },
  failureRecipes: [
    { kind: 'stale', message: 'Context source version changed.', next: 'Build a new context from the current version; do not edit through an old snapshot.' },
    { kind: 'scope', message: 'Binding belongs to a different task or principal.', next: 'Use the binding issued for this task and role; a forged attachment is refused.' },
    { kind: 'unavailable', message: 'No native adapter is registered.', next: 'Ask the operator to register the adapter for this project before opening a binding.' }
  ],
  verify: { command: 'npm run test:native', description: 'Registers a native adapter, opens a business binding, refuses a forged one, and records artifact-ready observations without a model call.' }
};
const feedbackSkillContent = [
  'Answer feedback that arrived through the selected native hook, without rebasing it.',
  'Use capability.list to discover feedback.read and feedback.status.',
  '',
  '1. When the hook supplies an original delivery reference, call feedback.read with that',
  '   task, delivery, context and a stable fetchId. Fetch the whole object: if the reply says',
  '   the size is too small, raise maxBytes rather than accepting a partial message.',
  '2. feedback.status reports delivery, exact-target fetches and explicitly linked replies.',
  '   A hook emission or a tool read is not understanding, model consumption or domain',
  '   correctness.',
  '3. relatedDocumentId is a pointer, not a snapshot: read that document CURRENT version',
  '   before editing, preserve human changes, and use conditional edit and save.',
  '4. Reply with annotation.reply, naming the exact original messageId as replyTo and a',
  '   separate versioned reply draft.',
  '5. Missing acknowledgements keep the outcome unknown. Do not invent a new delivery, a new',
  '   native session, or a new changeId for the same reply.'
].join('\n');
const feedbackSkill = {
  ...declaredSkill('agent.feedback', feedbackSkillContent, '1.1'),
  intent: 'Read one original feedback delivery and answer it explicitly.',
  requires: ['feedback.read', 'feedback.status', 'document.read', 'document.edit', 'annotation.reply'],
  example: {
    method: 'feedback.read',
    input: {
      taskId: 'grades', deliveryId: 'delivery-1', contextId: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', fetchId: 'fetch-1',
      query: { after: 0, cursor: null, limit: 50, maxBytes: 65536 }
    }
  },
  failureRecipes: [
    { kind: 'limit', message: 'Feedback object exceeds maxBytes.', next: 'Increase maxBytes and read the whole object; never use a partial message.' },
    { kind: 'stale', message: 'Related document changed since the feedback.', next: 'Read the current document version and edit conditionally, keeping human changes.' },
    { kind: 'unauthorized', message: 'Only the original business binding may read this delivery.', next: 'Read it from the binding that received the delivery.' }
  ],
  verify: { command: 'npm run test:feedback', description: 'Drives the real feedback worker and hook entries without a model: original delivery, whole-object fetch and explicit reply.' }
};
const presentationSkillContent = [
  'Enhance only what the assigned person is looking at, within the presentation role.',
  'Use rho_index, rho_resolve and rho_call for workspace.observe and workspace.enhance only.',
  '',
  '1. Resolve the relevant instructions and whole exact contracts, including every schema',
  '   dependency, before executing. Reuse only complete cached bodies; if context loses a',
  '   body, omit its known reference and fetch it again.',
  '2. Observe with workspace.observe, accumulating whole pages against the same snapshot.',
  '   Use the assigned task, composition, presenter generation, retained binding witness and',
  '   visible observation as the basis.',
  '3. Enhance display only: emphasis, a title, and an optional plain note of at most 600',
  '   characters. The application writes authorship and the basis; you do not.',
  '4. Never read or write business feedback, shared documents or native trace through',
  '   another capability.',
  '5. Keep the original changeId after an unknown reply. A stale layout or assignment needs a',
  '   fresh observation and an explicit new intent, never a silent rebase.'
].join('\n');
const presentationSkill = {
  ...declaredSkill('agent.presentation', presentationSkillContent, '1.1'),
  intent: 'Enhance the visible layout for the assigned presenter, display only.',
  requires: ['workspace.observe', 'workspace.enhance'],
  example: {
    method: 'workspace.observe',
    input: { taskId: 'grades', compositionId: 'workspace', query: { after: 0, cursor: null, limit: 20, maxBytes: 65536 } }
  },
  failureRecipes: [
    { kind: 'stale', message: 'Witness, generation or layout changed.', next: 'Observe again and form an explicit new intent; never rebase silently.' },
    { kind: 'scope', message: 'Presentation role cannot reach business feedback or documents.', next: 'Stay within workspace.observe and workspace.enhance.' },
    { kind: 'limit', message: 'Note exceeds 600 characters.', next: 'Shorten the note; emphasis and title carry the rest.' }
  ],
  verify: { command: 'npm run test:presenter', description: 'Presentation enhances display within its witness and role, and refuses business feedback or document access.' }
};
export const plugin = { entryVersion: '1.0', id: 'agent', package: '@rho-workspace/plugin-agent', version: '0.4.11', requires: [], capabilities: ['agent-context'], presentation,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })),
  components: [{ id: 'rho.agent-note', version: '0.2.0', owner: 'rho-plugins.agent', bindings: {}, propsSchema: layeredSchemas.AgentNoteProps, ui: './ui', presentation: { displayName: 'Agent note', description: 'A plain presentation explanation with authenticated author and binding basis.', readOnly: true, runsCode: false } }],
  skills: [{ ...agentSkill, presentation: skillPresentation }, { ...feedbackSkill, presentation: { displayName: 'Business feedback', description: 'Reads original feedback, preserves current human edits and links an explicit reply.' } }, { ...presentationSkill, presentation: { displayName: 'Presentation', description: 'Enhances the assigned visible layout without business feedback or document access.' } }],
  agent: { id: 'claude-code-mcp', transport: 'stdio', modelLoop: 'external-client', contextDelivery: 'pull-tool-result', proactivePush: 'unsupported' }
};
