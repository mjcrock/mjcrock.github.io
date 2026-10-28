import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {test} from 'node:test';
import {LIMITS} from '../engine.js';

const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const html = read('index.html');
const app = read('app.js');
const engine = read('engine.js');
const routing = read('routing.js');
const markdown = read('markdown.js');
const css = read('style.css');

test('all runtime resources are local and exist; legacy stylesheet is removed', () => {
  for (const [, path] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (path.startsWith('data:image/svg+xml,')) continue;
    assert.match(path, /^[A-Za-z][A-Za-z.-]+$/);
    assert.ok(existsSync(new URL(path, root)), path);
  }
  assert.ok(!existsSync(new URL('assets/styles.css', root)));
  assert.ok(!/assets\/styles\.css/.test(html));
});

test('CSP allows only same-origin loading and no inline/eval execution', () => {
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const directives = new Map(policy.split(';').map(part => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values];
  }));
  for (const name of ['script-src', 'style-src']) assert.deepEqual(directives.get(name), ["'self'"]);
  for (const name of ['connect-src', 'object-src', 'base-uri', 'form-action']) {
    assert.deepEqual(directives.get(name), ["'none'"]);
  }
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<link'));
  assert.doesNotMatch(html, /\son\w+\s*=|<base\b|<iframe\b|\sstyle=/i);
  assert.match(html, /name="referrer" content="no-referrer"/);
});

test('rendering has no HTML execution, storage, or runtime fetch', () => {
  const source = app + engine + routing + markdown;
  assert.doesNotMatch(source, /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\b/);
  assert.doesNotMatch(source, /XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(source, /\bfetch\s*\(|AbortController|setTimeout|readMarkdown/);
  assert.match(app, /textContent/);
  assert.match(app, /createTextNode/);
});

test('input limits, named regions, and mobile control labels are explicit', () => {
  assert.match(html, new RegExp(`maxlength="${LIMITS.input}"`));
  assert.match(html, /id="screen" role="region"/);
  assert.match(html, /id="complete" aria-label="Complete command or path"/);
  assert.match(html, /id="completions"[^>]*role="listbox"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.doesNotMatch(html, /\sautofocus(?:\s|=|>)/);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML IDs');
});

test('normal foreground palette meets WCAG AA contrast on its surfaces', () => {
  const colors = Object.fromEntries([...css.matchAll(/--([a-z]+):\s*(#[\da-f]{6})/gi)].map(match => [match[1], match[2]]));
  const luminance = color => {
    const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const foreground of ['ink', 'muted', 'blue', 'rose', 'error']) {
    for (const background of ['canvas', 'surface', 'raised']) {
      const values = [luminance(colors[foreground]), luminance(colors[background])].sort((a, b) => b - a);
      const ratio = (values[0] + 0.05) / (values[1] + 0.05);
      assert.ok(ratio >= 4.5, `${foreground}/${background}: ${ratio.toFixed(2)}:1`);
    }
  }
});

test('focus pseudo-classes remain valid after stylesheet formatting', () => {
  const selectors = [...css.matchAll(/(?:^|\})\s*([^{}]+)\{/g)].map(match => match[1]);
  for (const selector of selectors) {
    assert.doesNotMatch(selector, /:[ \t]+[a-z-]/i, `Whitespace breaks pseudo-selector: ${selector}`);
  }
  assert.match(css, /button:focus-visible,a:focus-visible,input:focus-visible,\.screen:focus-visible\s*\{/);
  assert.match(css, /form:focus-within\s*\{/);
  assert.match(css, /\.block:focus-visible\s*\{/);
});


test('runtime module imports resolve to local files, including the bounded router', () => {
  for (const source of [app, engine, routing, markdown]) {
    for (const [, path] of source.matchAll(/from ['"]([^'"]+)['"]/g)) {
      assert.match(path, /^\.\/[a-z-]+\.js$/);
      assert.ok(existsSync(new URL(path, root)), path);
    }
  }
  assert.match(html, /role="combobox"[^>]*aria-autocomplete="list"/);
  assert.match(html, /id="completion-panel"[^>]*hidden/);
});


test('approved identity, one short hint, and real canonical README replace placeholders', () => {
  assert.match(html, /<h1 class="site-name">Michael J\. Crockett<\/h1>/);
  assert.match(html, /<p class="site-status">Site in progress<\/p>/);
  assert.match(html, /id="keyboard-help">Type <button[^>]+>help<\/button> for commands\.<\/p>/);
  assert.doesNotMatch(html, /<footer|class="mode"|data-command="ls \/"|data-command="open \/writing\/sample"/);
  assert.doesNotMatch(app + html, /Interactive study|Interactive terminal|Generic placeholders|content placeholders/);
  assert.equal(read('README.md'), '[GitHub](https://github.com/mjcrock)\n');
  assert.ok(existsSync(new URL('DEVELOPMENT.md', root)));
  assert.ok(!existsSync(new URL('.DS_Store', root)));
});


test('completion overlay is outside layout flow and anchored above the entry', () => {
  assert.match(css, /\.entry\s*\{\s*position: relative;/);
  const panel = css.match(/\.completion-panel\s*\{([^}]+)\}/)[1];
  assert.match(panel, /position: absolute;/);
  assert.match(panel, /bottom: 100%;/);
  assert.match(panel, /max-height: 180px;/);
  assert.match(panel, /overflow-y: auto;/);
});
