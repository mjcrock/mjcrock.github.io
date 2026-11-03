import {FILES, LIMITS, Session, completions, execute} from './engine.js';
import {parseLocation, entryURL, navigationState, navigationCwd} from './routing.js';
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
// Every published page carries the small document catalog, without a fetch.
// Inert templates survive clear/navigation and are cloned only when opened.
const views = new Map(Array.from(document.querySelectorAll('template'), template =>
  [template.dataset.view, template.content.firstElementChild]));
views.set(output.dataset.route || '/README.md', output.firstElementChild.cloneNode(true));
const siteLinks = document.querySelector('.site-nav').querySelectorAll('a');
const ownerTitle = document.querySelector('.site-name').textContent;
const session = new Session();
let choices = [];
let selectedChoice = -1;
let completionAttempted = false;
let lastNavigation = '';
let composing = false;
let documentSources;

// Keep the intended passage even when a larger pane clamps its scroll offset.
// Expected positions distinguish our asynchronous scroll events from reading.
const reading = (() => {
  let mark = null, expected = 0, width, height, extent;
  const sample = () => {
    expected = screen.scrollTop;
    width = screen.clientWidth;
    height = screen.clientHeight;
    extent = screen.scrollHeight;
  };
  const remember = (intent = false) => {
    const top = screen.scrollTop;
    if (!intent && (Math.abs(top - expected) < .5 ||
        screen.clientWidth !== width || screen.clientHeight !== height || screen.scrollHeight !== extent)) return;
    let node = output;
    // Transcript children follow visual order. Search only the selected branch,
    // stopping at text blocks so long documents stay cheap to scroll.
    while (node.children.length && !/^(P|PRE|H[1-6]|LI|DT|DD)$/.test(node.tagName)) {
      const children = node.children;
      let low = 0, high = children.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (children[middle].offsetTop <= top) low = middle + 1;
        else high = middle;
      }
      node = children[Math.max(0, low - 1)];
    }
    mark = node === output ? null : {node, offset: node.offsetTop - top};
    sample();
  };
  const restore = (reveal = false) => {
    if (mark && !output.contains(mark.node)) mark = null;
    if (mark && (reveal || window.getSelection()?.isCollapsed !== false)) {
      const target = Math.min(Math.max(0, mark.node.offsetTop - mark.offset),
        Math.max(0, screen.scrollHeight - screen.clientHeight));
      // Reassigning an unchanged offset can interrupt touch momentum.
      if (Math.abs(screen.scrollTop - target) >= .5) screen.scrollTop = target;
    }
    sample();
  };
  screen.addEventListener('scroll', () => remember(), {passive: true});
  screen.addEventListener('wheel', () => remember(true), {passive: true});
  screen.addEventListener('pointerdown', () => remember(true), {passive: true});
  screen.addEventListener('keydown', event => {
    if (/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| |Tab)$/.test(event.key)) remember(true);
  });
  screen.addEventListener('focusin', event => {
    if (event.target !== mark?.node) remember(true);
  });
  return {
    remember, restore,
    reveal(node) { mark = {node, offset: 12}; restore(true); },
    reset() { mark = null; screen.scrollTop = 0; sample(); },
  };
})();

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

const displayPath = () => session.cwd === '/' ? '~' : '~' + session.cwd;
const focusInput = () => {
  if (document.activeElement !== input) input.focus({preventScroll: !terminal.classList.contains('mobile')});
};
const announce = message => { announcement.textContent = message; };
const modified = event => event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
const updatePrompt = () => { prompt.textContent = `guest:${displayPath()} $`; };

function setTools(open, preserve = true) {
  if (terminal.classList.contains('tools-open') === open) return;
  if (preserve) reading.remember();
  terminal.classList.toggle('tools-open', open);
  toolsToggle.setAttribute('aria-expanded', String(open));
  if (preserve) reading.restore();
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
      row.append(commandButton(`open ${path}`, name));
      const description = file.description || file.title;
      if (description && description !== name && description !== name.replace(/\/$/, '')) {
        row.append(element('span', description));
      }
      list.append(row);
    }
    if (!result.entries.length) list.append(element('p', 'This directory is empty.', 'dim'));
    parent.append(list);
  } else if (result.kind === 'file') {
    const path = element('div', result.path, 'file-path');
    const link = element('a', 'Link to this document', 'document-link');
    link.href = entryURL(result.path);
    link.dataset.page = '';
    path.append(' · ', link);
    parent.append(path);
    const content = views.get(result.path).cloneNode(true);
    if (content.querySelector('h1')?.textContent !== result.entry.title) {
      parent.append(element('h2', result.entry.title, 'file-title'));
    }
    content.removeAttribute('aria-label'); // The enclosing result already names the document.
    parent.append(content);
  } else if (result.kind === 'cat') {
    documentSources ??= JSON.parse($('document-sources').textContent);
    parent.append(element('pre', documentSources[result.path], 'file-text'));
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
    reading.reset();
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
    reading.reveal(block);
  }
  if (mode === 'browse' && block) block.focus({preventScroll: true});
  announce(result.kind === 'error' ? result.message : result.kind === 'file'
    ? `Opened ${result.entry.title}.` : result.kind === 'clear' ? 'Output cleared.' : 'Command complete.');
}

function routeSignature(route, cwd) {
  return `${route.kind}:${route.path || ''}:${cwd}`;
}

function updatePage(route) {
  const title = route.path && route.path !== '/README.md' ? FILES[route.path]?.title : '';
  document.title = title ? `${title} | ${ownerTitle}` : ownerTitle;
  for (const link of siteLinks) {
    const current = link.getAttribute('href') === '/' ? !route.path?.startsWith('/projects') : route.path?.startsWith('/projects');
    if (current) link.setAttribute('aria-current', route.path?.startsWith('/projects/') ? 'true' : 'page');
    else link.removeAttribute('aria-current');
  }
}

function writeNavigation(method, path, url = window.location.pathname + window.location.search + window.location.hash) {
  try {
    window.history[method](navigationState(path, session.cwd), '', url);
    const route = parseLocation(window.location);
    lastNavigation = routeSignature(route, session.cwd);
    updatePage(route);
    return true;
  } catch {
    // Restricted/overloaded history APIs must not break reading or commands.
    return false;
  }
}

function rememberCurrentCwd() {
  const route = parseLocation(window.location);
  const saved = window.history.state?.terminal;
  if (saved?.path === route.path && saved.cwd === session.cwd) return true;
  return writeNavigation('replaceState', route.path);
}

function rememberDocument(path) {
  rememberCurrentCwd();
  const url = entryURL(path);
  return window.location.pathname + window.location.hash === url
    ? rememberCurrentCwd()
    : writeNavigation('pushState', path, url);
}

function run(raw, mode = 'typed') {
  snakePlayer.finish();
  if (typeof raw !== 'string' || !raw.trim()) return;
  setTools(false, false);
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
  const link = event.target.closest('a');
  if (link && link.hasAttribute('data-page') && !event.defaultPrevented &&
      event.button === 0 && !modified(event) && !link.getAttribute('target') && !link.hasAttribute('download')) {
    const url = new URL(link.href, window.location.href);
    const route = parseLocation(url);
    if (url.origin === window.location.origin && route.kind !== 'invalid') {
      // Only generated local links enter the application. Modified clicks retain
      // normal new-tab behavior and published pages also work without scripts.
      rememberCurrentCwd();
      const previousCwd = session.cwd;
      session.cwd = navigationCwd(null, route.path);
      if (writeNavigation(url.href === window.location.href ? 'replaceState' : 'pushState', route.path, url.pathname + url.search + url.hash)) {
        event.preventDefault();
        lastNavigation = '';
        navigate();
      } else session.cwd = previousCwd;
      return;
    }
  }
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
  const route = parseLocation(window.location);
  const cwd = navigationCwd(window.history.state, route.path);
  const signature = routeSignature(route, cwd);
  if (!initial && signature === lastNavigation) return;
  setTools(false, false);
  snakePlayer.finish();
  lastNavigation = signature;
  session.cwd = cwd;
  updatePrompt();
  updatePage(route);
  hideSuggestions();
  completionAttempted = false;
  // Leave a direct visit's static content in place. Regular page links show
  // the same standalone view; only terminal commands add transcript entries.
  if (initial && route.kind !== 'invalid' && output.dataset.route === (route.path || '')) {
    rememberCurrentCwd();
    return;
  }
  if (route.kind === 'home' || route.kind === 'directory' ||
      (route.kind === 'file' && (!window.location.hash || window.location.hash === '#'))) {
    output.replaceChildren(views.get(route.path || '/README.md').cloneNode(true));
    reading.reset();
    if (!initial) { screen.focus({preventScroll: true}); announce(`${route.kind === 'home' ? 'README.md' : FILES[route.path].title}. Command history retained.`); }
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
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion:reduce)');
  let pending = 0;
  let layoutWidth = 0, layoutFont = 0;
  let opening = 0, anchor = null, dismissed = false;
  const stopOpening = () => { window.clearTimeout(opening); opening = 0; anchor = null; };
  const applyViewport = () => {
    if (pending) cancelAnimationFrame(pending);
    pending = 0;
    // Pinch zoom shrinks the visual viewport too. Preserve the layout so
    // magnification never masquerades as a keyboard opening or loses text.
    if (viewport?.scale && viewport.scale !== 1) return;
    const reportedHeight = viewport?.height ?? innerHeight;
    const mobile = innerWidth <= 600 || Boolean(touch?.matches);
    const availableHeight = dismissed ? innerHeight : reportedHeight;
    const top = mobile && !dismissed
      ? Math.max(0, Math.min(viewport?.offsetTop ?? 0, innerHeight - availableHeight)) : 0;
    if (anchor) {
      // Allow at most 4px of settling relative to the original focus height.
      // Native content resizing must still release the focus anchor immediately.
      const layoutResized = Math.abs(innerHeight - anchor.height) > 4 ||
        (innerHeight !== anchor.height && Math.abs(reportedHeight - innerHeight) <= 1);
      // Keep the native focus target stationary while the browser pans it.
      // Releasing only because the height arrived first creates a second move.
      // After the bounded handoff, fall back if native panning did not reveal
      // the input (also covers later keyboard-size changes without polling).
      if (!mobile || innerWidth !== anchor.width || layoutResized ||
          reducedMotion?.matches ||
          (anchor.bottom !== undefined && reportedHeight + top + (window.scrollY || 0) < anchor.bottom - 1)) stopOpening();
    }
    const fontSize = mobile ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 16;
    const compact = mobile && availableHeight <= Math.max(440, 20 * fontSize);
    const frameHeight = anchor ? anchor.height - top : availableHeight;
    const height = mobile ? `${frameHeight}px` : '';
    const margin = top ? `${top}px` : '';
    const changed = height !== terminal.style.getPropertyValue('--viewport-height') ||
      margin !== terminal.style.marginTop || compact !== terminal.classList.contains('compact') ||
      mobile !== terminal.classList.contains('mobile') || innerWidth !== layoutWidth || fontSize !== layoutFont;
    // Width/font reflow can already have clamped the pane before this event.
    if (changed && innerWidth === layoutWidth && fontSize === layoutFont) reading.remember();
    if (compact && !terminal.classList.contains('compact') && toolbar.contains(document.activeElement)) {
      hideSuggestions();
      setTools(true, false);
    }
    terminal.classList.toggle('compact', compact);
    terminal.classList.toggle('mobile', mobile);
    if (!compact) {
      setTools(false, false);
      if (document.activeElement === toolsToggle) toolbar.querySelector('button').focus({preventScroll: true});
    }
    // Commit the frame and its controls together. Letting CSS viewport units
    // resize first can clamp the transcript before compact mode catches up.
    if (terminal.style.getPropertyValue('--viewport-height') !== height) {
      if (height) terminal.style.setProperty('--viewport-height', height);
      else terminal.style.removeProperty('--viewport-height');
    }
    // A phone keyboard can pan the visual viewport without scrolling the page.
    // Follow that pan in normal flow, but never follow the reader's page scroll.
    if (terminal.style.marginTop !== margin) terminal.style.marginTop = margin;
    if (changed) reading.restore();
    layoutWidth = innerWidth;
    layoutFont = fontSize;
    if (anchor && !opening && anchor.bottom === undefined) {
      // Measure once, after this frame's geometry and minimum sizes apply.
      // Document coordinates keep native page scrolling out of layout sizing.
      anchor.bottom = input.getBoundingClientRect().bottom + (window.scrollY || 0);
      if (reportedHeight + top + (window.scrollY || 0) < anchor.bottom - 1) { stopOpening(); fit(); }
    }
  };
  const fit = () => {
    if (pending) return;
    pending = requestAnimationFrame(applyViewport);
  };
  input.addEventListener('focus', () => {
    stopOpening();
    const reopening = dismissed;
    dismissed = false;
    if (terminal.classList.contains('mobile') && viewport?.scale === 1 &&
        (reopening || viewport.height >= innerHeight - 1) && !reducedMotion?.matches) {
      anchor = {width: innerWidth, height: innerHeight};
      // Safety deadline for missing/partial native pan, not an animation curve.
      opening = window.setTimeout(() => { opening = 0; fit(); }, 350);
    }
    fit();
  });
  input.addEventListener('blur', () => {
    stopOpening();
    // Done can precede the final viewport event. Use layout height now,
    // letting the native pan unwind instead of canceling it with stale offsets.
    dismissed = terminal.classList.contains('mobile');
    fit();
  });
  reducedMotion?.addEventListener?.('change', () => { stopOpening(); fit(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopOpening(); else fit(); });
  viewport?.addEventListener('resize', fit);
  viewport?.addEventListener('scroll', fit);
  touch?.addEventListener?.('change', fit);
  window.addEventListener('resize', () => {
    // Follow native resizing in this event, keeping frame and controls in step
    // before paint. Visual-only pan/resize reports remain coalesced below.
    if (terminal.classList.contains('mobile') &&
        (!viewport || Math.abs(viewport.height - innerHeight) <= 1)) applyViewport();
    else fit();
  });
  // Expose controls only after their initial geometry is ready. A fast first
  // command must not be revealed against a layout that changes next frame.
  applyViewport();
}
document.querySelector('.entry').hidden = false;
navigate(true);
