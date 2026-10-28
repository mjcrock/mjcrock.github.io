// Pure command model. This is a fixed, read-only virtual filesystem, never a shell.
export const LIMITS = Object.freeze({input: 500, history: 50, output: 40});
export const COMMANDS = Object.freeze(['help', 'ls', 'open', 'cd', 'pwd', 'clear', 'history']);
export const FILES = Object.freeze({
  '/': {type: 'directory', description: 'Home'},
  '/about': {type: 'file', title: 'About', lines: ['Generic placeholder.', 'No personal information has been added.']},
  '/work': {type: 'directory', description: 'Work · placeholder'},
  '/work/readme': {type: 'file', title: 'Work', lines: ['Generic placeholder.', 'No projects have been added.']},
  '/writing': {type: 'directory', description: 'Writing · placeholder'},
  '/writing/sample': {type: 'file', title: 'Sample document', lines: ['Placeholder content only.', 'This sample exists to test reading and navigation. It does not describe a person, project, or publication.']},
  '/contact': {type: 'file', title: 'Contact', lines: ['Generic placeholder.', 'No contact details or form have been added.']}
});

const own = path => Object.prototype.hasOwnProperty.call(FILES, path);
const validText = value => typeof value === 'string' && value.length <= LIMITS.input && !/[\u0000-\u0008\u000B-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(value);
const error = (cwd, message, hint = 'Type help to see available commands.') => ({cwd, kind: 'error', message, hint});

export function resolvePath(raw = '.', cwd = '/') {
  if (raw === '~') return '/';
  if (raw.startsWith('~/')) raw = raw.slice(1);
  const parts = (raw.startsWith('/') ? raw : `${cwd}/${raw}`).split('/');
  const normalized = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') normalized.pop();
    else normalized.push(part);
  }
  return '/' + normalized.join('/');
}

export function list(path) {
  return Object.keys(FILES).filter(key => key !== path && key.slice(0, key.lastIndexOf('/')) === (path === '/' ? '' : path));
}

export function execute(line, cwd = '/', history = []) {
  if (!own(cwd) || FILES[cwd].type !== 'directory') cwd = '/';
  if (!validText(line)) return error(cwd, 'Use a single text command of at most 500 characters.');
  const [command, ...args] = line.trim().split(/\s+/u).filter(Boolean);
  const result = {cwd, kind: 'empty'};
  if (!command) return result;
  if (!COMMANDS.includes(command)) return error(cwd, `Unknown command: ${command}`);
  if (args.length > 1 || (['help', 'pwd', 'clear', 'history'].includes(command) && args.length)) {
    return error(cwd, `Usage: ${command}${['ls', 'open', 'cd'].includes(command) ? ' [path]' : ''}`, 'Commands accept one path at a time.');
  }
  if (command === 'help' || command === 'clear') return {...result, kind: command};
  if (command === 'history') return {...result, kind: 'history', entries: history.slice(-LIMITS.history)};
  if (command === 'pwd') return {...result, kind: 'text', message: cwd};
  const path = resolvePath(args[0] || (command === 'cd' ? '/' : '.'), cwd);
  if (!own(path)) return error(cwd, `Not found: ${args[0] || path}`, 'Use ls to see available paths.');
  const entry = FILES[path];
  if (command === 'cd') return entry.type === 'directory'
    ? {...result, kind: 'location', cwd: path}
    : error(cwd, `Not a directory: ${path}`, 'Use open to read a file.');
  if (entry.type === 'directory') return {...result, kind: 'list', path, entries: list(path)};
  if (command === 'ls') return {...result, kind: 'list', path: cwd, entries: [path]};
  return {...result, kind: 'file', path, entry};
}

export function completions(value, cwd = '/') {
  if (!validText(value)) return [];
  const parts = value.trimStart().split(/\s+/u);
  if (parts.length === 1) return COMMANDS.filter(c => c.startsWith(parts[0])).map(c => c + (['open', 'ls', 'cd'].includes(c) ? ' ' : ''));
  const [command, prefix] = parts;
  if (!['open', 'ls', 'cd'].includes(command) || parts.length > 2) return [];
  const slash = prefix.lastIndexOf('/');
  const base = slash < 0 ? '' : prefix.slice(0, slash + 1);
  const token = prefix.slice(slash + 1);
  return list(resolvePath(base || '.', cwd)).filter(path => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    return name.startsWith(token) && (command !== 'cd' || FILES[path].type === 'directory');
  }).map(path => `${command} ${base}${path.slice(path.lastIndexOf('/') + 1)}${FILES[path].type === 'directory' ? '/' : ''}`);
}

// State is in memory only: no cookies, storage, requests, or persistent input logs.
export class Session {
  cwd = '/';
  history = [];
  cursor = 0;
  draft = '';

  submit(raw) {
    const line = validText(raw) ? raw.trim() : raw;
    if (validText(line) && line) {
      this.history.push(line);
      if (this.history.length > LIMITS.history) this.history.shift();
    }
    this.cursor = this.history.length;
    this.draft = '';
    const result = execute(line, this.cwd, this.history);
    this.cwd = result.cwd;
    return result;
  }

  recall(delta, input) {
    if (!this.history.length) return input;
    if (this.cursor === this.history.length) this.draft = input;
    this.cursor = Math.max(0, Math.min(this.history.length, this.cursor + delta));
    return this.cursor === this.history.length ? this.draft : this.history[this.cursor];
  }
}
