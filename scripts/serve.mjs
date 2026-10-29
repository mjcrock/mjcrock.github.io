// Local preview only. Share the deployment allowlist with browser checks.
import {createServer} from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import {join, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {renderIndex} from './update-readme.mjs';

const files = new Set(['index.html', 'style.css', 'app.js', 'engine.js', 'routing.js', 'snake.js', 'README.md']);
const types = {html: 'text/html', css: 'text/css', js: 'text/javascript', md: 'text/plain'};

export async function startServer({root = new URL('../', import.meta.url), port = 0} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  const directory = await realpath(root);
  const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, {Allow: 'GET, HEAD'}).end();
      return;
    }
    // Check the raw path so encoded separators and dot segments cannot expand access.
    const path = request.url.split('?')[0];
    const name = path === '/' ? 'index.html' : path.slice(1);
    if (!path.startsWith('/') || !files.has(name)) { response.writeHead(404).end(); return; }
    try {
      const target = join(directory, name);
      if (await realpath(target) !== target) { response.writeHead(404).end(); return; }
      if (name === 'index.html' && await realpath(join(directory, 'README.md')) !== join(directory, 'README.md')) {
        response.writeHead(404).end(); return;
      }
      const bytes = name === 'index.html'
        ? Buffer.from(await renderIndex(pathToFileURL(directory + sep)))
        : await readFile(target);
      response.writeHead(200, {
        'Content-Type': `${types[name.split('.').at(-1)]}; charset=utf-8`,
        'Content-Length': bytes.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {server, url: `http://127.0.0.1:${server.address().port}/`};
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  const {url} = await startServer({port: Number(process.argv[2] ?? 8000)});
  console.log(`Preview: ${url}`);
}
