import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createApp} from './helpers/dom.mjs';

// These deterministic DOM-model tests do not replace real-browser QA.
const ready = async options => {
  const app = await createApp(options);
  app.flushFrame();
  app.resetMetrics();
  return app;
};
const button = (app, id) => app.document.getElementById(id);

test('startup renders the welcome without autofocus or command execution', async () => {
  const app = await ready();
  assert.match(app.output.textContent, /Interactive terminal/);
  assert.equal(app.output.children.length, 1);
  assert.equal(app.document.activeElement, app.document.body);
  assert.equal(app.metrics.focusCalls.length, 0);
  assert.equal(app.suggestions.hidden, true);
});

test('typed submission prevents navigation, updates prompt, and returns focus to input', async () => {
  const app = await ready();
  assert.equal(app.submit('cd writing').defaultPrevented, true);
  assert.equal(app.input.value, '');
  assert.equal(app.prompt.textContent, 'guest:~/writing $');
  assert.match(app.output.lastElementChild.textContent, /guest:~ \$ cd writing/);
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

test('delegated shortcut clicks on nested content focus the result, not the input', async () => {
  const app = await ready();
  const nested = app.document.createElement('span');
  app.shortcuts[2].append(nested);
  app.click(nested);
  const result = app.output.lastElementChild;
  assert.equal(result.getAttribute('aria-label'), 'Sample document');
  assert.equal(app.document.activeElement, result);
  assert.ok(app.metrics.focusCalls.every(call => call.node !== app.input));
  assert.match(result.textContent, /Placeholder content only/);
  assert.equal(app.announcement.textContent, 'Opened Sample document.');
});

test('dynamic listing and help buttons use the same delegated command handler', async () => {
  const app = await ready();
  app.click(app.shortcuts[1]);
  const listingButton = app.output.lastElementChild.querySelectorAll('button').find(node => node.dataset.command === 'open /writing');
  app.click(listingButton);
  assert.match(app.output.lastElementChild.textContent, /sample/);
  app.click(app.shortcuts[0]);
  const helpButton = app.output.lastElementChild.querySelectorAll('button').find(node => node.dataset.command === 'open /writing/sample');
  app.click(helpButton);
  assert.match(app.output.lastElementChild.textContent, /Sample document/);
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
  app.change('open /w');
  assert.equal(app.key('ArrowUp').defaultPrevented, true);
  assert.equal(app.input.value, 'help');
  assert.equal(app.input.selectionStart, 4);
  assert.equal(app.input.selectionEnd, 4);
  app.click(button(app, 'previous'));
  assert.equal(app.input.value, 'pwd');
  app.click(button(app, 'next'));
  assert.equal(app.input.value, 'help');
  app.key('ArrowDown');
  assert.equal(app.input.value, 'open /w');
});

test('unique Tab completion edits input and only then prevents default', async () => {
  const app = await ready();
  app.change('op');
  assert.equal(app.key('Tab').defaultPrevented, true);
  assert.equal(app.input.value, 'open ');
  assert.equal(app.suggestions.hidden, true);
  assert.equal(app.announcement.textContent, 'Completed: open ');
  app.change('pwd');
  assert.equal(app.key('Tab').defaultPrevented, false);
  app.change('unmatched');
  assert.equal(app.key('Tab').defaultPrevented, false);
  assert.equal(app.announcement.textContent, 'No matching completion.');
});

test('multiple completions expose controls and leave the next Tab for native navigation', async () => {
  const app = await ready();
  app.change('h');
  assert.equal(app.key('Tab').defaultPrevented, true);
  assert.equal(app.suggestions.hidden, false);
  assert.equal(app.suggestions.children.length, 2);
  assert.equal(app.input.getAttribute('aria-controls'), 'completions');
  assert.equal(app.key('Tab').defaultPrevented, false);
  const nested = app.document.createElement('span');
  app.suggestions.firstElementChild.append(nested);
  app.click(nested);
  assert.equal(app.input.value, 'help');
  assert.equal(app.suggestions.hidden, true);
  assert.equal(app.suggestions.children.length, 0);
  assert.equal(app.input.getAttribute('aria-controls'), null);
  assert.equal(app.document.activeElement, app.input);
});

test('completion button supports blank input and retains trailing spaces in selected values', async () => {
  const app = await ready();
  app.click(button(app, 'complete'));
  assert.equal(app.suggestions.hidden, false);
  assert.equal(app.suggestions.children.length, 7);
  const open = app.suggestions.children.find(node => node.textContent === 'open');
  app.click(open);
  assert.equal(app.input.value, 'open ');
  assert.equal(app.document.activeElement, app.input);
});

test('editing and Escape dismiss suggestions and remove their ARIA association', async () => {
  const app = await ready();
  app.change('h');
  app.key('Tab');
  app.change('he');
  assert.equal(app.suggestions.hidden, true);
  assert.equal(app.input.getAttribute('aria-controls'), null);
  app.change('h');
  app.key('Tab');
  app.key('Escape');
  assert.equal(app.input.value, '');
  assert.equal(app.suggestions.hidden, true);
  assert.equal(app.suggestions.children.length, 0);
});

test('Escape from a completion choice dismisses it and returns to command input', async () => {
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

test('modified and composing Escape events leave completion choices and focus untouched', async () => {
  const app = await ready();
  app.change('h');
  app.key('Tab');
  const choice = app.suggestions.firstElementChild;
  choice.focus();
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']) {
    const event = app.key('Escape', {[modifier]: true}, choice);
    assert.equal(event.defaultPrevented, false, modifier);
    assert.equal(app.suggestions.hidden, false, modifier);
    assert.equal(app.document.activeElement, choice, modifier);
    assert.equal(app.input.value, 'h', modifier);
    assert.equal(app.input.getAttribute('aria-controls'), 'completions', modifier);
  }
});

test('modified shortcuts, IME events, Shift-Tab, and blank Tab remain untouched', async () => {
  const app = await ready();
  app.submit('pwd');
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'isComposing']) {
    for (const key of ['ArrowUp', 'ArrowDown', 'Tab', 'Escape']) {
      app.change('draft');
      assert.equal(app.key(key, {[modifier]: true}).defaultPrevented, false, `${modifier} ${key}`);
      assert.equal(app.input.value, 'draft', `${modifier} ${key}`);
      assert.equal(app.suggestions.hidden, true);
    }
  }
  app.change('h');
  assert.equal(app.key('Tab', {shiftKey: true}).defaultPrevented, false);
  assert.equal(app.suggestions.hidden, true);
  app.change('');
  assert.equal(app.key('Tab').defaultPrevented, false);
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
  assert.equal(app.terminal.style.height, '');
  app.screen.scrollTop = 123;
  app.resetMetrics();
  for (let index = 0; index < 50; index++) app.resize(500, 700);
  assert.equal(app.pendingFrames, 1);
  assert.equal(app.metrics.heightWrites, 0);
  app.flushFrame();
  assert.equal(app.terminal.style.height, '684px');
  assert.equal(app.metrics.heightWrites, 1);
  app.resize(500, 700);
  app.flushFrame();
  assert.equal(app.metrics.heightWrites, 1);
  assert.equal(app.screen.scrollTop, 123);
  assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.geometryReads, 0);
  app.resize(1000, 800);
  app.flushFrame();
  assert.equal(app.terminal.style.height, '');
  assert.equal(app.metrics.heightWrites, 2);
});

test('short mobile viewports enforce the minimum height; missing visualViewport is supported', async () => {
  const mobile = await ready({width: 320, height: 100});
  assert.equal(mobile.terminal.style.height, '180px');
  const fallback = await ready({viewport: false});
  assert.equal(fallback.pendingFrames, 0);
  assert.equal(fallback.terminal.style.height, '');
  fallback.submit('pwd');
  fallback.flushFrame();
  assert.equal(fallback.metrics.geometryReads, 2);
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
