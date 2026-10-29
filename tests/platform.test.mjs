import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');

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

test('the direct README fallback is inside the initial output region', () => {
  const fallback = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
  assert.ok(fallback);
  assert.match(fallback[1], /href="README\.md"/);
  assert.ok(fallback.index > html.indexOf('id="screen"'));
  assert.ok(fallback.index < html.indexOf('id="announcement"'));
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
});
