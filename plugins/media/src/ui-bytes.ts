export interface UiClient { call(method: string, input: any, signal?: AbortSignal): Promise<any> }
export interface Ref { id: string; version: string }
export const mediaByteBudget = 8 * 1024 * 1024;

// The first reply declares the size and the owner's actual page limit. No duplicate
// copy of Files' defaults is needed, and cancellation stops subsequent observations.
export async function readWhole(client: UiClient, projectId: string, resource: Ref, budget = mediaByteBudget, pageBytes?: number, signal?: AbortSignal) {
  if (!Number.isSafeInteger(budget) || budget < 1 || pageBytes !== undefined && (!Number.isSafeInteger(pageBytes) || pageBytes < 1)) throw new Error('Invalid media read budget.');
  let offset = 0, all: Uint8Array<ArrayBuffer> | undefined;
  for (;;) {
    signal?.throwIfAborted();
    const page = await client.call('resource.read', { projectId, resource, offset, ...(pageBytes === undefined ? {} : { maxBytes: Math.min(pageBytes, budget) }) }, signal);
    signal?.throwIfAborted();
    const total = page.resource?.bytes;
    if (!Number.isSafeInteger(total) || total < 0 || page.resource?.id !== resource.id || page.resource?.version !== resource.version) throw new Error('The resource identity changed during the read.');
    if (total > budget) throw new Error(`This file exceeds the ${budget} byte display budget.`);
    if (page.encoding !== 'base64' || page.offset !== offset || !Number.isSafeInteger(page.nextOffset) || page.nextOffset < offset || page.nextOffset > total || typeof page.more !== 'boolean') throw new Error('The file could not be read in order.');
    const binary = atob(page.data);
    if (binary.length !== page.nextOffset - offset || page.more !== (page.nextOffset < total) || page.more && binary.length === 0 || all && all.length !== total) throw new Error('The file could not be read in order.');
    all ??= new Uint8Array(total);
    for (let i = 0; i < binary.length; i++) all[offset + i] = binary.charCodeAt(i);
    if (!page.more) return all;
    offset = page.nextOffset;
    if (Number.isSafeInteger(page.maxReadBytes) && page.maxReadBytes > 0) pageBytes = Math.min(pageBytes ?? page.maxReadBytes, page.maxReadBytes);
  }
}
