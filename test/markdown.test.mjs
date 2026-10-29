import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderMarkdown, projectPath, markdownLimits } from '@rho-workspace/plugin-markdown/render';

test('paths a document names resolve inside the project only', () => {
  assert.equal(projectPath('report/notes.md', 'figures/a.png'), 'report/figures/a.png');
  assert.equal(projectPath('report/notes.md', '../data/x.csv'), 'data/x.csv');
  assert.equal(projectPath('report/notes.md', '/data/x.csv'), 'data/x.csv');
  assert.equal(projectPath('report/notes.md', 'my%20figure.png?raw=1#top'), 'report/my figure.png');
  assert.equal(projectPath('report/notes.md', '../../etc/passwd'), null);
  assert.equal(projectPath('notes.md', 'https://example.org/a.png'), null);
  assert.equal(projectPath('notes.md', '//example.org/a.png'), null);
  assert.equal(projectPath('notes.md', '%E0%A4%A'), null);
});

test('links and images are marked for the view to resolve, never loaded from the web', () => {
  const r = renderMarkdown([
    '# Results', '', '## Results', '',
    '[script](analysis.py) [web](https://example.org) [top](#results) [away](../../x) [bad](javascript:alert(1))', '',
    '![fit](figures/fit.png) ![remote](https://example.org/a.png) ![outside](../../a.png) ![dot](data:image/png;base64,iVBORw0KGgo=)',
  ].join('\n'), 'study/report.md');
  assert.deepEqual(r.headings.map(h => h.slug), ['results', 'results-1']);
  assert.deepEqual(r.links, ['study/analysis.py']);
  assert.deepEqual(r.images, ['study/figures/fit.png']);
  assert.match(r.html, /<a href="#" data-rho-path="study\/analysis.py" title="study\/analysis.py">script<\/a>/);
  assert.match(r.html, /<a href="https:\/\/example.org" target="_blank" rel="noopener noreferrer">web<\/a>/);
  assert.match(r.html, /<a href="#results" data-rho-anchor="results">top<\/a>/);
  assert.match(r.html, /<a href="#" data-rho-outside="">away<\/a>/);
  assert.doesNotMatch(r.html, /href="javascript/i);
  assert.match(r.html, /<img data-rho-image="study\/figures\/fit.png" alt="fit">/);
  assert.match(r.html, /remote · an image on the web/);
  assert.match(r.html, /outside · not in this project/);
  assert.match(r.html, /<img src="data:image\/png;base64,iVBORw0KGgo=" alt="dot">/);
  assert.doesNotMatch(r.html, /src="https?:/);
});

test('the document\'s own HTML stays text', () => {
  const r = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> **bold**', 'a.md');
  assert.doesNotMatch(r.html, /<script|<img src=x/);
  assert.match(r.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(r.html, /<strong>bold<\/strong>/);
});

test('tables, task lists, math and fenced code render; punctuation stays with inline math', () => {
  const r = renderMarkdown([
    '| Term | p |', '|---|--:|', '| Temp | 0.001 |', '',
    '- [x] fitted', '- [ ] refit', '',
    'Explains half ($R^2 = 0.49$).', '', '$$y = a + b x$$', '',
    '```python', 'x = 1', '```', '', '```{r fit, echo=FALSE}', 'lm(y ~ x)', '```', '', '    indented',
  ].join('\n'), 'a.md');
  assert.match(r.html, /<table>[\s\S]*<td style="text-align:right">0.001<\/td>/);
  assert.equal((r.html.match(/<input class="task-list-item-checkbox"[^>]*disabled/g) ?? []).length, 2);
  assert.match(r.html, /<span class="rho-md-nobreak">\(<span class="katex">[\s\S]*?\)\.<\/span><\/p>/);
  assert.match(r.html, /class="katex-display"/);
  assert.match(r.html, /<pre class="rho-md-code" data-language="python"><code>x = 1\n<\/code><\/pre>/);
  assert.match(r.html, /<pre class="rho-md-code" data-language="r"><code>lm\(y ~ x\)\n<\/code><\/pre>/);
  assert.match(r.html, /<pre class="rho-md-code"><code>indented\n<\/code><\/pre>/);
});

test('images past the budget show their description', () => {
  const text = Array.from({ length: 3 }, (_, i) => `![figure ${i}](f${i}.png)`).join('\n\n');
  const r = renderMarkdown(text, 'a.md', { ...markdownLimits, maxImages: 2 });
  assert.deepEqual(r.images, ['f0.png', 'f1.png']);
  assert.match(r.html, /figure 2 · more images than this view shows/);
});

test('the package declares one view over the Documents capability', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugins/markdown/rho-ui.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(new URL('../plugins/markdown/package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.format, 'rho.ui-extension/1');
  assert.equal(manifest.plugin, 'documents');
  assert.ok(!manifest.component.startsWith('rho.'));
  assert.deepEqual(manifest.bindings, { document: 'document' });
  assert.equal(manifest.version, pkg.version);
  assert.equal(pkg.rho.ui, './rho-ui.json');
  assert.equal(pkg.exports[manifest.entry], './dist/ui.js');
  assert.ok(pkg.files.includes('rho-ui.json'));
});
