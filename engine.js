// Pure command model. This is a fixed, read-only virtual filesystem, never a shell.
export const LIMITS = Object.freeze({input: 500, history: 50, output: 40});
export const COMMANDS = Object.freeze(['help', 'ls', 'open', 'cat', 'cd', 'pwd', 'clear', 'history']);
export const FILES = Object.freeze({
  '/': {type: 'directory', description: 'Home'},
  '/about': {type: 'file', title: 'About', lines: ['Generic placeholder.', 'No personal information has been added.']},
  '/work': {type: 'directory', description: 'Work · placeholder'},
  '/work/readme': {type: 'file', title: 'Work', lines: ['Generic placeholder.', 'No projects have been added.']},
  '/writing': {type: 'directory', description: 'Writing · placeholder'},
  '/writing/sample': {type: 'file', title: 'Sample document', lines: ['Placeholder content only.', 'This sample exists to test reading and navigation. It does not describe a person, project, or publication.']},
  '/contact': {type: 'file', title: 'Contact', lines: ['Generic placeholder.', 'No contact details or form have been added.']}
});

const PATH_COMMANDS = Object.freeze(['ls', 'open', 'cat', 'cd']);
const own = path => Object.prototype.hasOwnProperty.call(FILES, path);
const validText = value => typeof value === 'string' && value.length <= LIMITS.input && !/[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028-\u202E\u2066-\u2069]/u.test(value);
const error = (cwd, message, hint = 'Type help to see available commands.', suggestions = ['help']) => ({
  cwd, kind: 'error', message, hint, suggestions
});

// A bounded one-edit check is enough for short command names; never auto-correct.
function oneEditApart(value, candidate) {
  if (Math.abs(value.length - candidate.length) > 1) return false;
  let left = 0;
  let right = 0;
  let edits = 0;
  while (left < value.length && right < candidate.length) {
    if (value[left] === candidate[right]) { left++; right++; continue; }
    if (++edits > 1) return false;
    if (value.length >= candidate.length) left++;
    if (candidate.length >= value.length) right++;
  }
  return edits + (left < value.length || right < candidate.length ? 1 : 0) <= 1;
}

const parentPath = path => path.slice(0, path.lastIndexOf('/')) || '/';
function nearestDirectory(path) {
  while (!own(path) || FILES[path].type !== 'directory') path = parentPath(path);
  return path;
}

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
  if (!validText(line)) {
    // Let the view suppress rejected control characters instead of echoing them.
    return {...error(cwd, `Use a single text command of at most ${LIMITS.input} characters.`), invalidInput: true};
  }
  const [command, ...args] = line.trim().split(/\s+/u).filter(Boolean);
  const result = {cwd, kind: 'empty'};
  if (!command) return result;
  if (!COMMANDS.includes(command)) {
    const matches = COMMANDS.filter(candidate => oneEditApart(command, candidate));
    return error(cwd, `Unknown command: ${command}`,
      matches.length ? `Did you mean ${matches.join(' or ')}?` : 'Type help to see available commands.',
      matches.length ? matches : ['help']);
  }
  if (args.length > 1 || (!PATH_COMMANDS.includes(command) && args.length) || (command === 'cat' && !args.length)) {
    const usage = command === 'cat' ? 'cat path' : command + (PATH_COMMANDS.includes(command) ? ' [path]' : '');
    const browse = `ls ${cwd}`;
    return error(cwd, `Usage: ${usage}`, PATH_COMMANDS.includes(command)
      ? `Choose one path with ${browse}. Flags, pipes, and multiple paths are not supported.`
      : `${command} does not take arguments.`, PATH_COMMANDS.includes(command) ? [browse] : [command]);
  }
  if (command === 'help' || command === 'clear') return {...result, kind: command};
  if (command === 'history') return {...result, kind: 'history', entries: history.slice(-LIMITS.history)};
  if (command === 'pwd') return {...result, kind: 'text', message: cwd};
  const path = resolvePath(args[0] || (command === 'cd' ? '/' : '.'), cwd);
  if (!own(path)) {
    const browse = `ls ${nearestDirectory(path)}`;
    return error(cwd, `Not found: ${args[0] || path}`, `Use ${browse} to see available paths.`, [browse]);
  }
  const entry = FILES[path];
  if (command === 'cd') return entry.type === 'directory'
    ? {...result, kind: 'location', cwd: path}
    : error(cwd, `Not a directory: ${path}`, `Use open ${path} or cat ${path} to read this file.`, [`open ${path}`, `cat ${path}`]);
  if (command === 'cat' && entry.type === 'directory') {
    return error(cwd, `Is a directory: ${path}`, `Use open ${path} to browse or ls ${path} to list its contents.`, [`open ${path}`, `ls ${path}`]);
  }
  if (entry.type === 'directory') return {...result, kind: 'list', path, entries: list(path)};
  if (command === 'ls') return {...result, kind: 'list', path: cwd, entries: [path]};
  return {...result, kind: command === 'cat' ? 'cat' : 'file', path, entry};
}

export function completions(value, cwd = '/') {
  if (!validText(value)) return [];
  const parts = value.trimStart().split(/\s+/u);
  if (parts.length === 1) return COMMANDS.filter(c => c.startsWith(parts[0])).map(c => c + (PATH_COMMANDS.includes(c) ? ' ' : ''));
  const [command, prefix] = parts;
  if (!PATH_COMMANDS.includes(command) || parts.length > 2) return [];
  const slash = prefix.lastIndexOf('/');
  const base = slash < 0 ? '' : prefix.slice(0, slash + 1);
  const token = prefix.slice(slash + 1);
  // cat keeps directory candidates so users can complete a file path one segment at a time.
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
