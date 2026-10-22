import fs from 'node:fs/promises';
import { atomicJson, canonical, confined, digest, Fault, now, readJson, requireThat, stateDirectory } from '@rho-workspace/plugin-contracts';
import { Ajv } from 'ajv';
import { deliveryStoreSchema } from './feedback-contract.js';
import { isNativeTime } from './contract.js';

export const agentDeliveryLimits = { maxRecords: 128, maxBytes: 4194304, maxFetchReceiptsPerDelivery: 128, maxFeedbackObjectBytes: 12288 };
const size = (v: any) => Buffer.byteLength(JSON.stringify(v) + '\n');
const validator = new Ajv({ strict: false, allowUnionTypes: true });
validator.addFormat('date-time', isNativeTime);
const validStore = validator.compile<any>(deliveryStoreSchema);
function frozenFeedback(context: any, annotation: any) {
  const frozen = context.annotations[0], message = frozen.messages.find((m: any) => m.id === annotation.messageId);
  requireThat(message, 'storage', 'Original prepared message is unavailable.');
  return { annotation, anchor: frozen.anchor, source: frozen.source, messageText: message.draft.text, messageDigest: message.draft.sha256, author: message.author };
}
export interface FeedbackSources {
  annotations?: { create(input: any, author: string): Promise<any>; read(id: string): Promise<any> };
  agent: { prepareFeedbackContext(ref: any, changeId: string, target: any): Promise<any>; peekContext(id: string): Promise<any>; readContext(id: string, principal: string): Promise<any> };
  binding(id: string): Promise<any>;
}
// One bounded delivery file, written only under the application's existing
// project writer. It stores message-delivery facts, never native executions.
// Public profiles are frozen. The private coordination member additionally
// retains transport ACK observation and the original hook emission boundary.
export class FeedbackDelivery {
  limits: typeof agentDeliveryLimits;
  constructor(public root: string, public projectId: string, public sources: FeedbackSources, limits: Partial<typeof agentDeliveryLimits> = {}) {
    this.limits = { ...agentDeliveryLimits, ...limits };
    requireThat(Object.values(this.limits).every(v => Number.isSafeInteger(v) && v > 0) && this.limits.maxRecords <= 128 && this.limits.maxFetchReceiptsPerDelivery <= 128 && this.limits.maxFeedbackObjectBytes <= 12288, 'invalid', 'Delivery limits must be positive integers within the selected profile caps.');
  }
  private async file() { await stateDirectory(this.root, '.rho/plugins/agent'); return confined(this.root, '.rho/plugins/agent/delivery.json', true); }
  async initialize() {
    try { await fs.access(await this.file()); await this.state(); }
    catch (e: any) { if (e.code !== 'ENOENT') throw e; await this.save({ format: 'rho.agent-delivery/1', coordinationVersion: 1, version: 0, records: [], receiptRetentionFrom: null }); }
  }
  async state() {
    const file = await this.file();
    let state: any;
    try { requireThat((await fs.stat(file)).size <= this.limits.maxBytes, 'limit', 'Delivery storage exceeds agentDelivery.maxBytes.'); state = await readJson(file); }
    catch (e: any) { if (e.code === 'ENOENT') throw new Fault('storage', 'Configured delivery history is missing; never initialize it on read or retry.'); throw e; }
    requireThat(validStore(state) && state.records.length <= this.limits.maxRecords, 'storage', 'Delivery history is corrupt or exceeds its selected retention.');
    const submissions = new Set(), deliveries = new Set();
    for (const r of state.records) {
      const s = r.submission, e = s.delivery, hook = r.coordination.hook;
      requireThat(!submissions.has(s.submissionId) && r.originalInput.projectId === this.projectId && s.submissionId === r.originalInput.submissionId && s.requestDigest === digest(canonical({ input: r.originalInput, author: s.author })) && r.pinnedRoute.projectId === this.projectId && r.pinnedRoute.taskId === r.originalInput.taskId && r.fetchReceipts.length <= this.limits.maxFetchReceiptsPerDelivery, 'storage', 'Original submission or route identity is corrupt.');
      submissions.add(s.submissionId);
      if (e) {
        const { requestDigest, ...original } = e;
        requireThat(!deliveries.has(e.deliveryId) && requestDigest === digest(canonical(original)) && e.projectId === this.projectId && e.taskId === r.originalInput.taskId && e.contextId === s.contextId && canonical(e.message) === canonical(s.annotation) && e.targetBindingId === r.pinnedRoute.feedbackOwnerBindingId && e.taskVersion === r.pinnedRoute.version, 'storage', 'Original delivery envelope is corrupt.');
        deliveries.add(e.deliveryId);
      }
      requireThat(r.attempts.every((a: any) => e && a.targetBindingId === e.targetBindingId && a.externalSessionId === e.externalSessionId) && (!r.inboxReceipt || e && r.attempts.length === 1 && r.inboxReceipt.deliveryId === e.deliveryId && r.inboxReceipt.requestDigest === e.requestDigest && r.inboxReceipt.inboxReceiptId === digest(canonical(e))) && (!r.coordination.ackObservedAt || r.inboxReceipt) && (!hook || e && r.inboxReceipt && hook.externalSessionId === e.externalSessionId) && (!r.inboxReceipt || (r.inboxReceipt.emission === 'not-attempted' ? !hook : hook && (r.inboxReceipt.emission === 'emitted') === !!hook.emittedAt)) && r.fetchReceipts.every((f: any) => e && f.deliveryId === e.deliveryId && f.contextId === e.contextId && f.bindingId === e.targetBindingId), 'storage', 'Delivery attempt, inbox, hook or fetch identity is corrupt.');
    }
    return state;
  }
  private async save(state: any) {
    requireThat(state.records.length <= this.limits.maxRecords && size(state) <= this.limits.maxBytes, 'limit', 'Delivery storage is full; preserve drafts, committed messages, contexts and original identities.', { limit: 'agentDelivery.maxRecords/maxBytes' });
    await atomicJson(await this.file(), state);
  }
  private async commit(state: any) { state.version++; await this.save(state); }
  private record(state: any, submissionId: string) { const r = state.records.find((r: any) => r.submission.submissionId === submissionId); requireThat(r, 'not_found', 'Original feedback submission is unavailable; do not mint a replacement.'); return r; }
  private delivery(state: any, deliveryId: string) { const r = state.records.find((r: any) => r.submission.delivery?.deliveryId === deliveryId); requireThat(r, 'not_found', 'Original delivery is unavailable; absence does not authorize replay.'); return r; }
  async pending(externalSessionId: string, adapterRegistrationId: string) {
    return (await this.state()).records.filter((r: any) => r.submission.delivery?.externalSessionId === externalSessionId && r.submission.delivery.adapterRegistrationId === adapterRegistrationId && !r.coordination.ackObservedAt).map((r: any) => ({ submissionId: r.submission.submissionId, deliveryId: r.submission.delivery.deliveryId, attemptRecorded: r.attempts.length > 0 }));
  }
  private async target(record: any, principal?: string) {
    const envelope = record.submission.delivery;
    const id = envelope?.targetBindingId ?? record.pinnedRoute.feedbackOwnerBindingId;
    const binding = id ? await this.sources.binding(id) : null;
    requireThat(binding && binding.projectId === this.projectId && binding.attachment?.taskId === record.originalInput.taskId && binding.attachment.role === 'business' && (!envelope || binding.externalSessionId === envelope.externalSessionId && binding.attachment.adapterRegistrationId === envelope.adapterRegistrationId) && (!principal || binding.principal === principal), 'scope', 'Feedback belongs to its original business binding and native session.');
    return binding;
  }
  async submit(input: any, author: string, route: any) {
    const state = await this.state(), requestDigest = digest(canonical({ input, author }));
    let record = state.records.find((r: any) => r.submission.submissionId === input.submissionId);
    if (record) requireThat(record.submission.requestDigest === requestDigest, 'conflict', 'Submission ID names different content, author or route expectation.');
    else {
      requireThat(route?.taskId === input.taskId && route.compositionId === input.compositionId && input.routeExpectation.taskVersion === route.version && input.routeExpectation.targetBindingId === route.feedbackOwnerBindingId, 'condition', 'Task responsibility changed; keep the original draft and reconcile its route.');
      requireThat(state.records.length < this.limits.maxRecords, 'limit', 'Delivery retention is full; the original Documents draft remains available.');
      record = { submission: { submissionId: input.submissionId, requestDigest, author, stages: { annotation: 'pending', context: 'pending', queue: 'pending' }, annotation: null, contextId: null, delivery: null, reason: null }, originalInput: structuredClone(input), pinnedRoute: structuredClone(route), attempts: [], inboxReceipt: null, fetchReceipts: [], coordination: { ackObservedAt: null, hook: null } };
      state.records.push(record); await this.commit(state);
    }
    const s = record.submission;
    if (s.stages.queue === 'queued') return s;
    try {
      requireThat(this.sources.annotations, 'unavailable', 'Feedback needs the selected Annotations owner.');
      if (!s.annotation) {
        const identity = digest(canonical([author, input.submissionId]));
        const thread = await this.sources.annotations.create({ annotationId: 'feedback:' + identity, expectedVersion: 0, changeId: 'submit:' + identity, anchor: input.anchor, draft: input.draft }, author);
        const version = thread.receipt.version, message = thread.messages[version - 1];
        s.annotation = { annotationId: thread.annotationId, submittedVersion: version, messageId: message.id };
        s.stages.annotation = 'committed'; s.reason = null; await this.commit(state);
      }
      if (!record.pinnedRoute.feedbackOwnerBindingId) { s.stages.queue = 'needs-routing'; s.reason = 'needs-routing'; await this.commit(state); return s; }
      const binding = await this.target(record);
      if (!s.contextId) {
        const context = await this.sources.agent.prepareFeedbackContext(s.annotation, 'feedback:' + digest(canonical([author, input.submissionId])), { principal: binding.principal, bindingId: binding.id, externalSessionId: binding.externalSessionId });
        s.contextId = context.contextId; s.stages.context = 'prepared'; s.reason = null; await this.commit(state);
      }
      requireThat(size(frozenFeedback(await this.sources.agent.peekContext(s.contextId), s.annotation)) <= this.limits.maxFeedbackObjectBytes, 'limit', 'Whole frozen feedback exceeds the selected object cap; preserve it without queueing an unfetchable message.', { limit: 'maxFeedbackObjectBytes' });
      const caps = binding.attachment.transportCapabilities;
      requireThat(['post-tool-boundary', 'queued-turn'].includes(caps.inputMode) && caps.inboxLookup && caps.inboxDeduplication === 'retained-original-delivery' && caps.hookEmissionDeduplication === 'no-reemit-after-attempt', 'unavailable', 'The original native adapter does not supply the selected delivery boundary.');
      const original = { projectId: this.projectId, taskId: input.taskId, deliveryId: 'delivery:' + digest(canonical([author, input.submissionId])), targetBindingId: binding.id, externalSessionId: binding.externalSessionId, adapterRegistrationId: binding.attachment.adapterRegistrationId, contextId: s.contextId, message: s.annotation, taskVersion: record.pinnedRoute.version, mode: caps.inputMode };
      s.delivery = { ...original, requestDigest: digest(canonical(original)) };
      s.stages.queue = 'queued'; s.reason = null; await this.commit(state);
    } catch (error) {
      if (!(error instanceof Fault)) throw error;
      if (error.kind === 'storage') throw error;
      if (!s.annotation) { s.stages.annotation = 'needs-reconcile'; s.reason = error.kind === 'unavailable' ? 'owner-unavailable' : 'source-unavailable'; }
      else if (!s.contextId) { s.stages.context = ['stale', 'condition', 'conflict'].includes(error.kind) ? 'needs-reconcile' : 'pending'; s.reason = error.kind === 'limit' ? 'context-limit' : 'owner-unavailable'; }
      else { s.stages.queue = 'blocked'; s.reason = error.kind === 'limit' ? error.details?.limit === 'maxFeedbackObjectBytes' ? 'context-limit' : 'queue-full' : 'owner-unavailable'; }
      await this.commit(state);
    }
    return s;
  }
  async prepareAttempt(submissionId: string, route: any) {
    const state = await this.state(), r = this.record(state, submissionId), envelope = r.submission.delivery;
    requireThat(envelope && r.submission.stages.queue === 'queued', 'condition', 'Feedback has no complete original delivery envelope.');
    await this.target(r);
    requireThat(route?.taskId === envelope.taskId && route.feedbackOwnerBindingId === envelope.targetBindingId, 'condition', 'Original responsibility changed; retain the delivery without retargeting.');
    if (r.attempts.length) return { action: 'lookup', envelope };
    r.attempts.push({ number: 1, at: now(), targetBindingId: envelope.targetBindingId, externalSessionId: envelope.externalSessionId });
    await this.commit(state); return { action: 'accept', envelope };
  }
  async accept(envelope: any) {
    const state = await this.state(), r = this.delivery(state, envelope.deliveryId);
    requireThat(r.attempts.length === 1 && canonical(r.submission.delivery) === canonical(envelope), 'conflict', 'Runtime inbox accepts only the original durable attempted envelope.');
    if (r.inboxReceipt) return r.inboxReceipt;
    const receipt = { deliveryId: envelope.deliveryId, requestDigest: envelope.requestDigest, acceptedAt: now(), inboxReceiptId: digest(canonical(envelope)), emission: 'not-attempted' };
    r.inboxReceipt = receipt; await this.commit(state); return receipt;
  }
  async lookup(input: any) {
    const state = await this.state(), r = state.records.find((r: any) => r.submission.delivery?.deliveryId === input.deliveryId);
    if (!r) return { deliveryId: input.deliveryId, state: 'not-found', receipt: null, absenceAuthorizesReplay: false };
    const e = r.submission.delivery;
    requireThat(['requestDigest', 'targetBindingId', 'externalSessionId', 'taskId', 'projectId'].every(k => e[k] === input[k]), 'scope', 'Inbox lookup changed the original identity or target.');
    return { deliveryId: input.deliveryId, state: r.inboxReceipt ? 'retained' : 'not-found', receipt: r.inboxReceipt, absenceAuthorizesReplay: false };
  }
  async acknowledge(envelope: any, receipt: any) {
    const state = await this.state(), r = this.delivery(state, envelope.deliveryId);
    requireThat(canonical(r.submission.delivery) === canonical(envelope) && receipt?.deliveryId === envelope.deliveryId && receipt.requestDigest === envelope.requestDigest && receipt.inboxReceiptId === r.inboxReceipt?.inboxReceiptId, 'conflict', 'Acknowledgement does not match the retained original inbox.');
    if (!r.coordination.ackObservedAt) { r.coordination.ackObservedAt = now(); await this.commit(state); }
    return r.inboxReceipt;
  }
  async next(bindingId: string, externalSessionId: string, nativeToolUseId: string, route: any) {
    const state = await this.state();
    const r = state.records.find((r: any) => r.submission.delivery?.targetBindingId === bindingId && r.inboxReceipt?.emission === 'not-attempted');
    if (!r) return { delivery: null };
    const e = r.submission.delivery;
    requireThat(e.externalSessionId === externalSessionId && route?.taskId === e.taskId && route.feedbackOwnerBindingId === bindingId, 'scope', 'Hook targets another original native session or responsibility.');
    await this.target(r);
    r.inboxReceipt.emission = 'attempt-recorded';
    r.coordination.hook = { externalSessionId, nativeToolUseId, attemptedAt: now(), emittedAt: null };
    await this.commit(state);
    return { delivery: e };
  }
  async emitted(deliveryId: string, bindingId: string, externalSessionId: string, nativeToolUseId: string) {
    const state = await this.state(), r = this.delivery(state, deliveryId), hook = r.coordination.hook;
    requireThat(r.submission.delivery.targetBindingId === bindingId && hook?.externalSessionId === externalSessionId && hook.nativeToolUseId === nativeToolUseId, 'scope', 'Hook emission acknowledgement changed its original boundary.');
    if (r.inboxReceipt.emission === 'emitted') return r.inboxReceipt;
    requireThat(r.inboxReceipt.emission === 'attempt-recorded', 'condition', 'No original emission attempt is retained.');
    r.inboxReceipt.emission = 'emitted'; hook.emittedAt = now(); await this.commit(state); return r.inboxReceipt;
  }
  async contextTarget(contextId: string) {
    const state = await this.state();
    const record = state.records.find((r: any) => r.submission.contextId === contextId);
    return record?.submission.delivery?.targetBindingId ?? record?.pinnedRoute.feedbackOwnerBindingId ?? null;
  }
  async read(input: any, principal: string) {
    const state = await this.state(), r = this.delivery(state, input.deliveryId), e = r.submission.delivery;
    requireThat(input.taskId === e.taskId && input.contextId === e.contextId, 'scope', 'Feedback read changed the original task/context.');
    const binding = await this.target(r, principal), context = await this.sources.agent.peekContext(e.contextId);
    requireThat(context.feedbackTarget?.bindingId === e.targetBindingId, 'storage', 'Original prepared target is unavailable.');
    const feedback = frozenFeedback(context, e.message);
    requireThat(size(feedback) <= this.limits.maxFeedbackObjectBytes, 'limit', 'Complete selected feedback exceeds maxFeedbackObjectBytes.', { requiredBytes: size(feedback) });
    requireThat(input.query.after === 0 && !input.query.cursor, 'invalid', 'The selected feedback is one immutable complete object.');
    requireThat(!state.records.some((other: any) => other !== r && other.fetchReceipts.some((f: any) => f.fetchId === input.fetchId)), 'conflict', 'Fetch ID already belongs to a different original delivery.');
    let receipt = r.fetchReceipts.find((f: any) => f.fetchId === input.fetchId && f.observation === 'owner-served');
    if (!receipt) receipt = { receiptId: digest(canonical([input.deliveryId, input.fetchId, principal, 'owner-served'])), fetchId: input.fetchId, deliveryId: input.deliveryId, contextId: e.contextId, bindingId: binding.id, principal, observation: 'owner-served', nativeToolUseId: null, at: now() };
    const result = { fetchReceipt: receipt, contextVersion: 1, feedback, relatedDocumentId: r.originalInput.relatedDocumentId, next: null, complete: true };
    requireThat(size(result) <= input.query.maxBytes, 'limit', 'Complete feedback does not fit the requested page.', { requiredBytes: size(result) });
    if (!r.fetchReceipts.includes(receipt)) {
      requireThat(r.fetchReceipts.length < this.limits.maxFetchReceiptsPerDelivery, 'limit', 'Feedback fetch receipt retention is full.');
      await this.sources.agent.readContext(e.contextId, principal);
      r.fetchReceipts.push(receipt); await this.commit(state);
    }
    return result;
  }
  async returnedFetch(bindingId: string, fetchId: string, nativeToolUseId: string, at: string) {
    const state = await this.state(), r = state.records.find((r: any) => r.submission.delivery?.targetBindingId === bindingId && r.fetchReceipts.some((f: any) => f.fetchId === fetchId && f.observation === 'owner-served'));
    if (!r) return null;
    const served = r.fetchReceipts.find((f: any) => f.fetchId === fetchId && f.observation === 'owner-served');
    const existing = r.fetchReceipts.find((f: any) => f.fetchId === fetchId && f.observation === 'client-tool-returned');
    if (existing) { requireThat(existing.nativeToolUseId === nativeToolUseId, 'conflict', 'Fetch ID already names another native tool return.'); return existing; }
    requireThat(r.fetchReceipts.length < this.limits.maxFetchReceiptsPerDelivery, 'limit', 'Feedback fetch receipt retention is full.');
    const receipt = { ...served, receiptId: digest(canonical([served.receiptId, nativeToolUseId])), observation: 'client-tool-returned', nativeToolUseId, at };
    r.fetchReceipts.push(receipt); await this.commit(state); return receipt;
  }
  async status(input: any, principal: string, operator = false) {
    const state = await this.state(), r = this.record(state, input.submissionId), s = r.submission;
    requireThat(input.taskId === r.originalInput.taskId, 'scope', 'Status belongs to another task.');
    if (!operator && principal !== s.author) await this.target(r, principal);
    let thread: any = null;
    if (s.annotation && this.sources.annotations) thread = await this.sources.annotations.read(s.annotation.annotationId);
    const binding = r.pinnedRoute.feedbackOwnerBindingId ? await this.sources.binding(r.pinnedRoute.feedbackOwnerBindingId) : null;
    const responses = thread?.messages.filter((m: any) => m.replyTo === s.annotation.messageId).map((m: any) => ({ annotationId: thread.annotationId, messageId: m.id, replyTo: m.replyTo, author: m.author, fromAssignedBusiness: m.author === binding?.principal })) ?? [];
    const q = input.query, pin = digest(canonical([principal, { ...input, query: { ...q, cursor: null } }, state.version, thread?.version ?? null])).slice(0, 32);
    let offset = q.after;
    if (q.cursor) { const [position, binding] = q.cursor.split(':'); requireThat(binding === pin, 'stale', 'Feedback status snapshot or query changed.'); offset = Number(position); }
    const items = [...r.fetchReceipts.map((value: any) => ({ kind: 'fetch', value })), ...responses.map((value: any) => ({ kind: 'response', value }))];
    requireThat(Number.isSafeInteger(offset) && offset >= q.after && offset <= items.length, 'invalid', 'Status page offset is invalid.');
    const result: any = { snapshot: { deliveryStoreVersion: state.version, annotationVersion: thread?.version ?? null }, next: null, complete: true, submission: s, queue: { attempts: r.attempts.length, transport: r.inboxReceipt ? 'accepted' : r.attempts.length ? 'unknown' : s.stages.queue === 'queued' ? 'queued' : s.stages.queue === 'blocked' ? 'blocked' : 'not-attempted', enqueueAck: r.coordination.ackObservedAt ? 'observed' : 'not-observed', inboxReceipt: r.inboxReceipt }, fetches: [], responses: [], retention: { receipts: r.inboxReceipt ? 'retained' : r.attempts.length ? 'unavailable' : 'retained', originalTargetPreserved: true } };
    const selected: any[] = [];
    for (const item of items.slice(offset)) {
      const candidate = [...selected, item], next = (offset + candidate.length) + ':' + pin;
      const trial = { ...result, fetches: candidate.filter(x => x.kind === 'fetch').map(x => x.value), responses: candidate.filter(x => x.kind === 'response').map(x => x.value), next, complete: false };
      if (candidate.length > q.limit || size(trial) > q.maxBytes) break;
      selected.push(item);
    }
    result.fetches = selected.filter(x => x.kind === 'fetch').map(x => x.value); result.responses = selected.filter(x => x.kind === 'response').map(x => x.value);
    result.complete = offset + selected.length === items.length;
    if (!result.complete) result.next = (offset + selected.length) + ':' + pin;
    requireThat(size(result) <= q.maxBytes && (result.complete || selected.length), 'limit', 'Complete feedback status item exceeds maxBytes.', { requiredBytes: size({ ...result, fetches: r.fetchReceipts.slice(offset, offset + 1), next: 'reserved-page-cursor' }) + 128 });
    return result;
  }
}
