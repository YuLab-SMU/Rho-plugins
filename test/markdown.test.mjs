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
  assert.equal((r.html.match(/<input class="task-list-item-checkbox"[^>]*>/g) ?? []).filter(box => !/disabled/.test(box)).length, 2);
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
  // The component version names its contract (props and bindings), which saved layouts
  // pin; the package version moves with its code.
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/); assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.rho.ui, './rho-ui.json');
  assert.equal(pkg.exports[manifest.entry], './dist/ui.js');
  assert.ok(pkg.files.includes('rho-ui.json'));
});

test('a to-do names its source line and ticks in the text; a comment-only line is not shown', async () => {
  const { toggleTask } = await import('../plugins/markdown/dist/format.js');
  const text = ['## Swarming', '<!-- rho:session c-1 -->', '', '- [ ] Run the test', '- [x] Read the data', '1. [ ] Ordered', '- plain', '', '```html', '<!-- kept in code -->', '```'].join('\n');
  const r = renderMarkdown(text, 'project-notes.md');
  assert.deepEqual([...r.html.matchAll(/data-rho-task-line="(\d+)"/g)].map(m => Number(m[1])), [3, 4, 5]);
  assert.doesNotMatch(r.html, /rho:session/, 'the marker line is not shown');
  assert.match(r.html, /&lt;!-- kept in code --&gt;/, 'a comment inside code stays');
  assert.doesNotMatch(r.html, /disabled/, 'the boxes are tickable; the view disables them where the session may not edit');
  assert.equal(toggleTask(text, 3).split('\n')[3], '- [x] Run the test');
  assert.equal(toggleTask(text, 4).split('\n')[4], '- [ ] Read the data');
  assert.equal(toggleTask(text, 5).split('\n')[5], '1. [x] Ordered');
  assert.equal(toggleTask(text, 6), null, 'a line with no to-do is left alone');
  assert.equal(toggleTask(text, 99), null);
  assert.match(renderMarkdown('Text\n<!-- note -->\nmore', 'a.md').html, /<p>Text\nmore<\/p>/);
});

test('the formatting controls write Markdown around the selection and toggle off', async () => {
  const { formatChange } = await import('../plugins/markdown/dist/format.js');
  const apply = (text, from, to, command) => { const c = formatChange(text, from, to, command); return { text: text.slice(0, c.from) + c.insert + text.slice(c.to), sel: [c.anchor, c.head] }; };
  assert.deepEqual(apply('a word here', 2, 6, 'bold'), { text: 'a **word** here', sel: [4, 8] });
  assert.deepEqual(apply('a **word** here', 4, 8, 'bold'), { text: 'a word here', sel: [2, 6] });
  assert.deepEqual(apply('a **word** here', 2, 10, 'bold'), { text: 'a word here', sel: [2, 6] });
  assert.deepEqual(apply('a word', 2, 6, 'italic'), { text: 'a *word*', sel: [3, 7] });
  assert.equal(apply('Title\nnext', 2, 2, 'h2').text, '## Title\nnext');
  assert.equal(apply('## Title', 3, 3, 'h1').text, '# Title', 'another heading level replaces the mark');
  assert.equal(apply('# Title', 3, 3, 'h1').text, 'Title', 'the same level takes it off');
  assert.equal(apply('one\ntwo\n\nthree', 0, 14, 'number').text, '1. one\n2. two\n\n3. three');
  assert.equal(apply('- one\n- two', 0, 11, 'task').text, '- [ ] one\n- [ ] two');
  assert.equal(apply('- [ ] one\n- [x] two', 0, 19, 'task').text, 'one\ntwo');
  assert.equal(apply('  indented', 4, 4, 'bullet').text, '  - indented');
  assert.equal(apply('a\nb\nc', 2, 4, 'bullet').text, 'a\n- b\nc', 'a selection ending at a line break stops before the next line');
});
