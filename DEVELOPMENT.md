# Development

The site is a dependency-free static terminal interface. The repository-root
`README.md` is the **single authored public Markdown document**, not this guide.
The virtual root lists only that real file; no empty categories are invented.

## Editing public content

Edit `README.md`, commit, and push to `main`. The GitHub Pages workflow
regenerates the embedded text, runs the tests, and deploys the static artifact.
Do not manually edit `README_SOURCE` in `engine.js`. The workflow does not commit
its generated changes back: a source checkout can therefore contain an older
embedded README until generation runs. This is intentional.

The site still needs no runtime packages or content fetch. Generation happens
once during deployment, not in visitors' browsers. Failed tests prevent deployment.

`cat README.md` prints that source exactly, including its final newline.
`open README.md` formats the same source with a deliberately small subset:
paragraphs, level 1–3 headings, and absolute HTTPS links. No destination whitelist
needs updating. HTTP, relative URLs, credentials and unsafe URL characters are
left as literal text. Percent-encode parentheses in link destinations as `%28`
and `%29`; nested Markdown syntax is deliberately unsupported. Links are navigated only when clicked; nothing is fetched. Unsupported
syntax and raw HTML remain literal text. No generic Markdown framework is used.
The generator accepts valid UTF-8 up to 64 KiB and preserves BOM and line endings.

## Preview and checks

```sh
node scripts/update-readme.mjs
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000`. Regenerate after local README edits, then reload.
This local-only preview step is not required for edits pushed to GitHub. HTTP is
required for JavaScript modules. Use Node.js
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

## One-time GitHub Pages setup

1. In GitHub Desktop, select `mjcrock.github.io`, fetch/pull the latest `main`,
   then create `setup/pages-automation` from `main` (Branch → New Branch).
2. Copy the update files into the repository, preserving the directory paths.
   The ZIP includes hidden `.github/workflows/pages.yml`; in Finder use
   Command–Shift–period to show hidden files. Do not delete unrelated files.
3. Review Changes, commit as `Automate README generation in Pages deployment`,
   and publish the branch. Open a pull request, review it, and merge into `main`.
4. On GitHub open Settings → Pages → Build and deployment → Source and select
   **GitHub Actions**. No access token or secret needs to be added.
5. Under Actions → Deploy site to GitHub Pages, run the workflow on `main`
   if the merge-triggered run happened before the setting was ready. Wait for
   both build and deploy to succeed, then check the live site.

Only pushes to `main` or manual runs on `main` deploy. The workflow uses pinned
official actions, Node 24, read-only source access in the build, and Pages/OIDC
permissions only in the deployment job. It publishes exactly seven public files
plus `.nojekyll`, not tests, scripts, this guide, hidden files, or the whole repo.
For a future custom domain, configure it in Pages settings separately; this
workflow targets the existing GitHub-provided domain.

A copied local `engine.js` is generated for the included README so the first
preview works. Subsequent GitHub content edits need only change README.md.
Do not commit `_site/`; it is generated staging output.

Keep `.DS_Store`, `._*` and `__MACOSX/` out of Git. `noindex,nofollow` is not access
control. GitHub Pages cannot set arbitrary response headers from these files;
header-only protections such as CSP `frame-ancestors` need suitable hosting.
