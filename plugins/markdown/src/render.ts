// Markdown read as formatted text: CommonMark with tables, strikethrough, task lists and
// TeX math, rendered without any HTML of the document's own (HTML in the text is shown
// as text, except a line that is only an HTML comment, which is not shown, as in other
// Markdown readers). Links and images name project files relative to the document; the
// view resolves them, the renderer only marks them. Each to-do names its source line, so
// the view can tick it in the text.
import MarkdownIt, { type PluginWithOptions } from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import mathPlugin from '@vscode/markdown-it-katex';
import taskLists from 'markdown-it-task-lists';

// The protected resource is the browser tab. A document over maxRenderBytes is shown as
// its source with a note; images past maxImages show their description instead.
export const markdownLimits = { maxRenderBytes: 512 * 1024, maxImages: 32 };

export interface Heading { level: number; text: string; slug: string }
export interface Rendered { html: string; headings: Heading[]; images: string[]; links: string[] }

// A file the document names, as a project path: relative to the document's folder, or to
// the project with a leading slash. Null for a path outside the project or no file at all.
export function projectPath(documentPath: string, target: string): string | null {
  let raw = target.replace(/[?#].*$/, '');
  try { raw = decodeURIComponent(raw); } catch { return null; }
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return null;
  const parts = raw.startsWith('/') ? [] : documentPath.split('/').slice(0, -1);
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}

// A paragraph line that is only an HTML comment, such as a marker an Agent keeps under its
// heading. With HTML disabled it would show as text.
const comment = /^<!--[\s\S]*?-->$/;
function dropComments(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.type === 'inline' && token.children) {
      const kept: Token[] = [];
      for (const child of token.children) {
        if (child.type === 'text' && comment.test(child.content.trim())) continue;
        if (child.type === 'softbreak' && (!kept.length || kept.at(-1)!.type === 'softbreak')) continue;
        kept.push(child);
      }
      while (kept.at(-1)?.type === 'softbreak') kept.pop();
      if (!kept.length && token.children.length && tokens[i - 1]?.type === 'paragraph_open' && tokens[i + 1]?.type === 'paragraph_close') { out.pop(); i++; continue; }
      token.children = kept;
    }
    out.push(token);
  }
  return out;
}

const fenceLanguage = (info: string) => info.trim().replace(/^\{\s*/, '').split(/[\s,{}]/)[0]?.toLowerCase() ?? '';
const external = (href: string) => /^(https?:|mailto:)/i.test(href);

function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') || 'section';
    const n = seen.get(base) ?? 0; seen.set(base, n + 1);
    return n ? base + '-' + n : base;
  };
}

// Punctuation against inline math stays on the formula's line, as it would beside a word.
function keepPunctuation(children: Token[], escapeHtml: (s: string) => string) {
  const out: Token[] = [], html = (like: Token, content: string) => Object.assign(new (like.constructor as typeof Token)('html_inline', '', 0), { content });
  for (let i = 0; i < children.length; i++) {
    const token = children[i]!, prev = out.at(-1), next = children[i + 1];
    if (token.type !== 'math_inline') { out.push(token); continue; }
    const before = prev?.type === 'text' ? /[(\[“‘"']+$/.exec(prev.content)?.[0] ?? '' : '';
    const after = next?.type === 'text' ? /^[)\]”’"'.,;:!?]+/.exec(next.content)?.[0] ?? '' : '';
    if (!before && !after) { out.push(token); continue; }
    if (before) prev!.content = prev!.content.slice(0, -before.length);
    if (after) next!.content = next!.content.slice(after.length);
    out.push(html(token, '<span class="rho-md-nobreak">' + escapeHtml(before)), token, html(token, escapeHtml(after) + '</span>'));
  }
  return out;
}

let md: MarkdownIt | null = null;
function parser() {
  if (md) return md;
  md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  // A CommonJS default export arrives wrapped when this module runs in Node.
  // Its types name another copy of markdown-it's.
  const math = ((mathPlugin as any).default ?? mathPlugin) as PluginWithOptions<{ throwOnError: boolean; enableFencedBlocks: boolean }>;
  md.use(math, { throwOnError: false, enableFencedBlocks: true });
  md.use(taskLists, { enabled: true, label: true });
  const { escapeHtml } = md.utils;
  md.renderer.rules.fence = (tokens, i) => {
    const token = tokens[i]!, language = fenceLanguage(token.info);
    return `<pre class="rho-md-code"${language ? ` data-language="${escapeHtml(language)}"` : ''}><code>${escapeHtml(token.content)}</code></pre>\n`;
  };
  md.renderer.rules.code_block = (tokens, i) => `<pre class="rho-md-code"><code>${escapeHtml(tokens[i]!.content)}</code></pre>\n`;
  return md;
}

// The document's text as HTML for its view. documentPath places relative links and images.
export function renderMarkdown(text: string, documentPath: string, limits = markdownLimits): Rendered {
  const parse = parser(), env = {}, tokens = dropComments(parse.parse(text, env));
  const slug = slugger(), headings: Heading[] = [], images: string[] = [], links: string[] = [];
  const { escapeHtml } = parse.utils;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.type === 'heading_open') {
      const text = tokens[i + 1]?.children?.filter(c => c.type === 'text' || c.type === 'code_inline').map(c => c.content).join('') ?? '';
      const heading = { level: Number(token.tag.slice(1)), text, slug: slug(text) };
      headings.push(heading); token.attrSet('data-rho-heading', heading.slug);
    }
    if (token.type === 'list_item_open' && /\btask-list-item\b/.test(token.attrGet('class') ?? '') && token.map) token.attrSet('data-rho-task-line', String(token.map[0]));
    if (token.children) token.children = keepPunctuation(token.children, escapeHtml);
    for (const child of token.children ?? []) {
      if (child.type === 'link_open') {
        const href = child.attrGet('href') ?? '';
        if (href.startsWith('#')) { child.attrSet('data-rho-anchor', href.slice(1)); continue; }
        if (external(href)) { child.attrSet('target', '_blank'); child.attrSet('rel', 'noopener noreferrer'); continue; }
        const path = projectPath(documentPath, href);
        if (path) { links.push(path); child.attrSet('data-rho-path', path); child.attrSet('title', path); }
        else child.attrSet('data-rho-outside', '');
        child.attrSet('href', '#');
      }
      if (child.type === 'image') {
        const src = child.attrGet('src') ?? '', path = projectPath(documentPath, src);
        if (src.startsWith('data:image/')) continue;
        if (path && images.length < limits.maxImages) { images.push(path); child.attrs = [['data-rho-image', path], ['alt', child.content]]; continue; }
        // Shown as its description: a web address the page will not load, a path outside the
        // project, or an image past the budget.
        const why = path ? 'more images than this view shows' : external(src) ? 'an image on the web' : 'not in this project';
        Object.assign(child, { type: 'html_inline', content: `<span class="rho-md-image-note" title="${escapeHtml(src)}">${escapeHtml(child.content || src)} · ${why}</span>` });
      }
    }
  }
  // html_inline tokens made above are the renderer's own markup; the document's HTML stays
  // text because the parser never produces them from the source with html disabled.
  return { html: parse.renderer.render(tokens, parse.options, env), headings, images, links };
}
