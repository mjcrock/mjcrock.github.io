// Public links describe fixed documents, never commands or a remote filesystem.
import {FILES, LIMITS} from './engine.js';

const own = path => Object.prototype.hasOwnProperty.call(FILES, path);
const isFile = path => typeof path === 'string' && own(path) && FILES[path].type === 'file';
const isDirectory = path => typeof path === 'string' && own(path) && FILES[path].type === 'directory';

// A directory can share its landing URL with its README. The file entry wins.
const pages = new Map();
for (const [path, entry] of Object.entries(FILES)) {
  if (!entry.url.includes('#') && (!pages.has(entry.url) || entry.type === 'file')) pages.set(entry.url,
    {kind: path === '/' ? 'home' : entry.type === 'file' ? 'file' : 'directory', path: path === '/' ? null : path});
}

export function entryURL(path) {
  return typeof path === 'string' && own(path) ? FILES[path].url : '';
}

// One related destination per page, shared by static and interactive navigation.
export function pageLink(path) {
  if (path === null || path === '/' || path === '/README.md') {
    return {href: FILES['/projects'].url, label: 'Browse projects'};
  }
  if (typeof path === 'string' && own(path) && path.startsWith('/projects/')) {
    return {href: FILES['/projects'].url, label: 'All projects'};
  }
  return {href: FILES['/'].url, label: 'Home'};
}

export function isDocumentHash(hash) {
  return typeof hash === 'string' && /^#(?:\/|%2f)/i.test(hash);
}

export function parseLocation(location = {}) {
  if (!location || typeof location !== 'object') return {kind: 'invalid', path: null};
  const {pathname = '/', hash = ''} = location;
  if (typeof pathname !== 'string' || typeof hash !== 'string' || (hash && !hash.startsWith('#'))) {
    return {kind: 'invalid', path: null};
  }
  const page = pages.get(pathname.endsWith('/index.html') ? pathname.slice(0, -10) : pathname);
  if (!page) return {kind: 'invalid', path: null};
  if (isDocumentHash(hash)) return parseDocumentHash(hash);
  return {...page};
}

export function parseDocumentHash(hash) {
  if (hash === '' || hash === '#') return {kind: 'home', path: null};
  if (typeof hash !== 'string' || !hash.startsWith('#') || hash.length > LIMITS.input) return {kind: 'invalid', path: null};
  try {
    const path = decodeURIComponent(hash.slice(1));
    return isFile(path) ? {kind: 'file', path} : {kind: 'invalid', path: null};
  } catch {
    return {kind: 'invalid', path: null};
  }
}

export function documentHash(path) {
  return isFile(path) ? '#' + encodeURIComponent(path).replaceAll('%2F', '/') : '';
}

export function navigationState(path, cwd) {
  return {terminal: {path: isFile(path) || isDirectory(path) ? path : null, cwd: isDirectory(cwd) ? cwd : '/'}};
}

export function navigationCwd(state, path) {
  const saved = state?.terminal;
  if (saved && saved.path === path && isDirectory(saved.cwd)) return saved.cwd;
  return isDirectory(path) ? path : isFile(path) ? path.slice(0, path.lastIndexOf('/')) || '/' : '/';
}
