// Render the authored README into the HTML template without changing source files.
import {open, readFile, realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {markdownBlocks} from '../markdown.js';

const start = '<!-- BEGIN GENERATED README -->';
const end = '<!-- END GENERATED README -->';
export async function renderIndex(root = new URL('../', import.meta.url)) {
  // Read at most one byte beyond the limit, even for an accidentally huge file.
  // Do not rely on a prior stat: the file can grow between checking and reading.
  const buffer = Buffer.alloc(65537);
  const file = await open(new URL('README.md', root), 'r');
  let length = 0;
  try {
    while (length < buffer.length) {
      const {bytesRead} = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
  } finally {
    await file.close();
  }
  if (length > 65536) throw new Error('README.md must be at most 64 KiB.');
  const bytes = buffer.subarray(0, length);
  // Reject invalid UTF-8, but retain a BOM, CRLF and final newline verbatim.
  const source = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
  const literal = JSON.stringify(source).replace(/[<\u2028\u2029]/gu, character =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const entities = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  };
  const escapeHTML = value => value.replace(/[&<>"']/g, character => entities[character]);
  const formatted = markdownBlocks(source).map(({tag, parts}) => `<${tag}>${parts.map(part => part.href
    ? `<a class="document-link" href="${escapeHTML(part.href)}">${escapeHTML(part.text)}</a>`
    : escapeHTML(part.text)).join('')}</${tag}>`).join('');
  const html = await readFile(new URL('index.html', root), 'utf8');
  // Match marker lines, not marker-like text inside the generated string.
  const starts = [...html.matchAll(/^<!-- BEGIN GENERATED README -->\r?$/gm)];
  const ends = [...html.matchAll(/^<!-- END GENERATED README -->\r?$/gm)];
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index <= starts[0].index) {
    throw new Error('Expected exactly one generated README region in index.html.');
  }
  const first = starts[0].index;
  const last = ends[0].index;
  if (html.slice(first + starts[0][0].length, last).trim()) {
    throw new Error('The generated README region in source index.html must be empty.');
  }
  const generated = `${start}\n<div id="output"><section class="initial-document" aria-label="README.md">${formatted}</section></div>\n<script id="readme-source" type="application/json">${literal}</script>\n${end}`;
  return html.slice(0, first) + generated + html.slice(last + ends[0][0].length);
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node scripts/update-readme.mjs [--check]');
  }
  const html = await renderIndex();
  if (!args.length) process.stdout.write(html);
}
