// What an HTML page needs from the project to show as it was made: the files its styles,
// scripts, images and fonts name, each as a path in the project. Nothing here reads a file or
// touches a page; the view does both.

// The protected resource is the browser tab: the page's own text, how many files it may take
// from the project, each file's size and all of them together. Past a limit the page shows
// without that file, and says so.
export const htmlLimits = { maxRenderBytes: 8 * 1024 * 1024, maxFiles: 64, maxFileBytes: 8 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 };

// A reference resolved against the document's folder (or the project with a leading /), or
// null for one on the web, another scheme or a path that leaves the project.
export function projectPath(documentPath: string, target: string): string | null {
  let raw = target.trim().replace(/[?#].*$/, '');
  try { raw = decodeURIComponent(raw); } catch { return null; }
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return null;
  const parts = raw.startsWith('/') ? [] : documentPath.split('/').slice(0, -1);
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}
// A reference to the web, which the page shows without.
export const onTheWeb = (target: string) => /^(https?:)?\/\//i.test(target.trim());

const types: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', vtt: 'text/vtt',
};
export const mediaType = (path: string) => types[path.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream';

// The url(...) a stylesheet names, other than the page's own anchors and data.
export function cssReferences(css: string) {
  const out: string[] = [];
  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    const target = match[2]!.trim();
    if (!target.startsWith('#') && !/^data:/i.test(target)) out.push(target);
  }
  return [...new Set(out)];
}

export function dataUrl(bytes: Uint8Array, type: string) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

// The first thing the page runs: a link to anything but a place on the page is handed to the
// view, which opens a project file in Rho and leaves the web alone.
export const linkGuard = `document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;var h=a.getAttribute('href')||'';if(h.charAt(0)==='#')return;e.preventDefault();parent.postMessage({type:'rho-html-link',href:h},'*');},true);`
