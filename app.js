import {FILES, LIMITS, README_SOURCE, Session, completions, execute} from './engine.js';
import {parseDocumentHash, documentHash, navigationState, navigationCwd} from './routing.js';
import {markdownBlocks} from './markdown.js';

const $ = id => document.getElementById(id);
const output = $('output');
const screen = $('screen');
const form = $('command-form');
const input = $('command');
const prompt = $('prompt');
const suggestions = $('completions');
const completionPanel = $('completion-panel');
const completionStatus = $('completion-status');
const announcement = $('announcement');
const terminal = document.querySelector('.terminal');
const session = new Session();
let choices = [];
let selectedChoice = -1;
let completionAttempted = false;
let lastNavigation = '';
let composing = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

const displayPath = () => session.cwd === '/' ? '~' : '~' + session.cwd;
const focusInput = () => input.focus({preventScroll: true});
const announce = message => { announcement.textContent = message; };
const modified = event => event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
const updatePrompt = () => { prompt.textContent = `guest:${displayPath()} $`; };

function hideSuggestions() {
  completionPanel.hidden = true;
  suggestions.hidden = true;
  suggestions.replaceChildren();
  completionStatus.textContent = '';
  choices = [];
  selectedChoice = -1;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
}

function fillCommand(value) {
  input.value = value;
  completionAttempted = false;
  hideSuggestions();
  focusInput();
  input.setSelectionRange(value.length, value.length);
}

function commandButton(command, label = command) {
  const button = element('button', label, 'inline-command');
  button.type = 'button';
  button.dataset.command = command;
  return button;
}

function renderMarkdown(parent, source) {
  for (const block of markdownBlocks(source)) {
    const node = element(block.tag);
    for (const part of block.parts) {
      if (part.href) {
        const link = element('a', part.text, 'document-link');
        link.href = part.href;
        node.append(link);
      } else node.append(document.createTextNode(part.text));
    }
    parent.append(node);
  }
}

function initialDocument() {
  const document = element('section', undefined, 'initial-document');
  document.setAttribute('aria-label', 'README.md');
  renderMarkdown(document, README_SOURCE);
  output.append(document);
}

function renderResult(parent, result) {
  if (result.kind === 'help') {
    parent.append(element('p', 'A small, read-only interface. Not a remote shell.'));
    const list = element('dl', undefined, 'help-list');
    for (const [command, description] of [
      ['help', 'Show this guide'], ['ls [path]', 'List files and directories'],
      ['open [path]', 'Read a file or browse a directory'], ['cat path', 'Print one file as plain text; no reader or navigation'],
      ['cd [path]', 'Change directory; cd alone returns home'], ['pwd', 'Show the current directory'],
      ['clear', 'Clear output; retain history and document link'], ['history', 'Recall recent commands']
    ]) list.append(element('dt', command), element('dd', description));
    parent.append(list);
    const hint = element('p', 'Try ');
    hint.append(commandButton('cat README.md'), ' or ', commandButton('open README.md'), '.');
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
    const path = element('div', result.path, 'file-path');
    const link = element('a', 'Link to this document', 'document-link');
    link.href = documentHash(result.path);
    path.append(' · ', link);
    parent.append(path, element('h2', result.entry.title, 'file-title'));
    renderMarkdown(parent, result.source);
  } else if (result.kind === 'cat') {
    parent.append(element('pre', result.source, 'file-text'));
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
    if (result.suggestions?.length) {
      const recovery = element('div', undefined, 'recovery');
      recovery.append(element('span', 'Fill input: ', 'dim'));
      for (const command of result.suggestions) {
        const button = element('button', command, 'inline-command');
        button.type = 'button';
        button.dataset.recall = command;
        recovery.append(button);
      }
      parent.append(recovery);
    }
  } else if (result.kind === 'location') {
    parent.append(element('p', `Now in ${displayPath()}`, 'dim'));
  } else if (result.kind === 'text') parent.append(element('p', result.message));
}

function showResult(result, prefix, raw, mode, showEcho = true) {
  let block;
  if (result.kind === 'clear') {
    output.replaceChildren();
    screen.scrollTop = 0;
  } else {
    block = element('section', undefined, 'block');
    block.tabIndex = -1;
    block.setAttribute('aria-label', result.kind === 'file' ? result.entry.title : 'Command result');
    const echo = element('div', undefined, 'echo');
    echo.append(element('span', prefix, 'path'), document.createTextNode(result.invalidInput ? '[invalid input]' : raw));
    const body = element('div', undefined, 'result');
    renderResult(body, result);
    if (showEcho) block.append(echo);
    block.append(body);
    output.append(block);
    while (output.children.length > LIMITS.output) output.firstElementChild.remove();
    // Reveal synchronously: a later reader scroll must never be overwritten.
    screen.scrollTop = Math.max(0, block.offsetTop - screen.offsetTop - 12);
  }
  if (mode === 'typed') focusInput();
  else if (mode === 'browse' && block) block.focus({preventScroll: true});
  announce(result.kind === 'error' ? result.message : result.kind === 'file'
    ? `Opened ${result.entry.title}.` : result.kind === 'clear' ? 'Output cleared.' : 'Command complete.');
}

function routeSignature(route, cwd) {
  return `${route.kind}:${route.path || ''}:${cwd}`;
}

function writeNavigation(method, path, hash = window.location.hash) {
  try {
    window.history[method](navigationState(path, session.cwd), '', hash || window.location.pathname + window.location.search);
    lastNavigation = routeSignature(parseDocumentHash(window.location.hash), session.cwd);
    return true;
  } catch {
    // Restricted/overloaded history APIs must not break reading or commands.
    return false;
  }
}

function rememberCurrentCwd() {
  const route = parseDocumentHash(window.location.hash);
  const saved = window.history.state?.terminal;
  if (saved?.path === route.path && saved.cwd === session.cwd) return true;
  return writeNavigation('replaceState', route.path);
}

function rememberDocument(path) {
  rememberCurrentCwd();
  const hash = documentHash(path);
  return window.location.hash === hash
    ? rememberCurrentCwd()
    : writeNavigation('pushState', path, hash);
}

function run(raw, mode = 'typed') {
  if (typeof raw !== 'string' || !raw.trim()) return;
  hideSuggestions();
  completionAttempted = false;
  const prefix = `guest:${displayPath()} $ `;
  const result = session.submit(raw);
  input.value = '';
  updatePrompt();
  showResult(result, prefix, raw, mode);
  const linked = result.kind === 'file' ? rememberDocument(result.path) : rememberCurrentCwd();
  if (!linked) announce('Command complete. This browser could not update the document link.');
}

function recall(delta) {
  fillCommand(session.recall(delta, input.value));
}

function selectChoice(index) {
  if (!choices.length) return;
  if (selectedChoice >= 0) suggestions.children[selectedChoice].setAttribute('aria-selected', 'false');
  selectedChoice = (index + choices.length) % choices.length;
  const option = suggestions.children[selectedChoice];
  option.setAttribute('aria-selected', 'true');
  input.setAttribute('aria-activedescendant', option.id);
  // Keep keyboard selection inside the short-viewport panel, not the page.
  if (completionPanel.scrollHeight > completionPanel.clientHeight) {
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < completionPanel.scrollTop) completionPanel.scrollTop = top;
    else if (bottom > completionPanel.scrollTop + completionPanel.clientHeight) {
      completionPanel.scrollTop = bottom - completionPanel.clientHeight;
    }
  }
  announce(`${choices[selectedChoice].trimEnd()}, ${selectedChoice + 1} of ${choices.length}. Enter accepts; Tab leaves.`);
}

function acceptChoice(index = selectedChoice) {
  const value = choices[index];
  if (value === undefined) return;
  fillCommand(value);
  completionAttempted = true;
  announce(`Completed: ${value}. Press Enter to run or keep typing.`);
}

function complete() {
  const options = completions(input.value, session.cwd);
  hideSuggestions();
  completionAttempted = true;
  if (options.length === 1) {
    const changed = options[0] !== input.value;
    input.value = options[0];
    announce(changed ? `Completed: ${options[0].trimEnd()}. Tab leaves the input.` : 'Already complete. Enter runs; Tab leaves the input.');
    return changed;
  }
  completionPanel.hidden = false;
  if (!options.length) {
    completionStatus.textContent = 'No matching completion. Keep typing, or use help. Tab leaves the input.';
    announce(completionStatus.textContent);
    return false;
  }
  choices = options;
  suggestions.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  completionStatus.textContent = `${options.length} choices · ↑ ↓ select · Enter accepts · Tab leaves · Esc dismisses`;
  for (const [index, value] of options.entries()) {
    const button = element('button', value.trimEnd());
    button.type = 'button';
    button.id = `completion-${index}`;
    button.tabIndex = -1;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.dataset.completion = String(index);
    suggestions.append(button);
  }
  selectChoice(0);
  return true;
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!composing) run(input.value);
});
form.addEventListener('click', event => {
  if (event.target !== form && event.target !== prompt) return;
  if (window.getSelection()?.isCollapsed === false) {
    event.preventDefault(); // Do not turn a completed text selection into an input-focus action.
    return;
  }
  focusInput();
});
input.addEventListener('input', () => { completionAttempted = false; hideSuggestions(); });
input.addEventListener('compositionstart', () => { composing = true; });
input.addEventListener('compositionend', () => { composing = false; });
input.addEventListener('keydown', event => {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.shiftKey) {
    if (event.key === 'Tab') hideSuggestions();
    return;
  }
  if (event.key === 'Tab') {
    if (input.value.trim() && !completionAttempted) {
      if (complete()) event.preventDefault();
    } else hideSuggestions();
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    const delta = event.key === 'ArrowUp' ? -1 : 1;
    if (choices.length) selectChoice(selectedChoice + delta);
    else recall(delta);
  } else if (event.key === 'Enter' && choices.length) {
    event.preventDefault();
    acceptChoice();
  } else if (event.key === 'Escape' && !completionPanel.hidden) {
    event.preventDefault();
    hideSuggestions();
  }
});
// One handler owns static shortcuts, dynamic results, and fill-only recovery.
terminal.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !terminal.contains(button)) return;
  if (button.dataset.command !== undefined) run(button.dataset.command, 'browse');
  else if (button.dataset.recall !== undefined) {
    fillCommand(button.dataset.recall);
    announce(`Ready: ${input.value}. Press Enter to run.`);
  } else if (button.dataset.completion !== undefined) acceptChoice(Number(button.dataset.completion));
});
suggestions.addEventListener('keydown', event => {
  if (modified(event)) return;
  if (event.key === 'Escape') { event.preventDefault(); hideSuggestions(); focusInput(); }
  else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    selectChoice(selectedChoice + (event.key === 'ArrowUp' ? -1 : 1));
    focusInput();
  }
});
$('complete').addEventListener('click', () => { complete(); focusInput(); });
$('previous').addEventListener('click', () => recall(-1));
$('next').addEventListener('click', () => recall(1));
$('read-output').addEventListener('click', () => screen.focus({preventScroll: true}));

function navigate(initial = false) {
  const route = parseDocumentHash(window.location.hash);
  const cwd = navigationCwd(window.history.state, route.path);
  const signature = routeSignature(route, cwd);
  if (!initial && signature === lastNavigation) return;
  lastNavigation = signature;
  session.cwd = cwd;
  updatePrompt();
  hideSuggestions();
  completionAttempted = false;
  if (route.kind === 'home') {
    output.replaceChildren();
    initialDocument();
    screen.scrollTop = 0;
    if (!initial) { screen.focus({preventScroll: true}); announce('README.md. Command history retained.'); }
  } else {
    const result = route.kind === 'file' ? execute(`open ${route.path}`, cwd) : {
      kind: 'error', message: 'This document link is not available.',
      hint: 'Use ls / to browse the available files.', suggestions: ['ls /']
    };
    showResult(result, 'view: ', route.path || '[unavailable document]', initial ? 'passive' : 'browse', !initial);
  }
  rememberCurrentCwd();
}
window.addEventListener('popstate', () => navigate());
window.addEventListener('hashchange', () => navigate());
navigate(true);

// No initial autofocus. Resize preserves the reader's position, never the bottom.
if (window.visualViewport) {
  let pending = false;
  const fit = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      terminal.classList.toggle('compact', innerWidth <= 600 && visualViewport.height <= 420);
      const height = innerWidth <= 600 ? `${Math.max(180, visualViewport.height - 16)}px` : '';
      if (terminal.style.height !== height) terminal.style.height = height;
    });
  };
  visualViewport.addEventListener('resize', fit);
  window.addEventListener('resize', fit);
  fit();
}
