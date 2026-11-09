import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const title = 'Mathematics for Cyber Threat Detection';
const bookPath = '/projects/textbook/';
const frames = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const path = page => new URL(page.url()).pathname;
const routeLink = (page, name) => page.getByRole('navigation', {name: 'Site'}).getByRole('link', {name, exact: true});

export async function checkTextbook(browser, url, engine) {
  const rootSource = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const bookSource = await readFile(new URL('../projects/textbook/README.md', import.meta.url), 'utf8');
  const errors = [];
  const createPage = async options => {
    const page = await browser.newPage(options);
    page.on('pageerror', error => errors.push(String(error)));
    return page;
  };

  // Direct public URLs must already contain readable content, even before the
  // terminal initializes. Keep the actual rendered nodes through initialization.
  const initial = await createPage({viewport: {width: 390, height: 780}, hasTouch: true});
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    await initial.route('**/app.js', async route => { await gate; await route.continue(); });
    await initial.goto(new URL(bookPath, url).href, {waitUntil: 'commit'});
    const heading = initial.locator('#output .initial-document h1');
    await heading.waitFor();
    await initial.waitForFunction(() => document.styleSheets.length > 0);
    await frames(initial);
    assert.equal(await heading.textContent(), title);
    assert.equal(await initial.locator('h1').count(), 1);
    assert.equal(await routeLink(initial, 'All projects').getAttribute('href'), '/projects/');
    assert.equal(await initial.locator('#output .initial-document p').textContent(), 'Textbook · In progress');
    assert.equal(await initial.locator('#command').isVisible(), false);
    await heading.evaluate(node => { node.dataset.retained = 'yes'; });
    const before = await heading.boundingBox();
    release();
    await initial.locator('.entry').waitFor(); await frames(initial);
    assert.equal(await heading.getAttribute('data-retained'), 'yes', 'Direct book startup retains the static document');
    const after = await heading.boundingBox();
    for (const dimension of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(before[dimension] - after[dimension]) < .5,
        `${engine}: book ${dimension} remains stable through initialization`);
    }
    assert.equal(await initial.locator('.echo').count(), 0);
    assert.equal(await initial.evaluate(() => document.activeElement === document.body), true);
    assert.equal(await initial.locator('#prompt').textContent(), 'guest:~/projects/textbook $');
    assert.equal(await initial.title(), title + ' | Michael J. Crockett');
    assert.equal(await initial.locator('meta[name="robots"]').getAttribute('content'), 'noindex,nofollow');
    const resources = await initial.locator('head [href],head [src]').evaluateAll(nodes => nodes.map(node =>
      new URL(node.href || node.src, location.href).pathname));
    for (const resource of ['/style.css', '/app.js', '/engine.js', '/routing.js', '/snake.js', '/favicon.png', '/apple-touch-icon.png']) {
      assert.ok(resources.includes(resource), `${engine}: nested page resolves ${resource} from the site root`);
    }
    const sizes = await initial.evaluate(async () => Promise.all(['icon', 'apple-touch-icon'].map(async rel => {
      const image = new Image(); image.src = document.querySelector(`link[rel="${rel}"]`).href;
      await image.decode(); return [image.naturalWidth, image.naturalHeight];
    })));
    assert.deepEqual(sizes, [[192, 192], [180, 180]]);
    const source = await initial.request.get(new URL('projects/textbook/README.md', url).href);
    assert.equal(source.status(), 200); assert.equal(await source.text(), bookSource);
    await initial.goto(new URL(bookPath + '#screen', url).href); await initial.reload();
    await initial.locator('.entry').waitFor();
    assert.equal(await initial.locator('#output h1').textContent(), title, 'A native section fragment keeps the direct textbook view');
    assert.equal(await initial.locator('.echo,.error').count(), 0);
    await initial.goto(url + '#%2Fprojects%2Ftextbook%2FREADME.md'); await initial.locator('.entry').waitFor();
    assert.equal(await initial.locator('#output').getByRole('heading', {name: title, exact: true}).count(), 1,
      'An encoded legacy document fragment still opens the book');
    assert.equal(await initial.locator('.error').count(), 0);
  } finally { release(); await initial.close(); }

  const plain = await createPage({viewport: {width: 390, height: 780}, hasTouch: true, javaScriptEnabled: false});
  try {
    await plain.goto(url);
    assert.ok((await plain.locator('#output .initial-document').textContent()).trim());
    assert.ok(!(await plain.locator('#output').textContent()).includes(title),
      'The authored homepage remains separate from the textbook');
    assert.equal(await plain.locator('.page-nav a').count(), 1);
    assert.equal(await plain.locator('h1.site-name').count(), 1);
    await routeLink(plain, 'Browse projects').click();
    assert.equal(path(plain), '/projects/');
    assert.equal(await plain.title(), 'Projects | Michael J. Crockett');
    assert.equal(await plain.locator('h1').textContent(), 'Projects');
    const project = plain.locator('#output').getByRole('link', {name: title, exact: true});
    assert.equal(await project.getAttribute('href'), bookPath);
    await project.click();
    assert.equal(path(plain), bookPath);
    assert.equal(await plain.locator('#output h1').textContent(), title);
    assert.equal(await plain.locator('#output p').count(), 1);
    assert.equal(await plain.locator('#command').isVisible(), false);
    assert.equal(await plain.getByRole('button', {name: 'Run command', exact: true}).count(), 0);
    await routeLink(plain, 'All projects').click();
    assert.equal(path(plain), '/projects/');
    await routeLink(plain, 'Home').click();
    assert.equal(path(plain), '/');
    assert.equal(await plain.locator('#output h1').count(), 0);
    assert.ok(await plain.locator('#output a[href="https://github.com/mjcrock"]').count());
  } finally { await plain.close(); }

  const page = await createPage({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  try {
    await page.goto(url); await page.locator('.entry').waitFor();
    const input = page.locator('#command');
    const run = async command => { await input.fill(command); await input.press('Enter'); await frames(page); };
    const focusedHeading = () => page.evaluate(() => document.activeElement.matches('h1') ? document.activeElement.textContent : '');
    const checkBookPage = async () => {
      const output = page.locator('#output');
      assert.equal(await output.locator(':scope > *').count(), 1);
      assert.ok(await output.locator(':scope > .initial-document').isVisible());
      assert.equal(await output.getByRole('heading', {name: title, exact: true}).count(), 1);
      assert.equal(await output.locator('.echo,.project-list').count(), 0);
    };
    const requests = [];
    page.on('request', request => {
      if (['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(request.resourceType())) requests.push(request.url());
    });
    await input.fill('a draft across pages');
    const browse = routeLink(page, 'Browse projects');
    // Catch the event after the site's delegated handler and prevent opening an
    // actual second tab. The browser receives a modified click uncanceled.
    const intercepted = await browse.evaluate(link => {
      let intercepted;
      document.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault(); }, {once: true});
      link.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, metaKey: true}));
      return intercepted;
    });
    assert.equal(intercepted, false); assert.equal(path(page), '/');
    await browse.click(); await frames(page);
    assert.equal(path(page), '/projects/');
    assert.equal(await focusedHeading(), 'Projects');
    assert.equal(await input.inputValue(), 'a draft across pages');
    assert.equal(await page.locator('#prompt').textContent(), 'guest:~/projects $');
    await page.locator('#output').getByRole('link', {name: title, exact: true}).click(); await frames(page);
    assert.equal(path(page), bookPath); assert.equal(new URL(page.url()).hash, '');
    assert.equal(await focusedHeading(), title);
    assert.equal(await page.locator('#prompt').textContent(), 'guest:~/projects/textbook $');
    assert.equal(await input.inputValue(), 'a draft across pages');
    await checkBookPage();

    const header = await page.locator('.bar').boundingBox();
    const ownerStyle = () => page.locator('.site-name').evaluate(node => {
      const style = getComputedStyle(node);
      return {font: style.fontSize, color: style.color, weight: style.fontWeight};
    });
    const quietOwner = await ownerStyle();
    await input.evaluate(field => {
      for (let i = 0; i < 40; i++) {
        field.value = 'pwd';
        field.form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
      }
    });
    assert.equal(await page.locator('h1.site-name').count(), 1, 'The masthead supplies a primary heading after pruning the initial view');
    assert.deepEqual(await page.locator('.bar').boundingBox(), header, 'Pruning output cannot resize the masthead');
    assert.deepEqual(await ownerStyle(), quietOwner, 'Pruning output retains the quiet owner typography');
    await input.fill('a draft across pages');
    await page.goBack(); await frames(page);
    assert.equal(path(page), '/projects/');
    assert.equal(await focusedHeading(), 'Projects');
    assert.equal(await page.locator('#prompt').textContent(), 'guest:~/projects $');
    await page.goForward(); await frames(page);
    assert.equal(path(page), bookPath);
    assert.equal(await page.locator('#prompt').textContent(), 'guest:~/projects/textbook $');
    assert.equal(await input.inputValue(), 'a draft across pages');
    await checkBookPage();

    await run('cd /'); await run('ls projects');
    assert.equal(await page.locator('#output > .block').last().locator('.listing-row button').textContent(), 'textbook/');
    const directoryURL = page.url();
    await run('open projects/textbook');
    assert.equal(await page.locator('#output > .block').last().locator('.listing-row button').textContent(), 'README.md');
    assert.equal(page.url(), directoryURL, 'Opening a directory keeps browsing semantics');
    await run('cd projects/textbook');
    await run('cat README.md');
    assert.equal(await page.locator('#output > .block').last().locator('.file-text').textContent(), bookSource);
    await run('cat /README.md');
    assert.equal(await page.locator('#output > .block').last().locator('.file-text').textContent(), rootSource);
    await run('clear');
    assert.equal(await page.locator('#output').evaluate(node => node.children.length), 0);
    assert.deepEqual(await page.locator('.bar').boundingBox(), header, 'Clearing output cannot resize the masthead');
    assert.deepEqual(await ownerStyle(), quietOwner, 'Clearing output retains the quiet owner typography');
    await routeLink(page, 'All projects').click(); await frames(page);
    assert.equal(path(page), '/projects/', 'The contextual link survives clearing the transcript');
    await page.goBack(); await frames(page);
    assert.equal(await focusedHeading(), title);
    await run('open README.md');
    const result = page.locator('#output > .block').last();
    assert.equal(await result.getByRole('heading', {name: title, level: 2, exact: true}).count(), 1);
    assert.equal(await result.getByRole('heading').count(), 1, 'The command result displays the authored title once');
    const copyLink = result.getByRole('link', {name: `Permalink to ${title}`, exact: true});
    assert.equal(await copyLink.getAttribute('href'), bookPath);
    assert.equal(await copyLink.textContent(), 'Permalink');

    await run('cd /');
    await input.fill('open projects/te'); await input.press('Tab');
    assert.equal(await input.inputValue(), 'open projects/textbook/');
    await input.fill('open projects/textbook/R'); await input.press('Tab');
    assert.equal(await input.inputValue(), 'open projects/textbook/README.md');
    await input.press('Enter'); await frames(page);
    assert.equal(path(page), bookPath); assert.equal(await page.locator('#prompt').textContent(), 'guest:~ $');
    await run('open /README.md');
    assert.equal(path(page), '/'); assert.equal(new URL(page.url()).hash, '#/README.md');
    await input.fill('preserved history draft');
    await page.goBack(); await frames(page);
    assert.equal(path(page), bookPath); assert.equal(await page.locator('#prompt').textContent(), 'guest:~ $');
    assert.equal(await input.inputValue(), 'preserved history draft');
    await checkBookPage();
    assert.deepEqual(requests, [], 'In-page browsing and terminal commands need no extra content or code requests');
    await page.setViewportSize({width: 601, height: 780});
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; dispatchEvent(new Event('resize')); });
    await run('cd /projects/textbook');
    const field = await input.boundingBox();
    assert.ok(field.width >= 100, 'A long working-directory prompt leaves space to type at large desktop text sizes');
    assert.equal(await page.locator('#prompt').textContent(), 'guest:~/projects/textbook $');
    await run('pwd');
    assert.equal(await page.locator('#output > .block').last().locator('.result').textContent(), '/projects/textbook');
  } finally { await page.close(); }

  for (const [width, font] of [[320, 16], [390, 24], [320, 32]]) {
    const mobile = await createPage({viewport: {width, height: 780}, hasTouch: true, reducedMotion: 'reduce'});
    try {
      await mobile.goto(new URL(bookPath, url).href); await mobile.locator('.entry').waitFor();
      await mobile.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; dispatchEvent(new Event('resize')); }, font);
      await frames(mobile);
      assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
        `${engine}: textbook title fits ${width}px with ${font}px text`);
      const heading = await mobile.locator('#output h1').evaluate(node => ({
        height: node.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(node).lineHeight),
      }));
      assert.ok(heading.height > heading.lineHeight * 1.5, 'The long title wraps naturally');
      const link = routeLink(mobile, 'All projects');
      const box = await link.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, 'The contextual link retains its touch target');
      const input = mobile.locator('#command');
      await input.fill('ls'); await input.press('Enter');
      await mobile.setViewportSize({width, height: 260}); await frames(mobile);
      const geometry = await mobile.evaluate(() => {
        const screen = document.querySelector('.screen').getBoundingClientRect();
        const entry = document.querySelector('.entry').getBoundingClientRect();
        const input = document.querySelector('#command').getBoundingClientRect();
        return {screen: screen.toJSON(), entry: entry.toJSON(), input: input.toJSON(), width: document.documentElement.scrollWidth};
      });
      assert.ok(geometry.screen.height > 0 && geometry.screen.bottom <= geometry.entry.top + .5,
        'Book output remains scrollable above the compact controls');
      assert.ok(geometry.input.height >= 44 && geometry.input.bottom <= 260,
        'The native resized viewport retains the full-size command input');
      assert.ok(geometry.width <= width);
      const filename = await mobile.locator('#output > .block').last().locator('.listing-row button').boundingBox();
      assert.ok(filename.height >= 44, 'The nested README keeps its touch target');
      await input.fill('help'); await input.press('Enter');
      const measured = await link.evaluate(link => {
        const screen = document.querySelector('#screen');
        screen.scrollTop = 0;
        const initialY = link.getBoundingClientRect().top;
        screen.scrollTop = screen.scrollHeight;
        const rect = link.getBoundingClientRect(), pane = screen.getBoundingClientRect();
        return {distance: initialY - rect.top, scrolled: screen.scrollTop,
          afterOutput: rect.top >= document.querySelector('#output').getBoundingClientRect().bottom - 1,
          reachable: rect.top >= pane.top - 1 && rect.bottom <= pane.bottom + 1};
      });
      assert.ok(measured.scrolled > 44 && Math.abs(measured.distance - measured.scrolled) <= 1,
        'The link scrolls with the transcript in compact mode');
      assert.ok(measured.afterOutput && measured.reachable, 'The link can scroll fully into view below the output');
      await link.tap(); await frames(mobile);
      assert.equal(path(mobile), '/projects/');
    } finally { await mobile.close(); }
  }
  assert.deepEqual(errors, [], `${engine}: textbook pages have no runtime errors`);
  console.log(`${engine}: textbook pages, no-JavaScript browsing, terminal integration, history, and mobile layout passed`);
}
