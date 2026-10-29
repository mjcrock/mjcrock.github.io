import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, cpSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';

const root = new URL('../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/pages.yml', root), 'utf8');
const publicFiles = ['index.html', 'style.css', 'app.js', 'engine.js', 'routing.js', 'markdown.js', 'README.md'];

test('Pages workflow generates before testing and restricts deployment to main', () => {
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.ok(workflow.indexOf('node scripts/update-readme.mjs\n') < workflow.indexOf('node --test'));
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

test('deployment staging includes only the explicit public asset allowlist', () => {
  const command = workflow.match(/          cp (.+) _site\//)[1];
  assert.deepEqual(command.split(' '), publicFiles);
  assert.match(workflow, /path: _site\n/);
  const temporary = mkdtempSync(join(tmpdir(), 'pages-artifact-'));
  try {
    for (const file of publicFiles) cpSync(new URL(file, root), join(temporary, file));
    // Exercise the exact workflow staging commands without exposing repository files.
    execFileSync('sh', ['-eu', '-c', `mkdir _site\ncp ${command} _site/\ntouch _site/.nojekyll`], {cwd: temporary});
    assert.deepEqual(readdirSync(join(temporary, '_site')).sort(), [...publicFiles, '.nojekyll'].sort());
    assert.equal(readFileSync(join(temporary, '_site/README.md'), 'utf8'), readFileSync(new URL('README.md', root), 'utf8'));
  } finally { rmSync(temporary, {recursive: true, force: true}); }
});
