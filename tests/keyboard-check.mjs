import assert from 'node:assert/strict';

// Model independent viewport reports, not the native iOS keyboard compositor.
// A resize-only test cannot catch moving the browser's focus target twice.
export async function checkKeyboardHandoff(browser, url, engine) {
  const page = await browser.newPage({viewport: {width: 390, height: 900}, hasTouch: true});
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, {height: innerHeight, offsetTop: 0, scale: 1});
    Object.defineProperty(window, 'visualViewport', {value: viewport});
    window.reportViewport = (height, top) => {
      if (height !== null) { viewport.height = height; viewport.dispatchEvent(new Event('resize')); }
      if (top !== null) { viewport.offsetTop = top; viewport.dispatchEvent(new Event('scroll')); }
    };
  });
  const frames = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const state = () => page.evaluate(() => {
    const terminal = document.querySelector('.terminal'), input = document.querySelector('#command');
    const screen = document.querySelector('.screen'), rect = screen.getBoundingClientRect();
    const field = input.getBoundingClientRect(), top = visualViewport.offsetTop;
    const bottom = top + visualViewport.height, style = getComputedStyle(screen);
    return {field: field.toJSON(), frame: terminal.getBoundingClientRect().toJSON(),
      override: terminal.style.getPropertyValue('--viewport-height'), margin: terminal.style.marginTop,
      compact: terminal.classList.contains('compact'), focused: document.activeElement === input,
      draft: input.value, scroll: screen.scrollTop, pageScroll: scrollY,
      visible: field.top >= top && field.bottom <= bottom,
      lines: (Math.min(bottom, rect.bottom - parseFloat(style.paddingBottom)) -
        Math.max(top, rect.top + parseFloat(style.paddingTop))) /
        parseFloat(getComputedStyle(screen.querySelector('.block')).lineHeight)};
  });
  const report = async (height, top) => {
    await page.evaluate(([height, top]) => reportViewport(height, top), [height, top]);
    await frames();
    return state();
  };
  const reset = async (font = 16) => {
    await page.goto(url); await page.locator('.entry').waitFor();
    await page.evaluate(font => {
      document.documentElement.style.fontSize = `${font}px`;
      dispatchEvent(new Event('resize'));
      document.querySelector('#command').value = 'help';
      document.querySelector('#command-form').requestSubmit();
      document.querySelector('#command').blur();
      document.querySelector('#command').value = 'preserved draft';
      document.querySelector('.screen').scrollTop = 37;
    }, font);
    await frames();
  };
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < .5, `${engine}: ${message} (${actual}, ${expected})`);
  try {
    for (const font of [16, 24, 32]) {
      await reset(font);
      const original = await state();
      await page.locator('#command').tap();
      const early = await report(300, null);
      near(early.field.y, original.field.y, 'an early height report cannot jump the native focus target');
      assert.equal(early.compact, true, 'The header starts folding without waiting for the native pan');
      assert.equal(early.override, '');
      // Partial pan is intentional: the keyboard can cover bottom padding while
      // leaving the full input visible. It must not cause a second correction.
      const partial = original.field.bottom - 300 + 2;
      for (const top of [200, partial]) {
        const moved = await report(null, top);
        near(moved.field.y, original.field.y, 'native pan does not change the input layout position');
        near(moved.frame.y, top + 8, 'the frame follows the pan without a delayed header flash');
        assert.equal(moved.scroll, original.scroll, 'Viewport handoff retains the transcript scroll position');
      }
      await page.waitForTimeout(400);
      await frames();
      const settled = await state();
      near(settled.field.y, original.field.y, 'a visible partial pan settles without a step');
      assert.equal(settled.visible, true);
      assert.ok(settled.field.height >= 44 && settled.lines >= 3, 'Large input and readable output survive the handoff');
      assert.equal(settled.focused, true); assert.equal(settled.draft, 'preserved draft');
      // Offset reports can unwind before the old, short height is replaced.
      await page.locator('#command').blur(); await frames();
      for (const top of [partial, 200, 0]) {
        const closing = await report(null, top);
        assert.equal(closing.override, ''); assert.equal(closing.margin, '');
        near(closing.field.y, original.field.y, 'Done leaves movement to native pan, even with stale height');
      }
      const closed = await report(900, null);
      near(closed.field.y, original.field.y, 'the late closing height cannot move the input again');
      assert.equal(closed.draft, 'preserved draft');
    }

    await page.setViewportSize({width: 390, height: 650});
    // These small post-opening reports used to discard a visible anchor and
    // then feed every fluctuation into the input's layout position.
    await reset(); await page.locator('#command').tap();
    await report(260, 389); await page.waitForTimeout(400); await frames();
    const steady = await state();
    for (const height of [258, 261, 258, 264, 260]) {
      const next = await report(height, null);
      near(next.field.y, steady.field.y, 'small settled height changes do not move a visible input');
      assert.equal(next.visible, true); assert.equal(next.focused, true);
      assert.equal(next.draft, 'preserved draft');
    }
    // Native document scrolling changes screen coordinates, not layout ownership.
    await report(260, 370);
    const beforeScroll = await state();
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.height = '100px'; document.body.append(spacer);
      window.scrollTo(0, 1);
    });
    const afterScroll = await report(null, 370);
    assert.ok(afterScroll.pageScroll > 0, 'The fixture really scrolls the document');
    near(afterScroll.field.y + afterScroll.pageScroll, beforeScroll.field.y + beforeScroll.pageScroll,
      'a small page scroll cannot cause a second layout adjustment');
    assert.equal(afterScroll.override, '280px');

    // Previously the three-line minimum overruled the frame height at these
    // boundaries, moving the input down 4–5px and back as height settled.
    for (const motion of ['no-preference', 'reduce']) {
      await page.emulateMedia({reducedMotion: motion});
      for (const [font, heights] of [[16, [185, 180, 185]], [24, [228, 222, 228]], [32, [272, 266, 272]]]) {
        for (const openTools of [false, true]) {
          await reset(font); await page.locator('#command').tap();
          await report(heights[0], 650 - heights[0]);
          await page.waitForTimeout(400); await frames();
          if (openTools) { await page.locator('#tools-toggle').tap(); await frames(); }
          const initial = await state();
          for (const height of heights) {
            const next = await report(height, 650 - height);
            near(next.field.y, initial.field.y, `${font}px text stays steady across the old minimum-height boundary`);
            near(next.frame.height, height - 16, 'reading space yields instead of enlarging the terminal');
            assert.equal(next.visible, true); assert.ok(next.field.height >= 44);
            assert.ok(next.lines >= (openTools ? 1 : 2.7), 'These boundary cases retain usable reading space');
            assert.equal(next.focused, true); assert.equal(next.draft, 'preserved draft');
            assert.equal(next.pageScroll, 0, 'Reading-space constraints must not introduce page scrolling');
          }
          const controls = await page.locator(openTools ? '#command-tools button, .run, #tools-toggle' : '.run, #tools-toggle')
            .evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
          assert.ok(controls.every(rect => rect.width >= 44 && rect.height >= 44), 'Boundary layouts preserve touch targets');
          assert.equal(await page.locator('#command').evaluate(node => parseFloat(getComputedStyle(node).fontSize)), font);
        }
      }
    }
    await page.emulateMedia({reducedMotion: 'no-preference'});
    // A notch/home-indicator inset reduces usable space without changing text.
    for (const [font, heights] of [[16, [250, 242, 250]], [32, [336, 328, 336]]]) {
      await reset(font);
      await page.evaluate(() => {
        document.body.style.setProperty('--page-inset-top', '44px');
        document.body.style.setProperty('--page-inset-bottom', '34px');
      });
      await page.locator('#command').tap();
      await report(heights[0], 650 - heights[0]);
      await page.waitForTimeout(400); await frames();
      const insetStart = await state();
      for (const height of heights) {
        const next = await report(height, 650 - height);
        near(next.field.y, insetStart.field.y, 'safe-area padding does not restore the old minimum-height bounce');
        near(next.frame.height, height - 78, 'the frame accounts for both safe-area insets');
        assert.equal(next.visible, true); assert.equal(next.pageScroll, 0);
      }
    }
    await page.setViewportSize({width: 390, height: 900});

    // No pan / inadequate pan must never leave the field behind a keyboard.
    for (const top of [0, 350]) {
      await reset(); await page.locator('#command').tap();
      await report(300, top);
      await page.waitForTimeout(400); await frames();
      const fallback = await state();
      assert.equal(fallback.visible, true, 'Missing native pan has a bounded usable fallback');
      assert.equal(fallback.override, '300px');
      assert.equal(fallback.draft, 'preserved draft');
    }

    // A larger replacement keyboard can cover a previously visible anchor.
    await reset(); await page.locator('#command').tap();
    await report(300, 580);
    await page.waitForTimeout(400); await frames();
    const largerKeyboard = await report(220, null);
    assert.equal(largerKeyboard.visible, true, 'Emoji/dictation-sized changes can release the settled anchor');
    assert.equal(largerKeyboard.override, '220px');

    // Done before the first resize must also suppress a queued opening report.
    await reset();
    await page.evaluate(() => { const input = document.querySelector('#command'); input.focus(); input.blur(); });
    const cancelled = await report(300, 600);
    assert.equal(cancelled.override, ''); assert.equal(cancelled.margin, '');
    await page.waitForTimeout(400); await frames();
    assert.equal((await state()).override, '', 'A cancelled opening has no late timeout rebound');
    assert.deepEqual(errors, []);
    console.log(`${engine}: separate keyboard-height/pan reports, partial pan, Done, and bounded fallback passed`);
  } finally {
    await page.close();
  }
}
