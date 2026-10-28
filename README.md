# Terminal prototype

A small, dependency-free static interface with generic placeholder content. It is
not a shell: commands read only the fixed virtual files in `engine.js`. No build
step, runtime packages, external fonts, analytics, cookies, local storage, or
services are required.

## Preview

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000`. Use HTTP rather than opening `index.html` directly,
because the browser loads JavaScript modules.

## Commands

- `help`: show the command and keyboard guide.
- `ls [path]`: list files or a directory.
- `open [path]`: open a formatted document reader, or inspect a directory.
- `cat path`: print one file's text inline, without reader metadata or navigation.
- `cd [path]`: change directory; no path returns home.
- `pwd`, `clear`, `history`: show location, clear output, or recall commands.

Paths support `/`, `~`, relative directories, `.` and `..`. This deliberately
small subset has no flags, pipes, redirection, globbing or multiple-file `cat`.
`cat` rejects directories rather than silently behaving like `open`.

Errors offer accurate recovery buttons that **fill input only**. Nothing guessed
is executed automatically. Click directory/file listings to browse directly.

## Keyboard and focus

- First Tab on nonempty input completes a unique match or shows choices.
- **Tab again leaves normally; Shift+Tab always leaves normally.** Completion is
  local to the command input, never a page-wide Tab trap.
- With choices open, Up/Down selects and Enter **accepts without running**. Press
  Enter again to execute the completed command.
- Escape dismisses suggestions without deleting your draft. With no suggestions,
  Up/Down recalls command history and restores an unfinished draft.
- No match is shown visibly while Tab still leaves. The completion button also
  works with blank input and can request completion again without editing.
- Browser shortcuts and composition/IME input are preserved. Clicking the prompt
  row focuses input; reading or selecting output does not. The focus handler also
  respects a pre-existing nonempty selection.
- The page never autofocuses input on load or when following a document link.

## Document links and browser history

Only formatted documents opened with `open` (including clicked file listings)
produce links such as `#/writing/sample`. `cat` and directory inspection do not
navigate. Back/Forward restores the linked document and a validated directory
snapshot; it does not replay commands or erase the current input draft.

Fresh direct links start at the root. A matching browser history entry can retain
its directory. Unknown/malformed links show a safe error. Reopening the current
document does not create a duplicate history entry.

`clear` clears output, not command history or the document link. An explicit later
Back/Forward action or reload can display that linked document again. Reloading
clears typed command history. URLs and browser state contain only fixed document
paths/directory context, never raw typed commands; typed history stays in memory.

Input is limited to 500 characters, history to 50 commands, and output to 40 blocks.

## Maintain and test

- `index.html`: semantic structure and security policy.
- `style.css`: palette, responsive layout, focus and completion states.
- `engine.js`: pure commands and placeholder virtual filesystem.
- `routing.js`: bounded, allowlisted document-link parsing and browser state.
- `app.js`: text rendering, local interaction and navigation coordination.
- `tests/`: development checks, not required to serve the site.

Keep content generic unless replacing it is explicitly intended. Rendering uses
text nodes rather than HTML templates. Any remote resource/service requires a
separate Content Security Policy and privacy review.

Use a recent Node.js with ES-module syntax detection (tested with Node.js 24):

```sh
node --check engine.js
node --check routing.js
node --check app.js
node --test tests/*.test.mjs
```

The deterministic DOM fixture checks interaction logic, not real layout, network
performance, assistive technology or software keyboards. The optional Python
Playwright script `tests/browser-check.py` provides additional browser checks; it
is development tooling, not a site dependency. Review actual desktop/mobile
layouts and real software keyboards before publishing.

## Replacing an earlier draft

Copy all five runtime files (`index.html`, `style.css`, `app.js`, `engine.js`,
and the **new `routing.js`**) plus this README to the draft branch only. Do not
omit `routing.js`: the app imports it.
Delete the old, unused `assets/styles.css` if it remains. Preserve existing
repository infrastructure such as `.nojekyll`, `CNAME`, `.github/`, or custom
hosting configuration. Tests are optional to include in the repository.

Do not change a live branch or Pages settings merely to preview this draft.
`noindex,nofollow` discourages indexing; it does not make a public site private.
GitHub Pages cannot set arbitrary HTTP response headers from these files:
header-only protections such as CSP `frame-ancestors` need suitable hosting.
