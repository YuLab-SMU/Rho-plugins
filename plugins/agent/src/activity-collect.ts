import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalActivity, type ObservedEvent } from './activity-normalize.js';
import { readActivitySource, type SourceOptions } from './activity-reader.js';

export interface ActivityConnection { binary: string; socket: string; caller: string }
export class CoreActivityClient {
  constructor(public connection: ActivityConnection) {
    if (!path.isAbsolute(connection.binary) || !path.isAbsolute(connection.socket)) throw new Error('Select absolute Core binary and socket paths');
  }
  call(command: string, args: string[] = [], body?: unknown): any {
    const c = this.connection;
    const result = spawnSync(c.binary, [command, '--socket', c.socket, '--caller', c.caller, ...args], {
      input: body === undefined ? undefined : JSON.stringify(body), encoding: 'utf8',
      timeout: 15000, maxBuffer: 2 * 1024 * 1024,
    });
    if (result.error) throw new Error('Core observation transport failed; retain the original source and stream identity');
    let reply;
    try { reply = JSON.parse(result.stdout); } catch { throw new Error('Core observation acknowledgement is unreadable; retain original identity'); }
    if (result.status !== 0 || reply.ok !== true) throw new Error(`Core ${reply.error?.kind ?? 'unknown'}: ${reply.error?.message ?? 'observation acknowledgement unknown'}`);
    return reply.value;
  }
}

export async function collectActivity(client: CoreActivityClient, options: SourceOptions, streamId: string) {
  const capability = client.call('capability');
  if (capability.project_root !== await fs.realpath(options.project) || !capability.limits?.activity) throw new Error('Core project or activity capability does not match the selected source');
  const snapshot = await readActivitySource(options, streamId);
  const state = client.call('activity-open', ['--source-file', '-'], snapshot.source);
  let next = state.next_sequence;
  if (!Number.isSafeInteger(next) || next < 0 || next > snapshot.events.length) throw new Error('Native source no longer contains the acknowledged history; observation is incomplete');
  if (next > 0) {
    const last = client.call('activity-read', ['--id', streamId, '--after', String(next - 1), '--limit', '1']);
    if (canonicalActivity(last.entries?.[0]?.event) !== canonicalActivity(snapshot.events[next - 1])) throw new Error('Native source prefix or normalization changed; preserve the original stream');
  }
  const limits = capability.limits.activity; let appended = 0;
  while (next < snapshot.events.length) {
    const batch: ObservedEvent[] = [];
    for (const event of snapshot.events.slice(next, next + limits.max_batch_events)) {
      if (Buffer.byteLength(JSON.stringify([...batch, event])) > limits.max_batch_bytes) break;
      batch.push(event);
    }
    if (!batch.length) throw new Error('Selected event cannot fit Core batch limit; source and acknowledged prefix retained');
    const result = client.call('activity-append', ['--id', streamId, '--events-file', '-'], batch);
    if (result.receipts?.length !== batch.length || result.receipts.some((r: any, i: number) => r.sequence !== batch[i]!.sequence || r.cursor !== r.sequence + 1)) throw new Error('Core receipt does not match original batch; preserve identity');
    appended += result.receipts.filter((r: any) => r.existing === false).length;
    next += batch.length;
  }
  return {stream: streamId, observed: snapshot.events.length, appended, next_sequence: next, pending_tail: snapshot.pendingTail};
}

export { summarizeActivity } from './activity-summary.js';
