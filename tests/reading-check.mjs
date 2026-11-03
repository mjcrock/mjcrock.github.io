import assert from 'node:assert/strict';

// These checks model independent viewport reports and browser scroll bounds.
// They do not reproduce the native iOS keyboard compositor or touch momentum.
export async function checkReading(browser, url, engine) {
  for (const [font, motion] of [[16, 'no-preference'], [24, 'reduce'], [32, 'no-preference']]) {
    const page = await browser.newPage({viewport: {width: 390, height: 650}, hasTouch: true, reducedMotion: motion});
    const errors = [], label = `${engine} reading ${font}px ${motion}`;
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      const viewport = new EventTarget();
      Object.assign(viewport, {height: innerHeight, offsetTop: 0, scale: 1});
      Object.defineProperty(window, 'visualViewport', {value: viewport});
      window.reportViewport = (height, offsetTop) => {
        Object.assign(viewport, {height, offsetTop});
        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
      };
    });
    const frames = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const report = async (height, top) => { await page.evaluate(([h, t]) => reportViewport(h, t), [height, top]); await frames(); };
    const input = page.locator('#command');
    const run = async command => { await input.fill(command); await input.press('Enter'); await frames(); };
    const relative = locator => locator.evaluate(node => {
      const view = document.querySelector('.screen').getBoundingClientRect(), rect = node.getBoundingClientRect();
      return {top: rect.top - view.top, bottom: rect.bottom - view.top, height: view.height};
    });
    const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= 1,
      `${label}: ${message} (${actual}, ${expected})`);
    const open = async () => { await input.tap(); await report(260, 389); };
    const close = async () => { await input.blur(); await report(650, 0); };
    try {
      await page.goto(url); await page.locator('.entry').waitFor();
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; dispatchEvent(new Event('resize')); }, font);
      await frames(); await open(); await page.waitForTimeout(400); await frames();
      await run('ls');
      await input.fill('python'); await close();
      await page.evaluate(() => {
        window.inputFocuses = 0;
        document.querySelector('#command').addEventListener('focus', () => inputFocuses++);
      });
      const before = await page.locator('#output > .block').count();
      await page.getByRole('button', {name: 'Run command', exact: true}).tap(); await frames();
      assert.equal(await page.evaluate(() => inputFocuses), 0, label + ': Run after Done cannot reopen the keyboard');
      assert.equal(await input.evaluate(node => node === document.activeElement), false);
      assert.equal(await input.inputValue(), '');
      assert.equal(await page.locator('#output > .block').count(), before + 1);
      const closedArt = await relative(page.locator('.snake').last());
      assert.ok(closedArt.top >= 0 && closedArt.bottom <= closedArt.height + 1,
        label + ': Run with the keyboard closed reveals the complete drawing');

      await open(); await page.waitForTimeout(400); await frames();
      await run('python'); await input.fill('draft across resizing');
      assert.equal(await input.evaluate(node => node === document.activeElement), true, label + ': Enter retains input focus');
      const newest = page.locator('#output > .block').last();
      const initial = await relative(newest);
      assert.ok(initial.top >= 0 && initial.top < 24, label + ': the new command begins in the reading area');
      for (let cycle = 0; cycle < 3; cycle++) {
        await close(); await open();
        const reopened = await relative(newest);
        near(reopened.top, initial.top, 'the same result survives a full close/reopen cycle');
        assert.equal(await input.inputValue(), 'draft across resizing');
      }
      await page.waitForTimeout(400); await frames();
      near((await relative(newest)).top, initial.top, 'a late handoff cannot displace the result');

      // Even a wheel gesture against a scroll boundary explicitly chooses the
      // current reading position over a result that could not fit there before.
      await close();
      const clamped = await page.locator('.screen').evaluate(node => ({top: node.scrollTop, max: node.scrollHeight - node.clientHeight}));
      near(clamped.top, clamped.max, 'the closed reading area actually clamps at its bottom');
      assert.ok((await relative(newest)).top > initial.top + 20, label + ': the result bookmark is latent while clamped');
      await page.locator('.screen').hover(); await page.mouse.wheel(0, 90);
      await page.waitForTimeout(150); await frames();
      await open();
      near(await page.locator('.screen').evaluate(node => node.scrollTop), clamped.top,
        'a deliberate gesture at the bottom abandons the latent result bookmark');

      // A real wheel gesture chooses earlier output while resize reports arrive.
      // Its scroll must win over the previous automatic result reveal.
      for (let n = 0; n < 4; n++) await run('help');
      const beforeWheel = await page.locator('.screen').evaluate(node => node.scrollTop);
      await page.locator('.screen').hover();
      await Promise.all([page.mouse.wheel(0, -220), report(280, 369)]);
      await page.waitForTimeout(150); await frames();
      const chosen = await page.evaluate(() => {
        const screen = document.querySelector('.screen'), edge = screen.getBoundingClientRect().top;
        const blocks = [...document.querySelectorAll('#output > .block')];
        const index = blocks.findIndex(node => node.getBoundingClientRect().bottom > edge + 8);
        return {index, top: blocks[index].getBoundingClientRect().top - edge, scroll: screen.scrollTop};
      });
      assert.ok(chosen.scroll < beforeWheel - 40, label + ': the user actually scrolled away from the latest result');
      const passage = page.locator('#output > .block').nth(chosen.index);
      await report(260, 389);
      near((await relative(passage)).top, chosen.top, 'resizing preserves the user-selected earlier passage');
      await close(); await open(); await page.waitForTimeout(400); await frames();
      near((await relative(passage)).top, chosen.top, 'reopening preserves the earlier passage rather than the newest command');

      // Submitting a command is an explicit navigation even if the visitor left
      // text selected. Avoid fill/press here: they can collapse that selection.
      const selectedAtSubmit = await page.evaluate(() => {
        const selection = getSelection(), range = document.createRange();
        range.selectNodeContents(document.querySelector('#output .echo'));
        selection.removeAllRanges(); selection.addRange(range);
        const selected = !selection.isCollapsed;
        document.querySelector('#command').value = 'python';
        document.querySelector('#command-form').requestSubmit();
        return selected;
      });
      assert.ok(selectedAtSubmit, label + ': the command starts with an actual text selection');
      await frames();
      const selectedResult = await relative(page.locator('#output > .block').last());
      assert.ok(selectedResult.top >= 0 && selectedResult.top < 24,
        label + ': an old text selection cannot hide a newly requested result');

      const selectionText = await page.evaluate(() => {
        const selection = getSelection(), range = document.createRange();
        range.selectNodeContents(document.querySelector('#output .echo'));
        selection.removeAllRanges(); selection.addRange(range);
        return selection.toString();
      });
      const beforeExpansion = await page.locator('.screen').evaluate(node => node.scrollTop);
      await page.evaluate(() => {
        const screen = document.querySelector('.screen');
        let prototype = screen, descriptor;
        while (prototype && !descriptor) {
          descriptor = Object.getOwnPropertyDescriptor(prototype, 'scrollTop');
          prototype = Object.getPrototypeOf(prototype);
        }
        let writes = 0;
        Object.defineProperty(screen, 'scrollTop', {configurable: true,
          get() { return descriptor.get.call(this); },
          set(value) { writes++; descriptor.set.call(this, value); }
        });
        window.finishSelectionScrollCheck = () => {
          delete screen.scrollTop; delete window.finishSelectionScrollCheck;
          return writes;
        };
      });
      await report(650, 0);
      const selectedClamp = await page.locator('.screen').evaluate(node => node.scrollTop);
      assert.ok(selectedClamp < beforeExpansion - 1, label + ': expansion naturally clamps the scroll offset');
      await report(260, 389);
      // Selection and focus can trigger native browser scrolling. The app must
      // leave that behavior alone rather than restore its own reading bookmark.
      assert.equal(await page.evaluate(() => finishSelectionScrollCheck()), 0,
        label + ': an ordinary resize cannot force a scroll while text is selected');
      assert.equal(await page.evaluate(() => getSelection().toString()), selectionText);
      await page.evaluate(() => getSelection().removeAllRanges());

      if (font === 32) {
        // Keep pane dimensions fixed so font reflow alone exercises the browser's
        // scroll clamp, independently of a keyboard or control-height resize.
        await page.locator('.terminal').evaluate(node => node.style.setProperty('--compact-input-height', '48px'));
        await run('help');
        const row = page.locator('#output > .block').last().locator('.help-list dt').nth(2);
        const delta = (await relative(row)).top + 1;
        await page.locator('.screen').hover(); await page.mouse.wheel(0, delta);
        await page.waitForTimeout(150); await frames();
        const rowTop = (await relative(row)).top;
        near(rowTop, -1, 'the visitor selects a specific help passage');
        const pane = await page.locator('.screen').evaluate(node => ({width: node.clientWidth, height: node.clientHeight}));
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; dispatchEvent(new Event('resize')); }, size);
          await frames();
          assert.deepEqual(await page.locator('.screen').evaluate(node => ({width: node.clientWidth, height: node.clientHeight})), pane,
            label + ': font reflow leaves the compact pane dimensions unchanged');
          near((await relative(row)).top, rowTop, 'font reflow preserves the selected help passage');
        }
        await close(); await open();
        near((await relative(row)).top, rowTop, 'a close/reopen after font reflow preserves the passage');
      }

      await run('clear'); await close(); await open();
      assert.equal(await page.locator('#output').evaluate(node => node.children.length), 0);
      assert.equal(await page.locator('.screen').evaluate(node => node.scrollTop), 0, label + ': clear cannot restore a removed bookmark');
      await run('open README.md');
      await page.evaluate(() => { location.hash = ''; }); await frames();
      await close(); await open();
      assert.equal(await page.locator('#output > .initial-document').count(), 1);
      assert.equal(await page.locator('.screen').evaluate(node => node.scrollTop), 0, label + ': navigation resets the reading bookmark');
      await page.evaluate(() => {
        const field = document.querySelector('#command'), form = document.querySelector('#command-form');
        for (let n = 0; n < 45; n++) { field.value = 'pwd'; form.requestSubmit(); }
      });
      await frames(); await close(); await open();
      assert.equal(await page.locator('#output > .block').count(), 40);
      const last = await relative(page.locator('#output > .block').last());
      assert.ok(last.bottom <= last.height + 1 && last.bottom > 0, label + ': pruning retains a visible current result');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }

  // Width changes reflow real paragraphs. Preserve the selected passage, not a
  // numerical offset into everything that precedes it.
  const page = await browser.newPage({viewport: {width: 390, height: 650}, hasTouch: true, reducedMotion: 'reduce'});
  try {
    await page.route('**/', async route => {
      const response = await route.fetch(), opening = '<section class="initial-document" aria-label="README.md">';
      const paragraphs = Array.from({length: 24}, (_, n) => `<p data-passage="${n}">Passage ${n}. ${'Readable public writing wraps naturally as the available width changes. '.repeat(4)}</p>`).join('');
      await route.fulfill({response, body: (await response.text()).replaceAll(opening, opening + paragraphs)});
    });
    await page.goto(url); await page.locator('.entry').waitFor();
    const input = page.locator('#command');
    await input.fill('open README.md'); await input.press('Enter');
    const reading = page.locator('#output > .block').last().locator('[data-passage="12"]');
    // Browser focus is another deliberate way to select a reading location,
    // including keyboard and assistive-technology navigation.
    await reading.evaluate(node => { node.tabIndex = -1; node.focus(); });
    await page.locator('.screen').hover(); await page.mouse.wheel(0, 24);
    await page.waitForTimeout(150);
    const selected = await page.evaluate(() => {
      const screen = document.querySelector('.screen'), edge = screen.getBoundingClientRect().top;
      const paragraphs = [...document.querySelector('#output > .block:last-child').querySelectorAll('[data-passage]')];
      const node = paragraphs.find(node => node.getBoundingClientRect().bottom > edge + 8);
      return {id: node.dataset.passage, top: node.getBoundingClientRect().top - edge};
    });
    const marker = page.locator('#output > .block').last().locator(`[data-passage="${selected.id}"]`);
    for (const width of [320, 520, 390]) {
      await page.setViewportSize({width, height: 650});
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const top = await marker.evaluate(node => node.getBoundingClientRect().top - document.querySelector('.screen').getBoundingClientRect().top);
      assert.ok(Math.abs(top - selected.top) <= 1, `${engine}: document reflow keeps the selected passage (${top}, ${selected.top})`);
    }
  } finally { await page.close(); }
  console.log(`${engine}: Run focus, complete keyboard cycles, user reading, reflow, and bookmark cleanup passed`);
}
