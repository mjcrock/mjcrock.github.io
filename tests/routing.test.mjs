import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FILES, LIMITS} from '../engine.js';
import {parseDocumentHash, documentHash, navigationState, navigationCwd} from '../routing.js';

const paths = Object.keys(FILES).filter(path => FILES[path].type === 'file');

test('empty fragments represent home, not an executable command', () => {
  assert.deepEqual(parseDocumentHash(''), {kind: 'home', path: null});
  assert.deepEqual(parseDocumentHash('#'), {kind: 'home', path: null});
});

test('each authored document has a reversible canonical fragment', () => {
  for (const path of paths) {
    assert.equal(documentHash(path), `#${path}`);
    assert.deepEqual(parseDocumentHash(documentHash(path)), {kind: 'file', path});
    assert.deepEqual(parseDocumentHash(`#${encodeURIComponent(path)}`), {kind: 'file', path});
  }
});

test('directories and unknown/prototype paths are not document routes', () => {
  for (const value of ['/', '/work', '/writing', '/missing', '__proto__', 'constructor', 'toString']) {
    assert.equal(documentHash(value), '');
    assert.deepEqual(parseDocumentHash(`#${value}`), {kind: 'invalid', path: null});
  }
});

test('malformed or oversized fragments fail closed without decoding exceptions', () => {
  const cases = [null, undefined, false, 9, {}, [], '%2Fabout', 'about', '#%', '#%0', '#%GG', '#%C0%AFabout', '#%ED%A0%80', '#%F4%90%80%80', `#${'x'.repeat(LIMITS.input)}`];
  for (const value of cases) {
    assert.deepEqual(parseDocumentHash(value), {kind: 'invalid', path: null});
  }
});

test('route parsing never normalizes traversal or executes command/HTML/URL fragments', () => {
  for (const value of [
    '#/writing/../about', '#/about/', '#//about', '#/./about', '#%252Fabout',
    '#open /about', '#cat /about', '#javascript:alert(1)', '#https://example.invalid/',
    '#<img/src=x/onerror=alert(1)>', '#/about%00', '#/about%0A', '#/about%202E',
  ]) assert.deepEqual(parseDocumentHash(value), {kind: 'invalid', path: null}, value);
});

test('stored navigation state contains only a known document and directory', () => {
  assert.deepEqual(navigationState('/about', '/work'), {terminal: {path: '/about', cwd: '/work'}});
  assert.deepEqual(navigationState(null, '/writing'), {terminal: {path: null, cwd: '/writing'}});
  for (const value of ['/missing', '/work', '__proto__', '<script>', null, undefined, 1, {}]) {
    assert.equal(navigationState(value, '/').terminal.path, null);
  }
  for (const value of ['/missing', '/about', '__proto__', 'constructor', null, undefined, 1, {}]) {
    assert.equal(navigationState('/about', value).terminal.cwd, '/');
  }
});

test('cwd restoration requires a matching route and a known directory', () => {
  assert.equal(navigationCwd(navigationState('/about', '/work'), '/about'), '/work');
  assert.equal(navigationCwd(navigationState(null, '/writing'), null), '/writing');
  assert.equal(navigationCwd(navigationState('/about', '/work'), '/contact'), '/');
  assert.equal(navigationCwd(navigationState('/about', '/work'), null), '/');
  for (const state of [null, undefined, false, 'x', {}, {terminal: null}, {terminal: {path: '/about', cwd: '/about'}}, {terminal: {path: '/about', cwd: '__proto__'}}]) {
    assert.equal(navigationCwd(state, '/about'), '/');
  }
});

test('navigation snapshots cannot mutate subsequent snapshots or the filesystem', () => {
  const state = navigationState('/about', '/work');
  state.terminal.path = 'clear';
  state.terminal.cwd = '/missing';
  assert.deepEqual(navigationState('/about', '/work'), {terminal: {path: '/about', cwd: '/work'}});
  assert.equal(FILES['/about'].type, 'file');
});
