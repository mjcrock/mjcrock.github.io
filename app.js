import {FILES, LIMITS, Session, completions, execute} from './engine.js';
import {parseDocumentHash, documentHash, navigationState, navigationCwd} from './routing.js';
import {createSnakePlayer} from './snake.js';

const $ = id => document.getElementById(id);
const output = $('output');
const screen = $('screen');
const form = $('command-form');
const runButton = form.querySelector('.run');
const input = $('command');
const prompt = $('prompt');
const suggestions = $('completions');
const completionPanel = $('completion-panel');
const completionStatus = $('completion-status');
const announcement = $('announcement');
const terminal = document.querySelector('.terminal');
const toolsToggle = $('tools-toggle');
const toolbar = $('command-tools');
const snakePlayer = createSnakePlayer(window, visible => terminal.classList.toggle('snake-active', !visible));
// The build supplies the readable document. Retain it when output is cleared.
const readme = output.firstElementChild.cloneNode(true);
const rawReadme = $('readme-source').textContent;
const session = new Session();
let choices = [];
let selectedChoice = -1;
let completionAttempted = false;
let lastNavigation = '';
let composing = false;
let readmeSource;

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

function setTools(open) {
  if (terminal.classList.contains('tools-open') === open) return;
  terminal.classList.toggle('tools-open', open);
  toolsToggle.setAttribute('aria-expanded', String(open));
}

function hideSuggestions() {
  if (completionPanel.hidden) return;
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
  setTools(false);
  snakePlayer.finish();
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

function renderErrorHint(parent, {hint, suggestions = []}) {
  const line = element('p', undefined, 'dim');
  let cursor = 0;
  while (cursor < hint.length) {
    let start = hint.length;
    let match = '';
    for (const command of suggestions) {
      if (!command) continue;
      const index = hint.indexOf(command, cursor);
      if (index >= 0 && (index < start || (index === start && command.length > match.length))) {
        start = index;
        match = command;
      }
    }
    line.append(hint.slice(cursor, start));
    if (!match) break;
    // Only model-provided recovery commands become controls. All other text
    // stays literal, and clicking fills the input without executing anything.
    const button = element('button', match, 'inline-command');
    button.type = 'button';
    button.dataset.recall = match;
    button.setAttribute('aria-label', `Fill command line with ${match}`);
    line.append(button);
    cursor = start + match.length;
  }
  parent.append(line);
}

function renderResult(parent, result) {
  if (result.kind === 'help') {
    const list = element('dl', undefined, 'help-list');
    for (const [command, description] of [
      ['help', 'Show commands'], ['ls [path]', 'List files and directories'],
      ['open [path]', 'Read a file or browse a directory'], ['cat path', 'Show a file as plain text'],
      ['cd [path]', 'Change directory'], ['pwd', 'Show the current directory'],
      ['clear', 'Clear output'], ['history', 'Show recent commands']
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
    const content = readme.cloneNode(true);
    content.removeAttribute('aria-label'); // The enclosing result already names the document.
    parent.append(content);
  } else if (result.kind === 'cat') {
    readmeSource ??= JSON.parse(rawReadme);
    parent.append(element('pre', readmeSource, 'file-text'));
  } else if (result.kind === 'snake') {
    const snake = element('pre', undefined, 'snake');
    snake.setAttribute('role', 'img');
    snake.setAttribute('aria-label', 'A coiled python flicks its tongue');
    parent.append(snake);
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
    parent.append(element('p', result.message, 'error'));
    renderErrorHint(parent, result);
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
    if (result.kind === 'snake') snakePlayer.play(body.firstElementChild);
    while (output.children.length > LIMITS.output) output.firstElementChild.remove();
    // Reveal synchronously: a later reader scroll must never be overwritten.
    screen.scrollTop = Math.max(0, block.offsetTop - 12);
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
  snakePlayer.finish();
  if (typeof raw !== 'string' || !raw.trim()) return;
  setTools(false);
  hideSuggestions();
  completionAttempted = false;
  const prefix = `guest:${displayPath()} $ `;
  const result = session.submit(raw);
  if (mode === 'typed') input.value = '';
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
  setTools(false);
  snakePlayer.finish();
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
input.addEventListener('beforeinput', () => { setTools(false); snakePlayer.finish(); });
input.addEventListener('input', () => { setTools(false); snakePlayer.finish(); completionAttempted = false; hideSuggestions(); });
input.addEventListener('compositionstart', () => { setTools(false); snakePlayer.finish(); composing = true; });
input.addEventListener('compositionend', () => { composing = false; });
input.addEventListener('keydown', event => {
  snakePlayer.finish();
  // Some IMEs report the conversion key before/after isComposing is updated.
  if (composing || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
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
  if (button === toolsToggle) {
    if (terminal.classList.contains('compact')) {
      hideSuggestions();
      setTools(toolsToggle.getAttribute('aria-expanded') !== 'true');
    }
    return;
  }
  if (toolbar.contains(button)) setTools(false);
  if (button.dataset.command !== undefined) run(button.dataset.command, 'browse');
  else if (button.dataset.recall !== undefined) {
    fillCommand(button.dataset.recall);
    announce(`Ready: ${input.value}. Press Enter to run.`);
  } else if (button.dataset.completion !== undefined) acceptChoice(Number(button.dataset.completion));
});
// Cancel focus on mousedown, not pointerdown: WebKit suppresses a touch click
// when pointerdown is canceled. Input actions must not dismiss and reopen the
// keyboard between pointer focus and click. Keyboard navigation remains native.
terminal.addEventListener('mousedown', event => {
  const button = event.target.closest('button');
  if (!button || event.button !== 0 || document.activeElement !== input) return;
  const editsInput = button === runButton || button.dataset.recall !== undefined || button.dataset.completion !== undefined ||
    (toolbar.contains(button) && button.dataset.command === undefined);
  const compactTool = terminal.classList.contains('compact') && (button === toolsToggle || toolbar.contains(button));
  if (editsInput || compactTool) event.preventDefault();
});
document.addEventListener('click', event => {
  if (!toolsToggle.contains(event.target) && !toolbar.contains(event.target)) setTools(false);
});
terminal.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || modified(event) || composing || event.keyCode === 229 ||
      toolsToggle.getAttribute('aria-expanded') !== 'true') return;
  event.preventDefault();
  setTools(false);
  if (toolbar.contains(document.activeElement)) toolsToggle.focus({preventScroll: true});
});
terminal.addEventListener('focusout', event => {
  if (event.relatedTarget && event.relatedTarget !== toolsToggle && event.relatedTarget !== runButton &&
      !toolbar.contains(event.relatedTarget)) setTools(false);
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
  setTools(false);
  snakePlayer.finish();
  lastNavigation = signature;
  session.cwd = cwd;
  updatePrompt();
  hideSuggestions();
  completionAttempted = false;
  if (route.kind === 'home') {
    if (!initial) {
      output.replaceChildren(readme.cloneNode(true));
    }
    screen.scrollTop = 0;
    if (!initial) { screen.focus({preventScroll: true}); announce('README.md. Command history retained.'); }
  } else {
    if (initial) output.replaceChildren();
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

// No initial autofocus. Resize preserves the reader's position, never the bottom.
{
  const viewport = window.visualViewport;
  const touch = window.matchMedia?.('(pointer:coarse)');
  let pending = false;
  const applyViewport = () => {
    pending = false;
    // Pinch zoom shrinks the visual viewport too. Preserve the layout so
    // magnification never masquerades as a keyboard opening or loses text.
    if (viewport?.scale && viewport.scale !== 1) return;
    const availableHeight = viewport?.height ?? innerHeight;
    const mobile = innerWidth <= 600 || Boolean(touch?.matches);
    const fontSize = mobile ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 16;
    const compact = mobile && availableHeight <= Math.max(440, 20 * fontSize);
    if (compact && !terminal.classList.contains('compact') && toolbar.contains(document.activeElement)) {
      hideSuggestions();
      setTools(true);
    }
    terminal.classList.toggle('compact', compact);
    terminal.classList.toggle('mobile', mobile);
    document.body.classList.toggle('mobile-terminal', mobile);
    if (!compact) {
      setTools(false);
      if (document.activeElement === toolsToggle) toolbar.querySelector('button').focus({preventScroll: true});
    }
    // Let native viewport sizing drive the keyboard movement where supported.
    // Only compensate when the visual viewport differs from the layout viewport
    // (allowing one pixel of rounding), or when the API is unavailable.
    const height = mobile && (!viewport || Math.abs(availableHeight - innerHeight) > 1)
      ? `${availableHeight}px` : '';
    if (terminal.style.getPropertyValue('--viewport-height') !== height) {
      if (height) terminal.style.setProperty('--viewport-height', height);
      else terminal.style.removeProperty('--viewport-height');
    }
    // A phone keyboard can pan the visual viewport without scrolling the page.
    // Follow that pan in normal flow, but never follow the reader's page scroll.
    const top = mobile
      ? Math.max(0, Math.min(viewport?.offsetTop ?? 0, innerHeight - availableHeight)) : 0;
    const margin = top ? `${top}px` : '';
    if (terminal.style.marginTop !== margin) terminal.style.marginTop = margin;
  };
  const fit = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(applyViewport);
  };
  viewport?.addEventListener('resize', fit);
  viewport?.addEventListener('scroll', fit);
  touch?.addEventListener?.('change', fit);
  window.addEventListener('resize', fit);
  // Expose controls only after their initial geometry is ready. A fast first
  // command must not be revealed against a layout that changes next frame.
  applyViewport();
}
document.querySelector('.entry').hidden = false;
navigate(true);
