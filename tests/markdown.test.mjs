import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {markdownBlocks} from '../markdown.js';

const github = 'https://github.com/mjcrock';
const links = blocks => blocks.flatMap(block => block.parts.filter(part => 'href' in part));
const text = blocks => blocks.map(block => block.parts.map(part => part.text).join('')).join('\n\n');

test('approved authored link becomes a named, exact-target link', () => {
  assert.deepEqual(markdownBlocks(`[GitHub](${github})\n`), [
    {tag: 'p', parts: [{text: 'GitHub', href: github}]},
  ]);
});

test('headings and paragraphs preserve document order and ordinary text', () => {
  assert.deepEqual(markdownBlocks('# Heading\n\nFirst line\nsecond line.\n\n## Section\n### Detail\nLast.'), [
    {tag: 'h1', parts: [{text: 'Heading'}]},
    {tag: 'p', parts: [{text: 'First line\nsecond line.'}]},
    {tag: 'h2', parts: [{text: 'Section'}]},
    {tag: 'h3', parts: [{text: 'Detail'}]},
    {tag: 'p', parts: [{text: 'Last.'}]},
  ]);
});

test('formatting normalizes line endings without modifying raw source', () => {
  const source = `# Title\r\n\r\n[GitHub](${github})\r\n`;
  const before = source;
  assert.equal(text(markdownBlocks(source)), 'Title\n\nGitHub');
  assert.equal(source, before);
  assert.ok(source.endsWith('\r\n'));
});

test('multiple links retain all surrounding text and readable labels', () => {
  assert.deepEqual(markdownBlocks(`Before [one](${github}), then [two](${github}).`), [
    {tag: 'p', parts: [{text: 'Before '}, {text: 'one', href: github}, {text: ', then '}, {text: 'two', href: github}, {text: '.'}]},
  ]);
});

test('only valid absolute HTTPS destinations are linkable', () => {
  const destinations = [
    'javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//example.com',
    'http://example.com', 'https://', 'https:///example.com',
    'https://@example.com', 'https://user@example.com', 'https://user:pass@example.com',
    'https://example.com/\\path', 'https://example.com/%5cpath',
    'https://example.com/%0a', 'https://example.com/\u0000',
    'https://example.com/\t', 'https://example.com/\u202e',
    'https://example.org/a_(b)', 'https://example.com/ space', ' https://example.com',
    'javascript&#58;alert(1)', 'java%73cript:alert(1)',
    'https&#58;//example.com', '/README.md', '../README.md', '#/README.md',
  ];
  for (const destination of destinations) {
    const source = `[label](${destination})`;
    assert.deepEqual(links(markdownBlocks(source)), [], destination);
    assert.equal(text(markdownBlocks(source)), source, destination);
  }
});

test('HTTPS links require no per-destination code changes', () => {
  for (const href of ['https://orcid.org/0009-0005-2589-1596',
    'https://example.org/a?x=1&y=2#section', 'HTTPS://example.org/path',
    'https://example.org/%20name', 'https://example.org/a_%28b%29']) {
    assert.deepEqual(links(markdownBlocks(`[Profile](${href})`)), [{text: 'Profile', href}]);
  }
});

test('encoded ASCII controls and backslashes remain literal for either hex case', () => {
  const codes = [...Array.from({length: 32}, (_, index) => index), 0x5c, 0x7f];
  for (const code of codes) {
    const encoded = '%' + code.toString(16).padStart(2, '0');
    for (const escape of [encoded, encoded.toUpperCase()]) {
      const source = `[Profile](https://example.org/${escape}profile)`;
      assert.deepEqual(links(markdownBlocks(source)), [], escape);
      assert.equal(text(markdownBlocks(source)), source, escape);
    }
  }
});

test('a dense document within the 64 KiB source budget preserves every link in order', () => {
  const expected = Array.from({length: 1000}, (_, index) => ({text: String(index), href: `https://example.org/${index}`}));
  const source = expected.map(part => `[${part.text}](${part.href})`).join(' · ');
  assert.ok(Buffer.byteLength(source) <= 65536);
  const blocks = markdownBlocks(source);
  assert.deepEqual(links(blocks), expected);
  assert.equal(text(blocks), expected.map(part => part.text).join(' · '));
});

test('approved README copy renders both professional profile links', () => {
  const source = 'Mathematics, computing, and security.\n\n[GitHub](https://github.com/mjcrock) · [ORCID](https://orcid.org/0009-0005-2589-1596)\n';
  assert.equal(markdownBlocks(source)[0].parts[0].text, 'Mathematics, computing, and security.');
  assert.deepEqual(links(markdownBlocks(source)).map(link => link.text), ['GitHub', 'ORCID']);
});

test('raw HTML and event-handler-shaped labels remain text data', () => {
  const source = '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n<a href="javascript:alert(1)">x</a>';
  const blocks = markdownBlocks(source);
  assert.equal(text(blocks), source);
  assert.deepEqual(links(blocks), []);
  assert.deepEqual(markdownBlocks(`[<img src=x onerror=alert(1)>](${github})`), [
    {tag: 'p', parts: [{text: '<img src=x onerror=alert(1)>', href: github}]},
  ]);
});

test('unsupported images, escapes, nested links and autolinks stay literal', () => {
  const sources = [
    `![image](${github})`, `\\[escaped](${github})`, `[[nested](${github})]`,
    `[bad](javascript:[nested](${github}))`, `<${github}>`, github,
    `[blank]()`, `[missing](${github}`, `[unfinished`, `[ordinary] text`,
    `[](${github})`, `[   ](${github})`, '#### Unsupported heading',
  ];
  for (const source of sources) {
    assert.deepEqual(links(markdownBlocks(source)), [], source);
    assert.equal(text(markdownBlocks(source)), source, source);
  }
});

test('control and bidi characters cannot create deceptive link labels', () => {
  for (const control of ['\0', '\t', '\n', '\r', '\x7f', '\x85', '\u061c', '\u200e', '\u200f', '\u2028', '\u2029', '\u202e', '\u2066', '\u2069']) {
    const blocks = markdownBlocks(`[Git${control}Hub](${github})`);
    assert.deepEqual(links(blocks), [], JSON.stringify(control));
  }
});

test('empty and non-string input has no blocks', () => {
  for (const input of ['', ' \n\t\n', null, undefined, 12, {}, []]) {
    assert.deepEqual(markdownBlocks(input), []);
  }
});

test('returned block data never carries an executable or arbitrary tag', () => {
  const corpus = ['# <script>x</script>', '## [safe](https://github.com/mjcrock)', '### title', '<iframe src=x>', '# heading\n\nparagraph'];
  for (const source of corpus) {
    for (const block of markdownBlocks(source)) {
      assert.ok(['p', 'h1', 'h2', 'h3'].includes(block.tag));
      for (const part of block.parts) {
        assert.equal(typeof part.text, 'string');
        if ('href' in part) assert.equal(part.href, github);
      }
    }
  }
});

test('long malformed bracket input stays literal without recursive parsing', () => {
  const sources = ['['.repeat(65536), '[x]('.repeat(10000), `[${'x'.repeat(65000)}](${github})`];
  for (const source of sources) {
    const blocks = markdownBlocks(source);
    assert.ok(blocks.length <= 1);
    assert.ok(links(blocks).every(link => link.href === github));
    if (!source.endsWith(`](${github})`)) assert.equal(text(blocks), source);
  }
});

test('module uses a data representation rather than HTML or dynamic evaluation', () => {
  const module = readFileSync(new URL('../markdown.js', import.meta.url), 'utf8');
  assert.doesNotMatch(module, /innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|new Function/);
});
