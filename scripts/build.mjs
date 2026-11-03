// Stage public files with content-versioned asset URLs, without changing source.
import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {renderIndex} from './update-readme.mjs';
import {iconSizes, renderIcon} from './icons.mjs';
import {FILES} from '../engine.js';

// Preview and deployment expose the same fixed catalog, never arbitrary files.
export const publicPages = [...new Set(Object.values(FILES).map(entry => entry.url).filter(url => !url.includes('#')))];
export const documentFiles = Object.entries(FILES).filter(([, entry]) => entry.type === 'file').map(([path]) => path.slice(1));
export const runtimeFiles = ['style.css', 'app.js', 'engine.js', 'routing.js', 'snake.js'];

export async function buildSite(destination, root = new URL('../', import.meta.url)) {
  const names = runtimeFiles;
  const assets = await Promise.all(names.map(async name => [name, await readFile(new URL(name, root))]));
  const svg = await readFile(new URL('favicon.svg', root));
  for (const [name, size] of Object.entries(iconSizes)) assets.push([name, renderIcon(svg, size)]);
  const hash = createHash('sha256');
  for (const [name, bytes] of assets) hash.update(`${name}\0${bytes.length}\0`).update(bytes);
  const version = `?v=${hash.digest('hex').slice(0, 16)}`;
  const pages = await Promise.all(publicPages.map(async path => {
    const html = await renderIndex(root, path);
    const boundary = html.indexOf('</head>');
    if (boundary < 0) throw new Error('Expected an HTML head in index.html.');
    let head = html.slice(0, boundary);
    for (const [name] of assets) {
      const reference = `${name === 'app.js' ? 'src' : 'href'}="${path === '/' ? '' : '/'}${name}"`;
      if (head.split(reference).length !== 2) throw new Error(`Expected one asset reference for ${name} in ${path}.`);
      head = head.replace(reference, reference.replace(name, name + version));
    }
    return [path.slice(1) + 'index.html', head + html.slice(boundary)];
  }));
  // Version every module edge, including nested imports. Keep stable filenames
  // so URLs from older cached HTML still resolve after another deployment.
  const files = assets.map(([name, bytes]) => [name, name.endsWith('.js')
    ? bytes.toString('utf8').replace(/(\bfrom\s+['"])(\.\/[^'"]+)(['"])/g, (_, before, path, after) => {
      if (!names.includes(path.slice(2))) throw new Error(`Unknown runtime import: ${path}`);
      return before + path + version + after;
    }) : bytes]);
  // A new directory prevents stale artifacts and avoids overwriting local files.
  await mkdir(destination);
  const parents = new Set([...documentFiles, ...pages.map(([name]) => name)]
    .map(name => new URL('.', new URL(name, destination)).href));
  await Promise.all([...parents].map(path => mkdir(new URL(path), {recursive: true})));
  await Promise.all(files.map(([name, bytes]) => writeFile(new URL(name, destination), bytes)));
  await Promise.all(documentFiles.map(name => copyFile(new URL(name, root), new URL(name, destination))));
  await Promise.all(pages.map(([name, html]) => writeFile(new URL(name, destination), html)));
  await writeFile(new URL('.nojekyll', destination), '');
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/build.mjs');
  await buildSite(new URL('../_site/', import.meta.url));
}
