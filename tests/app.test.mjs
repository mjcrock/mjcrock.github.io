import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {markdownBlocks} from '../markdown.js';
import {createApp} from './helpers/dom.mjs';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

const renderedText = markdownBlocks(readme).flatMap(block => block.parts.map(part => part.text)).join('');

// These deterministic DOM-model tests do not replace real-browser QA.
const ready = async options => {
  const app = await createApp(options);
  app.flushFrame();
  app.resetMetrics();
  return app;
};
const button = (app, id) => app.document.getElementById(id);

test('startup renders canonical README passively without fake commands, history, or autofocus', async () => {
  const app = await ready();
  assert.equal(app.output.children.length, 1);
  assert.equal(app.output.querySelector('.echo'), null);
  assert.equal(app.output.firstElementChild.textContent, renderedText);
  assert.deepEqual(app.output.querySelectorAll('a').map(node => ({text: node.textContent, href: node.href})),
    markdownBlocks(readme).flatMap(block => block.parts.filter(part => 'href' in part)));
  assert.equal(app.document.activeElement, app.document.body);
  assert.equal(app.metrics.focusCalls.length, 0);
  assert.equal(app.suggestions.hidden, true);
  assert.equal(app.shortcuts.length, 0);
  app.change('draft');
  app.key('ArrowUp');
  assert.equal(app.input.value, 'draft');
  app.submit('history');
  assert.deepEqual(app.output.lastElementChild.querySelectorAll('button').map(node => node.textContent), ['history']);
});

test('typed submission prevents navigation, retains the root prompt, and returns focus to input', async () => {
  const app = await ready();
  assert.equal(app.submit('cd /').defaultPrevented, true);
  assert.equal(app.input.value, '');
  assert.equal(app.prompt.textContent, 'guest:~ $');
  assert.match(app.output.lastElementChild.textContent, /guest:~ \$ cd \//);
  assert.equal(app.document.activeElement, app.input);
  assert.equal(app.metrics.focusCalls.at(-1).options.preventScroll, true);
  assert.equal(app.announcement.textContent, 'Command complete.');
  assert.equal(app.output.lastElementChild.tabIndex, -1);
});

test('empty submissions leave output and focus unchanged', async () => {
  const app = await ready();
  const welcome = app.output.firstElementChild;
  app.submit('   ');
  assert.equal(app.output.children.length, 1);
  assert.equal(app.output.firstElementChild, welcome);
  assert.equal(app.pendingFrames, 0);
  assert.equal(app.metrics.focusCalls.length, 0);
});

test('delegated listing clicks on nested content focus the document, not the input', async () => {
  const app = await ready();
  app.submit('ls /');
  app.resetMetrics();
  const file = app.output.lastElementChild.querySelector('button');
  const nested = app.document.createElement('span');
  file.append(nested);
  app.click(nested);
  const result = app.output.lastElementChild;
  assert.equal(result.getAttribute('aria-label'), 'README.md');
  assert.equal(app.document.activeElement, result);
  assert.ok(app.metrics.focusCalls.every(call => call.node !== app.input));
  assert.ok(result.textContent.includes(renderedText));
  assert.equal(app.announcement.textContent, 'Opened README.md.');
  assert.equal(app.location.hash, '#/README.md');
});

test('dynamic listing and help controls use the same delegated command handler', async () => {
  const app = await ready();
  app.submit('open /');
  const listingButton = app.output.lastElementChild.querySelectorAll('button').find(node => node.dataset.command === 'open /README.md');
  assert.ok(listingButton);
  app.click(listingButton);
  assert.equal(app.location.hash, '#/README.md');
  app.submit('help');
  const commands = app.output.lastElementChild.querySelectorAll('button');
  assert.ok(commands.length);
  assert.ok(commands.every(node => !/writing|sample|about|contact|work/.test(node.dataset.command)));
  const helpButton = commands.find(node => node.dataset.command === 'cat README.md');
  assert.ok(helpButton);
  app.click(helpButton);
  assert.equal(app.output.lastElementChild.querySelector('pre').textContent, readme);
});

test('delegation ignores non-buttons, unrelated buttons, and foreign button targets', async () => {
  const app = await ready();
  const count = app.output.children.length;
  app.click(app.terminal);
  app.click(app.runButton); // Browser form submission is a separate default action.
  const foreign = app.document.createElement('button');
  foreign.dataset.command = 'help';
  app.dispatch(app.terminal, 'click', {target: foreign});
  assert.equal(app.output.children.length, count);
});

test('rendered history recalls text without executing and nested targets work', async () => {
  const app = await ready();
  app.submit('pwd');
  app.submit('history');
  const count = app.output.children.length;
  const recallButton = app.output.lastElementChild.querySelector('button');
  const nested = app.document.createElement('span');
  recallButton.append(nested);
  app.click(nested);
  assert.equal(app.input.value, 'pwd');
  assert.equal(app.output.children.length, count);
  assert.equal(app.document.activeElement, app.input);
  assert.equal(app.suggestions.hidden, true);
});

test('arrow history and toolbar controls restore an unfinished draft', async () => {
  const app = await ready();
  app.submit('pwd');
  app.submit('help');
  app.change('open /R');
  assert.equal(app.key('ArrowUp').defaultPrevented, true);
  assert.equal(app.input.value, 'help');
  assert.equal(app.input.selectionStart, 4);
  assert.equal(app.input.selectionEnd, 4);
  app.click(button(app, 'previous'));
  assert.equal(app.input.value, 'pwd');
  app.click(button(app, 'next'));
  assert.equal(app.input.value, 'help');
  app.key('ArrowDown');
  assert.equal(app.input.value, 'open /R');
});

test('unique Tab completion fills input without opening a panel and announces the result', async () => {
  const app = await ready();
  for (const [typed, completed] of [['op', 'open '], ['cat R', 'cat README.md']]) {
    app.change(typed);
    assert.equal(app.key('Tab').defaultPrevented, true);
    assert.equal(app.input.value, completed);
    assert.equal(app.suggestions.hidden, true);
    assert.equal(app.completionPanel.hidden, true);
    assert.equal(app.completionStatus.textContent, '');
    assert.ok(app.announcement.textContent.startsWith(`Completed: ${completed.trimEnd()}.`));
    assert.equal(app.input.getAttribute('aria-expanded'), 'false');
    assert.equal(app.key('Tab').defaultPrevented, false);
    assert.equal(app.input.value, completed);
    assert.equal(app.completionPanel.hidden, true);
  }
  for (const command of ['pwd', 'cat README.md']) {
    app.change(command);
    assert.equal(app.key('Tab').defaultPrevented, false);
    assert.equal(app.input.value, command);
    assert.equal(app.completionPanel.hidden, true);
    assert.equal(app.completionStatus.textContent, '');
    assert.match(app.announcement.textContent, /Already complete/);
  }
});

test('no-match completion is visible without trapping Tab or modifying the command', async () => {
  const app = await ready();
  app.change('unmatched');
  const count = app.output.children.length;
  assert.equal(app.key('Tab').defaultPrevented, false);
  assert.equal(app.input.value, 'unmatched');
  assert.equal(app.completionPanel.hidden, false);
  assert.equal(app.suggestions.hidden, true);
  assert.match(app.completionStatus.textContent, /No matching completion/);
  assert.match(app.announcement.textContent, /No matching completion/);
  assert.equal(app.output.children.length, count);
});

test('multiple options have coherent combobox selection and a native Tab exit', async () => {
  const app = await ready();
  app.change('h');
  assert.equal(app.key('Tab').defaultPrevented, true);
  assert.equal(app.suggestions.hidden, false);
  assert.equal(app.suggestions.children.length, 2);
  assert.equal(app.input.getAttribute('aria-controls'), 'completions');
  assert.equal(app.input.getAttribute('aria-expanded'), 'true');
  const first = app.suggestions.firstElementChild;
  assert.equal(first.getAttribute('role'), 'option');
  assert.equal(first.tabIndex, -1);
  assert.equal(first.getAttribute('aria-selected'), 'true');
  assert.equal(app.input.getAttribute('aria-activedescendant'), first.id);
  assert.equal(app.key('Tab').defaultPrevented, false);
  assert.equal(app.input.value, 'h');
  assert.equal(app.suggestions.hidden, true);
  assert.equal(app.input.getAttribute('aria-expanded'), 'false');
  assert.equal(app.input.getAttribute('aria-activedescendant'), null);
});

test('arrows select options and Enter accepts without executing or recalling history', async () => {
  const app = await ready();
  app.submit('pwd');
  app.change('h');
  app.key('Tab');
  const count = app.output.children.length;
  assert.equal(app.key('ArrowDown').defaultPrevented, true);
  assert.equal(app.input.value, 'h');
  const selected = app.document.getElementById(app.input.getAttribute('aria-activedescendant'));
  assert.equal(selected.textContent, 'history');
  assert.equal(selected.getAttribute('aria-selected'), 'true');
  assert.equal(app.suggestions.firstElementChild.getAttribute('aria-selected'), 'false');
  assert.equal(app.key('Enter').defaultPrevented, true);
  assert.equal(app.input.value, 'history');
  assert.equal(app.output.children.length, count);
  assert.equal(app.suggestions.hidden, true);
  assert.equal(app.input.getAttribute('aria-activedescendant'), null);
  // Native implicit form submission is outside this fixture: model its next submit.
  assert.equal(app.key('Enter').defaultPrevented, false);
  app.submit(app.input.value);
  assert.equal(app.output.lastElementChild.querySelectorAll('li').length, 2);
  assert.match(app.output.lastElementChild.textContent, /pwd/);
});

test('the Run control executes literal input rather than accepting a guessed option', async () => {
  const app = await ready();
  app.change('h');
  app.key('Tab');
  const count = app.output.children.length;
  assert.equal(app.dispatch(app.form, 'submit').defaultPrevented, true);
  assert.equal(app.input.value, '');
  assert.equal(app.output.children.length, count + 1);
  assert.match(app.output.lastElementChild.textContent, /Unknown command: h/);
  assert.equal(app.suggestions.hidden, true);
});

test('nested completion clicks fill only and preserve trailing spaces', async () => {
  const app = await ready();
  app.click(button(app, 'complete'));
  assert.equal(app.suggestions.hidden, false);
  assert.equal(app.suggestions.children.length, 8);
  const count = app.output.children.length;
  const open = app.suggestions.children.find(node => node.textContent === 'open');
  const nested = app.document.createElement('span');
  open.append(nested);
  app.click(nested);
  assert.equal(app.input.value, 'open ');
  assert.equal(app.output.children.length, count);
  assert.equal(app.document.activeElement, app.input);
  assert.equal(app.suggestions.hidden, true);
  assert.equal(app.key('Tab').defaultPrevented, false);
});

test('editing or Escape dismisses choices while preserving the typed draft', async () => {
  const app = await ready();
  app.change('h');
  app.key('Tab');
  app.change('he');
  assert.equal(app.suggestions.hidden, true);
  assert.equal(app.input.getAttribute('aria-expanded'), 'false');
  app.change('h');
  app.key('Tab');
  assert.equal(app.key('Escape').defaultPrevented, true);
  assert.equal(app.input.value, 'h');
  assert.equal(app.suggestions.hidden, true);
  assert.equal(app.suggestions.children.length, 0);
  assert.equal(app.key('Escape').defaultPrevented, false);
  assert.equal(app.input.value, 'h');
});

test('Escape from a completion choice dismisses it and returns to the unchanged input', async () => {
  const app = await ready();
  app.change('h');
  app.key('Tab');
  const choice = app.suggestions.firstElementChild;
  choice.focus();
  assert.equal(app.key('Escape', {}, choice).defaultPrevented, true);
  assert.equal(app.document.activeElement, app.input);
  assert.equal(app.input.value, 'h');
  assert.equal(app.suggestions.hidden, true);
});

test('modified and composing option keys leave choices, input, and focus untouched', async () => {
  const app = await ready();
  app.change('h');
  app.key('Tab');
  const choice = app.suggestions.firstElementChild;
  choice.focus();
  const selected = app.input.getAttribute('aria-activedescendant');
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']) {
    for (const key of ['Escape', 'ArrowUp', 'ArrowDown', 'Enter']) {
      const event = app.key(key, {[modifier]: true}, choice);
      assert.equal(event.defaultPrevented, false, `${modifier} ${key}`);
      assert.equal(app.suggestions.hidden, false, `${modifier} ${key}`);
      assert.equal(app.document.activeElement, choice, `${modifier} ${key}`);
      assert.equal(app.input.value, 'h', `${modifier} ${key}`);
      assert.equal(app.input.getAttribute('aria-activedescendant'), selected);
    }
  }
});

test('input modifiers and IME do not alter completion selection or drafts', async () => {
  const app = await ready();
  app.submit('pwd');
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']) {
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', 'Escape']) {
      app.change('h');
      app.key('Tab');
      const selected = app.input.getAttribute('aria-activedescendant');
      assert.equal(app.key(key, {[modifier]: true}).defaultPrevented, false, `${modifier} ${key}`);
      assert.equal(app.input.value, 'h', `${modifier} ${key}`);
      assert.equal(app.suggestions.hidden, false, `${modifier} ${key}`);
      assert.equal(app.input.getAttribute('aria-activedescendant'), selected);
    }
  }
});

test('normal Shift-Tab exits, but modified or composing Shift-Tab remains untouched', async () => {
  const app = await ready();
  app.change('h');
  app.key('Tab');
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'isComposing']) {
    assert.equal(app.key('Tab', {shiftKey: true, [modifier]: true}).defaultPrevented, false);
    assert.equal(app.suggestions.hidden, false, modifier);
    assert.equal(app.input.value, 'h');
  }
  assert.equal(app.key('Tab', {shiftKey: true}).defaultPrevented, false);
  assert.equal(app.suggestions.hidden, true);
  assert.equal(app.input.value, 'h');
  app.change('');
  assert.equal(app.key('Tab').defaultPrevented, false);
  assert.equal(app.suggestions.hidden, true);
});

test('200 commands retain 40 blocks, add no listeners, and reveal each result immediately', async () => {
  const app = await ready();
  const initialListeners = app.metrics.listeners;
  for (let index = 0; index < 200; index++) {
    app.submit('ls /');
    const expectedTop = Math.max(0, app.output.lastElementChild._offsetTop - app.screen._offsetTop - 12);
    assert.equal(app.screen.scrollTop, expectedTop);
  }
  assert.equal(app.output.children.length, 40);
  assert.equal(app.metrics.listeners, initialListeners);
  assert.equal(app.metrics.geometryReads, 400);
  assert.equal(app.metrics.scrollWrites, 200);
  const position = app.screen.scrollTop;
  app.flushFrame();
  assert.equal(app.screen.scrollTop, position);
  assert.equal(app.metrics.scrollWrites, 200);
});

test('a user scroll after a result is not overwritten by later animation frames', async () => {
  const app = await ready();
  app.submit('help');
  assert.ok(app.screen.scrollTop > 0);
  app.screen.scrollTop = 47;
  app.dispatch(app.screen, 'scroll');
  app.flushFrame();
  assert.equal(app.screen.scrollTop, 47);
  app.flushFrame();
  assert.equal(app.screen.scrollTop, 47);
});

test('clear removes output immediately and later frames cannot restore an old scroll position', async () => {
  const app = await ready();
  app.submit('help');
  const removed = app.output.lastElementChild;
  app.resetMetrics();
  app.submit('clear');
  assert.equal(removed.isConnected, false);
  assert.equal(app.output.children.length, 0);
  assert.equal(app.screen.scrollTop, 0);
  assert.equal(app.announcement.textContent, 'Output cleared.');
  app.flushFrame();
  assert.equal(app.screen.scrollTop, 0);
  assert.equal(app.metrics.geometryReads, 0);
  assert.equal(app.metrics.scrollWrites, 1);
  app.key('ArrowUp');
  assert.equal(app.input.value, 'clear');
});

test('a command after clear reveals its own result immediately without deferred scroll writes', async () => {
  const app = await ready();
  app.submit('help');
  app.submit('clear');
  app.submit('pwd');
  assert.equal(app.output.children.length, 1);
  const expectedTop = Math.max(0, app.output.lastElementChild._offsetTop - app.screen._offsetTop - 12);
  assert.equal(app.screen.scrollTop, expectedTop);
  const writes = app.metrics.scrollWrites;
  app.flushFrame();
  assert.equal(app.screen.scrollTop, expectedTop);
  assert.equal(app.metrics.scrollWrites, writes);
});

test('resize notifications coalesce and identical dimensions avoid height writes', async () => {
  const app = await ready();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '');
  app.screen.scrollTop = 123;
  app.resetMetrics();
  for (let index = 0; index < 50; index++) app.resize(500, 700);
  assert.equal(app.pendingFrames, 1);
  assert.equal(app.metrics.heightWrites, 0);
  app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '700px');
  assert.equal(app.metrics.heightWrites, 1);
  app.resize(500, 700);
  app.flushFrame();
  assert.equal(app.metrics.heightWrites, 1);
  assert.equal(app.screen.scrollTop, 123);
  assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.geometryReads, 0);
  app.resize(1000, 800);
  app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '');
  assert.equal(app.metrics.heightWrites, 2);
});

test('viewport size passes to CSS for safe-area sizing; missing visualViewport is supported', async () => {
  const mobile = await ready({width: 320, height: 100});
  assert.equal(mobile.terminal.style.getPropertyValue('--viewport-height'), '100px');
  const fallback = await ready({viewport: false});
  assert.equal(fallback.pendingFrames, 0);
  assert.equal(fallback.terminal.style.getPropertyValue('--viewport-height'), '');
  fallback.submit('pwd');
  fallback.flushFrame();
  assert.equal(fallback.metrics.geometryReads, 2);
});

test('pinch zoom preserves layout, draft and reader position; keyboard sizing resumes at normal scale', async () => {
  const app = await ready({width: 390, height: 650});
  app.change('unfinished');
  app.screen.scrollTop = 79;
  app.resetMetrics();
  for (const scale of [1.5, 2, 3]) {
    app.resize(390, 650 / scale, scale);
    app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '650px');
    assert.equal(app.terminal.classList.contains('compact'), false);
    assert.equal(app.input.value, 'unfinished');
    assert.equal(app.screen.scrollTop, 79);
  }
  assert.equal(app.metrics.heightWrites, 0);
  app.resize(390, 300);
  app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '300px');
  assert.equal(app.terminal.classList.contains('compact'), true);
});

test('IME conversion keys preserve the draft even when isComposing is false', async () => {
  const app = await ready();
  app.submit('pwd');
  app.change('h');
  app.key('Tab');
  const selection = app.input.getAttribute('aria-activedescendant');
  app.dispatch(app.input, 'compositionstart');
  for (const key of ['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Tab']) {
    assert.equal(app.key(key, {isComposing: false}).defaultPrevented, false);
    assert.equal(app.input.value, 'h');
    assert.equal(app.input.getAttribute('aria-activedescendant'), selection);
  }
  app.dispatch(app.input, 'compositionend');
  assert.equal(app.key('Enter', {keyCode: 229}).defaultPrevented, false);
  assert.equal(app.input.value, 'h');
  assert.equal(app.key('Enter').defaultPrevented, true);
  assert.equal(app.input.value, 'help');
});

test('repeated README views own independent nodes and retain exact raw cat after clear and navigation', async () => {
  const app = await ready();
  const first = app.output.firstElementChild;
  const text = first.textContent;
  app.submit('open README.md');
  const firstLink = first.querySelector('a');
  const nextLink = app.output.lastElementChild.querySelectorAll('a').find(link => link.href === firstLink.href);
  assert.ok(nextLink);
  assert.notEqual(firstLink, nextLink);
  first.textContent = 'reader-local mutation';
  app.submit('clear');
  app.navigateHash('');
  assert.equal(app.output.firstElementChild.textContent, text);
  app.submit('cat README.md');
  assert.equal(app.output.lastElementChild.querySelector('pre').textContent, readme);
});

test('read-output control changes focus without changing command or screen history', async () => {
  const app = await ready();
  app.change('draft');
  app.click(button(app, 'read-output'));
  assert.equal(app.document.activeElement, app.screen);
  assert.equal(app.input.value, 'draft');
  assert.equal(app.output.children.length, 1);
  assert.equal(app.metrics.focusCalls.at(-1).options.preventScroll, true);
});

test('hostile command content stays literal text and rejected commands remain bounded', async () => {
  const app = await ready();
  const payload = '<img/src=x/onerror=alert(1)>';
  app.submit(payload);
  assert.ok(app.output.lastElementChild.textContent.includes(payload));
  assert.equal(app.output.querySelectorAll('img').length, 0);
  assert.equal(app.output.querySelectorAll('script').length, 0);
  assert.equal(app.announcement.textContent, `Unknown command: ${payload}`);
  app.submit('x'.repeat(501));
  const echo = app.output.lastElementChild.querySelector('.echo').textContent;
  assert.equal(echo, 'guest:~ $ [invalid input]');
  app.submit('pwd\u202Ehidden');
  assert.equal(app.output.lastElementChild.querySelector('.echo').textContent, 'guest:~ $ [invalid input]');
  assert.match(app.announcement.textContent, /at most 500 characters/);
});

test('invalid line and direction controls are neither echoed nor recalled', async () => {
  const app = await ready();
  for (const control of ['\n', '\r', '\u0085', '\u061c', '\u200e', '\u2028', '\u2029', '\u202e', '\u2066']) {
    app.submit(`pwd${control}`);
    assert.equal(app.output.lastElementChild.querySelector('.echo').textContent, 'guest:~ $ [invalid input]');
    assert.ok(!app.output.lastElementChild.textContent.includes(control));
  }
  app.change('draft');
  app.key('ArrowUp');
  assert.equal(app.input.value, 'draft');
});


test('composition prevents implicit submission until composition ends', async () => {
  const app = await ready();
  app.change('pwd');
  const count = app.output.children.length;
  app.dispatch(app.input, 'compositionstart');
  assert.equal(app.dispatch(app.form, 'submit').defaultPrevented, true);
  assert.equal(app.input.value, 'pwd');
  assert.equal(app.output.children.length, count);
  app.dispatch(app.input, 'compositionend');
  app.dispatch(app.form, 'submit');
  assert.equal(app.input.value, '');
  assert.equal(app.output.children.length, count + 1);
});

test('clicking the prompt row focuses input but never steals text selection or output focus', async () => {
  const app = await ready();
  app.click(app.form);
  assert.equal(app.document.activeElement, app.input);
  app.screen.focus();
  app.resetMetrics();
  app.click(app.screen);
  app.click(app.output.firstElementChild);
  assert.equal(app.document.activeElement, app.screen);
  assert.equal(app.metrics.focusCalls.length, 0);
  app.selectText('guest:~ $');
  assert.equal(app.click(app.prompt).defaultPrevented, true);
  assert.equal(app.document.activeElement, app.screen);
  assert.equal(app.metrics.focusCalls.length, 0);
  app.selectText('');
  app.click(app.prompt);
  assert.equal(app.document.activeElement, app.input);
});

test('commands in error hints fill the input without running or duplicating the hint', async () => {
  for (const [command, hint, suggestions] of [
    ['bash', 'Type help to see available commands.', ['help']],
    ['cs', 'Did you mean ls or cd?', ['ls', 'cd']],
    ['cat /', 'Use open / to browse or ls / to list its contents.', ['open /', 'ls /']],
    ['cd README.md', 'Use open /README.md or cat /README.md to read this file.', ['open /README.md', 'cat /README.md']],
    ['help extra', 'help does not take arguments.', ['help']],
  ]) {
    const app = await ready();
    app.submit(command);
    const result = app.output.lastElementChild.querySelector('.result');
    assert.equal(result.querySelectorAll('p').length, 2);
    const line = result.querySelector('.dim');
    assert.equal(line.textContent, hint);
    assert.deepEqual(line.querySelectorAll('button').map(node => node.textContent), suggestions);
    assert.equal(result.querySelector('.recovery'), null);
    assert.doesNotMatch(result.textContent, /Fill input:/);
    const count = app.output.children.length;
    for (const button of line.querySelectorAll('button')) {
      assert.equal(button.type, 'button');
      assert.equal(button.getAttribute('aria-label'), `Fill command line with ${button.textContent}`);
      app.click(button);
      assert.equal(app.input.value, button.textContent);
      assert.equal(app.document.activeElement, app.input);
      assert.equal(app.output.children.length, count);
      assert.equal(app.location.hash, '');
    }
    app.submit('history');
    assert.deepEqual(app.output.lastElementChild.querySelectorAll('button').map(node => node.textContent), [command, 'history']);
  }
});

test('nested error hint clicks and corrections retain fill-only behavior', async () => {
  const app = await ready();
  app.submit('cat /');
  const error = app.output.lastElementChild;
  assert.match(error.textContent, /Is a directory: \//);
  const recovery = error.querySelectorAll('button').find(node => node.textContent === 'open /');
  assert.ok(recovery);
  const nested = app.document.createElement('span');
  recovery.append(nested);
  const count = app.output.children.length;
  app.click(nested);
  assert.equal(app.input.value, 'open /');
  assert.equal(app.output.children.length, count);
  assert.equal(app.document.activeElement, app.input);
  assert.equal(app.location.hash, '');
  app.submit(app.input.value);
  assert.match(app.output.lastElementChild.textContent, /README\.md/);
  assert.equal(app.location.hash, '');
  app.submit('opn /README.md');
  const correction = app.output.lastElementChild.querySelectorAll('button').find(node => node.textContent === 'open');
  assert.ok(correction);
  const before = app.output.children.length;
  app.click(correction);
  assert.equal(app.input.value, 'open');
  assert.equal(app.output.children.length, before);
  assert.equal(app.location.hash, '');
});

test('cat emits the exact canonical Markdown including trailing newline without chrome or navigation', async () => {
  const app = await ready();
  app.submit('open /README.md');
  const hash = app.location.hash;
  const entries = app.history.length;
  app.submit('cat README.md');
  const body = app.output.lastElementChild.querySelector('.result');
  assert.equal(body.children.length, 1);
  assert.equal(body.firstElementChild.tagName, 'PRE');
  assert.equal(body.firstElementChild.className, 'file-text');
  assert.equal(body.firstElementChild.textContent, readme);
  assert.equal(body.querySelector('h2'), null);
  assert.equal(body.querySelector('a'), null);
  assert.equal(body.querySelector('.file-path'), null);
  assert.equal(app.location.hash, hash);
  assert.equal(app.history.length, entries);
});

test('open creates a document link while directory and cat operations do not push routes', async () => {
  const app = await ready();
  app.submit('open /README.md');
  assert.equal(app.location.hash, '#/README.md');
  assert.equal(app.history.length, 2);
  const link = app.output.lastElementChild.querySelector('.document-link');
  assert.equal(link.href, '#/README.md');
  assert.equal(app.output.lastElementChild.querySelector('.file-title').textContent, 'README.md');
  app.submit('open README.md');
  assert.equal(app.history.length, 2, 'Same document must not add a duplicate URL entry');
  for (const command of ['ls /', 'open /', 'cd /', 'cat README.md']) {
    app.submit(command);
    assert.equal(app.history.length, 2, command);
    assert.equal(app.location.hash, '#/README.md', command);
  }
});

test('Back and Forward restore README without running commands or dropping the draft', async () => {
  const app = await ready();
  app.submit('open README.md');
  app.submit('cd /');
  app.change('unfinished command');
  app.history.back();
  assert.equal(app.location.hash, '');
  assert.equal(app.prompt.textContent, 'guest:~ $');
  assert.equal(app.input.value, 'unfinished command');
  assert.equal(app.output.children.length, 1, 'Home restores the passive README once');
  assert.equal(app.output.querySelector('.echo'), null);
  app.history.forward();
  assert.equal(app.location.hash, '#/README.md');
  assert.equal(app.prompt.textContent, 'guest:~ $');
  assert.equal(app.input.value, 'unfinished command');
  assert.equal(app.output.children.length, 2, 'Paired popstate/hashchange must render once');
  assert.equal(app.output.lastElementChild.querySelector('.file-title').textContent, 'README.md');
  app.submit('history');
  const commands = app.output.lastElementChild.querySelectorAll('button').map(node => node.textContent);
  assert.deepEqual(commands, ['open README.md', 'cd /', 'history']);
});

test('Back to the initial entry restores passive README without clearing command history', async () => {
  const app = await ready();
  app.submit('open /README.md');
  app.change('draft');
  app.history.back();
  assert.equal(app.location.hash, '');
  assert.equal(app.output.children.length, 1);
  assert.equal(app.output.querySelector('.echo'), null);
  assert.ok(app.output.textContent.includes(renderedText));
  assert.equal(app.input.value, 'draft');
  assert.equal(app.document.activeElement, app.screen);
  app.history.forward();
  assert.equal(app.output.lastElementChild.querySelector('.file-title').textContent, 'README.md');
  app.submit('history');
  assert.deepEqual(app.output.lastElementChild.querySelectorAll('button').map(node => node.textContent), ['open /README.md', 'history']);
});

test('fresh README links load passively without fake command echoes or command history', async () => {
  const app = await ready({hash: '#/README.md'});
  assert.equal(app.document.activeElement, app.document.body);
  assert.equal(app.prompt.textContent, 'guest:~ $');
  assert.equal(app.output.querySelector('.echo'), null);
  assert.equal(app.output.lastElementChild.querySelector('.file-title').textContent, 'README.md');
  assert.equal(app.history.length, 1);
  app.change('draft');
  app.key('ArrowUp');
  assert.equal(app.input.value, 'draft');
  app.submit('history');
  assert.deepEqual(app.output.lastElementChild.querySelectorAll('button').map(node => node.textContent), ['history']);
});

test('malformed and unknown initial hashes are safely rejected without autofocus or raw echo', async () => {
  for (const hash of ['#%', '#/writing', '#/../../etc/passwd', '#<img/src=x/onerror=alert(1)>', '#' + 'x'.repeat(501)]) {
    const app = await ready({hash});
    assert.equal(app.document.activeElement, app.document.body, hash);
    assert.match(app.output.textContent, /document link is not available/);
    assert.ok(!app.output.textContent.includes(hash.slice(1)), hash);
    assert.equal(app.output.querySelectorAll('img').length, 0);
    app.change('draft');
    app.key('ArrowUp');
    assert.equal(app.input.value, 'draft');
  }
});

test('forged history data cannot restore an invalid cwd or execute embedded commands', async () => {
  const app = await ready({hash: '#/README.md', state: {terminal: {path: '/README.md', cwd: '__proto__', command: 'clear', raw: 'cat /contact'}}});
  assert.equal(app.prompt.textContent, 'guest:~ $');
  assert.equal(app.output.lastElementChild.querySelector('.file-title').textContent, 'README.md');
  assert.deepEqual(app.history.state, {terminal: {path: '/README.md', cwd: '/'}});
  app.submit('history');
  assert.deepEqual(app.output.lastElementChild.querySelectorAll('button').map(node => node.textContent), ['history']);
});

test('manual hash navigation deduplicates paired events and uses only README.md', async () => {
  const app = await ready();
  app.submit('cd /');
  const count = app.output.children.length;
  app.navigateHash('#/README.md');
  assert.equal(app.prompt.textContent, 'guest:~ $');
  assert.equal(app.output.children.length, count + 1);
  assert.equal(app.output.lastElementChild.querySelector('.file-title').textContent, 'README.md');
  app.navigateHash('#clear');
  assert.match(app.output.lastElementChild.textContent, /document link is not available/);
  app.submit('history');
  assert.deepEqual(app.output.lastElementChild.querySelectorAll('button').map(node => node.textContent), ['cd /', 'history']);
});

test('repeated browser navigation remains output-bounded and adds no per-result listeners', async () => {
  const app = await ready();
  app.submit('open README.md');
  app.navigateHash('#not-a-document');
  const listeners = app.metrics.listeners;
  for (let index = 0; index < 100; index++) { app.history.back(); app.history.forward(); }
  assert.equal(app.output.children.length, 40);
  assert.equal(app.metrics.listeners, listeners);
  assert.equal(app.history.length, 3);
  app.submit('history');
  assert.deepEqual(app.output.lastElementChild.querySelectorAll('button').map(node => node.textContent), ['open README.md', 'history']);
});

test('history API write failure cannot prevent document rendering or further commands', async () => {
  const app = await ready();
  app.history.failWrites = true;
  app.submit('open /README.md');
  assert.equal(app.location.hash, '');
  assert.equal(app.output.lastElementChild.querySelector('.file-title').textContent, 'README.md');
  assert.match(app.announcement.textContent, /could not update the document link/);
  app.submit('pwd');
  assert.equal(app.output.lastElementChild.querySelector('.result').textContent, '/');
});

test('browser navigation invalidates visible completion state without deleting its draft', async () => {
  const app = await ready();
  app.submit('open /README.md');
  app.navigateHash('#not-a-document');
  app.change('h');
  app.key('Tab');
  assert.equal(app.input.getAttribute('aria-expanded'), 'true');
  app.history.back();
  assert.equal(app.input.value, 'h');
  assert.equal(app.completionPanel.hidden, true);
  assert.equal(app.suggestions.children.length, 0);
  assert.equal(app.input.getAttribute('aria-expanded'), 'false');
  assert.equal(app.input.getAttribute('aria-activedescendant'), null);
  assert.equal(app.location.hash, '#/README.md');
});

test('compact mode follows the visual viewport without changing the draft or reader position', async () => {
  const app = await ready({width: 390, height: 650});
  app.change('unfinished command');
  app.screen.scrollTop = 123;
  app.resetMetrics();
  for (const [width, height, compact] of [[390, 300, true], [390, 650, false], [390, 300, true], [1000, 300, false]]) {
    app.resize(width, height);
    app.flushFrame();
    assert.equal(app.terminal.classList.contains('compact'), compact, `${width}x${height}`);
    assert.equal(app.input.value, 'unfinished command');
    assert.equal(app.screen.scrollTop, 123);
  }
  assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.geometryReads, 0);
});


test('README and command controls are ready synchronously without network or timer APIs', async () => {
  // createApp awaits local test fixture imports, not application initialization.
  const app = await createApp();
  assert.ok(app.output.textContent.includes(renderedText));
  assert.equal(app.output.children.length, 1);
  assert.equal(app.output.querySelector('.loading'), null);
  assert.equal(app.output.querySelector('.error'), null);
  assert.equal(app.output.querySelector('.echo'), null);
  assert.ok(app.document.querySelectorAll('input, button').every(control => !control.disabled));
  assert.equal(app.document.querySelector('.site-name').textContent, 'Michael J. Crockett');
  assert.equal(app.document.querySelector('.site-status').textContent, 'Site in progress');
  assert.equal(app.document.querySelector('.show-commands').textContent, 'Show commands');
  for (const api of ['fetch', 'XMLHttpRequest', 'WebSocket', 'setTimeout', 'clearTimeout']) {
    assert.equal(api in app.globals, false, `${api} is not supplied by the fixture`);
  }
  assert.equal(app.document.activeElement, app.document.body);
  assert.equal(app.metrics.focusCalls.length, 0);
  app.submit('cat README.md');
  assert.equal(app.output.lastElementChild.querySelector('pre').textContent, readme);
});

test('help shows commands and short examples without introductory or detailed explanations', async () => {
  const app = await ready();
  app.click(app.document.querySelector('.show-commands'));
  assert.equal(app.document.activeElement, app.output.lastElementChild);
  const result = app.output.lastElementChild.querySelector('.result');
  assert.deepEqual(result.querySelectorAll('p').map(node => node.textContent), [
    'Try cat README.md or open README.md.',
  ]);
  assert.equal(result.querySelectorAll('dt').length, 8);
  assert.ok(result.querySelectorAll('dt').some(node => node.textContent === 'cat path'));
  assert.ok(result.querySelectorAll('dd').every(node => !node.textContent.includes(';')));
  assert.deepEqual(result.querySelectorAll('button').map(node => node.dataset.command), ['cat README.md', 'open README.md']);
  for (const removed of [
    'A small, read-only interface. Not a remote shell.',
    'Tab completes once; Tab again or Shift+Tab leaves the input. With choices open, ↑ / ↓ selects and Enter accepts without running. Escape dismisses choices and keeps your draft.',
    'Without choices, ↑ / ↓ recalls history. Browser shortcuts remain yours. No flags, pipes, or multiple files.',
    'README.md is the site’s real Markdown file. cat prints its source; open formats it. Document links and Back / Forward never replay typed commands.',
  ]) assert.equal(result.textContent.includes(removed), false);
});

test('the Python surprise keeps one timer and bounded output without adding listeners or navigation', async () => {
  const app = await ready();
  const listeners = app.metrics.listeners;
  for (let index = 0; index < 60; index++) app.submit(index % 2 ? 'python3' : 'python');
  assert.equal(app.output.children.length, 40);
  assert.equal(app.metrics.listeners, listeners);
  assert.equal(app.pendingFrames, 0);
  assert.equal(app.pendingTimers, 1);
  assert.equal(app.location.hash, '');
  assert.equal(app.document.activeElement, app.input);
  const snake = app.output.lastElementChild.querySelector('.snake');
  assert.equal(snake.getAttribute('role'), 'img');
  assert.equal(snake.getAttribute('aria-label'), 'A coiled python flicks its tongue');
  assert.deepEqual(snake.textContent.split('\n').map(line => line.length), Array(12).fill(34));
  app.advanceTime(2960);
  assert.equal(app.pendingTimers, 0);
  assert.equal(app.terminal.classList.contains('snake-active'), false);
  app.submit('help');
  assert.doesNotMatch(app.output.lastElementChild.textContent, /python|snake/);
  app.change('py');
  app.key('Tab');
  assert.equal(app.suggestions.children.length, 0);
});

test('the snake returns the real prompt at 2560ms without moving input or changing history', async () => {
  const app = await ready();
  app.submit('python');
  const history = structuredClone(app.history.entries);
  const focusCalls = app.metrics.focusCalls.length;
  const scrollWrites = app.metrics.scrollWrites;
  assert.equal(app.terminal.classList.contains('snake-active'), true);
  assert.equal(app.input.hidden, false);
  assert.equal(app.input.disabled, false);
  app.advanceTime(2559);
  assert.equal(app.terminal.classList.contains('snake-active'), true);
  app.advanceTime(1);
  assert.equal(app.terminal.classList.contains('snake-active'), false);
  assert.equal(app.pendingTimers, 1);
  app.advanceTime(400);
  assert.equal(app.pendingTimers, 0);
  assert.equal(app.metrics.focusCalls.length, focusCalls);
  assert.equal(app.metrics.scrollWrites, scrollWrites);
  assert.deepEqual(app.history.entries, history);
});

test('typing, paste and composition finish the snake without losing the input draft', async () => {
  for (const event of ['keydown', 'beforeinput', 'input', 'compositionstart']) {
    const app = await ready();
    app.submit('python3');
    app.advanceTime(1040);
    app.input.value = 'draft';
    app.dispatch(app.input, event, {key: 'x', isComposing: event === 'compositionstart'});
    assert.equal(app.input.value, 'draft');
    assert.equal(app.document.activeElement, app.input);
    assert.equal(app.terminal.classList.contains('snake-active'), false);
    assert.equal(app.pendingTimers, 0);
    const text = app.output.lastElementChild.textContent;
    app.advanceTime(5000);
    assert.equal(app.output.lastElementChild.textContent, text);
  }
});

test('reduced motion, backgrounding and page exit settle an active snake', async () => {
  for (const stop of [app => app.setReducedMotion(true), app => app.setHidden(true), app => app.dispatch(app.window, 'pagehide')]) {
    const app = await ready();
    app.submit('python');
    stop(app);
    assert.equal(app.pendingTimers, 0);
    assert.equal(app.terminal.classList.contains('snake-active'), false);
  }
  const app = await createApp({reducedMotion: true});
  app.submit('python');
  assert.equal(app.pendingTimers, 0);
  assert.equal(app.terminal.classList.contains('snake-active'), false);
  assert.ok(app.output.lastElementChild.textContent.includes(')--<'));
});

test('clear, recovery, completion and navigation cancel pending snake work', async () => {
  for (const act of [
    app => app.submit('clear'),
    app => app.click(app.document.getElementById('previous')),
    app => app.click(app.document.getElementById('complete')),
    app => app.navigateHash('#/README.md'),
  ]) {
    const app = await ready();
    app.submit('python');
    act(app);
    assert.equal(app.pendingTimers, 0);
    assert.equal(app.terminal.classList.contains('snake-active'), false);
    const text = app.output.textContent;
    app.advanceTime(5000);
    assert.equal(app.output.textContent, text);
  }
});
