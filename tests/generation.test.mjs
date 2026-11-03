import assert from 'node:assert/strict';
import {copyFile, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';

const start = '<!-- BEGIN GENERATED README -->';
const end = '<!-- END GENERATED README -->';
const prefix = '<!doctype html>\n<main>\n';
const suffix = '\n</main>\n';
const region = `${start}\n${end}`;
const rawJSON = html => html.match(/<script id="document-sources" type="application\/json">([\s\S]*?)<\/script>/)[1];
const textbookPath = 'projects/textbook/README.md';
const textbook = '# Mathematics for Cyber Threat Detection\n\nTextbook · In progress.\n';

async function fixture(t, source = '[GitHub](https://github.com/mjcrock)\n', html = prefix + region + suffix) {
  const root = await mkdtemp(join(tmpdir(), 'readme-generation-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'scripts'));
  await copyFile(new URL('../scripts/update-readme.mjs', import.meta.url), join(root, 'scripts/update-readme.mjs'));
  for (const name of ['markdown.js', 'engine.js', 'routing.js']) {
    await copyFile(new URL('../' + name, import.meta.url), join(root, name));
  }
  await mkdir(join(root, 'projects/textbook'), {recursive: true});
  await writeFile(join(root, textbookPath), textbook);
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(root, 'README.md'), source);
  await writeFile(join(root, 'index.html'), html);
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
    async render(pathname) {
      const {renderIndex} = await import(pathToFileURL(join(root, 'scripts/update-readme.mjs')));
      return renderIndex(pathToFileURL(root + '/'), pathname);
    },
    read: file => readFile(join(root, file)),
    write: (file, data) => writeFile(join(root, file), data),
  };
}

function succeeds(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout;
}

async function rejectsWithoutWrites(project, pattern, ...args) {
  const files = ['README.md', textbookPath, 'index.html'];
  const snapshot = async () => Promise.all(files.map(async file => {
    const info = await stat(join(project.root, file), {bigint: true});
    return {bytes: await project.read(file), mtime: info.mtimeNs};
  }));
  const before = await snapshot();
  const result = project.run(...args);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '', 'Invalid input must not emit partial HTML.');
  assert.match(result.stderr, pattern);
  assert.deepEqual(await snapshot(), before);
}

async function roundTrip(project, source) {
  const template = await project.read('index.html');
  const generated = succeeds(project.run());
  assert.equal(succeeds(project.run('--check')), '');
  assert.ok(generated.startsWith(prefix));
  assert.ok(generated.endsWith(suffix));
  assert.deepEqual(Buffer.from(JSON.parse(rawJSON(generated))['/README.md'], 'utf8'), Buffer.from(source));
  assert.equal(JSON.parse(rawJSON(generated))['/' + textbookPath], textbook);
  assert.deepEqual(await project.read('README.md'), Buffer.from(source));
  assert.deepEqual(await project.read('index.html'), template);
  return generated;
}

test('generation is deterministic and neither rendering nor --check rewrites source files', async t => {
  const project = await fixture(t);
  const entries = await readdir(project.root, {recursive: true});
  const template = await project.read('index.html');
  const generated = await roundTrip(project, '[GitHub](https://github.com/mjcrock)\n');
  const date = new Date('2001-01-01T00:00:00Z');
  const files = ['README.md', 'index.html'].map(file => join(project.root, file));
  for (const file of files) await utimes(file, date, date);
  const before = await Promise.all(files.map(file => stat(file, {bigint: true})));
  assert.equal(succeeds(project.run('--check')), '');
  assert.equal(succeeds(project.run()), generated);
  const after = await Promise.all(files.map(file => stat(file, {bigint: true})));
  assert.deepEqual(after.map(info => [info.mtimeNs, info.size]), before.map(info => [info.mtimeNs, info.size]));
  assert.deepEqual(await project.read('index.html'), template);
  assert.deepEqual(await readdir(project.root, {recursive: true}), entries);
});

test('README edits appear in the next render without updating the source template', async t => {
  const project = await fixture(t);
  const first = await roundTrip(project, '[GitHub](https://github.com/mjcrock)\n');
  await project.write('README.md', 'Changed canonical source.\n');
  assert.equal(succeeds(project.run('--check')), '');
  const next = await roundTrip(project, 'Changed canonical source.\n');
  assert.notEqual(next, first);
});

test('baked generated content in the source template rejects without writes', async t => {
  for (const content of ['stale content', '<div id="output">stale</div>', '<!-- placeholder -->']) {
    const html = `${prefix}${start}\n${content}\n${end}${suffix}`;
    const project = await fixture(t, 'Canonical source\n', html);
    await rejectsWithoutWrites(project, /must be empty/);
    await rejectsWithoutWrites(project, /must be empty/, '--check');
  }
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
  assert.ok(!rawJSON(generated).includes('\u2028'));
  assert.ok(!rawJSON(generated).includes('\u2029'));
  assert.ok(generated.includes('\\u003cscript>'));
});

test('formatted content is static safe HTML and the original source stays inert JSON', async t => {
  const source = '# Heading & <tag>\n\n[A&B <b> "quoted"](https://example.com/?x="a"&y=\'b\') and &lt; &#x3c;\n\n</ScRiPt><img src=x onerror=alert(1)>\n';
  const generated = await roundTrip(await fixture(t, source), source);
  assert.ok(generated.includes('<h1>Heading &amp; &lt;tag&gt;</h1>'));
  assert.ok(generated.includes('<a class="document-link" href="https://example.com/?x=&quot;a&quot;&amp;y=&#39;b&#39;">A&amp;B &lt;b&gt; &quot;quoted&quot;</a> and &amp;lt; &amp;#x3c;'));
  assert.ok(generated.includes('&lt;/ScRiPt&gt;&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal((generated.match(/<script\b/gi) || []).length, 1);
  assert.equal((generated.match(/<\/script>/gi) || []).length, 1);
  assert.doesNotMatch(generated, /<img\b|<b>/i);
  assert.ok(!rawJSON(generated).includes('<'));
});

test('only supported heading tags and HTTPS links become markup', async t => {
  const source = '# One\n\n## Two\n\n### Three\n\n#### Plain\n\n[bad](javascript:alert%281%29) [relative](README.md) [good](https://example.com/)\n';
  const generated = await roundTrip(await fixture(t, source), source);
  assert.ok(generated.includes('<h1>One</h1><h2>Two</h2><h3>Three</h3><p>#### Plain</p>'));
  assert.ok(generated.includes('[bad](javascript:alert%281%29) [relative](README.md)'));
  const visible = generated.slice(generated.indexOf('<div id="output"'), generated.indexOf('<template'));
  assert.equal((visible.match(/<a /g) || []).length, 1);
});

test('raw cat data preserves NUL even though HTML normalizes it in formatted text', async t => {
  const source = 'before\u0000after\n';
  const generated = await roundTrip(await fixture(t, source), source);
  assert.ok(rawJSON(generated).includes('\\u0000'));
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
  for (const html of [
    '', start, end, `${end}\n${start}`, `${start}\n${start}\n${end}`,
    `${start}\n${end}\n${end}`, ` ${start}\n${end}`, `${start} extra\n${end}`,
  ]) {
    const project = await fixture(t, 'Source\n', html);
    await rejectsWithoutWrites(project, /exactly one generated README region/);
    await rejectsWithoutWrites(project, /exactly one generated README region/, '--check');
  }
});

test('CRLF marker lines are accepted while surrounding HTML is untouched', async t => {
  const html = prefix + region.replaceAll('\n', '\r\n') + suffix;
  await roundTrip(await fixture(t, 'Source\n', html), 'Source\n');
});

test('unsupported CLI arguments reject without changing files', async t => {
  const project = await fixture(t);
  for (const args of [['--help'], ['--check=true'], ['--check', '--check'], ['README.md'], [''], ['--']]) {
    await rejectsWithoutWrites(project, /Usage: node scripts\/update-readme\.mjs \[--check\]/, ...args);
  }
});

test('each public page shows its current view, embeds each other view once, and preserves exact sources', async t => {
  const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const project = await fixture(t, 'Home introduction.\n', template);
  for (const [path, route] of [['/', ''], ['/projects/', '/projects'], ['/projects/textbook/', '/' + textbookPath]]) {
    const html = await project.render(path);
    const visible = html.slice(html.indexOf('<div id="output"'), html.indexOf('<template'));
    assert.ok(visible.includes(`data-route="${route}"`));
    assert.deepEqual(JSON.parse(rawJSON(html)), {'/README.md': 'Home introduction.\n', ['/' + textbookPath]: textbook});
    const templates = [...html.matchAll(/<template data-view="([^"]+)">([\s\S]*?)<\/template>/g)];
    assert.deepEqual(templates.map(match => match[1]).sort(),
      ['/README.md', '/projects', '/' + textbookPath].filter(key => key !== (route || '/README.md')).sort());
    assert.equal((html.match(/<section class="initial-document"/g) || []).length, 2);
    assert.equal((html.match(/<section class="initial-directory"/g) || []).length, 1);
    if (route !== '/projects') assert.match(templates.find(match => match[1] === '/projects')[2],
      /href="\/projects\/textbook\/">Mathematics for Cyber Threat Detection<\/a>/);
    assert.match(html, /name="robots" content="noindex,nofollow"/);
    if (path === '/') {
      assert.ok(visible.includes('<p>Home introduction.</p>'));
      assert.ok(!visible.includes('Mathematics for Cyber Threat Detection'));
      assert.match(html, /<title>Michael J\. Crockett<\/title>/);
      assert.match(html, /href="style\.css"/);
    } else {
      for (const name of ['style.css', 'app.js', 'engine.js', 'routing.js', 'snake.js', 'favicon.png', 'apple-touch-icon.png']) {
        assert.ok(html.includes(`="/${name}"`), `Nested assets resolve from the root: ${name}`);
      }
      assert.ok(!visible.includes('Home introduction.'));
      if (path === '/projects/') {
        assert.match(visible, /<h2>Projects<\/h2>/);
        assert.match(visible, /data-page="" href="\/projects\/textbook\/">Mathematics for Cyber Threat Detection<\/a>/);
        assert.match(visible, /<p class="dim">Textbook · In progress<\/p>/);
        assert.match(html, /<title>Projects \| Michael J\. Crockett<\/title>/);
      } else {
        assert.match(visible, /<h1>Mathematics for Cyber Threat Detection<\/h1><p>Textbook · In progress\.<\/p>/);
        assert.equal((visible.match(/<h1>/g) || []).length, 1);
        assert.match(html, /<title>Mathematics for Cyber Threat Detection \| Michael J\. Crockett<\/title>/);
      }
    }
  }
  for (const path of ['/', '/projects/', '/projects/textbook/']) {
    assert.equal(await project.render(path + 'index.html'), await project.render(path));
  }
  for (const path of ['/missing/', '/../README.md', '/projects/%74extbook/', '//projects/']) {
    await assert.rejects(project.render(path), /Unknown public page/);
  }
  assert.equal(await project.read('README.md').then(String), 'Home introduction.\n');
  assert.equal(await project.read(textbookPath).then(String), textbook);
});

test('textbook edits update static content and preserve exact inert source', async t => {
  const project = await fixture(t);
  const source = '\ufeff# Revised textbook\r\n\r\n[Future edition](https://example.com/book)\r\n\r\n<script>alert(1)</script>\u2028\u2029\r\n';
  await project.write(textbookPath, source);
  for (const path of ['/', '/projects/', '/projects/textbook/']) {
    const html = await project.render(path);
    assert.deepEqual(Buffer.from(JSON.parse(rawJSON(html))['/' + textbookPath]), Buffer.from(source));
    assert.ok(html.includes('Revised textbook'));
    assert.ok(html.includes('href="https://example.com/book"'));
    assert.doesNotMatch(html, /<script>alert/);
    assert.doesNotMatch(rawJSON(html), /[<\u2028\u2029]/u);
  }
  assert.equal(await project.read(textbookPath).then(String), source);
});

test('every document uses the same 64 KiB and strict UTF-8 boundaries', async t => {
  const project = await fixture(t);
  for (const source of ['x'.repeat(65536), 'é'.repeat(32768)]) {
    await project.write(textbookPath, source);
    assert.equal(JSON.parse(rawJSON(await project.render('/projects/textbook/')))['/' + textbookPath], source);
  }
  for (const source of ['x'.repeat(65537), 'é'.repeat(32769)]) {
    await project.write(textbookPath, source);
    await rejectsWithoutWrites(project, /projects\/textbook\/README\.md must be at most 64 KiB/);
  }
  await project.write(textbookPath, Buffer.from([0xc0, 0xaf]));
  await rejectsWithoutWrites(project, /encoded data was not valid/);
});

test('template, documents, and document ancestors cannot redirect reads through symlinks', async t => {
  for (const path of ['index.html', 'README.md', textbookPath, 'projects']) {
    const project = await fixture(t);
    await rename(join(project.root, path), join(project.root, path + '.real'));
    await symlink(path.split('/').at(-1) + '.real', join(project.root, path));
    await assert.rejects(project.render('/projects/textbook/'), /Public source must not be a symlink/);
    const result = project.run('--check');
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Public source must not be a symlink/);
  }
});
