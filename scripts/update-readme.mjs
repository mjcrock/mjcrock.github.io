// Render the fixed document catalog without changing authored source files.
import {open, readFile, realpath} from 'node:fs/promises';
import {sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {markdownBlocks} from '../markdown.js';
import {FILES, list} from '../engine.js';
import {entryURL, parseLocation} from '../routing.js';

const start = '<!-- BEGIN GENERATED README -->';
const end = '<!-- END GENERATED README -->';
const entities = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
const escapeHTML = value => value.replace(/[&<>"']/g, character => entities[character]);
const formatted = source => markdownBlocks(source).map(({tag, parts}) => `<${tag}>${parts.map(part => part.href
  ? `<a class="document-link" href="${escapeHTML(part.href)}">${escapeHTML(part.text)}</a>`
  : escapeHTML(part.text)).join('')}</${tag}>`).join('');

async function publicFile(root, name) {
  const file = new URL(name, root);
  if (await realpath(file) !== fileURLToPath(file)) throw new Error(`Public source must not be a symlink: ${name}`);
  return file;
}

async function readDocument(root, name) {
  // Read at most one byte beyond the limit, even for an accidentally huge file.
  // Do not rely on a prior stat: the file can grow between checking and reading.
  const buffer = Buffer.alloc(65537);
  const file = await open(await publicFile(root, name), 'r');
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
  if (length > 65536) throw new Error(`${name} must be at most 64 KiB.`);
  const bytes = buffer.subarray(0, length);
  // Reject invalid UTF-8, but retain a BOM, CRLF and final newline verbatim.
  return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
}

export async function renderIndex(root = new URL('../', import.meta.url), pathname = '/') {
  // Canonicalize the project root, then reject symlinks within the public tree.
  root = pathToFileURL(await realpath(root) + sep);
  const route = parseLocation({pathname, hash: ''});
  if (route.kind === 'invalid') throw new Error(`Unknown public page: ${pathname}`);
  const paths = Object.keys(FILES).filter(path => FILES[path].type === 'file');
  const sources = Object.fromEntries(await Promise.all(paths.map(async path =>
    [path, await readDocument(root, path.slice(1))])));
  const views = Object.fromEntries(paths.map(path => [path,
    `<section class="initial-document" aria-label="${escapeHTML(FILES[path].title)}">${formatted(sources[path])}</section>`]));
  for (const [path, entry] of Object.entries(FILES)) {
    if (entry.type !== 'directory' || parseLocation({pathname: entry.url}).kind !== 'directory') continue;
    const title = escapeHTML(entry.title);
    const rows = list(path).map(child => {
      const project = FILES[child];
      const label = FILES[child + '/README.md']?.title || project.title;
      const status = project.description ? `<p class="dim">${escapeHTML(project.description)}</p>` : '';
      return `<li class="project-row"><a class="document-link" data-page="" href="${escapeHTML(entryURL(child))}">${escapeHTML(label)}</a>${status}</li>`;
    });
    views[path] = `<section class="initial-directory" aria-label="${title}"><h2>${title}</h2><ul class="project-list">${rows.join('')}</ul></section>`;
  }
  const literal = JSON.stringify(sources).replace(/[<\u2028\u2029]/gu, character =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const html = await readFile(await publicFile(root, 'index.html'), 'utf8');
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
  const current = route.path || '/README.md';
  const templates = Object.entries(views).filter(([path]) => path !== current)
    .map(([path, view]) => `<template data-view="${escapeHTML(path)}">${view}</template>`).join('\n');
  const generated = `${start}\n<div id="output" data-route="${escapeHTML(route.path || '')}">${views[current]}</div>\n${templates}\n<script id="document-sources" type="application/json">${literal}</script>\n${end}`;
  let page = html.slice(0, first) + generated + html.slice(last + ends[0][0].length);
  if (route.kind !== 'home') {
    const title = escapeHTML(FILES[route.path].title);
    page = page.replace(/<title>([^<]*)<\/title>/, (_, owner) => `<title>${title} | ${owner}</title>`);
    page = page.replace(/(<meta name="description" content=")[^"]*(">)/, (_, before, after) =>
      before + (route.kind === 'file' ? `${title}. Textbook in progress.` : 'Selected projects.') + after);
    // Nested pages share root assets. A <base> would weaken the existing CSP.
    const boundary = page.indexOf('</head>');
    if (boundary >= 0) page = page.slice(0, boundary).replace(/\b(src|href)="([a-z][\w.-]*)"/g, '$1="/$2"') + page.slice(boundary);
  }
  return page;
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node scripts/update-readme.mjs [--check]');
  }
  const html = await renderIndex();
  if (!args.length) process.stdout.write(html);
}
