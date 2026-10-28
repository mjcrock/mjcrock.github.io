# Development

The site is a dependency-free static terminal interface. The repository-root
`README.md` is the **single authored public Markdown document**, not this guide.
The virtual root lists only that real file; no empty categories are invented.

## Editing public content

Edit `README.md`, then run:

```sh
node scripts/update-readme.mjs
```

This small, dependency-free authoring command updates the marked generated
`README_SOURCE` constant in `engine.js`. Commit both files. Do not edit the
constant by hand. The check below fails if source and generated content differ:

```sh
node scripts/update-readme.mjs --check
```

The shipped site needs no build, content fetch, or runtime packages. Generating
the content before publication removes loading, timeout, and authentication
states from startup. The tradeoff is this explicit authoring step after Markdown
edits. Tests check the generated content against the actual README bytes.

`cat README.md` prints that source exactly, including its final newline.
`open README.md` formats the same source with a deliberately small subset:
paragraphs, level 1–3 headings, and the exact approved GitHub link. Unsupported
syntax and raw HTML remain literal text. No generic Markdown framework is used.
The generator accepts valid UTF-8 up to 64 KiB and preserves BOM and line endings.

## Preview and checks

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000`. HTTP is required for JavaScript modules. Use Node.js
24 or another recent version supporting ES-module syntax detection for checks:

```sh
node scripts/update-readme.mjs --check
node --check app.js
node --check engine.js
node --check routing.js
node --check markdown.js
node --test tests/*.test.mjs
```

The optional Python Playwright script is development tooling only. Deterministic
DOM tests do not replace actual browser, screen-reader or phone verification.

## Files and boundaries

- `index.html`: static masthead, input controls, accessibility and CSP.
- `style.css`: palette, responsive layout, focus and completion styles.
- `app.js`: rendering, input and navigation coordination.
- `engine.js`: fixed filesystem, generated README text, commands and history.
- `routing.js`: bounded, allowlisted document links and browser state.
- `markdown.js`: safe subset producing text/link data, never HTML strings.
- `README.md`: canonical authored Markdown, also directly readable as a file.
- `scripts/update-readme.mjs`: development-only generation and consistency check.

The browser loads six runtime assets: HTML, CSS and four JavaScript modules.
It does not request README.md to render content. The CSP disallows connections,
inline scripts, objects, bases and form actions. Content lives with the module
until reload; publishing edits means replacing the generated engine too.

No raw commands are saved to URLs or browser state. Only the fixed document path
and validated root context are used for navigation. Typed history stays in
memory. Input is capped at 500 characters, history at 50 commands and output at
40 blocks. The command subset has no flags, pipes, redirection, globbing or
multi-file cat. No command can access a real shell or arbitrary local file.

Completion stays local: first Tab completes/shows choices, next Tab or Shift+Tab
exits; arrows select, Enter accepts without running, and Escape preserves the
draft. Unique completion has no visible success banner; choices and no-match
feedback overlay the output above the stationary prompt. Without choices arrows
recall history. Modified/IME keys remain untouched.
The owner masthead and visitor `guest` prompt are distinct. The normal hint is
exactly “Type help for commands.” Help lists commands without a keyboard essay.

## Replacing a previous draft

Copy all seven public files above (including `README.md`), `scripts/`, this guide,
and the existing `.gitignore` to the draft branch. Include the supplied tests for
future consistency checks. `markdown.js` is required; do not omit it. `README.md`
contains public content; technical instructions live in `DEVELOPMENT.md`.

Preserve hosting infrastructure such as `.nojekyll`, `CNAME` and `.github/` if
present. Do not track `.DS_Store`, `._*` or `__MACOSX/`. Do not change a live branch
or Pages settings just to preview. `noindex,nofollow` is not access control.
GitHub Pages does not set arbitrary response headers from these files; header-only
protections such as CSP `frame-ancestors` need suitable hosting.
