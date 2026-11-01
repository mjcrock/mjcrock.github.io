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
      draft: input.value, scroll: screen.scrollTop, visible: field.top >= top && field.bottom <= bottom,
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
