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
  for (const value of ['/', '/work', '/writing', '/about', '/contact', '/work/readme', '/writing/sample', '/missing', '__proto__', 'constructor', 'toString']) {
    assert.equal(documentHash(value), '');
    assert.deepEqual(parseDocumentHash(`#${value}`), {kind: 'invalid', path: null});
  }
});

test('malformed or oversized fragments fail closed without decoding exceptions', () => {
  const cases = [null, undefined, false, 9, {}, [], '%2FREADME.md', 'README.md', '#%', '#%0', '#%GG', '#%C0%AFREADME.md', '#%ED%A0%80', '#%F4%90%80%80', `#${'x'.repeat(LIMITS.input)}`];
  for (const value of cases) {
    assert.deepEqual(parseDocumentHash(value), {kind: 'invalid', path: null});
  }
});

test('route parsing never normalizes traversal or executes command/HTML/URL fragments', () => {
  for (const value of [
    '#/writing/../README.md', '#/README.md/', '#//README.md', '#/./README.md', '#%252FREADME.md',
    '#open /README.md', '#cat /README.md', '#javascript:alert(1)', '#https://example.invalid/',
    '#<img/src=x/onerror=alert(1)>', '#/README.md%00', '#/README.md%0A', '#/README.md%202E',
  ]) assert.deepEqual(parseDocumentHash(value), {kind: 'invalid', path: null}, value);
});

test('stored navigation state contains only README.md and the root directory', () => {
  assert.deepEqual(navigationState('/README.md', '/'), {terminal: {path: '/README.md', cwd: '/'}});
  assert.deepEqual(navigationState(null, '/'), {terminal: {path: null, cwd: '/'}});
  for (const value of ['/missing', '/work', '/about', '__proto__', '<script>', null, undefined, 1, {}]) {
    assert.equal(navigationState(value, '/').terminal.path, null);
  }
  for (const value of ['/missing', '/README.md', '/writing', '__proto__', 'constructor', null, undefined, 1, {}]) {
    assert.equal(navigationState('/README.md', value).terminal.cwd, '/');
  }
});

test('cwd restoration requires a matching route and the known root directory', () => {
  assert.equal(navigationCwd(navigationState('/README.md', '/'), '/README.md'), '/');
  assert.equal(navigationCwd(navigationState(null, '/'), null), '/');
  for (const state of [null, undefined, false, 'x', {}, {terminal: null}, {terminal: {path: '/README.md', cwd: '/README.md'}}, {terminal: {path: '/README.md', cwd: '__proto__'}}, {terminal: {path: '/about', cwd: '/writing'}}]) {
    assert.equal(navigationCwd(state, '/README.md'), '/');
  }
});

test('navigation snapshots cannot mutate subsequent snapshots or the filesystem', () => {
  const state = navigationState('/README.md', '/');
  state.terminal.path = 'clear';
  state.terminal.cwd = '/missing';
  assert.deepEqual(navigationState('/README.md', '/'), {terminal: {path: '/README.md', cwd: '/'}});
  assert.equal(FILES['/README.md'].type, 'file');
  assert.deepEqual(Object.keys(FILES), ['/', '/README.md']);
});
