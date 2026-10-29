import assert from 'node:assert/strict';
import {test} from 'node:test';
import {request} from 'node:http';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../scripts/serve.mjs';

test('preview serves only public files on loopback and rejects private or encoded paths', async () => {
  const {server, url} = await startServer();
  const get = (path, method = 'GET') => new Promise((resolve, reject) => {
    const req = request(url, {path, method}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks)}));
    });
    req.on('error', reject).end();
  });
  try {
    assert.equal(server.address().address, '127.0.0.1');
    const page = await get('/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /^text\/html/);
    assert.ok(page.body.includes('<!doctype html>'));
    assert.equal((await get('/app.js?v=1')).headers['content-type'], 'text/javascript; charset=utf-8');
    const head = await get('/README.md', 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    for (const path of ['/.git/config', '/DEVELOPMENT.md', '/tests/', '/../README.md', '/%2e%2e/README.md', '/%2fREADME.md', '//README.md', '/scripts/serve.mjs', '/markdown.js']) {
      assert.equal((await get(path)).status, 404, path);
    }
    assert.equal((await get('/', 'POST')).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('preview renders current content without writing generated files into the source tree', async t => {
  const root = await mkdtemp(join(tmpdir(), 'site-preview-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  await writeFile(join(root, 'index.html'), template);
  await writeFile(join(root, 'README.md'), 'First version.\n');
  const {server, url} = await startServer({root});
  try {
    const first = await (await fetch(url)).text();
    assert.ok(first.includes('<p>First version.</p>'));
    await writeFile(join(root, 'README.md'), 'Second version.\n');
    const second = await (await fetch(url)).text();
    assert.ok(second.includes('<p>Second version.</p>'));
    assert.ok(!second.includes('First version.'));
    assert.equal(await readFile(join(root, 'index.html'), 'utf8'), template);
    assert.deepEqual((await readdir(root)).sort(), ['README.md', 'index.html']);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
