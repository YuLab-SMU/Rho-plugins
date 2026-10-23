// Optional browser entry for rho.media. Bytes are read in bounded chunks from the
// exact bound version and shown as an object URL; the renderer never writes and never
// changes the resource. A file larger than the budget is reported, not truncated
// silently.
import { useEffect, useMemo, useState } from 'react';
import { readWhole, mediaByteBudget, type UiClient, type Ref } from './ui-bytes.js';
export { readWhole, mediaByteBudget } from './ui-bytes.js';

export interface MediaViewProps {
  view: { id: string; props: Record<string, unknown>; bindings: Record<string, unknown> };
  projectId: string;
  client: UiClient;
  active: boolean;
  maxReadBytes?: number;
  maxDisplayBytes?: number;
  mimeType?: string;
}
type Loaded = { url: string; bytes: number; mimeType: string } | { problem: string };

const message = { padding: '12px 14px', margin: 0, fontSize: 13, color: 'var(--text-muted, #8b939d)' } as const;

export function MediaView(props: MediaViewProps) {
  const resource = props.view.bindings.data as Ref | undefined;
  const title = typeof props.view.props.title === 'string' ? props.view.props.title : 'media';
  const [state, setState] = useState<Loaded | { problem: 'reading' } | null>(null);

  useEffect(() => {
    if (!props.active) { setState(null); return; }
    if (!resource?.id || !resource?.version) { setState({ problem: 'This view has no media bound.' }); return; }
    let url: string | undefined, live = true;
    const controller = new AbortController();
    setState({ problem: 'reading' });
    (async () => {
      try {
        const bytes = await readWhole(props.client, props.projectId, resource, props.maxDisplayBytes ?? mediaByteBudget, props.maxReadBytes, controller.signal);
        if (!live) return;
        const blob = new Blob([bytes], { type: props.mimeType ?? 'application/octet-stream' });
        url = URL.createObjectURL(blob);
        setState({ url, bytes: bytes.length, mimeType: 'application/octet-stream' });
      } catch (error: any) {
        if (live) setState({ problem: error?.error?.message ?? error?.message ?? 'This media could not be read.' });
      }
    })();
    return () => { live = false; controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [props.client, props.projectId, resource?.id, resource?.version, props.active, props.maxReadBytes, props.maxDisplayBytes, props.mimeType]);

  const label = useMemo(() => typeof resource?.version === 'string' ? resource.version.slice(0, 8) : '', [resource?.version]);

  // An inactive view is not reading: it is waiting for its tab to be selected, and saying
  // "Reading" forever would describe work that never started.
  if (!props.active && !state) return <p style={message}>{title}{label && <> · version {label}</>} — open this tab to load it.</p>;
  if (!state || 'problem' in state && state.problem === 'reading') return <p style={message}>Reading {title}…</p>;
  if ('problem' in state) return <p style={message} role="status">{state.problem}{label && <> · version {label}</>}</p>;
  return <figure style={{ margin: 0, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
    <img src={state.url} alt={title} style={{ maxWidth: '100%', height: 'auto', alignSelf: 'flex-start', border: '1px solid var(--hairline, #e4e7eb)' }} />
    <figcaption style={{ fontSize: 12, color: 'var(--text-muted, #8b939d)' }}>{title} · {(state.bytes / 1024).toFixed(0)} KB{label && <> · version {label}</>}</figcaption>
  </figure>;
}
