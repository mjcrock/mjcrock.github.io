// Public links describe fixed documents, never commands or a remote filesystem.
import {FILES, LIMITS} from './engine.js';

const own = path => Object.prototype.hasOwnProperty.call(FILES, path);
const isFile = path => typeof path === 'string' && own(path) && FILES[path].type === 'file';
const isDirectory = path => typeof path === 'string' && own(path) && FILES[path].type === 'directory';

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
  return {terminal: {path: isFile(path) ? path : null, cwd: isDirectory(cwd) ? cwd : '/'}};
}

export function navigationCwd(state, path) {
  const saved = state?.terminal;
  return saved && saved.path === path && isDirectory(saved.cwd) ? saved.cwd : '/';
}
