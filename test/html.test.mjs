import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cssReferences, dataUrl, htmlLimits, linkGuard, mediaType, onTheWeb, projectPath } from '@rho-workspace/plugin-html/page';

test('paths a page names resolve inside the project only', () => {
  assert.equal(projectPath('report/index.html', 'index_files/libs/app.js'), 'report/index_files/libs/app.js');
  assert.equal(projectPath('report/index.html', '../figures/a.png?v=2#x'), 'figures/a.png');
  assert.equal(projectPath('report/index.html', '/style.css'), 'style.css');
  assert.equal(projectPath('report/index.html', ' my%20plot.svg '), 'report/my plot.svg');
  assert.equal(projectPath('index.html', '../../etc/passwd'), null);
  assert.equal(projectPath('index.html', 'https://cdn.example.org/a.js'), null);
  assert.equal(projectPath('index.html', '//cdn.example.org/a.js'), null);
  assert.equal(projectPath('index.html', 'data:image/png;base64,AAAA'), null);
  assert.equal(onTheWeb('//cdn.example.org/a.js'), true);
  assert.equal(onTheWeb('libs/a.js'), false);
});

test('a stylesheet\'s fonts and images are found; its anchors and data are not', () => {
  const css = `@font-face { src: url("fonts/a.woff2") format("woff2"), url('fonts/a.woff'); }
    .x { background: url(img/bg.png) } .y { mask: url(#m) } .z { background: url(data:image/png;base64,AA==) } .w { background: url(img/bg.png) }`;
  assert.deepEqual(cssReferences(css), ['fonts/a.woff2', 'fonts/a.woff', 'img/bg.png']);
});

test('files become data of their type; links leave the page only through the view', () => {
  assert.equal(mediaType('a/b.WOFF2'), 'font/woff2');
  assert.equal(mediaType('x.unknown'), 'application/octet-stream');
  assert.equal(dataUrl(new TextEncoder().encode('hi'), 'text/plain'), 'data:text/plain;base64,aGk=');
  assert.equal(dataUrl(new Uint8Array(100000).fill(65), 'text/plain').length, 'data:text/plain;base64,'.length + 133336);
  assert.match(linkGuard, /preventDefault/);
  assert.match(linkGuard, /rho-html-link/);
  assert.ok(htmlLimits.maxFiles > 0 && htmlLimits.maxTotalBytes >= htmlLimits.maxFileBytes);
});

test('the manifest names the view over the Documents buffer', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugins/html/rho-ui.json', import.meta.url), 'utf8'));
  assert.deepEqual([manifest.plugin, manifest.component, manifest.export, manifest.bindings.document], ['documents', 'html.reader', 'HtmlView', 'document']);
  assert.deepEqual(manifest.requiredOperations, ['document.read']);
});
