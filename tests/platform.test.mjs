import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {renderIndex} from '../scripts/update-readme.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = await renderIndex();

test('the viewport requests native keyboard resizing while retaining zoom and safe-area support', () => {
  const content = html.match(/<meta name="viewport" content="([^"]+)">/)[1];
  const directives = new Map(content.split(',').map(part => part.trim().split('=')));
  assert.equal(directives.get('interactive-widget'), 'resizes-content');
  assert.equal(directives.get('width'), 'device-width');
  assert.equal(directives.get('initial-scale'), '1');
  assert.equal(directives.get('viewport-fit'), 'cover');
  assert.equal(directives.has('user-scalable'), false);
  assert.equal(directives.has('maximum-scale'), false);
});

test('preload hints cover the entry module dependencies exactly once', () => {
  const imports = [...read('../app.js').matchAll(/from ['"]\.\/([^'"]+)['"]/g)]
    .map(match => match[1]).sort();
  const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)]
    .map(match => match[1]).sort();
  assert.deepEqual(preloads, imports);
  assert.equal(new Set(preloads).size, preloads.length);
  assert.ok(html.indexOf('rel="stylesheet"') < html.indexOf('rel="modulepreload"'),
    'Discover the render-blocking stylesheet before speculative module work');
});

test('unused embedding and background execution capabilities are blocked', () => {
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const directives = new Map(policy.split(';').map(part => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values];
  }));
  assert.deepEqual(directives.get('frame-src'), ["'none'"]);
  assert.deepEqual(directives.get('worker-src'), ["'none'"]);
});

test('the readable README is present before JavaScript and controls wait for initialization', () => {
  const document = html.match(/<div id="output"><section class="initial-document"([^>]*)>([\s\S]*?)<\/section><\/div>/);
  assert.ok(document);
  assert.match(document[1], /aria-label="README\.md"/);
  assert.doesNotMatch(document[1], /\bhidden\b/);
  assert.ok(document.index > html.indexOf('id="screen"'));
  assert.ok(document.index < html.indexOf('id="announcement"'));
  assert.match(html, /<section class="entry"[^>]*\shidden>/);
  assert.match(read('../app.js'), /document\.querySelector\('\.entry'\)\.hidden = false/);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
});
