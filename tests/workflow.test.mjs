import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, cpSync, readdirSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';

const root = new URL('../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/pages.yml', root), 'utf8');
const publicFiles = ['index.html', 'style.css', 'app.js', 'engine.js', 'routing.js', 'README.md'];

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

test('deployment generates HTML without changing source and stages only public files', () => {
  const command = workflow.match(/          cp (.+) _site\//)[1];
  assert.deepEqual(command.split(' '), publicFiles.filter(file => file !== 'index.html'));
  assert.match(workflow, /path: _site\n/);
  const staging = workflow.match(/- name: Stage public files only\n        run: \|\n([\s\S]*?)      - name: Upload site/)[1]
    .split('\n').filter(Boolean).map(line => line.replace(/^          /, '')).join('\n');
  assert.match(staging, /^node scripts\/update-readme\.mjs > _site\/index\.html$/m);
  const temporary = mkdtempSync(join(tmpdir(), 'pages-artifact-'));
  try {
    for (const file of publicFiles) cpSync(new URL(file, root), join(temporary, file));
    const template = readFileSync(join(temporary, 'index.html'), 'utf8');
    assert.match(template, /<!-- BEGIN GENERATED README -->\r?\n\s*<!-- END GENERATED README -->/);
    assert.doesNotMatch(template, /id="output"|id="readme-source"/);
    mkdirSync(join(temporary, 'scripts'));
    cpSync(new URL('scripts/update-readme.mjs', root), join(temporary, 'scripts/update-readme.mjs'));
    cpSync(new URL('markdown.js', root), join(temporary, 'markdown.js'));
    writeFileSync(join(temporary, 'package.json'), '{"type":"module"}\n');
    for (const file of ['.DS_Store', '._README.md', 'DEVELOPMENT.md']) {
      writeFileSync(join(temporary, file), 'Private local metadata: never publish.');
    }
    mkdirSync(join(temporary, '__MACOSX'));
    writeFileSync(join(temporary, '__MACOSX/._README.md'), 'Private archive metadata.');
    // Exercise the exact workflow staging commands without exposing repository files.
    execFileSync('sh', ['-eu', '-c', staging], {cwd: temporary});
    assert.deepEqual(readdirSync(join(temporary, '_site')).sort(), [...publicFiles, '.nojekyll'].sort());
    const generated = readFileSync(join(temporary, '_site/index.html'), 'utf8');
    const source = readFileSync(new URL('README.md', root), 'utf8');
    const raw = generated.match(/<script id="readme-source" type="application\/json">([\s\S]*?)<\/script>/)[1];
    assert.match(generated, /<section class="initial-document" aria-label="README\.md">/);
    assert.equal(JSON.parse(raw), source);
    assert.equal(readFileSync(join(temporary, '_site/README.md'), 'utf8'), source);
    assert.equal(readFileSync(join(temporary, 'index.html'), 'utf8'), template);
  } finally { rmSync(temporary, {recursive: true, force: true}); }
});
