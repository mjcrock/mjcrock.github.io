import assert from 'node:assert/strict';
import {copyFile, mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';

const start = '// BEGIN GENERATED README — run node scripts/update-readme.mjs; do not edit here.';
const end = '// END GENERATED README';
const prefix = 'export const before = "unchanged before";\n';
const suffix = '\nexport const after = "unchanged after";\n';
const region = `${start}\nexport const README_SOURCE = "stale";\n${end}`;

async function fixture(t, source = '[GitHub](https://github.com/mjcrock)\n', engine = prefix + region + suffix) {
  const root = await mkdtemp(join(tmpdir(), 'readme-generation-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'scripts'));
  await copyFile(new URL('../scripts/update-readme.mjs', import.meta.url), join(root, 'scripts/update-readme.mjs'));
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(root, 'README.md'), source);
  await writeFile(join(root, 'engine.js'), engine);
  const run = (...args) => {
    // Deliberately run outside the project: paths must resolve beside the script.
    const result = spawnSync(process.execPath, [join(root, 'scripts/update-readme.mjs'), ...args], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  return {
    root, run,
    read: file => readFile(join(root, file)),
    write: (file, data) => writeFile(join(root, file), data),
  };
}

function succeeds(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
}

async function rejectsWithoutWrites(project, pattern, ...args) {
  const files = ['README.md', 'engine.js'];
  const snapshot = async () => Promise.all(files.map(async file => {
    const info = await stat(join(project.root, file), {bigint: true});
    return {bytes: await project.read(file), mtime: info.mtimeNs};
  }));
  const before = await snapshot();
  const result = project.run(...args);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
  assert.deepEqual(await snapshot(), before);
}

async function roundTrip(project, source) {
  succeeds(project.run());
  succeeds(project.run('--check'));
  const generated = (await project.read('engine.js')).toString('utf8');
  assert.ok(generated.startsWith(prefix));
  assert.ok(generated.endsWith(suffix));
  const module = await import(pathToFileURL(join(project.root, 'engine.js')).href);
  assert.equal(module.before, 'unchanged before');
  assert.equal(module.after, 'unchanged after');
  assert.deepEqual(Buffer.from(module.README_SOURCE, 'utf8'), Buffer.from(source));
  assert.deepEqual(await project.read('README.md'), Buffer.from(source));
  return generated;
}

test('generation is deterministic; current --check and update do not rewrite files', async t => {
  const project = await fixture(t);
  const generated = await roundTrip(project, '[GitHub](https://github.com/mjcrock)\n');
  const date = new Date('2001-01-01T00:00:00Z');
  const files = ['README.md', 'engine.js'].map(file => join(project.root, file));
  for (const file of files) await utimes(file, date, date);
  const before = await Promise.all(files.map(file => stat(file, {bigint: true})));
  succeeds(project.run('--check'));
  succeeds(project.run());
  const after = await Promise.all(files.map(file => stat(file, {bigint: true})));
  assert.deepEqual(after.map(info => [info.mtimeNs, info.size]), before.map(info => [info.mtimeNs, info.size]));
  assert.equal((await project.read('engine.js')).toString(), generated);
});

test('stale --check fails read-only and update repairs the exact canonical text', async t => {
  const project = await fixture(t);
  await rejectsWithoutWrites(project, /README\.md changed/, '--check');
  succeeds(project.run());
  await project.write('README.md', 'Changed canonical source.\n');
  await rejectsWithoutWrites(project, /README\.md changed/, '--check');
  await roundTrip(project, 'Changed canonical source.\n');
});

test('BOM, CRLF, non-ASCII text and final newline round-trip byte for byte', async t => {
  const source = '\ufeff# Café\r\n\r\nUnicode: λ 🐈\r\n';
  await roundTrip(await fixture(t, source), source);
});

test('empty text and text without a final newline round-trip exactly', async t => {
  for (const source of ['', 'No final newline']) await roundTrip(await fixture(t, source), source);
});

test('quotes, slashes, replacement tokens and script-looking text remain inert source', async t => {
  const source = '\\ " \' / $& $` $\' $$\n"; throw new Error("escaped source"); //\n<script>alert(1)</script>\u2028\u2029\n';
  const generated = await roundTrip(await fixture(t, source), source);
  assert.ok(!generated.includes('<script>'));
  assert.ok(!generated.includes('\u2028'));
  assert.ok(!generated.includes('\u2029'));
  assert.ok(generated.includes('\\u003cscript>'));
});

test('authored marker-like lines never become structural generated markers', async t => {
  const source = `${start}\n${end}\n${start}\n${end}\n`;
  await roundTrip(await fixture(t, source), source);
});

test('exact 64 KiB UTF-8 boundary is accepted, including multibyte content', async t => {
  for (const source of ['x'.repeat(65536), 'é'.repeat(32768)]) {
    assert.equal(Buffer.byteLength(source), 65536);
    await roundTrip(await fixture(t, source), source);
  }
});

test('oversized README fails before writing either file', async t => {
  for (const source of ['x'.repeat(65537), 'é'.repeat(32769)]) {
    const project = await fixture(t, source);
    await rejectsWithoutWrites(project, /at most 64 KiB/);
    await rejectsWithoutWrites(project, /at most 64 KiB/, '--check');
  }
});

test('malformed UTF-8 fails rather than replacing or normalizing source', async t => {
  for (const bytes of [[0xff], [0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80]]) {
    const project = await fixture(t, Buffer.from(bytes));
    await rejectsWithoutWrites(project, /encoded data was not valid/);
  }
});

test('missing, duplicate and reversed marker lines reject without writes', async t => {
  for (const engine of [
    '', start, end, `${end}\n${start}`, `${start}\n${start}\n${end}`,
    `${start}\n${end}\n${end}`, ` ${start}\n${end}`, `${start} extra\n${end}`,
  ]) {
    const project = await fixture(t, 'Source\n', engine);
    await rejectsWithoutWrites(project, /exactly one generated README region/);
    await rejectsWithoutWrites(project, /exactly one generated README region/, '--check');
  }
});

test('CRLF marker lines are accepted while surrounding engine text is untouched', async t => {
  const engine = prefix + region.replaceAll('\n', '\r\n') + suffix;
  await roundTrip(await fixture(t, 'Source\n', engine), 'Source\n');
});

test('unsupported CLI arguments reject without changing files', async t => {
  const project = await fixture(t);
  for (const args of [['--help'], ['--check=true'], ['--check', '--check'], ['README.md'], [''], ['--']]) {
    await rejectsWithoutWrites(project, /Usage: node scripts\/update-readme\.mjs \[--check\]/, ...args);
  }
});
