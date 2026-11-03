# Development

The site is a static terminal interface with no browser runtime dependencies.
The root `README.md` supplies the homepage, and `projects/textbook/README.md`
supplies the separate textbook page.

## Editing public content

Edit `projects/textbook/README.md` to update *Mathematics for Cyber Threat
Detection* at `/projects/textbook/`. When the textbook is available, add a
Markdown link labeled “Read the textbook” with its absolute HTTPS URL to that
file. Visitors reach the page through the Projects link and the index at
`/projects/`. The public catalog in `engine.js` supplies the directory entries
and listing labels.

The Pages workflow validates the source, tests it, and builds all three pages in
`_site/` when changes reach `main`. Keep the marked region in the checked-in
`index.html` template empty. The build fills each page with its own readable HTML,
title and description. All pages use the template's CSP and `noindex,nofollow`.

The public pages and navigation links work without JavaScript. Command controls
appear once their handlers are ready.
CSS establishes the mobile structure before initialization. When scripting is
enabled, the hidden controls reserve their final space without accepting focus
or appearing in the accessibility tree. With scripting disabled, that space is
released for reading. Short-screen startup styling follows the browser's default
text size, matching the page's `100%` root font.
Generation happens during deployment. Failed tests prevent deployment.

`ls /projects` lists the textbook directory. After `cd /projects/textbook`,
`ls` lists its `README.md`, `open README.md` displays it, and `cat README.md`
prints its exact source. Path completion uses the same directory entries.
A direct visit starts the terminal in the page's directory. Internal navigation
keeps the current draft and command history, and Back and Forward restore the
working directory saved for each page.

Both documents support paragraphs, level 1–3 headings, and absolute HTTPS links.
HTTP, relative URLs, credentials and unsafe URL characters are
left as literal text. Percent-encode parentheses in link destinations as `%28`
and `%29`; nested Markdown syntax is deliberately unsupported. Links are navigated only when clicked; nothing is fetched. Unsupported
syntax and raw HTML remain literal text. No generic Markdown framework is used.
Each Markdown file must contain valid UTF-8 and fit within 64 KiB. The generator
preserves BOM and line endings.
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

Open `http://localhost:8000` or `http://localhost:8000/projects/textbook/`. Reload
after Markdown or SVG edits. The preview renders pages and requested icons in
memory. HTTP is required for JavaScript modules. Run the checks with:

```sh
node scripts/update-readme.mjs --check
node --check app.js
node --check engine.js
node --check routing.js
node --check snake.js
node --check markdown.js
node --test tests/*.test.mjs
```

`--check` validates both documents and the empty template without writing files.
Running `node scripts/update-readme.mjs` without arguments prints the homepage HTML to
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
- `README.md` and `projects/textbook/README.md` supply the authored documents.
- `scripts/update-readme.mjs`: build-only HTML renderer and source validation.
- `scripts/build.mjs`: deployment staging with content-versioned asset URLs.
- `scripts/serve.mjs`: local preview server shared by the browser checks.
- `favicon.svg`: the single authored icon, with an opaque plum background.
- `scripts/icons.mjs`: build/preview renderer for the 192px favicon and 180px Apple icon.
- `package.json` and `package-lock.json`: pinned build tooling, never deployed.

Each page uses its own HTML, a shared stylesheet, and four shared JavaScript modules.
The browser can also request the generated PNG icons for tabs or saved pages.
The CSP disallows connections,
inline scripts, objects, frames, workers, bases and form actions. Module preloads
let browsers discover the imported modules alongside the entry script.
Each HTML page contains the three formatted views once. Its own view is visible,
and inert templates hold the others. The application reuses these views for
navigation and command output, including after `clear`. An inert JSON map holds
both Markdown sources and is decoded on the first `cat`. Reading and navigation
need no content fetch or client-side Markdown parser.

Including rendered content and exact source increases each page's size. Keep
these landing documents brief and link to larger publications from their pages.

No raw commands are saved to URLs or browser state. Navigation records the public
path and validated working directory. Typed history stays in
memory. Input is capped at 500 characters, history at 50 commands and output at
40 blocks. The command subset has no flags, pipes, redirection, globbing or
multi-file cat. No command can access a real shell or arbitrary local file.

Completion stays local: first Tab completes/shows choices, next Tab or Shift+Tab
exits; arrows select, Enter accepts without running, and Escape preserves the
draft. Unique completion has no visible success banner; choices and no-match
feedback overlay the output above the stationary prompt. Without choices arrows
recall history. Modified/IME keys remain untouched.
The viewport requests `interactive-widget=resizes-content` so supporting browsers
can resize the page with the keyboard. The mobile frame and compact controls use
one sizing update. Allowing CSS viewport units to grow the frame first can clamp
the transcript's scroll range before the controls return, even without animation.
When native layout and visual heights agree within one pixel, the window resize
handler commits their geometry synchronously and cancels any queued update.
Visual-only viewport resize and pan reports remain coalesced into one animation
frame. Unchanged heights cause no style writes. Desktop sizing stays in CSS.
WebKit can report keyboard geometry before or after its native animation;
desktop emulation cannot verify that timing.
On mobile focus, the fallback keeps the input's layout position fixed while the
browser pans it into view. Frame height and top inset change together, so an early
height report cannot move the browser's focus target a second time. The header
can still fold immediately. One 350ms safety timeout checks the input once after
layout; if native panning did not reveal it, measured-height sizing
resumes. The timeout bounds a missing-pan fallback, not a keyboard animation.
A partial pan that already reveals the input needs no correction. Later viewport
changes release the anchor only if they would cover the input or require a new layout.
Small visual-height fluctuations and fractional page scrolling do not switch
positioning rules. While the keyboard reduces only the visual viewport, layout
height corrections within four CSS pixels of the original focus height also
retain the native target. The bound stays relative to that original height so
repeated corrections cannot accumulate. Larger layout changes, width changes,
and native content resizing (layout and visual heights agree) release it
immediately; the existing occlusion check still fits an input that would be
covered. This avoids abandoning a settled input for a tiny late browser-chrome
correction without adding animation or another timeout. While anchored, even
subpixel height differences retain the exact target before the first native pan.
The visibility check uses document coordinates so native page
scrolling does not become another layout adjustment.
Done returns to the layout height and clears the pan inset on blur; stale closing
visual reports cannot reapply the old keyboard geometry before the next focus.
Programmatic mobile focus permits native
reveal, and an already focused field is never focused again. No keyboard-height
prediction, continuous animation, or polling is used. Actual iPhone verification
is still required: desktop engines cannot reproduce the native keyboard's timing.
Mobile sizing accounts for safe areas and the visual viewport, preserves layout
during pinch zoom. CSS
sizes the output in proportion to text size, with window dimensions as the
fallback when the visual viewport API is unavailable. Large default
fonts, short landscape layouts, coarse pointers, and forced colors are supported.
Narrow and touch-first screens keep the same frame width, padding, input size,
and command-row position throughout keyboard movement. The mobile toolbar sits
above the input, so opening or closing it cannot move the caret. With little
available height, the header and toolbar collapse in the same layout update as
the frame. Their heights do not animate: a delayed expansion temporarily gives
the transcript too much space, clamps its scroll offset, and then clips the
result when the controls return. Committing the final geometry together avoids
that second reflow without delayed scroll restoration that could override a
visitor's own scrolling. Tools also reserves its final height immediately.
Tools reveals a shallow row of commands,
completion, and history above the input. It reserves its own space so output
scrolls entirely above the controls. At extreme text sizes the toolbar can scroll
horizontally instead of wrapping. Tapping these controls while
typing preserves input focus until an action intentionally changes it. Run,
completion choices, and recalled commands also preserve focus between pointer
down and click, avoiding a keyboard dismissal followed by immediate reopening.
The Run button preserves the current focus: Enter keeps typing active, while running
a pretyped command after Done leaves the keyboard closed.
The disclosure and completion panel never cover one another. Output prioritizes three
text lines with Tools closed, or one while the controls are open, bounded by the
space left above the full-size controls. It yields space on unusually short
viewports instead of pushing the input down to enforce three lines. The minimum
frame holds one readable line and the full-size controls; below that minimum the
page can scroll to keep both reachable. Fine-pointer desktop layout is unchanged. The output reserves a
scrollbar gutter where classic scrollbars need space, avoiding text reflow when
output begins or stops overflowing.
When the keyboard pans the visual viewport, the frame follows its vertical offset
with a normal-flow margin. The opening handoff preserves the frame's layout
bottom, including when the keyboard covers only the bottom padding. Mobile scroll
anchoring is disabled where supported so it cannot add another adjustment.
The frame never follows document scrolling, so oversized
layouts remain scrollable. The offset is bounded by the difference between layout
and visual viewport heights and clears as the full height returns. The transcript
has no transform or independent animation. The output owns result-scroll
coordinates so submitting during viewport changes reveals a consistent position.
One reading bookmark retains the chosen result or paragraph and its relative
offset through complete keyboard close/reopen cycles. Browser scroll clamping
does not overwrite that intent. Deliberate scrolling, pointer interaction, and
keyboard navigation choose a new passage. Pending scroll events are reconciled
before resizing; changes to the pane or content dimensions identify automatic
reflow. Text selection suppresses passive restoration, but an explicit command
still reveals its result. Clear and navigation reset the bookmark. Unchanged
viewport reports do not read passage positions or write scroll offsets, and a
resize reads only the saved passage rather than scanning the transcript. There
is no new timer, animation loop, or dependency. This preserves a paragraph's
position through wrapping, not the exact character within a long paragraph.
Viewport-height updates stop at the output container instead of restyling its
entire transcript.
Compact mode retains the frame's flex layout, avoiding an intrinsic-size scan of
the transcript when the keyboard changes the available height.
The masthead, output, prompt, and first toolbar label share one text inset.
Control borders sit outside that inset, and the completion panel follows the
input box. Explicit input padding and a one-character desktop prompt gap keep
typed commands aligned with their echoes across browser defaults and text sizes.
Help and file listings share font-relative columns, capped to leave room for
descriptions. Redundant titles matching the filename are omitted. Listing text
keeps the same line height in both columns, including
wrapped filenames. History retains its shorter number column and shared baseline.
Opened documents preserve the landing document's typography and touch-link
spacing without adding another named region inside the command result.
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
The standard favicon is 192px so it also meets high-density browser icon requests
(Brave on iOS can require at least 96 pixels for a 32-point icon at 3× scale).
Do not create or commit PNG copies in the source folder. Local preview uses the
same renderer and reflects SVG edits on the next icon request. Ordinary PNG links
support browser interfaces that cannot use an SVG or data-URL favicon; a saved
browser icon may still need to refresh after deployment.

## Content direction

Keep the introduction and identity links in the root `README.md`. The Projects
index links to the textbook's public page. Future writing and selected work can
follow the same pattern of a directly accessible page and a terminal entry.

A contact link belongs with the README identity links. A public, current CV or
résumé can sit beside it, preferably with a readable HTML version and optional
PDF download. No contact form or empty sections are needed. Keep `noindex,nofollow`
until publication is ready. Then review the per-page titles and descriptions,
add canonical URLs, and publish a sitemap.

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
build tooling without lifecycle scripts. Only generated pages, authored public
documents, shared runtime assets, icons, and `.nojekyll` are staged.
For a future custom domain, configure it in Pages settings separately; this
workflow targets the existing GitHub-provided domain.

The workflow runs `node scripts/build.mjs` to create a new `_site/` directory.
It renders an `index.html` for `/`, `/projects/`, and `/projects/textbook/`,
copies both Markdown sources at their catalog paths, and generates both PNG icons.
The nested pages reference the shared root assets. CSS, all four JavaScript
modules, and the generated PNGs get a shared content-hash query string in the
generated HTML and module imports, including nested imports. Changing any runtime asset
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
The generator reads at most 65,537 bytes per Markdown file before enforcing the 64 KiB
limit, so rejected oversized authored files cannot require a full-file buffer.
