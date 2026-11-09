import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FILES, LIMITS} from '../engine.js';
import {parseDocumentHash, documentHash, entryURL, pageLink, isDocumentHash, parseLocation, navigationState, navigationCwd} from '../routing.js';

const paths = Object.keys(FILES).filter(path => FILES[path].type === 'file');

test('empty fragments represent home, not an executable command', () => {
  assert.deepEqual(parseDocumentHash(''), {kind: 'home', path: null});
  assert.deepEqual(parseDocumentHash('#'), {kind: 'home', path: null});
});

test('each authored document retains a reversible legacy fragment', () => {
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

test('stored navigation state contains only known file or directory paths', () => {
  assert.deepEqual(navigationState('/README.md', '/'), {terminal: {path: '/README.md', cwd: '/'}});
  assert.deepEqual(navigationState(null, '/'), {terminal: {path: null, cwd: '/'}});
  assert.deepEqual(navigationState('/projects', '/projects/textbook'), {terminal: {path: '/projects', cwd: '/projects/textbook'}});
  assert.deepEqual(navigationState('/projects/textbook/README.md', '/projects'), {terminal: {path: '/projects/textbook/README.md', cwd: '/projects'}});
  for (const value of ['/missing', '/work', '/about', '__proto__', '<script>', null, undefined, 1, {}]) {
    assert.equal(navigationState(value, '/').terminal.path, null);
  }
  for (const value of ['/missing', '/README.md', '/writing', '__proto__', 'constructor', null, undefined, 1, {}]) {
    assert.equal(navigationState('/README.md', value).terminal.cwd, '/');
  }
});

test('cwd restoration requires a matching route and a known directory', () => {
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
  assert.deepEqual(Object.keys(FILES), ['/', '/README.md', '/projects', '/projects/textbook', '/projects/textbook/README.md']);
});

test('public entry URLs are short, fixed, and independent of the current page', () => {
  for (const [path, expected] of [
    ['/', '/'], ['/README.md', '/#/README.md'], ['/projects', '/projects/'],
    ['/projects/textbook', '/projects/textbook/'], ['/projects/textbook/README.md', '/projects/textbook/'],
  ]) assert.equal(entryURL(path), expected);
  for (const path of [null, undefined, {}, '/missing', '__proto__', 'constructor', '/projects/textbook/../README.md']) {
    assert.equal(entryURL(path), '');
  }
});

test('related links connect the three pages through known public URLs', () => {
  for (const path of [null, '/', '/README.md']) {
    assert.deepEqual(pageLink(path), {href: '/projects/', label: 'Browse projects'});
  }
  assert.deepEqual(pageLink('/projects'), {href: '/', label: 'Home'});
  assert.deepEqual(pageLink('/projects/textbook/README.md'), {href: '/projects/', label: 'All projects'});
  assert.deepEqual(pageLink('/projects/missing'), {href: '/', label: 'Home'});
});

test('clean pages and explicit index aliases resolve to their intended views', () => {
  for (const [pathname, kind, path] of [
    ['/', 'home', null], ['/index.html', 'home', null],
    ['/projects/', 'directory', '/projects'], ['/projects/index.html', 'directory', '/projects'],
    ['/projects/textbook/', 'file', '/projects/textbook/README.md'],
    ['/projects/textbook/index.html', 'file', '/projects/textbook/README.md'],
  ]) {
    assert.deepEqual(parseLocation({pathname}), {kind, path});
    assert.deepEqual(parseLocation({pathname, hash: '#'}), {kind, path});
    assert.deepEqual(parseLocation({pathname, hash: '', search: '?ignored=clear'}), {kind, path});
  }
  assert.deepEqual(parseLocation(), {kind: 'home', path: null});
});

test('legacy fragments resolve on known pages without becoming commands', () => {
  for (const pathname of ['/', '/projects/', '/projects/textbook/']) {
    for (const path of paths) {
      assert.deepEqual(parseLocation({pathname, hash: documentHash(path)}), {kind: 'file', path});
    }
    assert.deepEqual(parseLocation({pathname, hash: '#%2fREADME.md'}), {kind: 'file', path: '/README.md'});
    for (const hash of ['#/missing', '#%2Fprojects%2F..%2FREADME.md', '#/%GG']) {
      assert.equal(isDocumentHash(hash), true);
      assert.deepEqual(parseLocation({pathname, hash}), {kind: 'invalid', path: null});
    }
  }
});

test('ordinary fragments stay within their published page and never select a terminal document', () => {
  for (const pathname of ['/', '/projects/index.html', '/projects/textbook/']) {
    for (const hash of ['#screen', '#overview', '#clear', '#heading%20one', '#%', '#%252FREADME.md']) {
      assert.equal(isDocumentHash(hash), false);
      assert.deepEqual(parseLocation({pathname, hash}), parseLocation({pathname}));
    }
  }
});

test('unknown and malformed page paths fail closed before considering a legacy hash', () => {
  for (const pathname of [
    '', '/missing/', '/projects', '/projects/textbook', '/projects/../', '/projects//textbook/',
    '//projects/', '/%70rojects/', '/projects/textbook/README.md', '/projects/textbook/index.html/',
    '/projects/textbook/?command=clear', '/constructor', 'https://example.invalid/projects/',
    null, 1, {}, [],
  ]) for (const hash of ['', '#/README.md']) {
    assert.deepEqual(parseLocation({pathname, hash}), {kind: 'invalid', path: null});
  }
  for (const location of [null, false, 1, '']) assert.deepEqual(parseLocation(location), {kind: 'invalid', path: null});
  for (const hash of [null, false, 1, {}, 'missing-leading-hash']) {
    assert.deepEqual(parseLocation({pathname: '/projects/textbook/', hash}), {kind: 'invalid', path: null});
  }
});

test('direct project pages choose a useful cwd while matching saved context wins', () => {
  assert.equal(navigationCwd(null, '/projects'), '/projects');
  assert.equal(navigationCwd(null, '/projects/textbook/README.md'), '/projects/textbook');
  assert.equal(navigationCwd(navigationState('/projects/textbook/README.md', '/'), '/projects/textbook/README.md'), '/');
  assert.equal(navigationCwd(navigationState('/projects', '/projects'), '/projects/textbook/README.md'), '/projects/textbook');
  assert.equal(navigationCwd({terminal: {path: '/projects/textbook/README.md', cwd: '/README.md'}}, '/projects/textbook/README.md'), '/projects/textbook');
  assert.equal(navigationCwd({terminal: {path: '/projects/textbook/README.md', cwd: '__proto__'}}, '/projects/textbook/README.md'), '/projects/textbook');
});

test('mutating a parsed route cannot alter future clean-page routing', () => {
  const route = parseLocation({pathname: '/projects/textbook/'});
  route.path = '/README.md'; route.kind = 'home';
  assert.deepEqual(parseLocation({pathname: '/projects/textbook/'}), {kind: 'file', path: '/projects/textbook/README.md'});
});
