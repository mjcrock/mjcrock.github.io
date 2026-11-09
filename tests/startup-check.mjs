import assert from 'node:assert/strict';

const frames = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const layout = page => page.evaluate(() => {
  const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
  const entry = document.querySelector('.entry');
  return {frame: box('.terminal'), output: box('.screen'), entry: box('.entry'),
    intro: box('.initial-document p'), header: box('.bar'), input: box('#command'), link: box('#page-link'),
    hidden: entry.hidden, visibility: getComputedStyle(entry).visibility,
    rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize)};
});

export async function checkStartup(browser, url, engine) {
  for (const [width, height, font, touch] of [
    [390, 650, 16, true], [390, 780, 24, true], [844, 780, 32, true],
    [390, 300, 24, true], [844, 300, 32, true], [320, 280, 32, true],
    [1280, 900, 16, false],
  ]) {
    const page = await browser.newPage({viewport: {width, height}, hasTouch: touch});
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const label = `${engine} startup ${width}x${height} ${font}px`;
    try {
      await page.route('**/style.css', async route => {
        const response = await route.fetch();
        const body = (await response.text()).replace('font-size: 100%;', `font-size: ${font}px;`);
        await route.fulfill({response, body});
      });
      await page.route('**/app.js', async route => { await gate; await route.continue(); });
      await page.goto(url, {waitUntil: 'commit'});
      await page.locator('.initial-document').waitFor();
      await page.waitForFunction(font => document.styleSheets.length > 0 &&
        parseFloat(getComputedStyle(document.documentElement).fontSize) === font, font);
      await frames(page);
      const before = await layout(page);
      assert.equal(before.hidden, true, label + ': the fixture really delays initialization');
      assert.equal(before.visibility, 'hidden', label + ': uninitialized controls remain unavailable');
      assert.ok(before.entry.height > 0, label + ': control space is reserved');
      await page.locator('#command').evaluate(node => node.focus());
      assert.equal(await page.locator('#command').evaluate(node => document.activeElement === node), false,
        label + ': a hidden control cannot accept keyboard focus');
      release();
      await page.locator('.entry').waitFor(); await frames(page);
      const after = await layout(page);
      assert.equal(after.hidden, false); assert.equal(after.visibility, 'visible');
      for (const name of ['frame', 'output', 'entry', 'intro', 'header', 'input', 'link']) {
        for (const dimension of ['x', 'y', 'width', 'height']) {
          assert.ok(Math.abs(before[name][dimension] - after[name][dimension]) < .5,
            `${label}: ${name}.${dimension} stays stable (${before[name][dimension]}, ${after[name][dimension]})`);
        }
      }
      assert.equal(after.rootFont, font);
      if (width <= 600 || touch) assert.ok(after.input.height >= 44, label + ': mobile input retains its touch height');
      else assert.deepEqual([after.frame.width, after.frame.height], [960, 560], 'Desktop geometry is unchanged');
    } finally { release(); await page.close(); }
  }

  for (const scripting of [false, true]) {
    const page = await browser.newPage({viewport: {width: 390, height: 300}, hasTouch: true, javaScriptEnabled: scripting});
    try {
      if (scripting) await page.route('**/app.js', route => route.abort());
      await page.goto(url); await page.locator('.initial-document').waitFor();
      assert.ok((await page.locator('.initial-document').textContent()).trim());
      assert.ok(await page.locator('.initial-document a').count() > 0, 'Identity links remain available without initialization');
      assert.equal(await page.locator('#command').isVisible(), false, 'No dead input appears after disabled or failed JavaScript');
      assert.equal(await page.getByRole('button', {name: 'Run command'}).count(), 0, 'Unavailable controls are absent from the accessible interface');
      await page.locator('#command').evaluate(node => node.focus());
      assert.equal(await page.locator('#command').evaluate(node => document.activeElement === node), false);
      const screen = await page.locator('.screen').boundingBox();
      const paragraph = await page.locator('.initial-document p').first().boundingBox();
      assert.ok(screen.height > 0 && paragraph.y >= screen.y && paragraph.y < screen.y + screen.height,
        'Readable content survives disabled or failed initialization');
    } finally { await page.close(); }
  }
  console.log(`${engine}: mobile startup reserves stable geometry and retains readable script-failure fallbacks`);
}
