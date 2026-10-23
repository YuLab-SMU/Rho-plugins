// Optional browser entry for rho.media. Bytes are read in bounded chunks from the
// exact bound version and shown as an object URL; the renderer never writes and never
// changes the resource. A file larger than the budget is reported, not truncated
// silently.
import { useEffect, useMemo, useState } from 'react';

export interface UiClient { call(method: string, input: any): Promise<any> }
export interface MediaViewProps {
  view: { id: string; props: Record<string, unknown>; bindings: Record<string, unknown> };
  projectId: string;
  client: UiClient;
  active: boolean;
}

export const mediaByteBudget = 8 * 1024 * 1024;
// The owner reads at most 64 KiB per page (fileLimits.maxReadBytes); asking for more
// is refused as a limit, not silently clamped.
export const mediaChunkBytes = 64 * 1024;

type Ref = { id: string; version: string };
type Loaded = { url: string; bytes: number; mimeType: string } | { problem: string };

const message = { padding: '12px 14px', margin: 0, fontSize: 13, color: 'var(--text-muted, #8b939d)' } as const;

// Reads whole bytes through bounded pages; a chunk loop, not one unbounded request.
export async function readWhole(client: UiClient, projectId: string, resource: Ref, budget = mediaByteBudget) {
  const parts: Uint8Array[] = [];
  let offset = 0, total = 0;
  for (;;) {
    const page = await client.call('resource.read', { projectId, resource, offset, maxBytes: mediaChunkBytes });
    const binary = atob(page.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    parts.push(bytes); total += bytes.length;
    if (total > budget) throw new Error(`This file is larger than the ${Math.round(budget / 1024 / 1024)} MB display budget.`);
    if (!page.more) break;
    if (typeof page.nextOffset !== 'number' || page.nextOffset <= offset) throw new Error('The file could not be read in order.');
    offset = page.nextOffset;
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { all.set(part, at); at += part.length; }
  return all;
}

export function MediaView(props: MediaViewProps) {
  const resource = props.view.bindings.data as Ref | undefined;
  const title = typeof props.view.props.title === 'string' ? props.view.props.title : 'media';
  const [state, setState] = useState<Loaded | { problem: 'reading' } | null>(null);

  useEffect(() => {
    if (!resource?.id || !resource?.version) { setState({ problem: 'This view has no media bound.' }); return; }
    let url: string | undefined, live = true;
    setState({ problem: 'reading' });
    (async () => {
      try {
        const bytes = await readWhole(props.client, props.projectId, resource);
        if (!live) return;
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        url = URL.createObjectURL(blob);
        setState({ url, bytes: bytes.length, mimeType: 'application/octet-stream' });
      } catch (error: any) {
        if (live) setState({ problem: error?.error?.message ?? error?.message ?? 'This media could not be read.' });
      }
    })();
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [props.client, props.projectId, resource?.id, resource?.version]);

  const label = useMemo(() => typeof resource?.version === 'string' ? resource.version.slice(0, 8) : '', [resource?.version]);

  if (!state || 'problem' in state && state.problem === 'reading') return <p style={message}>Reading {title}…</p>;
  if ('problem' in state) return <p style={message} role="status">{state.problem}{label && <> · version {label}</>}</p>;
  return <figure style={{ margin: 0, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
    <img src={state.url} alt={title} style={{ maxWidth: '100%', height: 'auto', alignSelf: 'flex-start', border: '1px solid var(--hairline, #e4e7eb)' }} />
    <figcaption style={{ fontSize: 12, color: 'var(--text-muted, #8b939d)' }}>{title} · {(state.bytes / 1024).toFixed(0)} KB{label && <> · version {label}</>}</figcaption>
  </figure>;
}
