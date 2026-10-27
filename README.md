# Personal website skeleton

A dependency-free static GitHub Pages scaffold. The four sections intentionally contain no personal content. There are no scripts, external fonts, analytics, forms, or third-party assets.

## Preview

Run `python3 -m http.server 8000` from this directory, then open `http://localhost:8000`.

## GitHub Pages setup (not yet deployed)

1. Use a new, empty repository named `<username>.github.io`. Do not replace an existing site or change an existing private repository's visibility.
2. Add `index.html`, `assets/styles.css`, and `.nojekyll` at the repository root on `main`.
3. In the repository's Settings → Pages, select **Deploy from a branch**, **main**, and **/(root)**, then save.
4. Wait for GitHub's Pages deployment to succeed and verify the URL GitHub provides.

Public hosting and repository visibility should be explicitly approved before publishing. This scaffold includes `noindex, nofollow` to discourage search indexing while unfinished; that is not access control or a privacy guarantee.

## Later edits

Add content only inside the corresponding `.section-content` containers. Update the page title and remove the robots `noindex` setting only when ready for discovery. Colors, layout, and responsive styles live in `assets/styles.css`.
