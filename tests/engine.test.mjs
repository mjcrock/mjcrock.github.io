import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';

// Select an alternative engine only when testing the same public contract.
const moduleURL = process.env.ENGINE_PATH
  ? pathToFileURL(process.env.ENGINE_PATH)
  : new URL('../engine.js', import.meta.url);
const {COMMANDS, FILES, LIMITS, README_SOURCE, Session, completions, execute, list, resolvePath} = await import(moduleURL.href);
const README = await readFile(new URL('README.md', moduleURL), 'utf8');
const read = command => execute(command);

test('commands and limits are explicit, bounded, and immutable', () => {
  assert.deepEqual(COMMANDS, ['help', 'ls', 'open', 'cat', 'cd', 'pwd', 'clear', 'history']);
  assert.deepEqual(LIMITS, {input: 500, history: 50, output: 40});
  assert.ok(Object.isFrozen(COMMANDS));
  assert.ok(Object.isFrozen(LIMITS));
});

test('the virtual filesystem contains only root and README metadata, not copied content', () => {
  assert.deepEqual(FILES, {
    '/': {type: 'directory', description: 'Home'},
    '/README.md': {type: 'file', title: 'README.md'},
  });
  assert.ok(Object.isFrozen(FILES));
  for (const entry of Object.values(FILES)) {
    assert.ok(Object.isFrozen(entry));
    assert.equal(Object.hasOwn(entry, 'lines'), false);
    assert.equal(Object.hasOwn(entry, 'source'), false);
  }
});

test('path normalization supports relative, absolute, home, and dot segments', () => {
  const cases = [
    [undefined, '/', '/'], ['', '/', '/'], ['.', '/', '/'], ['~', '/', '/'],
    ['README.md', '/', '/README.md'], ['~/README.md', '/', '/README.md'],
    ['/README.md', '/', '/README.md'], ['./README.md', '/', '/README.md'],
    ['../README.md', '/', '/README.md'], ['../../../README.md', '/', '/README.md'],
    ['//./README.md/', '/', '/README.md'], ['/missing/../README.md', '/', '/README.md'],
    ['../README.md', '/hypothetical', '/README.md'],
  ];
  for (const [raw, cwd, expected] of cases) {
    assert.equal(resolvePath(raw, cwd), expected, `${raw} from ${cwd}`);
    assert.equal(resolvePath(expected), expected);
  }
});

test('directory listing contains the real public README only', () => {
  assert.deepEqual(list('/'), ['/README.md']);
  assert.deepEqual(list('/README.md'), []);
  assert.deepEqual(list('/missing'), []);
  const entries = list('/');
  if (!Object.isFrozen(entries)) entries.length = 0;
  assert.deepEqual(list('/'), ['/README.md']);
});

test('empty text does not execute and help/clear/pwd are immediately available', () => {
  for (const value of ['', ' ', '\t  ']) assert.deepEqual(execute(value), {cwd: '/', kind: 'empty'});
  assert.deepEqual(execute('help'), {cwd: '/', kind: 'help'});
  assert.deepEqual(execute('clear'), {cwd: '/', kind: 'clear'});
  assert.deepEqual(execute('pwd'), {cwd: '/', kind: 'text', message: '/'});
});

test('invalid or non-directory current paths reset to the only valid directory', () => {
  for (const cwd of ['/missing', '/README.md', '__proto__', 'constructor']) {
    assert.deepEqual(execute('pwd', cwd), {cwd: '/', kind: 'text', message: '/'});
  }
});

test('ls and open directory return only the root listing', () => {
  for (const command of ['ls', 'ls /', 'open', 'open /', 'open ~']) {
    assert.deepEqual(execute(command), {cwd: '/', kind: 'list', path: '/', entries: ['/README.md']});
  }
  assert.deepEqual(execute('ls README.md'), {cwd: '/', kind: 'list', path: '/', entries: ['/README.md']});
});

test('open returns a reader action and cat a text-dump action with the identical raw source', () => {
  for (const [command, kind] of [['open', 'file'], ['cat', 'cat']]) {
    for (const path of ['README.md', '/README.md', '~/README.md', './README.md', '../README.md']) {
      assert.deepEqual(read(`${command} ${path}`), {
        cwd: '/', kind, path: '/README.md', entry: FILES['/README.md'], source: README,
      });
    }
  }
});

test('generated README source matches the independent canonical file exactly', () => {
  assert.equal(typeof README_SOURCE, 'string');
  assert.equal(README_SOURCE, README);
  for (const command of ['open README.md', 'cat README.md']) {
    const result = execute(command);
    assert.equal(result.source, README);
    assert.deepEqual(Buffer.from(result.source, 'utf8'), Buffer.from(README, 'utf8'));
    assert.equal(Object.hasOwn(result.entry, 'lines'), false);
  }
});

test('cd accepts root equivalents but never changes cwd to a file', () => {
  for (const command of ['cd', 'cd /', 'cd ~', 'cd .', 'cd ..', '  cd\t/  ']) {
    assert.deepEqual(execute(command), {cwd: '/', kind: 'location'});
  }
  const result = execute('cd README.md');
  assert.equal(result.kind, 'error');
  assert.equal(result.cwd, '/');
  assert.equal(result.message, 'Not a directory: /README.md');
  assert.deepEqual(result.suggestions, ['open /README.md', 'cat /README.md']);
});

test('cat requires one file path and rejects directory input without reading its source', () => {
  for (const command of ['cat', 'cat README.md README.md', 'cat -n README.md', 'cat README.md | pwd']) {
    const result = read(command);
    assert.equal(result.kind, 'error');
    assert.equal(result.message, 'Usage: cat path');
    assert.deepEqual(result.suggestions, ['ls /']);
    assert.match(result.hint, /Flags, pipes, and multiple paths are not supported/);
  }
  for (const command of ['cat /', 'cat .', 'cat ~']) {
    const result = read(command);
    assert.equal(result.kind, 'error');
    assert.equal(result.message, 'Is a directory: /');
    assert.deepEqual(result.suggestions, ['open /', 'ls /']);
  }
});

test('removed placeholder paths and unknown paths fail with an accurate root recovery action', () => {
  for (const path of ['/about', '/work', '/work/readme', '/writing', '/writing/sample', '/contact', '/README.md/missing', '/unknown/deeper']) {
    for (const command of ['ls', 'open', 'cat', 'cd']) {
      const result = read(`${command} ${path}`);
      assert.equal(result.kind, 'error', `${command} ${path}`);
      assert.equal(result.cwd, '/');
      assert.deepEqual(result.suggestions, ['ls /']);
      assert.equal(result.hint, 'Use ls / to see available paths.');
    }
  }
});

test('commands reject surplus arguments and provide command-specific usage', () => {
  for (const command of COMMANDS) assert.equal(read(`${command} / /README.md`).kind, 'error', command);
  for (const command of ['help', 'pwd', 'clear', 'history']) {
    const result = execute(`${command} extra`);
    assert.equal(result.kind, 'error');
    assert.equal(result.message, `Usage: ${command}`);
    assert.equal(result.hint, `${command} does not take arguments.`);
    assert.deepEqual(result.suggestions, [command]);
  }
  assert.equal(execute('open / /README.md').message, 'Usage: open [path]');
});

test('history results are capped and isolated from the supplied array', () => {
  const history = Array.from({length: LIMITS.history + 10}, (_, index) => `unknown-${index}`);
  const result = execute('history', '/', history);
  assert.equal(result.kind, 'history');
  assert.deepEqual(result.entries, history.slice(-LIMITS.history));
  result.entries.pop();
  assert.equal(history.length, LIMITS.history + 10);
});

test('input length accepts the exact boundary and rejects oversized and non-string values', () => {
  const boundary = 'pwd' + ' '.repeat(LIMITS.input - 3);
  assert.equal(execute(boundary).kind, 'text');
  for (const input of [`${boundary} `, null, undefined, 1, {}, []]) {
    const result = execute(input);
    assert.equal(result.kind, 'error');
    assert.equal(result.invalidInput, true);
    assert.deepEqual(completions(input), []);
  }
});

test('single-line policy rejects non-tab C0/C1 controls, line separators, and direction markers', () => {
  const codes = [
    ...Array.from({length: 32}, (_, index) => index).filter(code => code !== 9),
    ...Array.from({length: 33}, (_, index) => 127 + index),
    0x061c, 0x200e, 0x200f, 0x2028, 0x2029,
    ...Array.from({length: 5}, (_, index) => 0x202a + index),
    ...Array.from({length: 4}, (_, index) => 0x2066 + index),
  ];
  const session = new Session();
  for (const code of codes) {
    const input = `pwd${String.fromCodePoint(code)}`;
    const result = session.submit(input);
    assert.equal(result.kind, 'error', `U+${code.toString(16)}`);
    assert.equal(result.invalidInput, true, `U+${code.toString(16)}`);
    assert.deepEqual(completions(input), [], `U+${code.toString(16)}`);
  }
  assert.deepEqual(session.history, []);
  assert.equal(read('cat\tREADME.md').kind, 'cat');
});

test('shell syntax, HTML, URLs, and prototype properties never execute or become files', () => {
  for (const input of ['<img/src=x/onerror=alert(1)>', 'javascript:alert(1)', 'https://example.invalid/', 'pwd;alert(1)', 'pwd&&ls', '$(pwd)', '`pwd`', '__proto__', 'constructor']) {
    assert.equal(read(input).kind, 'error', input);
    assert.deepEqual(completions(input), [], input);
  }
  assert.equal(read('<img/src=x/onerror=alert(1)>').message, 'Unknown command: <img/src=x/onerror=alert(1)>');
  for (const path of ['/__proto__', '/constructor', '/toString', '/../../../etc/passwd', 'README.md;pwd', '*.md']) {
    assert.equal(read(`cat ${path}`).kind, 'error', path);
  }
});

test('command completions append a space only for path-accepting commands', () => {
  assert.deepEqual(completions(''), ['help', 'ls ', 'open ', 'cat ', 'cd ', 'pwd', 'clear', 'history']);
  assert.deepEqual(completions('h'), ['help', 'history']);
  assert.deepEqual(completions('ca'), ['cat ']);
  assert.deepEqual(completions('op'), ['open ']);
  assert.deepEqual(completions('  pw'), ['pwd']);
  assert.deepEqual(completions('pwd'), ['pwd']);
  assert.deepEqual(completions('unknown'), []);
});

test('file completion exposes only README, preserves path prefixes, and is case-sensitive', () => {
  for (const command of ['open', 'cat', 'ls']) {
    for (const [prefix, expected] of [['', 'README.md'], ['R', 'README.md'], ['/R', '/README.md'], ['~/R', '~/README.md'], ['./R', './README.md'], ['../R', '../README.md']]) {
      assert.deepEqual(completions(`${command} ${prefix}`), [`${command} ${expected}`]);
    }
    assert.deepEqual(completions(`${command} /README.md`), [`${command} /README.md`]);
    assert.deepEqual(completions(`${command} readme`), []);
    assert.deepEqual(completions(`${command} /missing/`), []);
  }
});

test('completion never invents directories or accepts extra arguments', () => {
  for (const input of ['cd ', 'cd /', 'cd R', 'open /README.md/', 'cat /README.md extra', 'open /work/', 'pwd ', 'help ', 'clear ']) {
    assert.deepEqual(completions(input), [], input);
  }
});

test('unknown commands suggest only one-edit allowlisted names without running or copying arguments', () => {
  for (const [input, expected] of [
    ['hel', ['help']], ['helpp', ['help']], ['heop', ['help']],
    ['car', ['cat']], ['cdd /README.md', ['cd']], ['ld', ['ls', 'cd']],
  ]) {
    const result = read(input);
    assert.equal(result.kind, 'error');
    assert.equal(result.cwd, '/');
    assert.deepEqual(result.suggestions, expected);
    assert.equal(result.hint, `Did you mean ${expected.join(' or ')}?`);
  }
  assert.deepEqual(read('completely-unknown').suggestions, ['help']);
});

test('command suggestions agree with an independent edit-distance reference', () => {
  // Full dynamic programming validates the production bounded one-edit shortcut.
  const distance = (left, right) => {
    let row = Array.from({length: right.length + 1}, (_, index) => index);
    for (let i = 0; i < left.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < right.length; j++) {
        next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (left[i] === right[j] ? 0 : 1)));
      }
      row = next;
    }
    return row[right.length];
  };
  const inputs = new Set(['zzz', 'x'.repeat(LIMITS.input), '__proto__', 'constructor', 'cta', 'Help']);
  for (const command of COMMANDS) {
    for (let index = 0; index <= command.length; index++) {
      inputs.add(command.slice(0, index) + command.slice(index + 1));
      for (const character of ['a', 'c', 'x']) {
        inputs.add(command.slice(0, index) + character + command.slice(index));
        inputs.add(command.slice(0, index) + character + command.slice(index + 1));
      }
    }
  }
  for (const input of inputs) {
    if (!input || COMMANDS.includes(input)) continue;
    const matches = COMMANDS.filter(command => distance(input, command) <= 1);
    const result = read(input);
    assert.equal(result.kind, 'error');
    assert.deepEqual(result.suggestions, matches.length ? matches : ['help'], input);
    assert.equal(result.hint.startsWith('Did you mean'), matches.length > 0, input);
  }
});

test('error recovery actions cannot carry hostile raw command or path content', () => {
  for (const raw of ['cat <img/src=x/onerror=alert(1)>', 'cd /__proto__/constructor', 'open javascript:alert(1)', 'pwd\u202e', 'x'.repeat(501)]) {
    const result = read(raw);
    assert.equal(result.kind, 'error');
    for (const suggestion of result.suggestions) {
      const [command, path] = suggestion.split(' ');
      assert.ok(COMMANDS.includes(command));
      if (path) assert.ok(Object.hasOwn(FILES, path));
      assert.ok(!/[<>\u202e]/u.test(suggestion));
    }
  }
});

test('fresh sessions read the generated source immediately without mutable source state', () => {
  const session = new Session();
  assert.equal(Object.hasOwn(session, 'readme'), false);
  assert.equal(session.submit('cat README.md').source, README);
  assert.equal(session.submit('open README.md').source, README);
  assert.equal(session.submit('ls').kind, 'list');
  assert.equal(session.cwd, '/');
});

test('a session stores only trimmed nonempty valid command text in history', () => {
  const session = new Session();
  for (const raw of ['  pwd  ', 'not-a-command', '', '  ', 'pwd\u0000', 'x'.repeat(LIMITS.input + 1), null]) session.submit(raw);
  assert.deepEqual(session.history, ['pwd', 'not-a-command']);
  assert.equal(session.cursor, session.history.length);
  assert.equal(Object.hasOwn(session, 'readme'), false);
});

test('history remains bounded across repeated submissions, including errors', () => {
  const session = new Session();
  const commands = Array.from({length: LIMITS.history * 20}, (_, index) => `unknown-${index}`);
  for (const command of commands) session.submit(command);
  assert.deepEqual(session.history, commands.slice(-LIMITS.history));
  assert.equal(session.cursor, LIMITS.history);
});

test('clear preserves source and history; history includes its own command', () => {
  const session = new Session();
  session.submit('cat README.md');
  assert.equal(session.submit('clear').kind, 'clear');
  assert.equal(session.cwd, '/');
  assert.equal(Object.hasOwn(session, 'readme'), false);
  assert.deepEqual(session.submit('history').entries, ['cat README.md', 'clear', 'history']);
});

test('empty history recall preserves the current draft', () => {
  const session = new Session();
  assert.equal(session.recall(-1, 'open R'), 'open R');
  assert.equal(session.recall(1, 'open R'), 'open R');
});

test('history recall clamps at both ends and restores the unfinished draft', () => {
  const session = new Session();
  session.submit('help');
  session.submit('ls /');
  assert.equal(session.recall(-1, 'open R'), 'ls /');
  assert.equal(session.recall(-1, 'ls /'), 'help');
  assert.equal(session.recall(-1, 'help'), 'help');
  assert.equal(session.recall(1, 'help'), 'ls /');
  assert.equal(session.recall(1, 'ls /'), 'open R');
  assert.equal(session.recall(1, 'open R'), 'open R');
});

test('submitting a recalled command resets the cursor and saved draft', () => {
  const session = new Session();
  session.submit('pwd');
  session.submit('help');
  session.recall(-1, 'unfinished');
  session.submit('help');
  assert.equal(session.cursor, session.history.length);
  assert.equal(session.draft, '');
  assert.equal(session.recall(-1, 'new draft'), 'help');
  assert.equal(session.recall(1, 'help'), 'new draft');
});

test('sessions never share history or draft state and use the same canonical source', () => {
  const first = new Session();
  const second = new Session();
  first.submit('cat README.md');
  first.recall(-1, 'draft');
  assert.deepEqual(second.history, []);
  assert.equal(second.draft, '');
  assert.equal(second.cursor, 0);
  assert.equal(Object.hasOwn(first, 'readme'), false);
  assert.equal(Object.hasOwn(second, 'readme'), false);
  assert.equal(first.submit('cat README.md').source, README);
  assert.equal(second.submit('cat README.md').source, README);
});
