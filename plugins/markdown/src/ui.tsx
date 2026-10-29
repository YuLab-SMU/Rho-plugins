// A Markdown document read as formatted text, from the same buffer every view of the
// document shares: an Agent's edit or the person's typing shows here as it is confirmed.
// Source switches the view to the Documents editor on that buffer. The renderer and its
// math fonts load the first time a Markdown view shows.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { DocumentEditorView, useDocumentBuffer } from '@rho-workspace/plugin-documents/ui';
import type { Rendered } from './render.js';

export interface UiClient { call(method: string, input: any): Promise<any> }
// Services the application offers any view. Each is optional: without it a project link
// stays a link, an image shows its description and code stays plain.
export interface ShellServices {
  openPath?(path: string): void;
  imageUrl?(path: string): Promise<string | null>;
  languageExtensions?(path: string): Promise<any[]>;
  highlight?(code: string, language: string): Promise<DocumentFragment | null>;
}
type Operation = { method: string; state: string; authorized: boolean };
export interface MarkdownViewProps {
  view: { id: string; props: Record<string, unknown>; bindings: Record<string, unknown> };
  projectId: string;
  snapshot: { catalog: { operations: Operation[] }; documents?: { id: string; version: number; revision: number }[]; limits?: Record<string, unknown> };
  client: UiClient;
  active: boolean;
  principalId?: string;
  contextTarget?: HTMLElement | null;
  headerTarget?: HTMLElement | null;
  shell?: ShellServices;
}

type Renderer = typeof import('./render.js');
let loading: Promise<Renderer> | null = null;
const loadRenderer = () => loading ??= Promise.all([import('./render.js'), import('katex/dist/katex.min.css')]).then(([module]) => module, error => { loading = null; throw error; });

const styles = `
.rho-md{height:100%;overflow:auto;background:var(--surface,#fff);color:var(--text,#1f2328)}
.rho-md-page{max-width:760px;margin:0 auto;padding:28px 32px 56px;font:15px/1.65 var(--font-ui,system-ui,sans-serif);overflow-wrap:break-word}
.rho-md-page>:first-child{margin-top:0}
.rho-md-page h1,.rho-md-page h2,.rho-md-page h3,.rho-md-page h4{line-height:1.3;font-weight:650;margin:1.6em 0 .6em}
.rho-md-page h1{font-size:1.75em}.rho-md-page h2{font-size:1.35em;padding-bottom:.25em;border-bottom:1px solid var(--divider,#eceef1)}.rho-md-page h3{font-size:1.12em}.rho-md-page h4{font-size:1em}
.rho-md-page p,.rho-md-page ul,.rho-md-page ol,.rho-md-page blockquote,.rho-md-page table,.rho-md-page pre,.rho-md-page figure{margin:0 0 1em}
.rho-md-page ul,.rho-md-page ol{padding-left:1.5em}.rho-md-page li+li{margin-top:.25em}
.rho-md-page .task-list-item{list-style:none;margin-left:-1.4em}.rho-md-page .task-list-item input{margin:0 .5em 0 0;vertical-align:-1px}
.rho-md-page a{color:var(--accent,#0b6bcb);text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1px}
.rho-md-page a[data-rho-outside]{color:inherit;text-decoration:none;cursor:default}
.rho-md-page blockquote{padding:.1em 1em;border-left:3px solid var(--border,#d9dde3);color:var(--text-muted,#5f6873)}
.rho-md-page code{font:.88em/1.5 var(--font-mono,ui-monospace,monospace);background:var(--surface-muted,#f4f5f7);padding:.1em .35em;border-radius:4px}
.rho-md-page pre.rho-md-code{background:var(--surface-muted,#f4f5f7);border:1px solid var(--divider,#eceef1);border-radius:8px;padding:12px 14px;overflow-x:auto}
.rho-md-page pre.rho-md-code code{background:none;padding:0;font-size:13px;white-space:pre}
.rho-md-page table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%;font-variant-numeric:tabular-nums}
.rho-md-page th,.rho-md-page td{border:1px solid var(--border,#d9dde3);padding:5px 12px}
.rho-md-page th{background:var(--surface-muted,#f4f5f7);font-weight:600}
.rho-md-page img{display:block;max-width:100%;height:auto;margin:.25em 0;border-radius:6px}
.rho-md-page img:not([src]){min-height:80px;background:var(--surface-muted,#f4f5f7)}
.rho-md-image-note{display:inline-block;color:var(--text-muted,#5f6873);font-size:.9em;border:1px dashed var(--border,#d9dde3);border-radius:6px;padding:4px 10px}
.rho-md-page hr{border:0;border-top:1px solid var(--divider,#eceef1);margin:2em 0}
.rho-md-page .katex-display{overflow-x:auto;overflow-y:hidden;padding:.25em 0}
.rho-md-nobreak{white-space:nowrap}
.rho-md-note{max-width:760px;margin:0 auto;padding:24px 32px;color:var(--text-muted,#5f6873);font:14px/1.5 var(--font-ui,system-ui,sans-serif)}
.rho-md-modes{display:inline-flex;border:1px solid var(--border,#d9dde3);border-radius:7px;overflow:hidden;margin-right:6px}
.rho-md-modes button{border:0;background:transparent;font:500 12.5px/1 var(--font-ui,system-ui,sans-serif);color:var(--text-muted,#5f6873);padding:6px 11px;cursor:pointer}
.rho-md-modes button[aria-pressed=true]{background:var(--surface-muted,#f4f5f7);color:var(--text,#1f2328)}
.rho-md-modes button+button{border-left:1px solid var(--border,#d9dde3)}
.rho-md-bar{display:flex;justify-content:flex-end;padding:8px 12px;border-bottom:1px solid var(--divider,#eceef1)}
.rho-md-source{height:100%;display:flex;flex-direction:column;min-height:0}.rho-md-source>*{flex:1 1 auto;min-height:0}
@media (max-width:600px){.rho-md-page{padding:20px 16px 40px;font-size:15px}}
`;
let injected = false;
function injectStyles() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style'); style.dataset.owner = 'rho-plugins.markdown'; style.textContent = styles; document.head.append(style);
}

const allowed = (ops: Operation[], method: string) => ops.some(o => o.method === method && o.state === 'available' && o.authorized);
const bytes = (text: string) => new TextEncoder().encode(text).length;

// Images and highlighted code arrive after the text; each view keeps the last of each so a
// change elsewhere in the document does not make them flicker.
function useEnhance(page: HTMLElement | null, rendered: Rendered | null, shell?: ShellServices) {
  const images = useRef(new Map<string, string | null>()), code = useRef(new Map<string, DocumentFragment>());
  useEffect(() => {
    if (!page || !rendered) return;
    let live = true;
    for (const img of page.querySelectorAll<HTMLImageElement>('img[data-rho-image]')) {
      const path = img.dataset.rhoImage!, known = images.current.get(path);
      if (known) img.src = known;
      if (!shell?.imageUrl) { img.replaceWith(note(img.alt, 'images are not available here')); continue; }
      shell.imageUrl(path).then(url => {
        if (!live) return;
        images.current.set(path, url);
        if (url) { if (img.src !== url) img.src = url; } else img.replaceWith(note(img.alt || path, 'not readable as an image'));
      }, () => { if (live) img.replaceWith(note(img.alt || path, 'could not be read')); });
    }
    for (const pre of page.querySelectorAll<HTMLElement>('pre[data-language]')) {
      const element = pre.firstElementChild as HTMLElement | null, language = pre.dataset.language!;
      if (!element || !shell?.highlight) continue;
      const text = element.textContent ?? '', key = language + '\0' + text, known = code.current.get(key);
      if (known) { element.replaceChildren(known.cloneNode(true)); continue; }
      shell.highlight(text, language).then(fragment => {
        if (!live || !fragment) return;
        code.current.set(key, fragment);
        element.replaceChildren(fragment.cloneNode(true));
      }, () => undefined);
    }
    return () => { live = false; };
  }, [page, rendered, shell]);
}
function note(description: string, why: string) {
  const span = document.createElement('span');
  span.className = 'rho-md-image-note'; span.textContent = (description ? description + ' · ' : '') + why;
  return span;
}

export function MarkdownView(props: MarkdownViewProps) {
  injectStyles();
  const { snapshot, shell } = props, ops = snapshot.catalog.operations;
  const binding = props.view.bindings.document as { documentId?: string } | undefined;
  const doc = snapshot.documents?.find(d => d.id === binding?.documentId);
  const maxUnconfirmedBytes = Math.max(1, Math.min(1024 * 1024, (snapshot.limits?.documents as { maxBufferBytes?: number } | undefined)?.maxBufferBytes ?? 1024 * 1024));
  const { buffer, failure, retry } = useDocumentBuffer({ client: props.client, projectId: props.projectId, documentId: binding?.documentId, documentVersion: doc?.version, principalId: props.principalId, maxUnconfirmedBytes });
  const [mode, setMode] = useState<'read' | 'source'>('read');
  const [renderer, setRenderer] = useState<Renderer | null>(null), [loadFailure, setLoadFailure] = useState('');
  useEffect(() => { let live = true; loadRenderer().then(r => { if (live) setRenderer(r); }, () => { if (live) setLoadFailure('The Markdown reader could not be loaded. Source shows the text.'); }); return () => { live = false; }; }, []);
  const large = buffer ? bytes(buffer.content) > (renderer?.markdownLimits.maxRenderBytes ?? Infinity) : false;
  const rendered = useMemo(() => renderer && buffer && !large ? renderer.renderMarkdown(buffer.content, buffer.path) : null, [renderer, buffer?.content, buffer?.path, large]);
  const [page, setPage] = useState<HTMLElement | null>(null);
  useEnhance(mode === 'read' ? page : null, rendered, shell);
  const showSource = mode === 'source' || large || !!loadFailure;

  function click(event: MouseEvent<HTMLElement>) {
    const link = (event.target as HTMLElement).closest('a');
    if (!link) return;
    const path = link.dataset.rhoPath, anchor = link.dataset.rhoAnchor;
    if (anchor !== undefined) {
      event.preventDefault();
      event.currentTarget.querySelector(`[data-rho-heading="${CSS.escape(decodeURIComponent(anchor))}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else if (path !== undefined || link.hasAttribute('data-rho-outside')) {
      event.preventDefault();
      if (path && shell?.openPath) shell.openPath(path);
    }
  }

  const modes = <div className="rho-md-modes" role="group" aria-label="Show as">
    <button aria-pressed={!showSource} disabled={large || !!loadFailure} onClick={() => setMode('read')}>Read</button>
    <button aria-pressed={showSource} onClick={() => setMode('source')}>Source</button>
  </div>;
  const header = props.headerTarget ? createPortal(modes, props.headerTarget) : null;
  if (!binding?.documentId) return <p className="rho-md-note">This view has no document bound.</p>;
  if (showSource) return <div className="rho-md-source">
    {header ?? <div className="rho-md-bar">{modes}</div>}
    {large && <p className="rho-md-note">This document is larger than {Math.round((renderer?.markdownLimits.maxRenderBytes ?? 0) / 1024)} KB, so it shows as its source.</p>}
    <DocumentEditorView view={props.view} projectId={props.projectId} client={props.client} active={props.active} documentVersion={doc?.version} documentRevision={doc?.revision}
      principalId={props.principalId} contextTarget={props.contextTarget} headerTarget={props.headerTarget} maxUnconfirmedBytes={maxUnconfirmedBytes}
      editable={['document.edit', 'document.undoOwn', 'document.revert', 'document.change.read'].every(m => allowed(ops, m))} saveable={allowed(ops, 'document.save')}
      askable={allowed(ops, 'context.create')} extensionsFor={shell?.languageExtensions} />
  </div>;
  return <div className="rho-md" aria-label={buffer ? buffer.path : 'Markdown document'}>
    {header ?? <div className="rho-md-bar">{modes}</div>}
    {failure ? <p className="rho-md-note" role="alert">{failure} <button onClick={retry}>Try again</button></p>
      : !rendered ? <p className="rho-md-note" role="status">Reading…</p>
      : <article ref={setPage} className="rho-md-page" onClick={click} dangerouslySetInnerHTML={{ __html: rendered.html }} />}
  </div>;
}
