# Terminal prototype

A small, dependency-free static interface with generic placeholder content. It is
not a shell: commands can only read the fixed virtual files in `engine.js`.
No build step, runtime packages, external fonts, analytics, storage, or services.

## Preview

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000`. Use a local HTTP server rather than opening
`index.html` directly, because the browser loads JavaScript modules.

## Controls

- `help`, `ls [path]`, `open [path]`, `cd [path]`, `pwd`, `clear`, `history`
- Tab completes commands and paths; Tab again reaches multiple choices.
- Up/Down recalls history; Escape dismisses completion choices or clears input.
- Click shortcuts and listed files to browse without focusing the text input.
- `clear` clears output, not history. Reloading clears all in-memory state.

Paths support `/`, `~`, relative directories, `.` and `..`. Input is limited to
500 characters; history to 50 commands; rendered output to 40 blocks.

## Maintain

- `index.html`: semantic page structure and security policy.
- `style.css`: the terminal palette, layout, focus states and responsive styles.
- `engine.js`: pure command model and placeholder virtual filesystem.
- `app.js`: safe text rendering, keyboard controls and viewport behavior.
- `tests/`: development checks, not required for serving the site.

Keep content generic unless replacing it is explicitly intended. Rendering uses
text nodes, not HTML templates. New remote resources or services require a
separate review of the Content Security Policy and privacy implications.

## Checks

Node.js 22.7 or later supports the source modules without a package/build step.

```sh
node --check engine.js
node --check app.js
node --test tests/*.test.mjs
```

The DOM tests use a deterministic fixture, not a real layout engine. They check
interaction logic and bounded work, not browser performance, visual rendering,
screen-reader output, touch behavior, or enforcement of the browser security
policy. Run `tests/browser-check.py` with Python Playwright and an installed
Chromium for additional real-browser smoke checks; it is optional development
tooling, not a site dependency. Review mobile/desktop layouts and real software
keyboards manually before publishing.

## Replacing an earlier draft

Replace the four runtime files above and this README on the draft branch only.
Delete the old, unreferenced `assets/styles.css` (and `assets/` if now empty).
Keep any existing repository infrastructure such as `.nojekyll`, `CNAME`,
`.github/`, or custom hosting configuration; these are not replaced by this
bundle. Tests are optional to include in the repository.

This is a review draft, not a deployment instruction. Do not change a live branch
or Pages settings just to preview it. `noindex,nofollow` discourages indexing;
it does not make a public site private. GitHub Pages cannot set arbitrary HTTP
response headers from these files: header-only protections such as CSP
`frame-ancestors` require a hosting layer that supports them.
