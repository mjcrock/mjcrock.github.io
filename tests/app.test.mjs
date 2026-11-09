import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {markdownBlocks} from '../markdown.js';
import {createApp} from './helpers/dom.mjs';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const textbookPath = '/projects/textbook/README.md';
const textbookTitle = 'Mathematics for Cyber Threat Detection';
const assertStandaloneTextbook = app => {
  assert.equal(app.output.children.length, 1, 'Normal navigation displays one authored page');
  const page = app.output.firstElementChild;
  assert.ok(page.classList.contains('initial-document'));
  assert.equal(page.querySelector('h1').textContent, textbookTitle);
  assert.equal(app.output.querySelector('.echo,.file-path,.initial-directory'), null);
};

const renderedText = markdownBlocks(readme).flatMap(block => block.parts.map(part => part.text)).join('');

// These deterministic DOM-model tests do not replace real-browser QA.
const ready = async options => {
  const app = await createApp(options);
  app.flushFrame();
  app.resetMetrics();
  return app;
};
const button = (app, id) => app.document.getElementById(id);
const touchFocus = app => {
  app.dispatch(app.input, 'pointerdown', {pointerType: 'touch'});
  app.input.focus();
  app.dispatch(app.input, 'focus');
  app.flushFrame();
};
const scrollOutput = (app, top) => {
  app.screen.scrollTop = top;
  app.dispatch(app.screen, 'scroll');
};

test('mobile controls have their final initial geometry before the first animation frame', async () => {
  const app = await createApp({width: 390, height: 260});
  assert.equal(app.pendingFrames, 0);
  assert.equal(app.terminal.classList.contains('mobile'), true);
  assert.equal(app.terminal.classList.contains('compact'), true);
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '260px', 'Frame height and compact controls are ready before the entry is revealed');
  assert.equal(app.metrics.heightWrites, 1);
  assert.equal(app.document.querySelector('.entry').hidden, false);
  assert.equal(app.document.activeElement, app.document.body);
});

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

test('typed submission prevents navigation, retains the root prompt, and preserves input focus', async () => {
  const app = await ready();
  app.input.focus(); app.resetMetrics();
  assert.equal(app.submit('cd /').defaultPrevented, true);
  assert.equal(app.input.value, '');
  assert.equal(app.prompt.textContent, 'guest:~ $');
  assert.match(app.output.lastElementChild.textContent, /guest:~ \$ cd \//);
  assert.equal(app.document.activeElement, app.input);
  assert.equal(app.metrics.focusCalls.length, 0, 'Enter needs no new focus call');
  assert.equal(app.announcement.textContent, 'Command complete.');
  assert.equal(app.output.lastElementChild.tabIndex, -1);
});

test('clean project URLs retain their static content without startup commands or focus changes', async () => {
  for (const [pathname, route, cwd] of [
    ['/projects/', '/projects', '/projects'],
    ['/projects/textbook/', textbookPath, '/projects/textbook'],
    ['/projects/textbook/index.html', textbookPath, '/projects/textbook'],
  ]) {
    const app = await createApp({pathname, width: 390, height: 260});
    assert.equal(app.output.firstElementChild, app.initialOutput, 'Initialization must preserve the already readable view');
    assert.equal(app.output.dataset.route, route);
    assert.equal(app.output.querySelector('.echo'), null);
    assert.equal(app.output.querySelector('.block'), null);
    assert.equal(app.document.activeElement, app.document.body);
    assert.equal(app.metrics.focusCalls.length, 0);
    assert.equal(app.pendingFrames, 0);
    assert.equal(app.history.length, 1);
    assert.equal(app.prompt.textContent, `guest:~${cwd} $`);
    assert.ok(app.output.textContent.includes(pathname === '/projects/' ? 'Textbook' : textbookTitle));
    app.change('draft'); app.key('ArrowUp');
    assert.equal(app.input.value, 'draft', 'Loading a project page cannot invent command history');
  }
});

test('the textbook participates in listing, directories, completion, reading and exact cat output', async () => {
  const app = await ready();
  const textbook = await readFile(new URL('../projects/textbook/README.md', import.meta.url), 'utf8');
  app.submit('ls');
  assert.ok(app.output.lastElementChild.querySelectorAll('button').some(node => node.dataset.command === 'open /projects'));
  app.submit('cd projects');
  assert.equal(app.prompt.textContent, 'guest:~/projects $');
  app.change('open t'); app.key('Tab');
  assert.equal(app.input.value, 'open textbook/');
  app.submit('open textbook');
  assert.equal(app.location.pathname, '/', 'Opening a directory still browses files without pushing a page URL');
  assert.equal(app.prompt.textContent, 'guest:~/projects $');
  assert.ok(app.output.lastElementChild.querySelectorAll('button').some(node => node.dataset.command === `open ${textbookPath}`));
  app.submit('cd textbook');
  assert.equal(app.prompt.textContent, 'guest:~/projects/textbook $');
  app.change('cat R'); app.key('Tab');
  assert.equal(app.input.value, 'cat README.md');
  app.submit('cat README.md');
  assert.equal(app.output.lastElementChild.querySelector('pre').textContent, textbook);
  assert.equal(app.location.pathname, '/');
  app.submit('open README.md');
  assert.equal(app.location.pathname, '/projects/textbook/');
  assert.equal(app.location.hash, '');
  assert.equal(app.prompt.textContent, 'guest:~/projects/textbook $');
  const opened = app.output.lastElementChild;
  assert.equal(opened.querySelectorAll('h1,h2,h3').filter(node => node.textContent === textbookTitle).length, 1,
    'The project title must appear only once in the opened document');
  assert.equal(opened.querySelector('.initial-document').querySelector('p').textContent, 'Textbook · In progress');
  assert.ok(opened.querySelector('.echo'), 'A CLI open appends the command to the transcript');
  const permalink = opened.querySelector('.document-link');
  assert.equal(permalink.href, '/projects/textbook/');
  assert.ok(app.document.title.includes(textbookTitle));
  const length = app.history.length;
  assert.equal(app.click(permalink).defaultPrevented, true);
  assert.equal(app.history.length, length, 'The permalink already identifies the current URL');
  assertStandaloneTextbook(app);
});

test('clearing or mutating one document cannot replace another document or its source', async () => {
  const app = await ready({pathname: '/projects/textbook/'});
  const textbook = await readFile(new URL('../projects/textbook/README.md', import.meta.url), 'utf8');
  app.output.firstElementChild.textContent = 'Local view mutation';
  app.submit('clear'); app.submit('open README.md');
  assert.ok(app.output.lastElementChild.textContent.includes(textbookTitle));
  app.submit('cat README.md');
  assert.equal(app.output.lastElementChild.querySelector('pre').textContent, textbook);
  app.submit('open /README.md');
  assert.equal(app.location.pathname, '/');
  assert.equal(app.location.hash, '#/README.md');
  assert.equal(app.output.lastElementChild.querySelector('.initial-document').textContent, renderedText);
  app.submit('cat /README.md');
  assert.equal(app.output.lastElementChild.querySelector('pre').textContent, readme);
  assert.equal(app.prompt.textContent, 'guest:~/projects/textbook $', 'Reading another document never changes cwd');
});

test('returning to a directly loaded project directory restores an independent copy of its listing', async () => {
  const app = await ready({pathname: '/projects/'});
  const first = app.output.firstElementChild;
  const canonical = first.textContent;
  const projectLink = first.querySelector('a');
  first.querySelector('h1').textContent = 'Local view mutation';
  app.click(projectLink);
  assertStandaloneTextbook(app);
  app.history.back();
  const restored = app.output.firstElementChild;
  assert.notEqual(restored, first);
  assert.notEqual(restored.querySelector('a'), projectLink);
  assert.equal(restored.textContent, canonical);
  assert.equal(restored.querySelector('a').href, '/projects/textbook/');
});

test('cross-document Back and Forward restore each saved directory without replaying commands', async () => {
  const app = await ready();
  app.submit('cd projects/textbook');
  app.submit('open README.md');
  app.submit('cd /');
  app.submit('open README.md');
  app.change('unfinished draft');
  app.history.back();
  assert.equal(app.location.pathname, '/projects/textbook/');
  assert.equal(app.location.hash, '');
  assert.equal(app.prompt.textContent, 'guest:~ $', 'Back restores the cwd last used at the textbook URL');
  assertStandaloneTextbook(app);
  assert.equal(app.input.value, 'unfinished draft');
  app.history.back();
  assert.equal(app.location.pathname, '/');
  assert.equal(app.location.hash, '');
  assert.equal(app.prompt.textContent, 'guest:~/projects/textbook $');
  assert.equal(app.output.firstElementChild.textContent, renderedText);
  app.history.forward();
  assertStandaloneTextbook(app);
  app.history.forward();
  assert.equal(app.location.hash, '#/README.md');
  assert.equal(app.input.value, 'unfinished draft');
  app.submit('history');
  assert.deepEqual(app.output.lastElementChild.querySelectorAll('button').map(node => node.textContent),
    ['cd projects/textbook', 'open README.md', 'cd /', 'open README.md', 'history']);
});

test('contextual page links remain usable after clear and give each destination heading focus', async () => {
  const app = await ready();
  app.change('unfinished draft');
  const link = app.document.getElementById('page-link');
  assert.equal(link.textContent, 'Browse projects');
  assert.equal(link.href, '/projects/');
  assert.equal(app.click(link).defaultPrevented, true);
  assert.equal(app.location.pathname, '/projects/');
  assert.equal(app.prompt.textContent, 'guest:~/projects $');
  assert.equal(link.textContent, 'Home');
  assert.equal(link.href, '/');
  assert.equal(app.document.activeElement, app.output.querySelector('h1'));
  assert.equal(app.document.querySelector('.site-name').tagName, 'P');
  assert.doesNotMatch(app.announcement.textContent, /command history/i);
  assert.equal(app.history.length, 2);
  const textbook = app.output.querySelectorAll('a').find(link => link.href === '/projects/textbook/');
  assert.ok(textbook);
  assert.equal(app.click(textbook).defaultPrevented, true);
  assert.equal(app.location.pathname, '/projects/textbook/');
  assert.equal(app.prompt.textContent, 'guest:~/projects/textbook $');
  assertStandaloneTextbook(app);
  assert.equal(link.textContent, 'All projects');
  assert.equal(link.href, '/projects/');
  assert.equal(app.document.activeElement, app.output.querySelector('h1'));
  assert.equal(app.input.value, 'unfinished draft');
  assert.equal(app.metrics.focusCalls.some(call => call.node === app.input), false);
  app.history.back();
  assert.equal(app.location.pathname, '/projects/');
  assert.equal(app.prompt.textContent, 'guest:~/projects $');
  assert.equal(app.input.value, 'unfinished draft');
  assert.equal(app.document.activeElement, app.output.querySelector('h1'));
  app.history.forward();
  assert.equal(app.document.activeElement, app.output.querySelector('h1'));
  assertStandaloneTextbook(app);
  app.submit('clear');
  assert.equal(app.output.children.length, 0);
  app.change('draft after clear');
  assert.equal(link.textContent, 'All projects');
  assert.equal(app.click(link).defaultPrevented, true);
  assert.equal(app.location.pathname, '/projects/');
  assert.equal(app.output.firstElementChild.querySelector('h1').textContent, 'Projects');
  assert.equal(link.textContent, 'Home');
  assert.equal(app.click(link).defaultPrevented, true);
  assert.equal(app.location.pathname, '/');
  assert.equal(app.prompt.textContent, 'guest:~ $');
  assert.equal(app.output.firstElementChild.textContent, renderedText);
  assert.equal(app.document.activeElement, app.document.querySelector('.site-name'));
  assert.equal(app.document.activeElement.tagName, 'H1');
  assert.equal(app.input.value, 'draft after clear');
  app.submit('history');
  assert.deepEqual(app.output.lastElementChild.querySelectorAll('button').map(node => node.textContent), ['clear', 'history']);
});

test('returning home on a short mobile screen focuses the visible reading pane', async () => {
  const app = await ready({pathname: '/projects/', width: 390, height: 260});
  app.click(app.document.getElementById('page-link'));
  assert.equal(app.location.pathname, '/');
  assert.equal(app.document.activeElement, app.screen);
  assert.equal(app.metrics.focusCalls.some(call => call.node === app.input), false);
});

test('a document without a heading remains navigable and focuses the reading pane', async () => {
  for (const empty of [false, true]) {
    const app = await ready();
    const template = app.document.querySelectorAll('template').find(node => node.dataset.view === textbookPath);
    const content = template.content.firstElementChild;
    // Both paragraph-only and empty Markdown are valid authored documents.
    if (empty) content.replaceChildren();
    else content.querySelector('h1').remove();
    const expected = content.textContent;
    app.change('retained draft');
    app.click(app.document.getElementById('page-link'));
    app.click(app.output.querySelector('a'));
    assert.equal(app.location.pathname, '/projects/textbook/');
    assert.equal(app.output.firstElementChild.textContent, expected);
    assert.equal(app.output.querySelector('.error'), null);
    assert.equal(app.document.activeElement, app.screen);
    assert.equal(app.input.value, 'retained draft');
    app.click(app.document.getElementById('page-link'));
    assert.equal(app.location.pathname, '/projects/');
    assert.equal(app.document.activeElement, app.output.querySelector('h1'));
  }
});

test('project link enhancement leaves modified, fragment, external, target and download navigation native', async () => {
  for (const modification of [{ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {altKey: true}, {button: 1}]) {
    const app = await ready();
    const projects = app.document.getElementById('page-link');
    assert.equal(app.dispatch(projects, 'click', modification).defaultPrevented, false);
    assert.equal(app.location.pathname, '/');
    assert.equal(app.history.length, 1);
  }
  for (const attributes of [{target: '_blank'}, {download: ''}, {href: '#screen'}, {href: '/projects/#screen'}, {href: 'https://example.com/projects/'}]) {
    const app = await ready();
    const projects = app.document.getElementById('page-link');
    for (const [name, value] of Object.entries(attributes)) projects.setAttribute(name, value);
    assert.equal(app.click(projects).defaultPrevented, false);
    assert.equal(app.location.pathname, '/');
    assert.equal(app.history.length, 1);
  }
  const app = await ready();
  const identity = app.output.querySelector('a');
  assert.equal(app.click(identity).defaultPrevented, false);
  assert.equal(app.history.length, 1);
});

test('published project links fall back to native navigation when browser history is unavailable', async () => {
  const app = await ready();
  app.change('preserved draft');
  app.history.failWrites = true;
  const projects = app.document.getElementById('page-link');
  const initial = app.output.firstElementChild;
  assert.equal(app.click(projects).defaultPrevented, false, 'A failed enhancement must not turn the real page link into a dead control');
  assert.equal(app.output.firstElementChild, initial);
  assert.equal(app.prompt.textContent, 'guest:~ $');
  assert.equal(app.input.value, 'preserved draft');
  assert.equal(app.document.activeElement, app.document.body);
  app.submit('pwd');
  assert.equal(app.output.lastElementChild.querySelector('.result').textContent, '/');
});

test('submitting a pretyped command with the input blurred preserves non-input focus', async () => {
  for (const [width, height] of [[390, 650], [390, 260], [1000, 800]]) {
    for (const focused of ['run', 'body']) {
      const app = await ready({width, height});
      const target = focused === 'run' ? app.runButton : app.document.body;
      target.focus(); app.change('python'); app.resetMetrics();
      assert.equal(app.submit(app.input.value).defaultPrevented, true);
      assert.equal(app.input.value, '', 'Run still submits and clears the entered command');
      assert.ok(app.output.lastElementChild.querySelector('.snake'));
      assert.equal(app.document.activeElement, target, 'Run must not reopen a dismissed keyboard');
      assert.equal(app.metrics.focusCalls.length, 0);
      assert.equal(app.pendingFrames, 0, 'Submission starts no keyboard-layout work');
      assert.equal(app.announcement.textContent, 'Command complete.');
    }
  }
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

test('directory listings omit a secondary title that repeats the filename', async () => {
  const app = await ready();
  for (const command of ['ls', 'ls /', 'open /']) {
    app.submit(command);
    const row = app.output.lastElementChild.querySelector('.listing-row');
    assert.equal(row.textContent, 'README.md', command);
    assert.equal(row.children.length, 1, 'The listing needs no empty or duplicate metadata column');
    assert.equal(row.firstElementChild.dataset.command, 'open /README.md');
  }
});

test('delegated listing clicks on nested content focus the document, not the input', async () => {
  const app = await ready();
  app.submit('ls /');
  app.change('unfinished');
  app.resetMetrics();
  const file = app.output.lastElementChild.querySelector('button');
  const nested = app.document.createElement('span');
  file.append(nested);
  app.click(nested);
  const result = app.output.lastElementChild;
  assert.equal(result.getAttribute('aria-label'), 'README.md');
  assert.equal(app.input.value, 'unfinished');
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
  const browse = commands.find(node => node.dataset.command === 'ls /projects');
  const read = commands.find(node => node.dataset.command === 'open /README.md');
  assert.ok(browse && read);
  for (const directory of ['/projects', '/projects/textbook']) {
    app.submit('cd ' + directory);
    app.click(browse);
    assert.equal(app.output.lastElementChild.querySelector('.listing-row').firstElementChild.dataset.command,
      'open /projects/textbook', 'A help action in an older transcript keeps its target after cd');
    app.click(read);
    assert.equal(app.output.lastElementChild.querySelector('.initial-document').textContent, renderedText);
    assert.equal(app.location.hash, '#/README.md');
  }
});

test('browsing help and documents preserves an unfinished command and records browsed commands', async () => {
  const app = await ready();
  app.change('cat RE');
  app.click(app.document.querySelector('.show-commands'));
  assert.equal(app.input.value, 'cat RE');
  const open = app.output.lastElementChild.querySelectorAll('button').find(node => node.dataset.command === 'open /README.md');
  app.click(open);
  assert.equal(app.input.value, 'cat RE');
  assert.equal(app.location.hash, '#/README.md');
  assert.equal(app.document.activeElement, app.output.lastElementChild);
  app.key('ArrowUp');
  assert.equal(app.input.value, 'open /README.md');
  app.key('ArrowUp');
  assert.equal(app.input.value, 'help');
  app.key('ArrowDown');
  app.key('ArrowDown');
  assert.equal(app.input.value, 'cat RE');
  app.submit('pwd');
  assert.equal(app.input.value, '', 'Submitting a typed command still clears the input');
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
    const expectedTop = Math.max(0, app.output.lastElementChild._offsetTop - 12);
    assert.equal(app.screen.scrollTop, expectedTop);
  }
  assert.equal(app.output.children.length, 40);
  assert.equal(app.metrics.listeners, initialListeners);
  assert.equal(app.metrics.geometryReads, 200);
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
  scrollOutput(app, 47);
  app.flushFrame();
  assert.equal(app.screen.scrollTop, 47);
  app.flushFrame();
  assert.equal(app.screen.scrollTop, 47);
});

test('explicit command results are revealed during text selection without changing focus', async () => {
  const app = await ready({width: 390, height: 650});
  app.submit('help');
  app.screen.focus();
  scrollOutput(app, 47);
  app.selectText('Show this guide');
  app.resetMetrics();
  app.panVisualViewport(260, 390); app.flushFrame();
  assert.equal(app.screen.scrollTop, 47, 'Viewport updates preserve the selection and reader position');
  assert.equal(app.metrics.geometryReads, 0);
  assert.equal(app.metrics.scrollWrites, 0);
  app.submit('pwd');
  const expectedTop = Math.max(0, app.output.lastElementChild._offsetTop - 12);
  assert.equal(app.screen.scrollTop, expectedTop, 'An explicit command still reveals its result');
  assert.equal(app.metrics.geometryReads, 1);
  assert.equal(app.metrics.scrollWrites, 1);
  assert.equal(app.document.activeElement, app.screen);
  assert.equal(app.metrics.focusCalls.length, 0);
  assert.equal(app.window.getSelection().isCollapsed, false);
  app.flushFrame();
  assert.equal(app.screen.scrollTop, expectedTop);
  assert.equal(app.metrics.scrollWrites, 1, 'No later frame can repeat the reveal');
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
  const expectedTop = Math.max(0, app.output.lastElementChild._offsetTop - 12);
  assert.equal(app.screen.scrollTop, expectedTop);
  const writes = app.metrics.scrollWrites;
  app.flushFrame();
  assert.equal(app.screen.scrollTop, expectedTop);
  assert.equal(app.metrics.scrollWrites, writes);
});

test('entering mobile sizing coalesces notifications, avoids redundant writes and releases desktop sizing', async () => {
  const app = await ready();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '');
  scrollOutput(app, 123);
  app.resetMetrics();
  for (let index = 0; index < 50; index++) app.resize(500, 700);
  assert.equal(app.pendingFrames, 1);
  assert.equal(app.metrics.heightWrites, 0);
  app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '700px');
  assert.equal(app.metrics.heightWrites, 1);
  app.resize(500, 700);
  app.flushFrame();
  assert.equal(app.metrics.heightWrites, 1, 'Repeated native dimensions must not rewrite the frame height');
  assert.equal(app.screen.scrollTop, 123);
  assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.geometryReads, 1, 'Only the changed frame reads the saved passage position');
  app.resize(1000, 800);
  app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '');
  assert.equal(app.metrics.heightWrites, 2, 'Returning to desktop clears the mobile height exactly once');
});

test('mobile sizing uses reported height while missing visualViewport uses the window fallback', async () => {
  const mobile = await ready({width: 320, height: 100});
  assert.equal(mobile.terminal.style.getPropertyValue('--viewport-height'), '100px');
  const fallback = await ready({viewport: false});
  assert.equal(fallback.pendingFrames, 0);
  assert.equal(fallback.terminal.style.getPropertyValue('--viewport-height'), '');
  fallback.submit('pwd');
  fallback.flushFrame();
  assert.equal(fallback.metrics.geometryReads, 1);
  fallback.resize(390, 250);
  fallback.flushFrame();
  assert.equal(fallback.terminal.style.getPropertyValue('--viewport-height'), '250px');
  assert.equal(fallback.terminal.classList.contains('compact'), true);
});

test('native mobile resizing changes controls before paint and cancels a queued viewport update', async () => {
  for (const fontSize of [16, 24, 32]) {
    const app = await ready({width: 390, height: 700, fontSize});
    app.change('preserved native draft'); scrollOutput(app, 123);
    app.input.focus(); app.dispatch(app.input, 'focus');
    app.panVisualViewport(300, 0);
    assert.equal(app.pendingFrames, 1, 'The earlier visual report is waiting for its frame');
    assert.equal(app.terminal.classList.contains('compact'), false);
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '700px',
      'The previous frame height remains fixed until its controls can change with it');
    app.resetMetrics();

    app.globals.innerHeight = 300;
    app.globals.visualViewport.height = 300;
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '700px',
      'A native layout resize cannot resize this frame before its event updates the controls');
    app.dispatch(app.window, 'resize');
    assert.equal(app.terminal.classList.contains('compact'), true,
      'Controls must match the new native frame before another animation frame can paint');
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '300px');
    assert.equal(app.terminal.style.marginTop, '');
    assert.equal(app.pendingFrames, 0, 'The native resize cancels the superseded visual callback');
    assert.equal(app.pendingTimers, 0, 'Native resizing releases the opening fallback');
    assert.equal(app.document.activeElement, app.input);
    assert.equal(app.input.value, 'preserved native draft'); assert.equal(app.screen.scrollTop, 123);
    app.flushFrame();
    assert.equal(app.terminal.classList.contains('compact'), true);

    app.document.activeElement = app.document.body;
    app.dispatch(app.input, 'blur');
    assert.equal(app.pendingFrames, 1, 'Done has queued the closing update');
    app.globals.innerHeight = 700;
    app.globals.visualViewport.height = 700;
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '300px',
      'The output cannot temporarily expand while the compact controls are still active');
    assert.equal(app.terminal.classList.contains('compact'), true);
    app.dispatch(app.window, 'resize');
    assert.equal(app.terminal.classList.contains('compact'), false,
      'Restored controls must not lag one frame behind the expanded native viewport');
    assert.equal(app.pendingFrames, 0, 'The native resize also cancels a queued blur callback');
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '700px');
    assert.equal(app.terminal.style.marginTop, '');
    assert.equal(app.document.activeElement, app.document.body);
    assert.equal(app.input.value, 'preserved native draft'); assert.equal(app.screen.scrollTop, 123);
    app.flushFrame();
    assert.equal(app.metrics.heightWrites, 2, 'One height commit per native resize, with no intermediate frame');
    assert.equal(app.metrics.offsetWrites, 0);
    assert.equal(app.metrics.geometryReads, 2, 'Each native resize reads the saved passage position once');
    assert.equal(app.metrics.scrollWrites, 0);
    assert.equal(app.metrics.focusCalls.length, 0); assert.equal(app.pendingFrames, 0);
  }
});

test('visual-only window resize reports still coalesce until their scheduled frame', async () => {
  const app = await ready({width: 390, height: 650});
  app.input.focus(); app.change('visual draft'); scrollOutput(app, 123);
  app.resetMetrics();
  for (let index = 0; index < 50; index++) {
    app.panVisualViewport(260, 390);
    app.dispatch(app.window, 'resize');
  }
  assert.equal(app.pendingFrames, 1); assert.equal(app.metrics.framesScheduled, 1);
  assert.equal(app.terminal.classList.contains('compact'), false);
  assert.equal(app.metrics.heightWrites, 0); assert.equal(app.metrics.offsetWrites, 0);
  app.flushFrame();
  assert.equal(app.terminal.classList.contains('compact'), true);
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '260px');
  assert.equal(app.terminal.style.marginTop, '390px');
  assert.equal(app.metrics.heightWrites, 1); assert.equal(app.metrics.offsetWrites, 1);
  assert.equal(app.input.value, 'visual draft'); assert.equal(app.screen.scrollTop, 123);
  assert.equal(app.document.activeElement, app.input);
  assert.equal(app.metrics.geometryReads, 1, 'The coalesced frame reads the saved passage position once');
  assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.focusCalls.length, 0); assert.equal(app.pendingFrames, 0);
});

test('duplicate viewport reports do no passage or scroll work as the transcript grows', async () => {
  for (const commands of [1, 40, 200]) {
    const app = await ready({width: 390, height: 650});
    for (let index = 0; index < commands; index++) app.submit('help');
    assert.equal(app.output.children.length, Math.min(commands + 1, 40));
    app.panVisualViewport(260, 390); app.flushFrame();
    const top = app.output.lastElementChild._offsetTop - 20;
    scrollOutput(app, top);
    app.resetMetrics();
    for (let index = 0; index < 50; index++) {
      app.panVisualViewport(260, 390);
      app.dispatch(app.window, 'resize');
    }
    assert.equal(app.pendingFrames, 1);
    assert.equal(app.metrics.framesScheduled, 1, `${commands} commands still need only one callback`);
    app.flushFrame();
    assert.equal(app.screen.scrollTop, top);
    assert.equal(app.metrics.geometryReads, 0, 'Unchanged geometry must not inspect the saved passage or transcript');
    assert.equal(app.metrics.heightWrites, 0);
    assert.equal(app.metrics.offsetWrites, 0);
    assert.equal(app.metrics.scrollWrites, 0);
    assert.equal(app.metrics.focusCalls.length, 0);
    assert.equal(app.metrics.framesScheduled, 1);
    assert.equal(app.pendingFrames, 0);
    assert.equal(app.pendingTimers, 0);
  }
});

test('seeking a passage in a large document uses logarithmically bounded position reads', async () => {
  for (const count of [1, 2048, 21845]) {
    const app = await ready({width: 390, height: 650});
    const document = app.document.createElement('section');
    document._offsetTop = 0;
    const paragraphs = Array.from({length: count}, (_, index) => {
      const paragraph = app.document.createElement('p');
      paragraph.textContent = `Passage ${index}`;
      paragraph._offsetTop = 100 + index * 24;
      return paragraph;
    });
    document.append(...paragraphs);
    app.output.replaceChildren(document);
    const passage = paragraphs[Math.floor(count * .75)];
    const top = passage._offsetTop + 7;
    app.screen.scrollTop = top;
    app.resetMetrics();
    app.dispatch(app.screen, 'pointerdown');
    assert.ok(app.metrics.geometryReads <= Math.ceil(Math.log2(count + 1)) + 2,
      `${count} passages must require at most 20 position reads, not a linear scan`);
    assert.equal(app.metrics.scrollWrites, 0);
    assert.equal(app.metrics.focusCalls.length, 0);

    passage._offsetTop += 8;
    app.resetMetrics();
    app.resize(390, 600); app.flushFrame();
    assert.equal(app.screen.scrollTop, top + 8, 'Resizing restores the selected paragraph at its original reading offset');
    assert.equal(app.metrics.geometryReads, 1, 'Restoration reads only the saved paragraph');
    assert.equal(app.metrics.scrollWrites, 1);
    assert.equal(app.metrics.focusCalls.length, 0);
  }
});

test('passage selection uses the last equal-top child and falls back before the first child', async () => {
  for (const {offsets, top, selected} of [
    {offsets: [0, 100, 100, 100, 200], top: 100, selected: 3},
    {offsets: [100, 200], top: 50, selected: 0},
  ]) {
    const app = await ready({width: 390, height: 650});
    const paragraphs = offsets.map(offset => {
      const paragraph = app.document.createElement('p');
      paragraph.textContent = 'Reading passage';
      paragraph._offsetTop = offset;
      return paragraph;
    });
    app.output.replaceChildren(...paragraphs);
    app.screen.scrollTop = top;
    app.resetMetrics();
    app.dispatch(app.screen, 'pointerdown');
    assert.ok(app.metrics.geometryReads <= Math.ceil(Math.log2(offsets.length + 1)) + 1);
    assert.equal(app.metrics.scrollWrites, 0);
    paragraphs[selected]._offsetTop += 8;
    app.resetMetrics();
    app.resize(390, 600); app.flushFrame();
    assert.equal(app.screen.scrollTop, top + 8, `Expected passage ${selected} for offsets ${offsets}`);
    assert.equal(app.metrics.geometryReads, 1);
    assert.equal(app.metrics.scrollWrites, 1);
    assert.equal(app.metrics.focusCalls.length, 0);
  }
});

test('a font-reflow clamp reported before resize cannot replace the intended reading passage', async () => {
  const app = await ready({width: 390, height: 650, fontSize: 32});
  const first = app.document.createElement('p');
  const passage = app.document.createElement('p');
  first.textContent = 'Earlier output'; first._offsetTop = 0;
  passage.textContent = 'Current reading passage'; passage._offsetTop = 600;
  app.output.replaceChildren(first, passage);
  app.screen._scrollHeight = 1000;
  scrollOutput(app, 610);
  app.dispatch(app.screen, 'pointerdown');
  app.change('preserved draft');
  app.resetMetrics();

  // Font reflow can shorten content and clamp scroll before resize is handled,
  // while the scroll pane's width and height both remain unchanged.
  passage._offsetTop = 250;
  app.screen._scrollHeight = 500;
  app.screen._scrollTop = 300;
  app.globals.getComputedStyle = () => ({fontSize: '24px'});
  app.dispatch(app.screen, 'scroll');
  assert.equal(app.metrics.geometryReads, 0, 'The automatic clamp must not become a new reading bookmark');
  assert.equal(app.metrics.scrollWrites, 0);
  app.dispatch(app.window, 'resize'); app.flushFrame();
  assert.equal(app.screen.scrollTop, 260, 'Restore the same passage offset after the shorter reflow');
  assert.equal(app.metrics.geometryReads, 1);
  assert.equal(app.metrics.scrollWrites, 1);

  passage._offsetTop = 600;
  app.screen._scrollHeight = 1000;
  app.globals.getComputedStyle = () => ({fontSize: '32px'});
  app.dispatch(app.window, 'resize'); app.flushFrame();
  assert.equal(app.screen.scrollTop, 610, 'Returning to larger text restores the original reading position');
  assert.equal(app.metrics.geometryReads, 2);
  assert.equal(app.metrics.scrollWrites, 2);
  assert.equal(app.input.value, 'preserved draft');
  assert.equal(app.metrics.focusCalls.length, 0);
  assert.equal(app.metrics.heightWrites, 0);
  assert.equal(app.metrics.offsetWrites, 0);
  assert.equal(app.pendingFrames, 0);
  assert.equal(app.pendingTimers, 0);
});

test('native and visual-only reports share frame sizing without disturbing the reader', async () => {
  const app = await ready({width: 390, height: 650});
  app.input.focus(); app.change('unfinished command');
  scrollOutput(app, 123);
  app.resetMetrics();
  for (const height of [260, 650]) {
    app.resize(390, height); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), `${height}px`);
    assert.equal(app.terminal.classList.contains('compact'), height === 260);
  }
  assert.equal(app.metrics.heightWrites, 2, 'Frame height changes once with each native resize');

  app.panVisualViewport(260, 390); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '260px');
  assert.equal(app.terminal.style.marginTop, '390px');
  assert.equal(app.terminal.classList.contains('compact'), true);
  assert.equal(app.metrics.heightWrites, 3);

  app.resize(390, 260); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '260px', 'Native sizing preserves an already matching frame height');
  assert.equal(app.terminal.style.marginTop, '', 'Native sizing rejects a stale visual pan');
  assert.equal(app.terminal.classList.contains('compact'), true);
  assert.equal(app.metrics.heightWrites, 3, 'Matching native and visual reports do not rewrite the height');
  app.resize(390, 650); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '650px');
  assert.equal(app.terminal.classList.contains('compact'), false);
  assert.equal(app.metrics.heightWrites, 4);
  assert.equal(app.input.value, 'unfinished command');
  assert.equal(app.document.activeElement, app.input);
  assert.equal(app.screen.scrollTop, 123);
  assert.equal(app.metrics.focusCalls.length, 0);
  assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.geometryReads, 5, 'Each changed frame reads the saved passage position once');
  assert.equal(app.pendingTimers, 0);
});

test('fractional visual reports retain one sizing owner and repeated values do not rewrite geometry', async () => {
  const app = await ready({width: 390, height: 650});
  for (const height of [649.5, 649, 650, 650.5, 651]) {
    app.panVisualViewport(height, 0); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), `${height}px`);
    const writes = app.metrics.heightWrites;
    app.panVisualViewport(height, 0); app.dispatch(app.window, 'resize'); app.flushFrame();
    assert.equal(app.metrics.heightWrites, writes, 'Duplicate reports must not rewrite frame geometry');
  }
  assert.equal(app.metrics.heightWrites, 5);
  app.panVisualViewport(648.75, 0); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '648.75px');
  assert.equal(app.metrics.heightWrites, 6);
  app.panVisualViewport(649.25, 0); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '649.25px');
  assert.equal(app.metrics.heightWrites, 7);
  app.panVisualViewport(650, 0); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '650px');
  assert.equal(app.metrics.heightWrites, 8);
  assert.equal(app.metrics.offsetWrites, 0); assert.equal(app.metrics.geometryReads, 0);
});

test('a direct touch preserves the native focus target while keyboard height arrives before its pan', async () => {
  const app = await ready({width: 390, height: 650});
  app.change('unfinished command'); scrollOutput(app, 123);
  touchFocus(app); app.resetMetrics();
  app.globals.visualViewport.height = 260;
  app.dispatch(app.globals.visualViewport, 'resize'); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '650px', 'An early height endpoint must not move the field the browser is revealing');
  assert.equal(app.terminal.style.marginTop, '');
  assert.equal(app.terminal.classList.contains('compact'), true, 'Compact controls can fold without moving the native focus target');
  for (const offset of [40, 180, 340, 390]) {
    app.globals.visualViewport.offsetTop = offset;
    app.dispatch(app.globals.visualViewport, 'scroll'); app.flushFrame();
    assert.equal(Number.parseFloat(app.terminal.style.getPropertyValue('--viewport-height')) +
      Number.parseFloat(app.terminal.style.marginTop), 650,
      'Frame height and origin must preserve its layout bottom while native panning moves the field');
  }
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '260px');
  assert.equal(app.terminal.style.marginTop, '390px');
  assert.equal(app.terminal.classList.contains('compact'), true);
  assert.equal(app.metrics.heightWrites, 4); assert.equal(app.metrics.offsetWrites, 4);
  assert.equal(app.input.value, 'unfinished command');
  assert.equal(app.document.activeElement, app.input); assert.equal(app.screen.scrollTop, 123);
  assert.equal(app.metrics.focusCalls.length, 0); assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.geometryReads, 5, 'Folding controls and each native pan read the saved passage once');
  assert.equal(app.pendingTimers, 1);
  app.advanceTime(1000); app.flushFrame();
  assert.equal(app.metrics.geometryReads, 6, 'Settling measures the native focus target once');
  assert.equal(app.pendingTimers, 0);
  assert.equal(app.metrics.heightWrites, 4, 'Completed native pan leaves no delayed correction');
});

test('a partial or missing native pan cannot leave the input permanently behind the keyboard', async () => {
  for (const offset of [0, 170]) {
    const app = await ready({width: 390, height: 650});
    touchFocus(app); app.resetMetrics();
    app.panVisualViewport(260, offset); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), `${650 - offset}px`);
    app.advanceTime(1000); app.flushFrame();
    assert.equal(app.pendingFrames, 1, 'Occluded input gets one following frame to apply the fallback');
    app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '260px');
    assert.equal(app.terminal.style.marginTop, offset ? `${offset}px` : '');
    assert.equal(app.terminal.classList.contains('compact'), true);
    assert.equal(app.metrics.geometryReads, 1);
    assert.equal(app.pendingTimers, 0); assert.equal(app.pendingFrames, 0);
    const scheduled = app.metrics.framesScheduled;
    app.advanceTime(1000); app.flushFrame();
    assert.equal(app.metrics.framesScheduled, scheduled, 'Settling must not create a polling loop');
  }
});

test('a taller keyboard releases the anchor only when the input would be covered', async () => {
  for (const laterOffset of [370, 410]) {
    const app = await ready({width: 390, height: 650});
    touchFocus(app);
    app.panVisualViewport(260, 370); app.flushFrame();
    app.input._bottom = 625;
    app.resetMetrics();
    app.advanceTime(1000); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '280px', 'Do not correct a visible input merely because native pan stopped short of the full frame');
    assert.equal(app.terminal.style.marginTop, '370px');
    assert.equal(app.metrics.heightWrites, 0); assert.equal(app.metrics.offsetWrites, 0);
    assert.equal(app.metrics.geometryReads, 1); assert.equal(app.pendingTimers, 0);
    app.panVisualViewport(220, laterOffset); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), laterOffset === 370 ? '220px' : '240px',
      'A visible input keeps its position even when a larger keyboard leaves less output space');
    assert.equal(app.metrics.geometryReads, 1, 'Later reports need no extra layout measurement');
  }
});

test('small viewport fluctuations after settling cannot move a visible native focus target', async () => {
  const app = await ready({width: 390, height: 650});
  touchFocus(app); app.change('steady draft'); scrollOutput(app, 37);
  app.panVisualViewport(260, 389); app.flushFrame();
  app.advanceTime(1000); app.flushFrame();
  const timers = app.metrics.timersScheduled;
  app.resetMetrics();
  for (const height of [258, 261, 258, 260, 257, 260]) {
    app.globals.visualViewport.height = height;
    app.dispatch(app.globals.visualViewport, 'resize'); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '261px');
    assert.equal(app.terminal.style.marginTop, '389px');
    assert.equal(app.document.activeElement, app.input);
    assert.equal(app.input.value, 'steady draft'); assert.equal(app.screen.scrollTop, 37);
  }
  assert.equal(app.metrics.heightWrites, 0); assert.equal(app.metrics.offsetWrites, 0);
  assert.equal(app.metrics.geometryReads, 0); assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.focusCalls.length, 0);
  assert.equal(app.metrics.timersScheduled, timers); assert.equal(app.pendingTimers, 0);
  assert.equal(app.pendingFrames, 0);
});

test('fractional document scrolling does not discard an already visible partial-pan anchor', async () => {
  const app = await ready({width: 390, height: 650});
  touchFocus(app); app.panVisualViewport(260, 370); app.flushFrame();
  app.advanceTime(1000); app.flushFrame();
  const timers = app.metrics.timersScheduled;
  app.resetMetrics();
  for (const scroll of [.5, 1, .25, 0]) {
    app.window.scrollY = scroll;
    app.dispatch(app.globals.visualViewport, 'scroll'); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '280px');
    assert.equal(app.terminal.style.marginTop, '370px');
  }
  assert.equal(app.metrics.heightWrites, 0); assert.equal(app.metrics.offsetWrites, 0);
  assert.equal(app.metrics.geometryReads, 0); assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.timersScheduled, timers); assert.equal(app.pendingTimers, 0);
});

test('late layout-height corrections keep an already visible keyboard input stationary', async () => {
  for (const elapsed of [300, 400]) {
    const app = await ready({width: 390, height: 650});
    touchFocus(app); app.change('steady draft'); scrollOutput(app, 37);
    app.panVisualViewport(260, 389); app.flushFrame();
    app.input._bottom = 625;
    app.advanceTime(elapsed); app.flushFrame();
    app.resetMetrics();
    // Browser chrome can correct the layout height independently of the
    // keyboard's visual height, including around the handoff deadline.
    for (const [layout, visual] of [[652, 263], [651, 261], [650, 260], [648, 258], [650, 260]]) {
      app.globals.innerHeight = layout;
      app.panVisualViewport(visual, 389);
      app.dispatch(app.window, 'resize'); app.flushFrame();
      const height = Number.parseFloat(app.terminal.style.getPropertyValue('--viewport-height'));
      const top = Number.parseFloat(app.terminal.style.marginTop);
      assert.equal(height + top, 650, 'A late browser-height correction must not move the native focus target down and back');
      assert.equal(app.document.activeElement, app.input);
      assert.equal(app.input.value, 'steady draft'); assert.equal(app.screen.scrollTop, 37);
    }
    app.advanceTime(1000); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '261px');
    assert.equal(app.metrics.heightWrites, 0); assert.equal(app.metrics.offsetWrites, 0);
    assert.equal(app.metrics.scrollWrites, 0); assert.equal(app.metrics.focusCalls.length, 0);
    assert.equal(app.pendingTimers, 0); assert.equal(app.pendingFrames, 0);
  }
});

test('small layout corrections before native pan retain the exact focus target', async () => {
  for (const correction of [-1, -.5, .5, 1]) {
    const app = await ready({width: 390, height: 650});
    touchFocus(app); app.change('unmoved draft');
    app.panVisualViewport(260, 0); app.flushFrame();
    app.globals.innerHeight = 650 + correction;
    app.dispatch(app.window, 'resize'); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '650px',
      `${correction}px correction must not hand an anchored target back to changing CSS viewport units`);
    assert.equal(app.terminal.style.marginTop, '');
    app.panVisualViewport(260, 389); app.flushFrame();
    assert.equal(Number.parseFloat(app.terminal.style.getPropertyValue('--viewport-height')) +
      Number.parseFloat(app.terminal.style.marginTop), 650);
    app.input._bottom = 625;
    app.advanceTime(400); app.flushFrame();
    assert.equal(app.document.activeElement, app.input);
    assert.equal(app.input.value, 'unmoved draft');
    assert.equal(app.pendingTimers, 0); assert.equal(app.pendingFrames, 0);
  }
});

test('separately delivered late layout and visual reports keep the anchored bottom fixed', async () => {
  for (const layoutFirst of [true, false]) {
    const app = await ready({width: 390, height: 650});
    touchFocus(app); app.panVisualViewport(260, 389); app.flushFrame();
    app.input._bottom = 625;
    app.advanceTime(400); app.flushFrame(); app.resetMetrics();
    const timers = app.metrics.timersScheduled;
    for (const [layout, visual] of [[652, 263], [648, 258], [650, 260]]) {
      const updateLayout = () => { app.globals.innerHeight = layout; app.dispatch(app.window, 'resize'); };
      const updateVisual = () => app.panVisualViewport(visual, 389);
      for (const update of layoutFirst ? [updateLayout, updateVisual] : [updateVisual, updateLayout]) {
        update(); app.flushFrame();
        assert.equal(Number.parseFloat(app.terminal.style.getPropertyValue('--viewport-height')) +
          Number.parseFloat(app.terminal.style.marginTop), 650,
          'Report ordering and offset clamping must not create a second input move');
      }
    }
    assert.equal(app.metrics.geometryReads, 0); assert.equal(app.metrics.scrollWrites, 0);
    assert.equal(app.metrics.focusCalls.length, 0); assert.equal(app.metrics.timersScheduled, timers);
    assert.equal(app.pendingTimers, 0); assert.equal(app.pendingFrames, 0);
  }
});

test('layout correction tolerance includes both four-pixel boundaries without accumulating', async () => {
  for (const direction of [-1, 1]) {
    const app = await ready({width: 390, height: 650});
    touchFocus(app); app.panVisualViewport(260, 389); app.flushFrame();
    app.input._bottom = 625;
    app.advanceTime(400); app.flushFrame();
    for (const correction of [1, 2, 3, 4]) {
      app.globals.innerHeight = 650 + direction * correction;
      app.panVisualViewport(260 + direction * correction, 389); app.flushFrame();
      assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '261px',
        'Every correction is bounded against the original focus height');
    }
    app.globals.innerHeight = 650 + direction * 4.5;
    app.panVisualViewport(260 + direction * 4.5, 389); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), `${260 + direction * 4.5}px`,
      'A change beyond the bound immediately resumes measured viewport sizing');
    assert.equal(app.pendingTimers, 0); assert.equal(app.pendingFrames, 0);
  }
});

test('retaining the keyboard anchor still yields to real resizing and input occlusion', async () => {
  for (const change of ['content resize', 'layout resize', 'cumulative resize', 'rotation', 'occlusion']) {
    const app = await ready({width: 390, height: 650, coarsePointer: true});
    touchFocus(app); app.panVisualViewport(260, 389); app.flushFrame();
    app.input._bottom = 625;
    app.advanceTime(400); app.flushFrame();
    app.globals.innerHeight = 652;
    app.panVisualViewport(263, 389); app.flushFrame();
    if (change === 'content resize') app.resize(390, 648);
    else if (change === 'cumulative resize') {
      app.globals.innerHeight = 654;
      app.panVisualViewport(265, 389); app.flushFrame();
      assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '261px');
      app.globals.innerHeight = 656;
      app.panVisualViewport(267, 389);
    } else if (change === 'rotation') {
      app.resize(844, 390); app.panVisualViewport(200, 190);
    } else {
      app.globals.innerHeight = change === 'layout resize' ? 690 : 652;
      app.panVisualViewport(change === 'layout resize' ? 300 : 220, 389);
    }
    app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'),
      {'content resize': '648px', 'layout resize': '300px', 'cumulative resize': '267px', rotation: '200px', occlusion: '220px'}[change], change);
    assert.equal(app.pendingTimers, 0); assert.equal(app.pendingFrames, 0);
  }
});

test('visibility uses document coordinates when native page scrolling reveals or covers the input', async () => {
  const app = await ready({width: 390, height: 650});
  app.window.scrollY = 100;
  touchFocus(app); app.panVisualViewport(260, 270); app.flushFrame();
  app.advanceTime(1000); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '380px',
    'The native page scroll already reveals the input, so its layout position stays anchored');
  assert.equal(app.metrics.geometryReads, 1);
  app.resetMetrics();
  app.window.scrollY = 98;
  app.dispatch(app.globals.visualViewport, 'scroll'); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '380px');
  app.window.scrollY = 0;
  app.dispatch(app.globals.visualViewport, 'scroll'); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '260px',
    'A genuinely covered input gets the measured-height fallback');
  assert.equal(app.terminal.style.marginTop, '270px');
  assert.equal(app.metrics.heightWrites, 1); assert.equal(app.metrics.offsetWrites, 0);
  assert.equal(app.metrics.geometryReads, 0); assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.focusCalls.length, 0); assert.equal(app.pendingTimers, 0);
});

test('an early scrollend cannot terminate the keyboard handoff while its partial pan is still unfolding', async () => {
  const app = await ready({width: 390, height: 650});
  touchFocus(app);
  app.panVisualViewport(260, 170); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '480px');
  app.resetMetrics();
  app.dispatch(app.globals.visualViewport, 'scrollend'); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '480px');
  assert.equal(app.terminal.style.marginTop, '170px');
  assert.equal(app.pendingTimers, 1); assert.equal(app.metrics.geometryReads, 0);
  app.panVisualViewport(260, 370); app.flushFrame();
  app.advanceTime(1000); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '280px');
  assert.equal(app.pendingTimers, 0); assert.equal(app.pendingFrames, 0);
  assert.equal(app.metrics.geometryReads, 1);
});

test('Done before the first keyboard report rejects late opening and closing reports', async () => {
  const app = await ready({width: 390, height: 650});
  touchFocus(app); app.change('quick draft');
  app.document.activeElement = app.document.body;
  app.dispatch(app.input, 'blur'); app.flushFrame(); app.resetMetrics();
  for (const [height, offset] of [[260, 0], [260, 390], [650, 0], [260, 200], [650, 0]]) {
    app.panVisualViewport(height, offset); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '650px');
    assert.equal(app.terminal.style.marginTop, '');
    assert.equal(app.terminal.classList.contains('compact'), false);
  }
  assert.equal(app.input.value, 'quick draft');
  assert.equal(app.metrics.heightWrites, 0); assert.equal(app.metrics.offsetWrites, 0);
  assert.equal(app.pendingTimers, 0);
});

test('Done restores layout height before the delayed visual viewport close reports arrive', async () => {
  const app = await ready({width: 390, height: 650});
  touchFocus(app); app.change('preserved draft');
  app.panVisualViewport(260, 390); app.flushFrame();
  scrollOutput(app, 123); app.resetMetrics();
  app.document.activeElement = app.document.body;
  app.dispatch(app.input, 'blur'); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '650px');
  assert.equal(app.terminal.style.marginTop, '');
  assert.equal(app.terminal.classList.contains('compact'), false);
  for (const offset of [350, 170, 0]) {
    app.globals.visualViewport.offsetTop = offset;
    app.dispatch(app.globals.visualViewport, 'scroll'); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '650px', 'A stale short viewport must not pull the dismissed prompt back up');
    assert.equal(app.terminal.style.marginTop, '');
  }
  app.globals.visualViewport.height = 650;
  app.dispatch(app.globals.visualViewport, 'resize'); app.flushFrame();
  assert.equal(app.input.value, 'preserved draft'); assert.equal(app.screen.scrollTop, 123);
  assert.equal(app.metrics.heightWrites, 1); assert.equal(app.metrics.offsetWrites, 1);
  assert.equal(app.metrics.scrollWrites, 0); assert.equal(app.metrics.focusCalls.length, 0);
  assert.equal(app.pendingTimers, 0);
});

test('refocusing during a partial keyboard dismissal starts a fresh native handoff without moving its target', async () => {
  const app = await ready({width: 390, height: 650});
  touchFocus(app); app.change('resume typing');
  app.panVisualViewport(260, 390); app.flushFrame();
  app.document.activeElement = app.document.body;
  app.dispatch(app.input, 'blur'); app.flushFrame();
  app.panVisualViewport(260, 170); app.flushFrame();
  touchFocus(app);
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '480px');
  assert.equal(app.terminal.style.marginTop, '170px');
  assert.equal(app.document.activeElement, app.input); assert.equal(app.input.value, 'resume typing');
  assert.equal(app.pendingTimers, 1);
  app.panVisualViewport(260, 370); app.flushFrame();
  app.advanceTime(1000); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '280px');
  assert.equal(app.terminal.style.marginTop, '370px');
  assert.equal(app.pendingTimers, 0); assert.equal(app.pendingFrames, 0);
});

test('backgrounding cancels the handoff timer and returning fits the current viewport once', async () => {
  const app = await ready({width: 390, height: 650});
  touchFocus(app); app.panVisualViewport(260, 170); app.flushFrame();
  app.setHidden(true); app.resetMetrics();
  assert.equal(app.pendingTimers, 0);
  app.advanceTime(1000); app.flushFrame();
  assert.equal(app.metrics.geometryReads, 0); assert.equal(app.pendingFrames, 0);
  app.setHidden(false); app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '260px');
  assert.equal(app.terminal.style.marginTop, '170px');
  assert.equal(app.pendingTimers, 0); assert.equal(app.pendingFrames, 0);
});

test('native resizing and reduced motion release the touch handoff immediately', async () => {
  for (const change of ['native resize', 'reduced motion']) {
    const app = await ready({width: 390, height: 650});
    touchFocus(app); app.panVisualViewport(260, 0); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '650px');
    if (change === 'native resize') app.resize(390, 260);
    else app.setReducedMotion(true);
    app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '260px', change);
    assert.equal(app.terminal.classList.contains('compact'), true, change);
    assert.equal(app.pendingTimers, 0, change);
  }
});

test('reduced motion and desktop never wait for a native pan handoff', async () => {
  for (const options of [{reducedMotion: true}, {width: 1000}]) {
    const app = await ready({width: 390, height: 650, ...options});
    touchFocus(app);
    app.panVisualViewport(260, 0); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), options.width ? '' : '260px');
    assert.equal(app.pendingTimers, 0);
  }
});

test('focusing through prompt-row padding permits native reveal on mobile while desktop prevents scrolling', async () => {
  for (const width of [390, 1000]) {
    const app = await ready({width, height: 650});
    app.click(app.form);
    assert.equal(app.document.activeElement, app.input);
    assert.equal(app.metrics.focusCalls.at(-1).options.preventScroll, width === 1000);
    // The model records focus calls but requires explicit native focus events.
    app.dispatch(app.input, 'focus'); app.flushFrame();
    app.panVisualViewport(260, 170); app.flushFrame();
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), width === 390 ? '480px' : '');
    assert.equal(app.pendingTimers, width === 390 ? 1 : 0);
  }
});

test('already focused command actions do not restart native focus or keyboard movement', async () => {
  const app = await ready({width: 390, height: 650});
  app.input.focus(); app.resetMetrics();
  app.submit('pwd');
  app.submit('help');
  app.key('ArrowUp');
  app.change('hel'); app.key('Tab');
  app.click(app.form);
  assert.equal(app.document.activeElement, app.input);
  assert.equal(app.metrics.focusCalls.length, 0);
});

test('visual viewport resize and pan coalesce without disturbing typing or reader position', async () => {
  const app = await ready({width: 390, height: 650});
  app.input.focus(); app.change('unfinished command');
  scrollOutput(app, 123);
  app.resetMetrics();
  for (let index = 0; index < 50; index++) app.panVisualViewport(260, 390);
  assert.equal(app.globals.innerHeight, 650, 'Keyboard panning need not resize the layout viewport');
  assert.equal(app.pendingFrames, 1);
  assert.equal(app.metrics.heightWrites, 0); assert.equal(app.metrics.offsetWrites, 0);
  app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '260px');
  assert.equal(app.terminal.style.marginTop, '390px');
  assert.equal(app.metrics.heightWrites, 1); assert.equal(app.metrics.offsetWrites, 1);
  app.panVisualViewport(260, 390); app.flushFrame();
  assert.equal(app.metrics.heightWrites, 1); assert.equal(app.metrics.offsetWrites, 1);
  app.globals.visualViewport.offsetTop = 350;
  app.dispatch(app.globals.visualViewport, 'scroll'); app.flushFrame();
  assert.equal(app.terminal.style.marginTop, '350px', 'A pan-only event updates the frame position');
  assert.equal(app.metrics.heightWrites, 1); assert.equal(app.metrics.offsetWrites, 2);
  assert.equal(app.input.value, 'unfinished command');
  assert.equal(app.document.activeElement, app.input);
  assert.equal(app.screen.scrollTop, 123);
  assert.equal(app.metrics.focusCalls.length, 0);
  assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.geometryReads, 2, 'Only changed frames read the saved passage position');
  assert.equal(app.pendingTimers, 0);
});

test('viewport compensation follows native panning but does not chase document scrolling', async () => {
  const app = await ready({width: 390, height: 650});
  for (const [height, offset] of [[500, 150], [350, 300], [260, 390], [350, 300], [500, 150]]) {
    app.panVisualViewport(height, offset); app.flushFrame();
    assert.equal(Number.parseFloat(app.terminal.style.marginTop) + height, 650,
      'The frame bottom stays at the native visual viewport bottom through opening and closing');
  }
  app.globals.visualViewport.pageTop = 270;
  app.window.scrollY = 120;
  app.globals.scrollY = 120;
  app.resetMetrics();
  app.dispatch(app.window, 'scroll');
  app.dispatch(app.globals.visualViewport, 'scroll'); app.flushFrame();
  assert.equal(app.terminal.style.marginTop, '150px');
  assert.equal(app.metrics.offsetWrites, 0); assert.equal(app.metrics.scrollWrites, 0);
  app.panVisualViewport(650, 150); app.flushFrame();
  assert.equal(Number.parseFloat(app.terminal.style.marginTop) || 0, 0,
    'Restored height rejects an offset left over from keyboard dismissal');
  app.resetMetrics();
  app.panVisualViewport(650, 0); app.flushFrame();
  assert.equal(app.metrics.offsetWrites, 0);
  app.panVisualViewport(260, -8); app.flushFrame();
  assert.equal(Number.parseFloat(app.terminal.style.marginTop) || 0, 0, 'Overscroll does not pull the frame above its normal origin');
  app.panVisualViewport(260, 800); app.flushFrame();
  assert.equal(app.terminal.style.marginTop, '390px', 'Offset compensation stays within the layout viewport');
});

test('viewport panning respects pinch zoom, remains stable on wide touch screens and clears on desktop', async () => {
  const app = await ready({width: 390, height: 650});
  app.input.focus(); app.change('draft across zoom'); scrollOutput(app, 79);
  app.panVisualViewport(260, 390); app.flushFrame(); app.resetMetrics();
  app.panVisualViewport(130, 520, 2); app.flushFrame();
  assert.equal(app.terminal.style.marginTop, '390px');
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '260px');
  assert.equal(app.metrics.heightWrites, 0); assert.equal(app.metrics.offsetWrites, 0);
  app.panVisualViewport(300, 350); app.flushFrame();
  assert.equal(app.terminal.style.marginTop, '350px');
  app.resize(1280, 900); app.flushFrame();
  assert.equal(app.terminal.style.marginTop, '');
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '');
  assert.equal(app.input.value, 'draft across zoom'); assert.equal(app.document.activeElement, app.input);
  assert.equal(app.screen.scrollTop, 79); assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.focusCalls.length, 0);

  const tablet = await ready({width: 844, height: 700, coarsePointer: true});
  tablet.panVisualViewport(220, 480); tablet.flushFrame();
  assert.equal(tablet.terminal.style.marginTop, '480px');
  tablet.panVisualViewport(500, 200); tablet.flushFrame();
  assert.equal(tablet.terminal.style.marginTop, '200px',
    'Wide touch frames keep the same viewport positioning outside compact mode');
  assert.equal(tablet.terminal.classList.contains('compact'), false);
  assert.equal(tablet.terminal.classList.contains('mobile'), true);
  tablet.panVisualViewport(220, 480); tablet.flushFrame();
  tablet.setCoarsePointer(false); tablet.flushFrame();
  assert.equal(tablet.terminal.style.marginTop, '');

  const fallback = await ready({width: 390, height: 650, viewport: false});
  fallback.panVisualViewport(260, 390); fallback.flushFrame();
  assert.equal(Number.parseFloat(fallback.terminal.style.marginTop) || 0, 0);
  assert.equal(fallback.terminal.style.getPropertyValue('--viewport-height'), '650px');
});

test('pinch zoom preserves layout, draft and reader position; keyboard sizing resumes at normal scale', async () => {
  const app = await ready({width: 390, height: 650});
  app.change('unfinished');
  scrollOutput(app, 79);
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
  const body = app.output.lastElementChild.querySelector('.result');
  const opened = body.querySelector('.initial-document');
  assert.ok(opened, 'Opened documents retain the same typography and touch-link scope as the landing view');
  assert.notEqual(opened, first);
  assert.equal(opened.getAttribute('aria-label'), null, 'The enclosing result names the document without a duplicate region');
  assert.equal(opened.textContent, text);
  const permalink = body.querySelector('.file-path').querySelector('a');
  assert.equal(opened.contains(permalink), false, 'Document metadata stays outside the authored-content styling');
  assert.equal(permalink.href, '/#/README.md');
  const firstLink = first.querySelector('a');
  const nextLink = opened.querySelectorAll('a').find(link => link.href === firstLink.href);
  assert.ok(nextLink);
  assert.notEqual(firstLink, nextLink);
  first.textContent = 'reader-local mutation';
  opened.firstElementChild.textContent = 'another view-local mutation';
  app.submit('open README.md');
  const repeated = app.output.lastElementChild.querySelector('.initial-document');
  assert.notEqual(repeated, opened);
  assert.equal(repeated.textContent, text, 'Opening again clones the canonical document, not either mutated view');
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
  assert.equal(link.href, '/#/README.md');
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
  assert.equal(app.document.activeElement, app.document.querySelector('.site-name'));
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

test('malformed and unknown legacy document links are safely rejected without autofocus or raw echo', async () => {
  for (const hash of ['#/%', '#/writing', '#/../../etc/passwd', '#/<img/src=x/onerror=alert(1)>', '#/' + 'x'.repeat(501)]) {
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

test('ordinary fragments preserve the current view, terminal directory, draft and focus', async () => {
  for (const pathname of ['/', '/projects/', '/projects/textbook/']) {
    const app = await createApp({pathname, hash: '#screen'});
    assert.equal(app.output.firstElementChild, app.initialOutput);
    assert.equal(app.output.querySelector('.error'), null);
    assert.equal(app.metrics.focusCalls.length, 0);
    app.submit('cd /projects');
    app.submit('pwd');
    const lastResult = app.output.lastElementChild;
    app.input.focus();
    app.change('retained draft');
    app.navigateHash('#overview');
    assert.equal(app.output.lastElementChild, lastResult);
    assert.equal(app.prompt.textContent, 'guest:~/projects $');
    assert.equal(app.input.value, 'retained draft');
    assert.equal(app.document.activeElement, app.input);
    app.history.back();
    assert.equal(app.output.lastElementChild, lastResult);
    assert.equal(app.prompt.textContent, 'guest:~/projects $');
  }
});

test('Back and Forward across ordinary fragments restore saved directories without replacing the transcript', async () => {
  for (const pathname of ['/', '/projects/', '/projects/textbook/']) {
    const app = await ready({pathname});
    app.submit('cd /');
    app.navigateHash('#screen');
    app.submit('cd /projects');
    const lastResult = app.output.lastElementChild;
    app.change('retained draft');
    app.history.back();
    assert.equal(app.location.hash, '');
    assert.equal(app.prompt.textContent, 'guest:~ $');
    assert.equal(app.history.state.terminal.cwd, '/');
    assert.equal(app.output.lastElementChild, lastResult);
    assert.equal(app.input.value, 'retained draft');
    app.history.forward();
    assert.equal(app.location.hash, '#screen');
    assert.equal(app.prompt.textContent, 'guest:~/projects $');
    assert.equal(app.history.state.terminal.cwd, '/projects');
    assert.equal(app.output.lastElementChild, lastResult);
    assert.equal(app.input.value, 'retained draft');
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
  assert.equal(app.output.firstElementChild.textContent, renderedText);
  assert.equal(app.output.querySelector('.error'), null);
  app.submit('history');
  assert.deepEqual(app.output.lastElementChild.querySelectorAll('button').map(node => node.textContent), ['cd /', 'history']);
});

test('repeated browser navigation remains output-bounded and adds no per-result listeners', async () => {
  const app = await ready();
  app.submit('open README.md');
  app.navigateHash('#/not-a-document');
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
  app.navigateHash('#/not-a-document');
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
  scrollOutput(app, 123);
  app.resetMetrics();
  for (const [width, height, compact] of [[390, 300, true], [390, 650, false], [390, 300, true], [1000, 300, false]]) {
    app.resize(width, height);
    app.flushFrame();
    assert.equal(app.terminal.classList.contains('compact'), compact, `${width}x${height}`);
    assert.equal(app.terminal.classList.contains('mobile'), width <= 600, `${width}x${height}`);
    assert.equal(app.input.value, 'unfinished command');
    assert.equal(app.screen.scrollTop, 123);
  }
  assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.geometryReads, 4, 'Each changed frame reads the saved passage position once');
});

test('compact layout allows more reading space when text is enlarged', async () => {
  const app = await ready({width: 390, height: 650, fontSize: 32});
  app.input.focus();
  app.change('unfinished command');
  scrollOutput(app, 123);
  app.resetMetrics();
  for (const [height, compact] of [[641, false], [640, true], [450, true], [421, true], [650, false]]) {
    app.resize(390, height);
    app.flushFrame();
    assert.equal(app.terminal.classList.contains('compact'), compact, `${height}px with enlarged text`);
    assert.equal(app.terminal.classList.contains('mobile'), true, 'Keyboard height never switches the mobile frame');
    assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), `${height}px`);
    assert.equal(app.input.value, 'unfinished command');
    assert.equal(app.document.activeElement, app.input);
    assert.equal(app.screen.scrollTop, 123);
  }
  assert.equal(app.metrics.focusCalls.length, 0);
  assert.equal(app.metrics.scrollWrites, 0);
  assert.equal(app.metrics.geometryReads, 5, 'Each changed frame reads the saved passage position once');
  const standard = await ready({width: 390, height: 441});
  assert.equal(standard.terminal.classList.contains('compact'), false);
});

test('wide touch screens receive keyboard sizing while fine-pointer desktops retain their layout', async () => {
  const app = await ready({width: 844, height: 220, fontSize: 32});
  assert.equal(app.terminal.classList.contains('compact'), false);
  assert.equal(app.terminal.classList.contains('mobile'), false);
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '');
  app.input.focus();
  app.change('unfinished');
  app.resetMetrics();
  app.setCoarsePointer(true);
  app.flushFrame();
  assert.equal(app.terminal.classList.contains('compact'), true);
  assert.equal(app.terminal.classList.contains('mobile'), true);
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '220px');
  app.resize(844, 700);
  app.flushFrame();
  assert.equal(app.terminal.classList.contains('compact'), false);
  assert.equal(app.terminal.classList.contains('mobile'), true, 'Closing the keyboard retains the wide touch frame');
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '700px');
  app.setCoarsePointer(false);
  app.flushFrame();
  assert.equal(app.terminal.style.getPropertyValue('--viewport-height'), '');
  assert.equal(app.terminal.classList.contains('mobile'), false);
  assert.equal(app.input.value, 'unfinished');
  assert.equal(app.document.activeElement, app.input);
  assert.equal(app.metrics.focusCalls.length, 0);
  assert.equal(app.metrics.scrollWrites, 0);
  const touch = await ready({width: 844, height: 220, coarsePointer: true});
  assert.equal(touch.terminal.classList.contains('compact'), true);
});

test('compact Tools disclosure preserves the draft and focus without submitting a command', async () => {
  const app = await ready({width: 390, height: 250});
  app.input.focus();
  app.change('h');
  app.key('Tab');
  assert.equal(app.completionPanel.hidden, false);
  const output = app.output.textContent;
  const label = app.document.createElement('span');
  app.toolsToggle.append(label);
  app.resetMetrics();
  app.click(label);
  assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(app.toolsToggle.getAttribute('aria-controls'), app.toolbar.id);
  assert.equal(app.terminal.classList.contains('tools-open'), true);
  assert.equal(app.completionPanel.hidden, true);
  assert.equal(app.input.value, 'h');
  assert.equal(app.output.textContent, output);
  assert.equal(app.document.activeElement, app.input);
  app.click(app.toolsToggle);
  assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(app.terminal.classList.contains('tools-open'), false);
  assert.equal(app.metrics.focusCalls.length, 0);
  assert.equal(app.metrics.geometryReads, 0);
  app.change('h');
  app.click(app.toolsToggle);
  app.key('Tab');
  assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(app.completionPanel.hidden, false, 'Tab completion replaces Tools instead of overlapping it');
  for (const type of ['beforeinput', 'input', 'compositionstart']) {
    app.change('unfinished');
    app.click(app.toolsToggle);
    app.dispatch(app.input, type);
    assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'false', type);
    assert.equal(app.input.value, 'unfinished');
    assert.equal(app.document.activeElement, app.input);
    if (type === 'compositionstart') app.dispatch(app.input, 'compositionend');
  }
});

test('pointer activation of Tools keeps an existing input focus without blocking other pointers', async () => {
  const app = await ready({width: 390, height: 250});
  const nested = app.document.createElement('span');
  app.toolsToggle.append(nested);
  app.input.focus();
  for (const target of [nested, button(app, 'complete'), button(app, 'previous')]) {
    assert.equal(app.dispatch(target, 'pointerdown').defaultPrevented, false, 'Touch clicks must not be suppressed');
    assert.equal(app.dispatch(target, 'mousedown').defaultPrevented, true);
  }
  for (const [target, init] of [[app.toolsToggle, {button: 2}], [app.input, {}], [app.screen, {}]]) {
    assert.equal(app.dispatch(target, 'mousedown', init).defaultPrevented, false);
  }
  app.screen.focus();
  assert.equal(app.dispatch(app.toolsToggle, 'mousedown').defaultPrevented, false);
  assert.equal(app.document.activeElement, app.screen);
  app.resize(1000, 800);
  app.flushFrame();
  app.input.focus();
  assert.equal(app.dispatch(button(app, 'complete'), 'mousedown').defaultPrevented, true,
    'Input-retaining shortcuts preserve focus before compact mode and on desktop');
  assert.equal(app.dispatch(app.document.querySelector('.show-commands'), 'mousedown').defaultPrevented, false,
    'Normal browsing controls retain native pointer focus');
});

test('Run, recall and completion clicks do not blur a focused input before returning to it', async () => {
  for (const [width, height] of [[390, 650], [390, 250], [1000, 800]]) {
    const app = await ready({width, height});
    app.input.focus();
    app.submit('bash');
    const recovery = app.output.lastElementChild.querySelector('button');
    app.change('h'); app.key('Tab');
    const choice = app.suggestions.firstElementChild;
    const nested = app.document.createElement('span');
    choice.append(nested);
    app.resetMetrics();
    for (const target of [app.runButton, recovery, nested]) {
      assert.equal(app.dispatch(target, 'pointerdown').defaultPrevented, false, 'Touch click delivery remains native');
      assert.equal(app.dispatch(target, 'mousedown').defaultPrevented, true, 'Pointer focus must not hide the keyboard');
      assert.equal(app.dispatch(target, 'mousedown', {button: 2}).defaultPrevented, false);
    }
    assert.equal(app.document.activeElement, app.input);
    assert.equal(app.metrics.focusCalls.length, 0, 'Focus retention requires no extra focus call');
    assert.equal(app.input.value, 'h');
    app.click(nested);
    assert.equal(app.input.value, 'help');
    assert.equal(app.document.activeElement, app.input);
    app.click(recovery);
    assert.equal(app.input.value, 'help');
    app.screen.focus();
    assert.equal(app.dispatch(app.runButton, 'mousedown').defaultPrevented, false,
      'A user can still focus controls normally when the input is not active');
    app.input.focus();
    app.click(app.document.querySelector('.show-commands'));
    assert.equal(app.document.activeElement, app.output.lastElementChild, 'Browsing help still moves focus to its result');
  }
});

test('tool actions close the disclosure and retain their intended input or output focus', async () => {
  const app = await ready({width: 390, height: 250});
  app.submit('pwd');
  app.change('h');
  app.click(app.toolsToggle);
  app.click(button(app, 'complete'));
  assert.equal(app.terminal.classList.contains('tools-open'), false);
  assert.equal(app.completionPanel.hidden, false);
  assert.equal(app.document.activeElement, app.input);
  app.click(app.toolsToggle);
  app.click(app.document.querySelector('.show-commands'));
  assert.equal(app.terminal.classList.contains('tools-open'), false);
  assert.ok(app.output.lastElementChild.querySelector('.help-list'));
  assert.equal(app.document.activeElement, app.output.lastElementChild);
  app.click(app.toolsToggle);
  app.click(button(app, 'previous'));
  assert.equal(app.terminal.classList.contains('tools-open'), false);
  assert.equal(app.input.value, 'help');
  assert.equal(app.document.activeElement, app.input);
});

test('Tools Escape respects composition and modifiers and restores only disclosure focus', async () => {
  const app = await ready({width: 390, height: 250});
  const complete = button(app, 'complete');
  app.click(app.toolsToggle);
  complete.focus();
  for (const init of [{isComposing: true}, {ctrlKey: true}, {altKey: true}, {metaKey: true}, {shiftKey: true}]) {
    assert.equal(app.key('Escape', init, complete).defaultPrevented, false);
    assert.equal(app.terminal.classList.contains('tools-open'), true);
  }
  assert.equal(app.key('Escape', {}, complete).defaultPrevented, true);
  assert.equal(app.terminal.classList.contains('tools-open'), false);
  assert.equal(app.document.activeElement, app.toolsToggle);
  app.input.focus();
  app.click(app.toolsToggle);
  app.key('Escape');
  assert.equal(app.terminal.classList.contains('tools-open'), false);
  assert.equal(app.document.activeElement, app.input);
});

test('leaving Tools closes it without reopening the keyboard or changing the draft', async () => {
  const app = await ready({width: 390, height: 250});
  app.change('unfinished');
  app.click(app.toolsToggle);
  app.screen.focus();
  app.click(app.screen);
  assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(app.document.activeElement, app.screen);
  app.click(app.toolsToggle);
  app.document.body.focus();
  app.click(app.document.body);
  assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(app.document.activeElement, app.document.body);
  assert.equal(app.input.value, 'unfinished');
  const help = app.document.querySelector('.show-commands');
  app.toolsToggle.focus();
  app.click(app.toolsToggle);
  app.dispatch(app.toolsToggle, 'focusout', {relatedTarget: app.runButton});
  assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'true');
  app.runButton.focus();
  app.dispatch(app.runButton, 'focusout', {relatedTarget: help});
  assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'true');
  help.focus();
  app.dispatch(help, 'focusout', {relatedTarget: null});
  assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'true');
  app.input.focus();
  app.dispatch(help, 'focusout', {relatedTarget: app.input});
  assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(app.document.activeElement, app.input);
});

test('compact transitions keep the focused control visible without stealing input focus', async () => {
  const app = await ready({width: 390, height: 250});
  const help = app.document.querySelector('.show-commands');
  app.toolsToggle.focus();
  app.click(app.toolsToggle);
  app.resize(390, 650);
  app.flushFrame();
  assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(app.terminal.classList.contains('tools-open'), false);
  assert.equal(app.document.activeElement, help);
  app.resetMetrics();
  app.resize(390, 250);
  app.flushFrame();
  assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(app.document.activeElement, help);
  assert.equal(app.metrics.focusCalls.length, 0, 'Entering compact keeps the focused tool visible in place');
  app.key('Escape', {}, help);
  app.resize(390, 260);
  app.flushFrame();
  assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'false', 'An ordinary compact resize does not reopen Tools');
  app.input.focus();
  app.change('unfinished');
  app.click(app.toolsToggle);
  app.resetMetrics();
  app.resize(1000, 800);
  app.flushFrame();
  assert.equal(app.terminal.classList.contains('compact'), false);
  assert.equal(app.toolsToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(app.document.activeElement, app.input);
  assert.equal(app.input.value, 'unfinished');
  assert.equal(app.metrics.focusCalls.length, 0);
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
  assert.equal(app.document.querySelector('.site-name').tagName, 'H1');
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
    'Try ls /projects or open /README.md.',
  ]);
  assert.equal(result.querySelectorAll('dt').length, 8);
  assert.ok(result.querySelectorAll('dt').some(node => node.textContent === 'cat path'));
  assert.ok(result.querySelectorAll('dd').every(node => !node.textContent.includes(';')));
  assert.deepEqual(result.querySelectorAll('button').map(node => node.dataset.command), ['ls /projects', 'open /README.md']);
  for (const removed of [
    'A small, read-only interface. Not a remote shell.',
    'Tab completes once; Tab again or Shift+Tab leaves the input. With choices open, ↑ / ↓ selects and Enter accepts without running. Escape dismisses choices and keeps your draft.',
    'Without choices, ↑ / ↓ recalls history. Browser shortcuts remain yours. No flags, pipes, or multiple files.',
    'README.md is the site’s real Markdown file. cat prints its source; open formats it. Document links and Back / Forward never replay typed commands.',
  ]) assert.equal(result.textContent.includes(removed), false);
});

test('the Python surprise keeps one timer and bounded output without adding listeners or navigation', async () => {
  const app = await ready();
  app.input.focus();
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
    app.input.focus();
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
