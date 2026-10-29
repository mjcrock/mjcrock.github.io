// Stage public files with content-versioned asset URLs, without changing source.
import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {renderIndex} from './update-readme.mjs';

export async function buildSite(destination, root = new URL('../', import.meta.url)) {
  const names = ['style.css', 'app.js', 'engine.js', 'routing.js', 'snake.js'];
  const assets = await Promise.all(names.map(async name => [name, await readFile(new URL(name, root))]));
  const hash = createHash('sha256');
  for (const [name, bytes] of assets) hash.update(`${name}\0${bytes.length}\0`).update(bytes);
  const version = `?v=${hash.digest('hex').slice(0, 16)}`;
  const html = await renderIndex(root);
  const boundary = html.indexOf('</head>');
  if (boundary < 0) throw new Error('Expected an HTML head in index.html.');
  let head = html.slice(0, boundary);
  for (const name of names) {
    const reference = `${name === 'app.js' ? 'src' : 'href'}="${name}"`;
    if (head.split(reference).length !== 2) throw new Error(`Expected one asset reference for ${name}.`);
    head = head.replace(reference, reference.replace(name, name + version));
  }
  // Version every module edge, including nested imports. Keep stable filenames
  // so URLs from older cached HTML still resolve after another deployment.
  const files = assets.map(([name, bytes]) => [name, name.endsWith('.js')
    ? bytes.toString('utf8').replace(/(\bfrom\s+['"])(\.\/[^'"]+)(['"])/g, (_, before, path, after) => {
      if (!names.includes(path.slice(2))) throw new Error(`Unknown runtime import: ${path}`);
      return before + path + version + after;
    }) : bytes]);
  // A new directory prevents stale artifacts and avoids overwriting local files.
  await mkdir(destination);
  await Promise.all(files.map(([name, bytes]) => writeFile(new URL(name, destination), bytes)));
  await copyFile(new URL('README.md', root), new URL('README.md', destination));
  await writeFile(new URL('index.html', destination), head + html.slice(boundary));
  await writeFile(new URL('.nojekyll', destination), '');
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/build.mjs');
  await buildSite(new URL('../_site/', import.meta.url));
}
