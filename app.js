import {FILES, LIMITS, Session, completions} from './engine.js';

const $ = id => document.getElementById(id);
const output = $('output');
const screen = $('screen');
const form = $('command-form');
const input = $('command');
const prompt = $('prompt');
const suggestions = $('completions');
const announcement = $('announcement');
const terminal = document.querySelector('.terminal');
const session = new Session();

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

const displayPath = () => session.cwd === '/' ? '~' : '~' + session.cwd;
const focusInput = () => input.focus({preventScroll: true});
const announce = message => { announcement.textContent = message; };

function hideSuggestions() {
  suggestions.hidden = true;
  suggestions.replaceChildren();
  input.removeAttribute('aria-controls');
}

function commandButton(command, label = command) {
  const button = element('button', label, 'inline-command');
  button.type = 'button';
  button.dataset.command = command;
  return button;
}

function welcome() {
  const wrap = element('div', undefined, 'welcome');
  wrap.append(element('div', 'Interactive study / 01', 'session-mark'), element('h1', 'Interactive terminal'));
  const hint = element('p', 'Start with ');
  hint.append(commandButton('help'), ' or browse ', commandButton('ls /'), '.');
  wrap.append(element('p', 'A small place to explore with commands.'), hint, element('p', 'Generic placeholders. No personal content.', 'dim'));
  output.append(wrap);
}

function renderResult(parent, result) {
  if (result.kind === 'help') {
    parent.append(element('p', 'A small, read-only interface. Not a remote shell.'));
    const list = element('dl', undefined, 'help-list');
    for (const [command, description] of [
      ['help', 'Show this guide'], ['ls [path]', 'List files and directories'],
      ['open [path]', 'Read a file or browse a directory'], ['cd [path]', 'Change directory; cd alone returns home'],
      ['pwd', 'Show the current directory'], ['clear', 'Clear output; retain command history'], ['history', 'Recall recent commands']
    ]) list.append(element('dt', command), element('dd', description));
    parent.append(list, element('p', 'Tab completes. ↑ / ↓ recalls history. Escape cancels input. Browser shortcuts remain yours.', 'dim'));
    const hint = element('p', 'Try ');
    hint.append(commandButton('ls /writing'), ' then ', commandButton('open /writing/sample'), '.');
    parent.append(hint);
  } else if (result.kind === 'list') {
    const list = element('div', undefined, 'listing');
    for (const path of result.entries) {
      const file = FILES[path];
      const name = path.slice(path.lastIndexOf('/') + 1) + (file.type === 'directory' ? '/' : '');
      const row = element('div', undefined, 'listing-row');
      row.append(commandButton(`open ${path}`, name), element('span', file.description || file.title));
      list.append(row);
    }
    if (!result.entries.length) list.append(element('p', 'This directory is empty.', 'dim'));
    parent.append(list);
  } else if (result.kind === 'file') {
    parent.append(element('div', result.path, 'file-path'), element('h2', result.entry.title, 'file-title'));
    for (const [index, line] of result.entry.lines.entries()) parent.append(element('p', line || '\u00a0', index === 0 ? 'dim' : undefined));
  } else if (result.kind === 'history') {
    const list = element('ol', undefined, 'history-list');
    for (const [index, command] of result.entries.entries()) {
      const row = element('li');
      const button = element('button', command);
      button.type = 'button';
      button.dataset.recall = command;
      row.append(element('span', String(index + 1).padStart(2, '0'), 'number'), button);
      list.append(row);
    }
    parent.append(list);
  } else if (result.kind === 'error') {
    parent.append(element('p', result.message, 'error'), element('p', result.hint, 'dim'));
  } else if (result.kind === 'location') {
    parent.append(element('p', `Now in ${displayPath()}`, 'dim'));
  } else if (result.kind === 'text') parent.append(element('p', result.message));
}

function run(raw, mode = 'typed') {
  if (typeof raw !== 'string' || !raw.trim()) return;
  hideSuggestions();
  const previousPrompt = `guest:${displayPath()} $ `;
  const result = session.submit(raw);
  input.value = '';
  prompt.textContent = `guest:${displayPath()} $`;
  let block;
  if (result.kind === 'clear') {
    output.replaceChildren();
    screen.scrollTop = 0;
  } else {
    block = element('section', undefined, 'block');
    block.tabIndex = -1;
    block.setAttribute('aria-label', result.kind === 'file' ? result.entry.title : 'Command result');
    const echo = element('div', undefined, 'echo');
    echo.append(element('span', previousPrompt, 'path'), document.createTextNode(result.invalidInput ? '[invalid input]' : raw));
    const body = element('div', undefined, 'result');
    renderResult(body, result);
    block.append(echo, body);
    output.append(block);
    while (output.children.length > LIMITS.output) output.firstElementChild.remove();
    // Start at a long result's beginning instead of dropping the reader at its end.
    screen.scrollTop = Math.max(0, block.offsetTop - screen.offsetTop - 12);
  }
  if (mode === 'typed') focusInput();
  else if (block) block.focus({preventScroll: true}); // No keyboard on a touch reading action.
  announce(result.kind === 'error' ? result.message : result.kind === 'file' ? `Opened ${result.entry.title}.` : result.kind === 'clear' ? 'Output cleared.' : 'Command complete.');
}

function recall(delta) {
  input.value = session.recall(delta, input.value);
  hideSuggestions();
  focusInput();
  input.setSelectionRange(input.value.length, input.value.length);
}

function complete() {
  const options = completions(input.value, session.cwd);
  if (options.length === 1 && options[0] === input.value) return false;
  hideSuggestions();
  if (options.length === 1) {
    input.value = options[0];
    announce(`Completed: ${options[0]}`);
    return true;
  }
  if (options.length > 1) {
    suggestions.hidden = false;
    input.setAttribute('aria-controls', 'completions');
    for (const value of options) {
      const button = element('button', value.trimEnd());
      button.type = 'button';
      button.dataset.recall = value;
      suggestions.append(button);
    }
    announce(`${options.length} completions available. Press Tab to reach the choices.`);
    return true;
  }
  announce('No matching completion.');
  return false;
}

form.addEventListener('submit', event => { event.preventDefault(); run(input.value); });
input.addEventListener('input', hideSuggestions);
input.addEventListener('keydown', event => {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Tab' && !event.shiftKey && input.value.trim()) {
    if (suggestions.hidden && complete()) event.preventDefault();
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    recall(event.key === 'ArrowUp' ? -1 : 1);
  } else if (event.key === 'Escape') {
    input.value = '';
    hideSuggestions();
  }
});
// One handler serves static shortcuts and dynamic result/completion buttons.
// Removed output carries no per-button listeners or captured session closures.
terminal.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !terminal.contains(button)) return;
  if (button.dataset.command !== undefined) run(button.dataset.command, 'browse');
  else if (button.dataset.recall !== undefined) {
    input.value = button.dataset.recall;
    hideSuggestions();
    focusInput();
  }
});
suggestions.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  event.preventDefault();
  hideSuggestions();
  focusInput();
});
$('complete').addEventListener('click', () => { complete(); focusInput(); });
$('previous').addEventListener('click', () => recall(-1));
$('next').addEventListener('click', () => recall(1));
$('read-output').addEventListener('click', () => screen.focus({preventScroll: true}));
welcome();

// No initial autofocus. Opening the site should never summon a software keyboard.
// Resize preserves the reader's position; it never jumps output to the bottom.
if (window.visualViewport) {
  let pending = false;
  const fit = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const height = innerWidth <= 600 ? `${Math.max(180, visualViewport.height - 16)}px` : '';
      if (terminal.style.height !== height) terminal.style.height = height;
    });
  };
  visualViewport.addEventListener('resize', fit);
  window.addEventListener('resize', fit);
  fit();
}
