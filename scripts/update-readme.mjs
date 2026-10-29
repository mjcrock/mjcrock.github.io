// README.md is authored; the marked engine.js region is deterministic output.
import {open, readFile, writeFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const start = '// BEGIN GENERATED README — run node scripts/update-readme.mjs; do not edit here.';
const end = '// END GENERATED README';
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  throw new Error('Usage: node scripts/update-readme.mjs [--check]');
}
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
const target = new URL('engine.js', root);
const engine = await readFile(target, 'utf8');
// Match marker lines, not marker-like text inside the generated string.
const starts = [...engine.matchAll(/^\/\/ BEGIN GENERATED README — run node scripts\/update-readme\.mjs; do not edit here\.\r?$/gm)];
const ends = [...engine.matchAll(/^\/\/ END GENERATED README\r?$/gm)];
if (starts.length !== 1 || ends.length !== 1 || ends[0].index <= starts[0].index) {
  throw new Error('Expected exactly one generated README region in engine.js.');
}
const first = starts[0].index;
const last = ends[0].index;
const generated = `${start}\nexport const README_SOURCE = ${literal};\n${end}`;
const next = engine.slice(0, first) + generated + engine.slice(last + ends[0][0].length);
if (args[0] === '--check') {
  if (next !== engine) throw new Error('README.md changed. Run node scripts/update-readme.mjs.');
} else if (next !== engine) {
  await writeFile(target, next);
}
