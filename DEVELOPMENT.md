# Development

The site is a static terminal interface with no browser runtime dependencies.
The repository-root `README.md` is the **single authored public Markdown document**, not this guide.
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

Use Node.js 24 or a newer supported version. After cloning, install the locked
build dependencies once. The SVG renderer is used only by deployment and local
preview; it is never loaded by visitors:

```sh
npm ci --include=dev --ignore-scripts --no-audit --no-fund
node scripts/serve.mjs
```

Open `http://localhost:8000`. Reload after README or SVG edits. The preview renders
the page and requested icons in memory and creates no build files. HTTP is
required for JavaScript modules. Run the checks with:

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
- `favicon.svg`: the single authored icon, with an opaque plum background.
- `scripts/icons.mjs`: build/preview renderer for the 64px favicon and 180px Apple icon.
- `package.json` and `package-lock.json`: pinned build tooling, never deployed.

The page renders from six runtime assets: HTML, CSS and four JavaScript modules.
The browser can also request the generated PNG icons for tabs or saved pages.
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
sizes the output in proportion to text size, with window dimensions as the
fallback when the visual viewport API is unavailable. Large default
fonts, short landscape layouts, coarse pointers, and forced colors are supported.
On narrow or touch-first screens with little available height, the header and full prompt give
way to output and a single command row. Tools reveals a shallow row of commands,
completion, and history above the input. It reserves its own space so output
scrolls entirely above the controls. At extreme text sizes the toolbar can scroll
horizontally instead of wrapping. Tapping these controls while
typing preserves input focus until an action intentionally changes it. The
disclosure and completion panel never cover one another. Output reserves at
least three text lines with Tools closed, or one while the controls are open.
The page can scroll if enlarged text makes the whole interface taller than the
visible area. Desktop layout is unchanged.
The compact-height threshold grows with the root text size, so larger text does
not fall back to a cramped full layout just above the normal breakpoint. Opening
help or browsing a document preserves an unfinished command. Closing an already
closed panel performs no DOM writes during ordinary typing.
The owner masthead and visitor `guest` prompt are distinct. The command row has
a visible boundary before focus. “Show commands” opens help directly without
focusing the input, and has a full-size touch target. The desktop frame is
compact with a stable prompt and scrollable output. Help lists commands without a keyboard essay.
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

## Icons

Edit `favicon.svg` to change the icon. Deployment generates `favicon.png` and
`apple-touch-icon.png` from that source with the locked `@resvg/resvg-js` renderer.
Both PNGs are part of the staged site and share its content-versioned URLs.
Do not create or commit PNG copies in the source folder. Local preview uses the
same renderer and reflects SVG edits on the next icon request. Ordinary PNG links
support browser interfaces that cannot use an SVG or data-URL favicon; a saved
browser icon may still need to refresh after deployment.

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
permissions only in the deployment job. Before validation it runs
`npm ci --include=dev --ignore-scripts --no-audit --no-fund` to install the locked
build tooling without lifecycle scripts. It publishes exactly nine public files
plus `.nojekyll`, not tests, scripts, this guide, hidden files, or the whole repo.
For a future custom domain, configure it in Pages settings separately; this
workflow targets the existing GitHub-provided domain.

The workflow runs `node scripts/build.mjs` to create a new `_site/` directory.
It renders `index.html`, copies `README.md`, generates both PNG icons, and adds
`.nojekyll`. CSS, all four JavaScript modules, and the generated PNGs get a shared
content-hash query string in the generated HTML and module imports, including
nested imports. Changing any runtime asset
or the icon artwork produces fresh URLs, avoiding reuse of cached code, styles,
or icons when the updated page loads. Filenames stay stable so older cached HTML can still resolve its
asset URLs after later deployments. Versioning adds no browser code.
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
