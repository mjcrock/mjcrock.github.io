# Development

The site is a dependency-free static terminal interface. The repository-root
`README.md` is the **single authored public Markdown document**, not this guide.
The virtual root lists only that real file; no empty categories are invented.

## Editing public content

Edit `README.md`, commit, and push to `main`. The GitHub Pages workflow validates
and tests the source, generates `_site/index.html`, and deploys the public files.
The checked-in `index.html` is a template. Keep its marked README region empty:
the build supplies the readable HTML and exact source data without changing
tracked files. The title, identity metadata, and `noindex` setting are authored
configuration in the template.

The site needs no runtime packages or content fetch. The README and its links
work without JavaScript. Command controls appear once their handlers are ready.
Generation happens during deployment. Failed tests prevent deployment.

`cat README.md` prints that source exactly, including its final newline.
`open README.md` formats the same source with a deliberately small subset:
paragraphs, level 1–3 headings, and absolute HTTPS links. No destination whitelist
needs updating. HTTP, relative URLs, credentials and unsafe URL characters are
left as literal text. Percent-encode parentheses in link destinations as `%28`
and `%29`; nested Markdown syntax is deliberately unsupported. Links are navigated only when clicked; nothing is fetched. Unsupported
syntax and raw HTML remain literal text. No generic Markdown framework is used.
The generator accepts valid UTF-8 up to 64 KiB and preserves BOM and line endings.
Formatted text follows normal HTML parsing, including replacement of NUL with
U+FFFD. The original source used by `cat` remains exact.

## Preview and checks

```sh
node scripts/serve.mjs
```

Open `http://localhost:8000`. Reload after README edits. The preview renders the
page in memory on each request and creates no build files. HTTP is required for
JavaScript modules. Use Node.js 24 or another recent version supporting
ES-module syntax detection for checks:

```sh
node scripts/update-readme.mjs --check
node --check app.js
node --check engine.js
node --check routing.js
node --check snake.js
node --check markdown.js
node --test tests/*.test.mjs
```

`--check` validates the README and empty template without writing files. Running
`node scripts/update-readme.mjs` without arguments prints the generated HTML to
standard output. Tests render in memory or use temporary directories outside
the repository.

The preview server binds only to loopback and serves the same public-file
allowlist as deployment. The server test needs permission to open a local port.
The optional browser check uses a separately installed Node Playwright package:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser-check.mjs chromium webkit
```

Browser tooling and binaries are development dependencies, never deployed.
Deterministic DOM tests and desktop browser emulation do not replace actual
screen-reader or phone verification.

## Files and boundaries

- `index.html`: authored template, controls, metadata, accessibility and CSP.
- `style.css`: palette, responsive layout, focus and completion styles.
- `app.js`: rendering, input and navigation coordination.
- `engine.js`: fixed filesystem, command actions and history.
- `routing.js`: bounded, allowlisted document links and browser state.
- `snake.js`: compact ASCII frames and the one-shot animation player.
- `markdown.js`: build-only safe subset producing text/link data.
- `README.md`: canonical authored Markdown, also directly readable as a file.
- `scripts/update-readme.mjs`: build-only HTML renderer and source validation.
- `scripts/build.mjs`: deployment staging with content-versioned asset URLs.
- `scripts/serve.mjs`: local preview server shared by the browser checks.

The browser loads six runtime assets: HTML, CSS and four JavaScript modules.
It does not request README.md to render content. The CSP disallows connections,
inline scripts, objects, frames, workers, bases and form actions. Module preloads
let browsers discover the imported modules alongside the entry script.
The application retains one detached copy of the generated README for subsequent
views. Each view has independent DOM nodes. The inert JSON source is decoded
only on the first `cat` and retained until reload. Publishing content replaces
the generated HTML. No Markdown parser runs in the browser.

Keeping rendered content and exact source in one response avoids a request when
`cat` runs. It duplicates some content bytes, which matters for long READMEs on
uncompressed or gzip-only hosting. Keep this front door brief. Future articles
should have their own pages rather than accumulating in the homepage payload.

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
Mobile sizing accounts for safe areas and the visual viewport, preserves layout
during pinch zoom, and coalesces resize events into one animation frame. CSS
provides the fallback when the visual viewport API is unavailable. Large default
fonts, short landscape layouts, coarse pointers, and forced colors are supported.
The owner masthead and visitor `guest` prompt are distinct. The normal hint is
exactly “Type help for commands.” Help lists commands without a keyboard essay.
Error hints contain clickable commands that fill and focus the input without
running it. Help uses `[path]` for optional paths and `cat path` for its required
file argument.

The hidden `python` and `python3` aliases play a coiled ASCII snake blinking and
flicking its tongue. They never execute arguments and do not appear in help or completion.
The supplied artwork is stored compactly in `snake.js`, with the prop cursor
removed and identical holds combined. Frames are displayed
through `textContent` in one fixed 34-column × 12-line `<pre>`, with ligatures
disabled. The sequence plays once for 2.96 seconds, restoring the normal prompt
at 2.56 seconds. Reduced motion shows the supplied still and prompt immediately.
Typing finishes the sequence immediately without losing input or focus.

The player schedules at most one timeout for the next frame boundary. Elapsed
time skips overdue frames instead of extending playback. It stops on navigation,
hidden pages, and changes to reduced-motion preferences. No continuous animation-frame
loop, image assets, JSON fetch, or extra runtime package is needed. Output and
history use the existing limits.

## Content direction

Keep `README.md` as the introduction, identity links, and selected work. Add real
content under `writing/` and `projects/` when ready. Generate normal HTML document
URLs with direct links for those sections, keeping the terminal as another way
to browse. Do not use command fragments as the only public article URLs.

A contact link belongs with the README identity links. A public, current CV or
résumé can sit beside it, preferably with a readable HTML version and optional
PDF download. No contact form or empty sections are needed. Keep `noindex,nofollow`
until publication is ready. Then add per-page titles, descriptions, canonical
URLs, and a sitemap alongside the real pages.

## GitHub Pages deployment

In the repository's **Settings → Pages → Build and deployment**, select
**GitHub Actions** as the source. Push the changes to `main`, or run
**Deploy site to GitHub Pages** manually on `main`. Wait for both build and
deploy to succeed before checking the live site. No access token or secret
needs to be added.

Only pushes to `main` or manual runs on `main` deploy. The workflow uses pinned
official actions, Node 24, read-only source access in the build, and Pages/OIDC
permissions only in the deployment job. It publishes exactly seven public files
plus `.nojekyll`, not tests, scripts, this guide, hidden files, or the whole repo.
For a future custom domain, configure it in Pages settings separately; this
workflow targets the existing GitHub-provided domain.

The workflow runs `node scripts/build.mjs` to create a new `_site/` directory.
It renders `index.html`, copies `README.md`, and adds `.nojekyll`. CSS and all
four JavaScript modules get a shared content-hash query string in the generated
HTML and module imports, including nested imports. Changing any runtime asset
produces fresh URLs, avoiding reuse of cached code or styles when the updated
page loads. Filenames stay stable so older cached HTML can still resolve its
asset URLs after later deployments. This adds no browser code or requests.
An already-open page still needs a reload, and Pages may cache the HTML itself.

The asset version is computed during the build, never stored in source. The
builder refuses an existing output directory rather than overwriting files.
`_site/` is ignored by Git and must not be committed. Local preview and tests
leave source files unchanged.

Keep `.DS_Store`, `._*` and `__MACOSX/` out of Git. `noindex,nofollow` is not access
control. GitHub Pages cannot set arbitrary response headers from these files;
header-only protections such as CSP `frame-ancestors` need suitable hosting.
The generator reads at most 65,537 README bytes before enforcing the 64 KiB
limit, so rejected oversized authored files cannot require a full-file buffer.
