import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {pathToFileURL} from 'node:url';
import {renderIndex} from '../../scripts/update-readme.mjs';

/**
 * Minimal deterministic DOM model for app logic, not a browser/layout emulator.
 * It models the APIs the app uses and counts writes/reads. Real rendering,
 * focus defaults, accessibility trees, CSP, and mobile keyboards need browser QA.
 */
export async function createApp({root = new URL('../../', import.meta.url), width = 1000, height = 800, viewport = true, hash = '', state = null, reducedMotion = false} = {}) {
  if (typeof root === 'string') root = pathToFileURL(root.endsWith('/') ? root : `${root}/`);
  const source = await readFile(new URL('app.js', root), 'utf8');
  const markup = await renderIndex(root);
  const staticTags = [...markup.matchAll(/<[^>]+>/gu)].map(match => match[0]);
  const importLine = /^import \{([^}]+)\} from ['"]\.\/([\w-]+)\.js['"];\s*/gmu;
  const modules = {};
  for (const [, , name] of source.matchAll(importLine)) {
    modules[name] = await import(new URL(`${name}.js`, root).href);
  }
  if (!modules.engine) throw new Error('Update harness for changed app import structure.');
  const metrics = {listeners: 0, geometryReads: 0, scrollWrites: 0, heightWrites: 0, framesScheduled: 0, timersScheduled: 0, focusCalls: []};
  const frames = new Map();
  let nextFrame = 0;
  let serial = 0;

  class Node {
    constructor(tag, text = '') {
      this.tagName = tag.toUpperCase();
      this.nodeType = tag === '#text' ? 3 : 1;
      this.childNodes = [];
      this.parentNode = null;
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.className = '';
      this.classList = {
        contains: name => this.className.split(/\s+/u).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/u).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/u).filter(name => !names.includes(name)).join(' '); },
        toggle: (name, force) => {
          const add = force ?? !this.classList.contains(name);
          if (add) this.classList.add(name); else this.classList.remove(name);
          return add;
        },
      };
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this._text = text;
      this._scrollTop = 0;
      this._offsetTop = ++serial * 10;
      const properties = new Map();
      this.style = new Proxy({
        getPropertyValue: name => properties.get(name) ?? '',
        setProperty(name, value) {
          if (name === '--viewport-height') metrics.heightWrites++;
          properties.set(name, value);
        },
        removeProperty(name) {
          if (name === '--viewport-height') metrics.heightWrites++;
          const previous = properties.get(name) ?? '';
          properties.delete(name);
          return previous;
        },
      }, {
        get: (target, key) => target[key] ?? '',
        set: (target, key, value) => {
          if (key === 'height') metrics.heightWrites++;
          target[key] = value;
          return true;
        },
      });
    }
    get children() { return this.childNodes.filter(node => node.nodeType === 1); }
    get firstElementChild() { return this.children[0] ?? null; }
    get lastElementChild() { return this.children.at(-1) ?? null; }
    get isConnected() {
      let node = this;
      while (node.parentNode) node = node.parentNode;
      return node === document.documentElement;
    }
    get textContent() { return this._text + this.childNodes.map(node => node.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    set innerHTML(_) { throw new Error('Unsafe HTML assignment: use textContent/DOM nodes.'); }
    get offsetTop() { metrics.geometryReads++; return this._offsetTop; }
    get scrollTop() { return this._scrollTop; }
    set scrollTop(value) { metrics.scrollWrites++; this._scrollTop = value; }
    append(...nodes) {
      for (let node of nodes) {
        if (typeof node === 'string') node = new Node('#text', node);
        node.remove();
        node.parentNode = this;
        this.childNodes.push(node);
      }
    }
    replaceChildren(...nodes) {
      for (const node of this.childNodes) node.parentNode = null;
      this.childNodes = [];
      this._text = '';
      this.append(...nodes);
    }
    cloneNode(deep = false) {
      const clone = new Node(this.nodeType === 3 ? '#text' : this.tagName, this._text);
      for (const key of ['className', 'id', 'href', 'tabIndex', 'hidden', 'disabled']) clone[key] = this[key];
      clone.attributes = new Map(this.attributes);
      clone.dataset = {...this.dataset};
      if (deep) clone.append(...this.childNodes.map(node => node.cloneNode(true)));
      return clone;
    }
    remove() {
      if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
      this.parentNode = null;
    }
    get isConnected() { return document.documentElement.contains(this); }
    contains(node) {
      for (let current = node; current; current = current.parentNode) if (current === this) return true;
      return false;
    }
    matches(selector) {
      if (selector.startsWith('.')) return this.className.split(/\s+/u).includes(selector.slice(1));
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      const attribute = selector.match(/^\[([\w-]+)(?:=['"]?([^'"]+)['"]?)?\]$/u);
      if (attribute) return attribute[2] === undefined
        ? this.getAttribute(attribute[1]) !== null
        : this.getAttribute(attribute[1]) === attribute[2];
      return this.tagName === selector.toUpperCase();
    }
    closest(selector) {
      for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node;
      return null;
    }
    querySelectorAll(selector) {
      if (selector.includes(',')) return [...new Set(selector.split(',').flatMap(part => this.querySelectorAll(part.trim())))];
      return this.children.flatMap(node => [node, ...node.querySelectorAll('*')]).filter(node => selector === '*' || node.matches(selector));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === 'id') this.id = String(value);
      if (name === 'tabindex') this.tabIndex = Number(value);
      if (name === 'class') this.className = String(value);
      if (name === 'href') this.href = String(value);
    }
    getAttribute(name) {
      if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] ?? null;
      return this.attributes.get(name) ?? null;
    }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, callback) {
      metrics.listeners++;
      const callbacks = this.listeners.get(type) ?? [];
      callbacks.push(callback);
      this.listeners.set(type, callbacks);
    }
    removeEventListener(type, callback) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter(listener => listener !== callback));
    }
    focus(options) { document.activeElement = this; metrics.focusCalls.push({node: this, options}); }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  }

  let selectedText = '';
  const selection = {get isCollapsed() { return selectedText.length === 0; }, toString: () => selectedText};
  const document = Object.assign(new Node('document'), {
    title: 'guest / terminal study',
    getSelection: () => selection,
    createElement: tag => new Node(tag),
    createTextNode: text => new Node('#text', text),
    getElementById: id => document.documentElement.querySelector(`#${id}`),
    querySelector: selector => document.documentElement.querySelector(selector),
    querySelectorAll: selector => document.documentElement.querySelectorAll(selector),
    hidden: false,
  });
  document.documentElement = new Node('html');
  document.body = new Node('body');
  document.documentElement.append(document.body);
  document.activeElement = document.body;
  const make = (tag, id, parent, className = '') => {
    const node = new Node(tag);
    node.id = id;
    node.className = className;
    const staticTag = staticTags.find(value => id ? value.includes(`id="${id}"`) : className && value.includes(`class="${className}"`));
    node.disabled = Boolean(staticTag && /\sdisabled(?:\s|>|=)/u.test(staticTag));
    node.hidden = Boolean(staticTag && /\shidden(?:\s|>|=)/u.test(staticTag));
    parent.append(node);
    return node;
  };
  const terminal = make('main', '', document.body, 'terminal');
  if (markup.includes('class="site-name"')) {
    const header = make('header', '', terminal, 'bar');
    for (const [tag, className] of [['h1', 'site-name'], ['p', 'site-status']]) {
      const text = markup.match(new RegExp(`<${tag} class="${className}">([^<]+)</${tag}>`, 'u'))?.[1];
      make(tag, '', header, className).textContent = text ?? '';
    }
  }
  const screen = make('div', 'screen', terminal, 'screen');
  const output = make('div', 'output', screen);
  // Parse only the generator's escaped text/p/h1-h3/a subset, independently of
  // its Markdown parser. Actual HTML parsing and layout stay in browser checks.
  const initial = markup.match(/<section class="initial-document" aria-label="README.md">([\s\S]*?)<\/section>/u);
  if (initial) {
    const root = make('section', '', output, 'initial-document');
    root.setAttribute('aria-label', 'README.md');
    const stack = [root];
    const entities = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"};
    const decode = text => text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => entities[entity]);
    for (const token of initial[1].match(/<[^>]+>|[^<]+/g) ?? []) {
      if (token.startsWith('</')) stack.pop();
      else if (token.startsWith('<')) {
        const tag = /^<(p|h[1-3]|a)\b/u.exec(token)?.[1];
        if (!tag) throw new Error(`Unexpected generated element: ${token}`);
        const node = new Node(tag);
        for (const [, name, value] of token.matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(name, decode(value));
        stack.at(-1).append(node);
        stack.push(node);
      } else stack.at(-1).append(decode(token));
    }
    make('script', 'readme-source', screen).textContent = markup.match(/<script id="readme-source" type="application\/json">([\s\S]*?)<\/script>/u)[1];
  }
  const announcement = make('div', 'announcement', terminal);
  const entry = make('section', '', terminal, 'entry');
  const form = make('form', 'command-form', entry);
  const prompt = make('span', 'prompt', form);
  prompt.textContent = 'guest:~ $';
  const input = make('input', 'command', form);
  const runButton = make('button', '', form, 'run');
  const completionPanel = make('div', 'completion-panel', entry, 'completion-panel');
  completionPanel.hidden = true;
  const completionStatus = make('p', 'completion-status', completionPanel, 'completion-status');
  const suggestions = make('div', 'completions', completionPanel, 'completions');
  suggestions.hidden = true;
  suggestions.setAttribute('role', 'listbox');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', 'completions');
  const toolbar = make('div', '', entry, 'toolbar');
  const shortcutsMarkup = markup.match(/<div class="shortcuts"[^>]*>([\s\S]*?)<\/div>/u)?.[1] ?? '';
  const shortcuts = [...shortcutsMarkup.matchAll(/<button[^>]+data-command="([^"]+)"[^>]*>/gu)].map(([, command]) => {
    const button = make('button', '', toolbar);
    button.dataset.command = command;
    return button;
  });
  const hintMarkup = markup.match(/<p[^>]*id="keyboard-help"[^>]*>([\s\S]*?)<\/p>/u)?.[1];
  if (hintMarkup) {
    const parts = hintMarkup.match(/^([\s\S]*?)<button([^>]+)>([^<]*)<\/button>([\s\S]*)$/u);
    if (!parts) throw new Error('Update fixture for the changed keyboard hint markup.');
    const [, before, attributes, label, after] = parts;
    const hint = make('p', 'keyboard-help', toolbar, 'prompt-hint');
    hint.append(before);
    const help = make('button', '', hint, 'inline-command');
    help.dataset.command = attributes.match(/data-command="([^"]+)"/u)?.[1];
    help.textContent = label;
    hint.append(after);
  }
  for (const id of ['complete', 'previous', 'next']) make('button', id, toolbar);
  make('button', 'read-output', entry);
  const visualViewport = new Node('viewport');
  visualViewport.height = height;
  visualViewport.scale = 1;
  const window = new Node('window');
  window.document = document;
  const motion = new Node('media-query');
  motion.matches = reducedMotion;
  window.matchMedia = () => motion;
  let now = 0, nextTimer = 0;
  const timers = new Map();
  window.performance = {now: () => now};
  window.setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    metrics.timersScheduled++;
    timers.set(id, {callback, at: now + delay});
    return id;
  };
  window.clearTimeout = id => timers.delete(id);
  if (viewport) window.visualViewport = visualViewport;
  window.getSelection = () => selection;
  let currentURL = new URL(`https://terminal.test/${hash}`);
  const entries = [{url: currentURL.href, state: structuredClone(state)}];
  let historyIndex = 0;
  const location = {
    get href() { return currentURL.href; },
    get hash() { return currentURL.hash; },
    set hash(value) { navigateHash(value); },
    get pathname() { return currentURL.pathname; },
    get search() { return currentURL.search; },
    get origin() { return currentURL.origin; },
  };
  const history = {
    get state() { return entries[historyIndex].state; },
    get length() { return entries.length; },
    get index() { return historyIndex; },
    entries,
    failWrites: false,
    pushState(nextState, _title, url) {
      if (this.failWrites) throw new Error('History writes unavailable');
      const next = new URL(url ?? currentURL.href, currentURL);
      if (next.origin !== currentURL.origin) throw new Error('Cross-origin history write');
      entries.splice(historyIndex + 1);
      entries.push({url: next.href, state: structuredClone(nextState)});
      historyIndex++;
      currentURL = next;
    },
    replaceState(nextState, _title, url) {
      if (this.failWrites) throw new Error('History writes unavailable');
      const next = new URL(url ?? currentURL.href, currentURL);
      if (next.origin !== currentURL.origin) throw new Error('Cross-origin history write');
      entries[historyIndex] = {url: next.href, state: structuredClone(nextState)};
      currentURL = next;
    },
    go(delta) {
      const nextIndex = Math.max(0, Math.min(entries.length - 1, historyIndex + delta));
      if (nextIndex === historyIndex) return;
      const oldHash = currentURL.hash;
      historyIndex = nextIndex;
      currentURL = new URL(entries[historyIndex].url);
      dispatch(window, 'popstate', {state: history.state});
      if (currentURL.hash !== oldHash) dispatch(window, 'hashchange');
    },
    back() { this.go(-1); },
    forward() { this.go(1); },
  };
  function navigateHash(value, nextState = null) {
    const next = new URL(currentURL);
    next.hash = value;
    if (next.href === currentURL.href) return;
    history.pushState(nextState, '', next.href);
    dispatch(window, 'popstate', {state: history.state});
    dispatch(window, 'hashchange');
  }
  window.location = location;
  window.history = history;
  const globals = {
    document, window, location, history, visualViewport, innerWidth: width, console, __modules: modules,
    requestAnimationFrame(callback) {
      const id = ++nextFrame;
      metrics.framesScheduled++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: id => frames.delete(id),
  };
  // Only replace module linkage; execute the actual unmodified app body.
  const executable = source.replace(importLine, (_, names, name) => `const {${names}} = __modules.${name};\n`);
  runInNewContext(executable, globals, {filename: new URL('app.js', root).pathname});

  function dispatch(target, type, init = {}) {
    const event = {type, target, button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init};
    const path = [];
    for (let node = target; node; node = node.parentNode) path.push(node);
    for (const node of path) for (const listener of node.listeners.get(type) ?? []) listener(event);
    return event;
  }
  return {
    document, terminal, screen, output, announcement, form, input, prompt, suggestions, completionPanel, completionStatus, runButton, shortcuts, metrics, globals, location, history, window,
    navigateHash,
    selectText(value) { selectedText = value; },
    dispatch,
    click: target => dispatch(target, 'click'),
    key: (key, init = {}, target = input) => dispatch(target, 'keydown', {key, ...init}),
    submit(value) { input.value = value; return dispatch(form, 'submit'); },
    change(value) { input.value = value; return dispatch(input, 'input'); },
    flushFrame() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    },
    get pendingFrames() { return frames.size; },
    get pendingTimers() { return timers.size; },
    advanceTime(milliseconds) {
      const end = now + milliseconds;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        const [id, {at, callback}] = next;
        now = at;
        timers.delete(id);
        callback();
      }
      now = end;
    },
    setReducedMotion(value) { motion.matches = value; dispatch(motion, 'change', {matches: value}); },
    setHidden(value) { document.hidden = value; dispatch(document, 'visibilitychange'); },
    resize(newWidth, newHeight, scale = 1) {
      globals.innerWidth = newWidth;
      visualViewport.height = newHeight;
      visualViewport.scale = scale;
      dispatch(visualViewport, 'resize');
      dispatch(window, 'resize');
    },
    resetMetrics() {
      for (const key of ['geometryReads', 'scrollWrites', 'heightWrites', 'framesScheduled']) metrics[key] = 0;
      metrics.focusCalls.length = 0;
    },
  };
}
