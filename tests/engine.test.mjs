import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';

// ENGINE_PATH lets the same suite check an untouched snapshot for comparison.
const moduleURL = process.env.ENGINE_PATH
  ? pathToFileURL(process.env.ENGINE_PATH)
  : new URL('../engine.js', import.meta.url);
const {COMMANDS, FILES, LIMITS, Session, completions, execute, list, resolvePath} = await import(moduleURL.href);

test('command names and resource limits are explicit and immutable', () => {
  assert.deepEqual(COMMANDS, ['help', 'ls', 'open', 'cat', 'cd', 'pwd', 'clear', 'history']);
  assert.deepEqual(LIMITS, {input: 500, history: 50, output: 40});
  assert.ok(Object.isFrozen(COMMANDS));
  assert.ok(Object.isFrozen(LIMITS));
  assert.ok(Object.isFrozen(FILES));
});

test('path normalization supports absolute, relative, home, and dot segments', () => {
  const cases = [
    [undefined, '/', '/'], ['', '/writing', '/writing'], ['.', '/writing', '/writing'],
    ['sample', '/writing', '/writing/sample'], ['/about', '/writing', '/about'],
    ['~', '/writing', '/'], ['~/work', '/writing', '/work'],
    ['../work/readme', '/writing', '/work/readme'],
    ['../../../../about', '/writing', '/about'],
    ['/writing//./sample/', '/', '/writing/sample'],
    ['/writing/../work/./readme', '/', '/work/readme'],
  ];
  for (const [raw, cwd, expected] of cases) {
    assert.equal(resolvePath(raw, cwd), expected, `${raw} from ${cwd}`);
  }
});

test('normalization is idempotent and cannot traverse above the virtual root', () => {
  for (const path of Object.keys(FILES)) {
    assert.equal(resolvePath(resolvePath(path)), path);
    assert.equal(resolvePath(`../../../../${path}`), path);
  }
});

test('list returns direct children only, in authored order', () => {
  assert.deepEqual(list('/'), ['/about', '/work', '/writing', '/contact']);
  assert.deepEqual(list('/work'), ['/work/readme']);
  assert.deepEqual(list('/writing'), ['/writing/sample']);
  assert.deepEqual(list('/about'), []);
  assert.deepEqual(list('/missing'), []);
});

test('list results cannot be used to mutate subsequent directory listings', () => {
  const entries = list('/');
  // A fresh mutable array or a frozen shared array is a valid implementation.
  if (!Object.isFrozen(entries)) entries.length = 0;
  assert.deepEqual(list('/'), ['/about', '/work', '/writing', '/contact']);
});

test('empty input does not execute a command', () => {
  for (const value of ['', ' ', '\t  ']) {
    assert.deepEqual(execute(value, '/writing'), {cwd: '/writing', kind: 'empty'});
  }
});

test('help and clear return structured actions without changing directory', () => {
  assert.deepEqual(execute('help', '/work'), {cwd: '/work', kind: 'help'});
  assert.deepEqual(execute('clear', '/work'), {cwd: '/work', kind: 'clear'});
});

test('pwd reports the current virtual directory', () => {
  assert.deepEqual(execute('pwd', '/writing'), {cwd: '/writing', kind: 'text', message: '/writing'});
});

test('invalid or non-directory current paths are reset to root', () => {
  for (const cwd of ['/missing', '/about', '__proto__', 'constructor']) {
    assert.deepEqual(execute('pwd', cwd), {cwd: '/', kind: 'text', message: '/'});
  }
});

test('ls defaults to the current directory and can list a file', () => {
  assert.deepEqual(execute('ls', '/writing'), {
    cwd: '/writing', kind: 'list', path: '/writing', entries: ['/writing/sample'],
  });
  assert.deepEqual(execute('ls /about', '/writing'), {
    cwd: '/writing', kind: 'list', path: '/writing', entries: ['/about'],
  });
});

test('open reads files and browses directories without changing cwd', () => {
  const file = execute('open /writing/sample', '/work');
  assert.equal(file.kind, 'file');
  assert.equal(file.cwd, '/work');
  assert.equal(file.path, '/writing/sample');
  assert.deepEqual(file.entry, FILES['/writing/sample']);
  assert.deepEqual(execute('open /writing', '/work'), {
    cwd: '/work', kind: 'list', path: '/writing', entries: ['/writing/sample'],
  });
});

test('cd changes directory, supports relative paths, and defaults to home', () => {
  assert.deepEqual(execute('cd writing'), {cwd: '/writing', kind: 'location'});
  assert.deepEqual(execute('cd ../work', '/writing'), {cwd: '/work', kind: 'location'});
  assert.deepEqual(execute('cd', '/writing'), {cwd: '/', kind: 'location'});
  assert.deepEqual(execute('cd ~', '/writing'), {cwd: '/', kind: 'location'});
});

test('cd rejects files without changing cwd and gives useful recovery guidance', () => {
  const result = execute('cd /about', '/writing');
  assert.equal(result.kind, 'error');
  assert.equal(result.cwd, '/writing');
  assert.equal(result.message, 'Not a directory: /about');
  assert.equal(result.hint, 'Use open /about or cat /about to read this file.');
  assert.deepEqual(result.suggestions, ['open /about', 'cat /about']);
});

test('missing paths and unsupported commands fail without changing cwd', () => {
  for (const command of ['ls /missing', 'open /missing', 'cd /missing', 'sudo', 'HELP']) {
    const result = execute(command, '/writing');
    assert.equal(result.kind, 'error', command);
    assert.equal(result.cwd, '/writing', command);
    assert.ok(result.message);
    assert.ok(result.hint);
  }
});

test('commands reject extra arguments instead of silently ignoring them', () => {
  for (const command of COMMANDS) {
    assert.equal(execute(`${command} /work /writing`).kind, 'error', command);
  }
  for (const command of ['help', 'pwd', 'clear', 'history']) {
    assert.equal(execute(`${command} /work`).kind, 'error', command);
  }
});

test('surrounding whitespace and tab-separated arguments are accepted', () => {
  assert.deepEqual(execute('  cd\t/work  '), {cwd: '/work', kind: 'location'});
});

test('history results are capped and isolated from the caller array', () => {
  const history = Array.from({length: LIMITS.history + 10}, (_, index) => `pwd ${index}`);
  const result = execute('history', '/', history);
  assert.equal(result.kind, 'history');
  assert.deepEqual(result.entries, history.slice(-LIMITS.history));
  result.entries.pop();
  assert.equal(history.length, LIMITS.history + 10);
});

test('oversized, non-string, control-character, and bidi input is rejected', () => {
  const inputs = [null, undefined, 1, {}, [], 'x'.repeat(LIMITS.input + 1)];
  for (const code of [0, 1, 8, 11, 12, 13, 27, 31, 127, 0x202a, 0x202e, 0x2066, 0x2069]) {
    inputs.push(`pwd${String.fromCodePoint(code)}`);
  }
  for (const input of inputs) {
    const result = execute(input, '/work');
    assert.equal(result.kind, 'error');
    assert.equal(result.cwd, '/work');
    assert.deepEqual(completions(input), []);
  }
});

test('length limit accepts exactly the boundary and rejects the next character', () => {
  const boundary = 'pwd' + ' '.repeat(LIMITS.input - 3);
  assert.equal(execute(boundary).kind, 'text');
  assert.equal(execute(`${boundary} `).kind, 'error');
});

test('shell syntax, HTML, URL schemes, and prototype names never execute', () => {
  const payloads = [
    '<img/src=x/onerror=alert(1)>', '<script>alert(1)</script>',
    'javascript:alert(1)', 'https://example.invalid/',
    'pwd;alert(1)', 'pwd&&ls', '$(pwd)', '`pwd`', '__proto__', 'constructor',
  ];
  for (const payload of payloads) {
    assert.equal(execute(payload).kind, 'error', payload);
    assert.deepEqual(completions(payload), [], payload);
  }
  assert.equal(execute('<img/src=x/onerror=alert(1)>').message,
    'Unknown command: <img/src=x/onerror=alert(1)>');
  for (const path of ['/__proto__', '/constructor', '/toString', '/../../../etc/passwd']) {
    assert.equal(execute(`open ${path}`).kind, 'error', path);
  }
});

test('command completions append a space only for path-accepting commands', () => {
  assert.deepEqual(completions(''), ['help', 'ls ', 'open ', 'cat ', 'cd ', 'pwd', 'clear', 'history']);
  assert.deepEqual(completions('h'), ['help', 'history']);
  assert.deepEqual(completions('op'), ['open ']);
  assert.deepEqual(completions('  pw'), ['pwd']);
  assert.deepEqual(completions('pwd'), ['pwd']);
  assert.deepEqual(completions('unknown'), []);
});

test('path completion respects directory context and prefixes', () => {
  assert.deepEqual(completions('open s', '/writing'), ['open sample']);
  assert.deepEqual(completions('open /w'), ['open /work/', 'open /writing/']);
  assert.deepEqual(completions('open /writing/s'), ['open /writing/sample']);
  assert.deepEqual(completions('open ~/w'), ['open ~/work/', 'open ~/writing/']);
  assert.deepEqual(completions('open ../w', '/writing'), ['open ../work/', 'open ../writing/']);
  assert.deepEqual(completions('ls /about'), ['ls /about']);
});

test('cd completes directories only while open and ls also complete files', () => {
  assert.deepEqual(completions('cd '), ['cd work/', 'cd writing/']);
  assert.deepEqual(completions('cd /a'), []);
  assert.deepEqual(completions('cd /writing/'), []);
  assert.deepEqual(completions('open /writing/'), ['open /writing/sample']);
  assert.deepEqual(completions('ls /writing/'), ['ls /writing/sample']);
});

test('completion does not invent paths or accept extra arguments', () => {
  for (const input of ['open /missing/', 'open /no-match', 'open /work extra', 'pwd ', 'help ', 'clear ']) {
    assert.deepEqual(completions(input), [], input);
  }
});

test('session state follows command results and failures preserve cwd', () => {
  const session = new Session();
  assert.equal(session.cwd, '/');
  session.submit('cd writing');
  assert.equal(session.cwd, '/writing');
  assert.equal(session.submit('open sample').kind, 'file');
  assert.equal(session.cwd, '/writing');
  assert.equal(session.submit('cd sample').kind, 'error');
  assert.equal(session.cwd, '/writing');
  session.submit('cd');
  assert.equal(session.cwd, '/');
});

test('history stores trimmed nonempty valid input, including ordinary command errors', () => {
  const session = new Session();
  for (const raw of ['  pwd  ', 'not-a-command', '', '  ', 'pwd\u0000', 'x'.repeat(LIMITS.input + 1), null]) {
    session.submit(raw);
  }
  assert.deepEqual(session.history, ['pwd', 'not-a-command']);
  assert.equal(session.cursor, session.history.length);
});

test('history remains bounded over repeated submissions', () => {
  const session = new Session();
  const commands = Array.from({length: LIMITS.history * 20}, (_, index) => `unknown-${index}`);
  for (const command of commands) session.submit(command);
  assert.deepEqual(session.history, commands.slice(-LIMITS.history));
  assert.equal(session.cursor, LIMITS.history);
});

test('clear preserves history and location; history includes its own command', () => {
  const session = new Session();
  session.submit('cd writing');
  assert.equal(session.submit('clear').kind, 'clear');
  assert.equal(session.cwd, '/writing');
  assert.deepEqual(session.history, ['cd writing', 'clear']);
  assert.deepEqual(session.submit('history').entries, ['cd writing', 'clear', 'history']);
});

test('empty history recall preserves the current draft', () => {
  const session = new Session();
  assert.equal(session.recall(-1, 'open /'), 'open /');
  assert.equal(session.recall(1, 'open /'), 'open /');
});

test('history recall clamps at both ends and restores the unfinished draft', () => {
  const session = new Session();
  session.submit('help');
  session.submit('ls /');
  assert.equal(session.recall(-1, 'open /w'), 'ls /');
  assert.equal(session.recall(-1, 'ls /'), 'help');
  assert.equal(session.recall(-1, 'help'), 'help');
  assert.equal(session.recall(1, 'help'), 'ls /');
  assert.equal(session.recall(1, 'ls /'), 'open /w');
  assert.equal(session.recall(1, 'open /w'), 'open /w');
});

test('submitting a recalled command resets the history cursor and saved draft', () => {
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

test('independent sessions never share cwd, history, or drafts', () => {
  const first = new Session();
  const second = new Session();
  first.submit('cd writing');
  first.recall(-1, 'draft');
  assert.equal(second.cwd, '/');
  assert.deepEqual(second.history, []);
  assert.equal(second.draft, '');
  assert.equal(second.cursor, 0);
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
    const value = `pwd${String.fromCodePoint(code)}`;
    const result = session.submit(value);
    assert.equal(result.kind, 'error', `U+${code.toString(16)}`);
    assert.equal(result.invalidInput, true, `U+${code.toString(16)}`);
    assert.deepEqual(completions(value), [], `U+${code.toString(16)}`);
  }
  assert.deepEqual(session.history, []);
  assert.equal(execute('cd\t/work').kind, 'location');
});

test('cat returns a distinct text-dump action with the exact file content', () => {
  for (const [path, entry] of Object.entries(FILES)) {
    if (entry.type !== 'file') continue;
    const result = execute(`cat ${path}`, '/work');
    assert.deepEqual(result, {cwd: '/work', kind: 'cat', path, entry});
    assert.deepEqual(result.entry.lines, entry.lines);
    assert.equal(execute(`open ${path}`, '/work').kind, 'file');
  }
  assert.deepEqual(execute('cat sample', '/writing'), {
    cwd: '/writing', kind: 'cat', path: '/writing/sample', entry: FILES['/writing/sample'],
  });
  assert.equal(execute('cat ~/work/readme', '/writing').path, '/work/readme');
});

test('cat requires exactly one path and offers a current-directory listing', () => {
  for (const command of ['cat', 'cat /about /contact', 'cat -n /about', 'cat /about | pwd']) {
    const result = execute(command, '/writing');
    assert.equal(result.kind, 'error', command);
    assert.equal(result.cwd, '/writing', command);
    assert.equal(result.message, 'Usage: cat path', command);
    assert.deepEqual(result.suggestions, ['ls /writing'], command);
    assert.match(result.hint, /Flags, pipes, and multiple paths are not supported/);
  }
});

test('cat rejects directories and offers exact canonical browse commands', () => {
  for (const input of ['cat /work', 'cat ../work/', 'cat ~/work']) {
    const result = execute(input, '/writing');
    assert.equal(result.kind, 'error');
    assert.equal(result.cwd, '/writing');
    assert.equal(result.message, 'Is a directory: /work');
    assert.deepEqual(result.suggestions, ['open /work', 'ls /work']);
    assert.match(result.hint, /browse/);
  }
  assert.deepEqual(execute('cat /').suggestions, ['open /', 'ls /']);
});

test('cat completion supports intermediate directories without treating them as readable files', () => {
  assert.deepEqual(completions('ca'), ['cat ']);
  assert.deepEqual(completions('cat /w'), ['cat /work/', 'cat /writing/']);
  assert.deepEqual(completions('cat /work/'), ['cat /work/readme']);
  assert.deepEqual(completions('cat s', '/writing'), ['cat sample']);
  assert.deepEqual(completions('cat ../work/r', '/writing'), ['cat ../work/readme']);
  assert.deepEqual(completions('cat ~/w'), ['cat ~/work/', 'cat ~/writing/']);
  assert.deepEqual(completions('cat /about'), ['cat /about']);
  assert.deepEqual(completions('cat /about extra'), []);
  assert.equal(execute(completions('cat /work/')[0]).kind, 'cat');
  assert.equal(execute(completions('cat /w')[0]).kind, 'error');
});

test('missing paths recover at the nearest existing directory, not an unrelated cwd', () => {
  const cases = [
    ['open missing', '/writing', 'ls /writing'],
    ['cat /work/missing', '/writing', 'ls /work'],
    ['ls /work/readme/missing', '/writing', 'ls /work'],
    ['cd /work/unknown/deeper', '/', 'ls /work'],
    ['cat ../about/missing', '/writing', 'ls /'],
    ['open /unknown/deeper', '/writing', 'ls /'],
    ['open ../../outside', '/work', 'ls /'],
  ];
  for (const [command, cwd, browse] of cases) {
    const result = execute(command, cwd);
    assert.equal(result.kind, 'error', command);
    assert.equal(result.cwd, cwd, command);
    assert.deepEqual(result.suggestions, [browse], command);
    assert.equal(result.hint, `Use ${browse} to see available paths.`, command);
    assert.equal(execute(browse, cwd).kind, 'list', command);
  }
});

test('argument-error guidance is specific and recovery actions remain explicit', () => {
  const noArgs = execute('pwd extra', '/writing');
  assert.equal(noArgs.hint, 'pwd does not take arguments.');
  assert.deepEqual(noArgs.suggestions, ['pwd']);
  const paths = execute('open /about /contact', '/work');
  assert.equal(paths.message, 'Usage: open [path]');
  assert.deepEqual(paths.suggestions, ['ls /work']);
});

test('unknown commands suggest allowlisted one-edit matches without running or copying arguments', () => {
  for (const [input, expected] of [
    ['hel', ['help']], ['helpp', ['help']], ['heop', ['help']],
    ['car', ['cat']], ['cdd /writing', ['cd']], ['ld', ['ls', 'cd']],
  ]) {
    const result = execute(input, '/work');
    assert.equal(result.kind, 'error', input);
    assert.equal(result.cwd, '/work', input);
    assert.deepEqual(result.suggestions, expected, input);
    assert.equal(result.hint, `Did you mean ${expected.join(' or ')}?`, input);
  }
  const unknown = execute('completely-unknown');
  assert.deepEqual(unknown.suggestions, ['help']);
  assert.equal(unknown.hint, 'Type help to see available commands.');
});

test('command suggestions agree with an independent edit-distance reference', () => {
  // Full dynamic programming is a validation oracle, not the production shortcut.
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
    const result = execute(input);
    assert.equal(result.kind, 'error', input);
    assert.deepEqual(result.suggestions, matches.length ? matches : ['help'], input);
    assert.equal(result.hint.startsWith('Did you mean'), matches.length > 0, input);
  }
});

test('error suggestions cannot carry hostile raw path or command input', () => {
  for (const raw of ['cat <img/src=x/onerror=alert(1)>', 'cd /__proto__/constructor', 'open javascript:alert(1)', 'pwd\u202e', 'x'.repeat(501)]) {
    const result = execute(raw, '/writing');
    assert.equal(result.kind, 'error');
    assert.ok(result.suggestions.length > 0);
    for (const suggestion of result.suggestions) {
      const [command, path] = suggestion.split(' ');
      assert.ok(COMMANDS.includes(command), raw);
      if (path) assert.ok(Object.hasOwn(FILES, path), raw);
      assert.ok(!/[<>\u202e]/u.test(suggestion), raw);
    }
  }
});

test('cat and recovery errors retain history bounds and preserve the working directory', () => {
  const session = new Session();
  session.submit('cd writing');
  assert.equal(session.submit('cat sample').kind, 'cat');
  assert.equal(session.submit('cat .').kind, 'error');
  assert.equal(session.submit('cdd /work').kind, 'error');
  assert.equal(session.cwd, '/writing');
  assert.deepEqual(session.history, ['cd writing', 'cat sample', 'cat .', 'cdd /work']);
});
