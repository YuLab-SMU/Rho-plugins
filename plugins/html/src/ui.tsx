// An HTML document shown as the page it makes, from the same buffer every view of the document
// shares: a report, a widget or a page an Agent wrote shows here as it is confirmed. The page
// runs in a sandbox of its own, in a frame the application serves for this: its scripts run,
// it cannot reach Rho or anything on the web, and it takes from the project only the styles,
// scripts, images and fonts it names, which the view reads and puts into the page. A link to a
// project file opens it in Rho. Edit (Source where the session may only read) switches the view
// to the Documents editor on that buffer.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DocumentEditorView, useDocumentBuffer } from '@rho-workspace/plugin-documents/ui';
import { cssReferences, dataUrl, htmlLimits, linkGuard, mediaType, onTheWeb, projectPath } from './page.js';

export interface UiClient { call(method: string, input: any): Promise<any> }
// Services the application offers any view. Without pageFrame the document shows as its
// source; without fileBytes the page shows without the project files it names.
export interface ShellServices {
  openPath?(path: string): void;
  languageExtensions?(path: string): Promise<any[]>;
  // The current bytes of a project file, or null when it cannot be read here.
  fileBytes?(path: string, maxBytes: number): Promise<Uint8Array | null>;
  // The URL of the application's frame document: sandboxed, with no network, it answers
  // { type: 'rho-html-ready' } and then shows the page { type: 'rho-html-page', html } sent to it.
  pageFrame?: string;
}
type Operation = { method: string; state: string; authorized: boolean };
export interface HtmlViewProps {
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

const styles = `
.rho-html{height:100%;display:flex;flex-direction:column;min-height:0;background:var(--surface,#fff)}
.rho-html-frame{flex:1 1 auto;width:100%;min-height:0;border:0;background:#fff;color-scheme:light}
.rho-html-note{margin:0;padding:6px 14px;border-bottom:1px solid var(--divider,#eceef1);color:var(--text-muted,#5f6873);font:12.5px/1.45 var(--font-ui,system-ui,sans-serif)}
.rho-html-wait{padding:24px 32px;color:var(--text-muted,#5f6873);font:14px/1.5 var(--font-ui,system-ui,sans-serif)}
.rho-html-modes{display:inline-flex;border:1px solid var(--border,#d9dde3);border-radius:7px;overflow:hidden;margin-right:6px}
.rho-html-modes button{border:0;background:transparent;font:500 12.5px/1 var(--font-ui,system-ui,sans-serif);color:var(--text-muted,#5f6873);padding:6px 11px;cursor:pointer}
.rho-html-modes button[aria-pressed=true]{background:var(--surface-muted,#f4f5f7);color:var(--text,#1f2328)}
.rho-html-modes button+button{border-left:1px solid var(--border,#d9dde3)}
.rho-html-modes button:disabled{opacity:.45;cursor:default}
.rho-html-bar{display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:8px 12px;border-bottom:1px solid var(--divider,#eceef1)}
.rho-html-source{height:100%;display:flex;flex-direction:column;min-height:0}.rho-html-source>*{flex:1 1 auto;min-height:0}.rho-html-source>.rho-html-bar,.rho-html-source>.rho-html-note{flex:none}
`;
let injected = false;
function injectStyles() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style'); style.dataset.owner = 'rho-plugins.html'; style.textContent = styles; document.head.append(style);
}
const allowed = (ops: Operation[], method: string) => ops.some(o => o.method === method && o.state === 'available' && o.authorized);
const bytes = (text: string) => new TextEncoder().encode(text).length;

export interface Prepared { html: string; web: number; unread: string[] }
// The page with the project files it names put into it: stylesheets and scripts as their text,
// images, media, icons and the fonts and images a stylesheet names as data. A file on the web
// is left out and counted; one that cannot be read, or past the limits, is named.
export async function preparePage(text: string, path: string, read?: ShellServices['fileBytes']): Promise<Prepared> {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  let files = 0, total = 0, web = 0;
  const unread = new Set<string>(), known = new Map<string, Promise<Uint8Array | null>>();
  const bytesOf = (target: string) => {
    let pending = known.get(target);
    if (!pending) {
      const turn = files++;
      pending = (async () => {
        if (!read || turn >= htmlLimits.maxFiles) return null;
        const data = await read(target, htmlLimits.maxFileBytes).catch(() => null);
        if (!data || data.length > htmlLimits.maxFileBytes || total + data.length > htmlLimits.maxTotalBytes) return null;
        total += data.length;
        return data;
      })();
      known.set(target, pending);
    }
    return pending;
  };
  async function resolve(base: string, ref: string, as: 'url' | 'text') {
    if (onTheWeb(ref)) { web++; return null; }
    const target = projectPath(base, ref);
    if (!target) return null;
    const data = await bytesOf(target);
    if (!data) { unread.add(target); return null; }
    return as === 'text' ? new TextDecoder().decode(data) : dataUrl(data, mediaType(target));
  }
  async function css(text: string, base: string) {
    let out = text;
    for (const ref of cssReferences(text)) { const url = await resolve(base, ref, 'url'); if (url) out = out.split(ref).join(url); }
    return out;
  }
  doc.querySelectorAll('base').forEach(base => base.remove());
  await Promise.all([
    ...[...doc.querySelectorAll('link[rel~="stylesheet" i][href]')].map(async link => {
      const ref = link.getAttribute('href')!, target = projectPath(path, ref), text = await resolve(path, ref, 'text');
      if (text === null || !target) return;
      const style = doc.createElement('style');
      style.textContent = await css(text, target);
      if (link.hasAttribute('media')) style.setAttribute('media', link.getAttribute('media')!);
      link.replaceWith(style);
    }),
    ...[...doc.querySelectorAll('script[src]')].map(async script => {
      const text = await resolve(path, script.getAttribute('src')!, 'text');
      if (text === null) return;
      script.removeAttribute('src');
      script.textContent = text.replace(/<\/script/gi, '<\\/script');
    }),
    ...([['img[src], source[src], video[src], audio[src], track[src], input[type="image" i][src]', 'src'], ['video[poster]', 'poster'], ['link[rel~="icon" i][href]', 'href']] as const).flatMap(([selector, attribute]) =>
      [...doc.querySelectorAll(selector)].map(async element => {
        const url = await resolve(path, element.getAttribute(attribute)!, 'url');
        if (url) { element.setAttribute(attribute, url); element.removeAttribute('srcset'); }
      })),
    ...[...doc.querySelectorAll('style')].map(async style => { style.textContent = await css(style.textContent ?? '', path); }),
    ...[...doc.querySelectorAll('[style*="url(" i]')].map(async element => { element.setAttribute('style', await css(element.getAttribute('style')!, path)); }),
  ]);
  const guard = doc.createElement('script');
  guard.textContent = linkGuard;
  doc.head.prepend(guard);
  return { html: (doc.doctype ? '<!DOCTYPE html>\n' : '') + doc.documentElement.outerHTML, web, unread: [...unread] };
}

export function HtmlView(props: HtmlViewProps) {
  injectStyles();
  const { snapshot, shell } = props, ops = snapshot.catalog.operations;
  const binding = props.view.bindings.document as { documentId?: string } | undefined;
  const doc = snapshot.documents?.find(d => d.id === binding?.documentId);
  const maxUnconfirmedBytes = Math.max(1, Math.min(1024 * 1024, (snapshot.limits?.documents as { maxBufferBytes?: number } | undefined)?.maxBufferBytes ?? 1024 * 1024));
  const { buffer, failure, retry } = useDocumentBuffer({ client: props.client, projectId: props.projectId, documentId: binding?.documentId, documentVersion: doc?.version, principalId: props.principalId, maxUnconfirmedBytes });
  const [mode, setMode] = useState<'read' | 'source'>('read');
  const large = buffer ? bytes(buffer.content) > htmlLimits.maxRenderBytes : false;
  const framed = !!shell?.pageFrame;
  const showSource = mode === 'source' || large || !framed;
  // The page is made again as the text changes, a moment after the last change.
  const [page, setPage] = useState<{ key: number; prepared: Prepared } | null>(null), [problem, setProblem] = useState('');
  const made = useRef(0);
  useEffect(() => {
    if (!buffer || showSource) return;
    let live = true;
    const timer = setTimeout(() => preparePage(buffer.content, buffer.path, shell?.fileBytes).then(
      prepared => { if (live) { setPage({ key: ++made.current, prepared }); setProblem(''); } },
      error => { if (live) setProblem(error instanceof Error ? error.message : 'The page could not be made.'); }), made.current ? 400 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [buffer?.content, buffer?.path, showSource, shell]);
  // The frame asks for the page once it is ready; a link it hands back opens a project file.
  const frame = useRef<HTMLIFrameElement>(null), [outside, setOutside] = useState('');
  useEffect(() => {
    function message(event: MessageEvent) {
      if (!frame.current || event.source !== frame.current.contentWindow || typeof event.data !== 'object' || !event.data) return;
      if (event.data.type === 'rho-html-ready' && page) frame.current.contentWindow!.postMessage({ type: 'rho-html-page', html: page.prepared.html }, '*');
      if (event.data.type === 'rho-html-link' && typeof event.data.href === 'string' && buffer) {
        const target = projectPath(buffer.path, event.data.href);
        if (target && shell?.openPath) { setOutside(''); shell.openPath(target); }
        else setOutside(event.data.href.slice(0, 200));
      }
    }
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, [page, buffer?.path, shell]);

  const editable = ['document.edit', 'document.undoOwn', 'document.revert', 'document.change.read'].every(m => allowed(ops, m));
  const modes = <div className="rho-html-modes" role="group" aria-label="Show as">
    <button aria-pressed={!showSource} disabled={large || !framed} onClick={() => setMode('read')}>Page</button>
    <button aria-pressed={showSource} onClick={() => setMode('source')}>{editable ? 'Edit' : 'Source'}</button>
  </div>;
  const header = props.headerTarget ? createPortal(modes, props.headerTarget) : null;
  if (!binding?.documentId) return <p className="rho-html-wait">This view has no document bound.</p>;
  if (showSource) return <div className="rho-html-source">
    {header}{!header && <div className="rho-html-bar">{modes}</div>}
    {large && <p className="rho-html-note">This page is larger than {Math.round(htmlLimits.maxRenderBytes / 1024 / 1024)} MB, so it shows as its source.</p>}
    {!framed && <p className="rho-html-note">Pages cannot be shown here, so this shows the source.</p>}
    <DocumentEditorView view={props.view} projectId={props.projectId} client={props.client} active={props.active} documentVersion={doc?.version} documentRevision={doc?.revision}
      principalId={props.principalId} contextTarget={props.contextTarget} headerTarget={props.headerTarget} maxUnconfirmedBytes={maxUnconfirmedBytes}
      editable={editable} saveable={allowed(ops, 'document.save')} askable={allowed(ops, 'context.create')} extensionsFor={shell?.languageExtensions} />
  </div>;
  const prepared = page?.prepared, unread = prepared?.unread ?? [];
  return <div className="rho-html" aria-label={buffer ? buffer.path : 'HTML page'}>
    {header ?? <div className="rho-html-bar">{modes}</div>}
    {prepared && prepared.web > 0 && <p className="rho-html-note">This page names {prepared.web} {prepared.web === 1 ? 'file' : 'files'} on the web, which it shows without.</p>}
    {unread.length > 0 && <p className="rho-html-note">Shown without {unread.length === 1 ? 'a project file it names' : unread.length + ' project files it names'}: {unread.slice(0, 4).join(', ')}{unread.length > 4 ? '…' : ''}</p>}
    {outside && <p className="rho-html-note">Links outside the project are not opened here: {outside}</p>}
    {failure ? <p className="rho-html-wait" role="alert">{failure} <button onClick={retry}>Try again</button></p>
      : problem ? <p className="rho-html-wait" role="alert">{problem}</p>
      : !page ? <p className="rho-html-wait" role="status">Making the page…</p>
      : <iframe key={page.key} ref={frame} className="rho-html-frame" src={shell!.pageFrame} sandbox="allow-scripts" referrerPolicy="no-referrer" title={buffer?.path ?? 'HTML page'} />}
  </div>;
}
