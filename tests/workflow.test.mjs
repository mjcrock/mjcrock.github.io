import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, cpSync, readdirSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {buildSite} from '../scripts/build.mjs';

const root = new URL('../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/pages.yml', root), 'utf8');
const publicFiles = ['index.html', 'style.css', 'app.js', 'engine.js', 'routing.js', 'snake.js', 'README.md'];
const assets = publicFiles.filter(file => /\.(?:css|js)$/.test(file));
const read = path => readFileSync(path, 'utf8');
const assetPaths = html => [...html.matchAll(/(?:src|href)="([^"/?]+\?v=[a-f0-9]{16})"/g)]
  .map(match => match[1]).sort();

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pages-artifact-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  mkdirSync(join(directory, 'scripts'));
  for (const file of [...publicFiles, 'markdown.js', 'scripts/update-readme.mjs', 'scripts/build.mjs']) {
    cpSync(new URL(file, root), join(directory, file));
  }
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
  return pathToFileURL(directory + '/');
}

test('Pages workflow validates source before testing and restricts deployment to main', () => {
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /workflow_dispatch:/);
  const validation = workflow.indexOf('node scripts/update-readme.mjs --check\n');
  assert.ok(validation >= 0 && validation < workflow.indexOf('node --test'));
  assert.ok(workflow.indexOf('node --test') < workflow.indexOf('Stage public files only'));
  assert.match(workflow, /needs: build/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.doesNotMatch(workflow, /contents: write|pull_request_target|npm install|npm ci|git push/);
  const [build, deploy] = workflow.split('\n  deploy:');
  assert.doesNotMatch(build, /pages: write|id-token: write/);
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /id-token: write/);
  assert.match(deploy, /name: github-pages/);
  for (const [, action] of workflow.matchAll(/uses: (.+)/g)) {
    assert.match(action, /^actions\/[a-z-]+@[a-f0-9]{40} # v\d+$/);
  }
});

test('deployment generates HTML without changing source and stages only public files', t => {
  assert.match(workflow, /path: _site\n/);
  const staging = workflow.match(/- name: Stage public files only\n        run: ([^\n]+)/)[1];
  assert.equal(staging, 'node scripts/build.mjs');
  const project = fixture(t);
  const before = publicFiles.map(file => read(new URL(file, project)));
  assert.match(before[0], /<!-- BEGIN GENERATED README -->\r?\n\s*<!-- END GENERATED README -->/);
  assert.doesNotMatch(before[0], /id="output"|id="readme-source"/);
  for (const file of ['.DS_Store', '._README.md', 'DEVELOPMENT.md']) {
    writeFileSync(new URL(file, project), 'Private local metadata: never publish.');
  }
  mkdirSync(new URL('__MACOSX/', project));
  writeFileSync(new URL('__MACOSX/._README.md', project), 'Private archive metadata.');
  // Exercise the exact workflow command without exposing repository files.
  execFileSync('sh', ['-eu', '-c', staging], {cwd: project});
  const output = new URL('_site/', project);
  const generated = read(new URL('index.html', output));
  const paths = assetPaths(generated);
  assert.equal(paths.length, assets.length);
  const version = paths[0].slice(paths[0].indexOf('?'));
  assert.deepEqual(paths, assets.map(file => file + version).sort());
  assert.deepEqual(readdirSync(output, {recursive: true}).sort(), [...publicFiles, '.nojekyll'].sort());
  for (const file of assets) {
    const published = new URL(file, output);
    const contents = read(published);
    assert.equal(contents.replace(/\?v=[a-f0-9]{16}(?=['"])/g, ''), read(new URL(file, project)));
    // Entry imports and transitive imports must use the same version as preloads.
    for (const [, specifier] of contents.matchAll(/from ['"]([^'"]+)['"]/g)) {
      assert.match(specifier, /^\.\/[a-z-]+\.js\?v=[a-f0-9]{16}$/);
      const imported = new URL(specifier, published);
      assert.equal(imported.search, version);
      imported.search = '';
      assert.ok(imported.href.startsWith(output.href));
      assert.equal(read(imported).replace(/\?v=[a-f0-9]{16}(?=['"])/g, ''),
        read(new URL(specifier.split('?')[0], project)));
    }
  }
  const raw = generated.match(/<script id="readme-source" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.match(generated, /<section class="initial-document" aria-label="README\.md">/);
  assert.equal(JSON.parse(raw), before.at(-1));
  assert.equal(read(new URL('README.md', output)), before.at(-1));
  assert.deepEqual(publicFiles.map(file => read(new URL(file, project))), before);
});

test('asset URLs are deterministic, change with any runtime asset, and ignore README-only edits', async t => {
  const project = fixture(t);
  let count = 0;
  const build = async () => {
    const output = new URL(`output-${count++}/`, project);
    await buildSite(output, project);
    return read(new URL('index.html', output));
  };
  const initial = await build();
  assert.equal(await build(), initial);
  for (const file of ['snake.js', 'style.css']) {
    const original = read(new URL(file, project));
    writeFileSync(new URL(file, project), original + '\n/* Asset changed. */\n');
    const changed = assetPaths(await build());
    assert.equal(changed.length, assets.length);
    for (const path of assetPaths(initial)) assert.ok(!changed.includes(path));
    writeFileSync(new URL(file, project), original);
  }
  writeFileSync(new URL('README.md', project), 'Updated public content.\n');
  const contentOnly = await build();
  assert.notEqual(contentOnly, initial);
  assert.deepEqual(assetPaths(contentOnly), assetPaths(initial));
});

test('build refuses an existing output directory without overwriting its files', async t => {
  const project = fixture(t);
  const output = new URL('_site/', project);
  await buildSite(output, project);
  const paths = [...publicFiles, '.nojekyll'];
  const before = paths.map(path => read(new URL(path, output)));
  writeFileSync(new URL('snake.js', project), 'Changed source must not overwrite the existing build.');
  await assert.rejects(buildSite(output, project));
  assert.deepEqual(paths.map(path => read(new URL(path, output))), before);
});
