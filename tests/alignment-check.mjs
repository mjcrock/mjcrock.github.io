// Browser geometry checks compare text origins, not just padded element boxes.
import assert from 'node:assert/strict';

const textGeometry = locator => locator.evaluate(node => {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const start = text.textContent.search(/\S/u);
    if (start < 0) continue;
    const range = document.createRange();
    range.setStart(text, start); range.setEnd(text, start + 1);
    const first = range.getBoundingClientRect();
    if (!first.width) continue;
    range.selectNodeContents(text);
    return {x: first.x, y: first.y, lines: [...new Set([...range.getClientRects()].map(rect => rect.top))],
      font: getComputedStyle(node).fontSize, lineHeight: getComputedStyle(node).lineHeight};
  }
  throw new Error('No visible text in ' + node.outerHTML);
});
const close = (actual, expected, label, tolerance = .5) => assert.ok(Math.abs(actual - expected) < tolerance, `${label}: ${actual}px vs ${expected}px`);
const frames = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));

export async function checkAlignment(browser, url, engine) {
  for (const [width, height, fontSize, touch] of [
    [1280, 900, 16, false], [1280, 900, 24, false], [1280, 900, 32, false],
    [601, 900, 24, false], [844, 780, 24, true], [844, 300, 32, true],
    [600, 780, 16, true], [390, 780, 16, true], [390, 260, 24, true],
    [351, 780, 24, true], [350, 780, 24, true], [320, 280, 32, true],
  ]) {
    const page = await browser.newPage({viewport: {width, height}, hasTouch: touch, reducedMotion: 'reduce'});
    const label = `${engine} ${width}×${height} ${fontSize}px`;
    try {
      await page.goto(url); await page.locator('.entry').waitFor();
      await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; dispatchEvent(new Event('resize')); }, fontSize);
      await frames(page);
      const input = page.locator('#command');
      const run = async command => { await input.fill(command); await input.press('Enter'); };
      const intro = await textGeometry(page.locator('.initial-document p').first());
      const rail = intro.x;
      if (await page.locator('.bar').isVisible()) {
        close((await textGeometry(page.locator('.site-name'))).x, rail, label + ' masthead');
        close((await textGeometry(page.locator('.site-status'))).x, rail, label + ' status');
      }
      close((await textGeometry(page.locator('.initial-document a').first())).x, rail, label + ' identity link');
      await run('ls'); await input.fill('ls');
      const echo = page.locator('.echo').last();
      close((await textGeometry(echo.locator('.path'))).x, rail, label + ' echoed prompt');
      const field = await input.evaluate(node => {
        const style = getComputedStyle(node);
        return {x: node.getBoundingClientRect().left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth), padding: style.paddingLeft, scroll: node.scrollLeft};
      });
      assert.equal(field.padding, '0px', 'Native input padding cannot add a browser-dependent indent');
      assert.equal(field.scroll, 0);
      if (await page.locator('#prompt').isVisible()) {
        close((await textGeometry(page.locator('#prompt'))).x, rail, label + ' active prompt');
        const echoedCommand = await echo.evaluate(node => {
          const range = document.createRange(); range.setStart(node.lastChild, 0); range.setEnd(node.lastChild, 1);
          return range.getBoundingClientRect().left;
        });
        // WebKit rounds glyph bounds while the native control retains fractional layout coordinates.
        close(field.x, echoedCommand, label + ' active and echoed command', 1);
      } else close(field.x, rail, label + ' mobile input');
      const filename = await textGeometry(page.locator('.listing-row button'));
      const description = await textGeometry(page.locator('.listing-row span'));
      close(filename.x, rail, label + ' filename'); close(filename.y, description.y, label + ' listing baseline');
      await page.locator('.listing-row').evaluate(row => {
        const wrapped = row.cloneNode(true);
        wrapped.querySelector('button').textContent = 'a-long-filename-that-wraps-across-several-lines.md';
        wrapped.querySelector('span').textContent = 'A long description that wraps beside its filename. '.repeat(8);
        row.parentNode.append(wrapped);
      });
      const wrappedName = await textGeometry(page.locator('.listing-row button').last());
      const wrappedDescription = await textGeometry(page.locator('.listing-row span').last());
      assert.ok(wrappedName.lines.length > 1 && wrappedDescription.lines.length > 1);
      for (let line = 0; line < Math.min(wrappedName.lines.length, wrappedDescription.lines.length); line++) {
        close(wrappedName.lines[line], wrappedDescription.lines[line], label + ' wrapped listing line ' + line);
      }
      await run('help');
      const help = page.locator('.help-list').last();
      close((await textGeometry(help.locator('dt').first())).x, rail, label + ' help command');
      close((await textGeometry(help.locator('dd').first())).x, description.x, label + ' shared description column');
      for (const row of await help.evaluate(node => [...node.querySelectorAll('dt')].map(dt => {
        const first = element => { const range = document.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 1); return range.getBoundingClientRect().top; };
        return [first(dt), first(dt.nextElementSibling)];
      }))) close(...row, label + ' help baseline');
      const hint = page.locator('.block').last().locator('.result p');
      const hintText = await textGeometry(hint), inlineText = await textGeometry(hint.locator('button').first());
      const lineHeight = parseFloat(hintText.lineHeight);
      const wrappedLines = Math.round((inlineText.y - hintText.y) / lineHeight);
      close(inlineText.y, hintText.y + wrappedLines * lineHeight, label + ' inline command baseline, including wrapping');
      await run('history');
      const history = page.locator('.history-list li').first();
      close((await textGeometry(history.locator('.number'))).x, rail, label + ' history number');
      close((await textGeometry(history.locator('.number'))).y, (await textGeometry(history.locator('button'))).y, label + ' history baseline');
      await run('open README.md');
      const result = page.locator('.block').last();
      close((await textGeometry(result.locator('.file-path'))).x, rail, label + ' document path');
      close((await textGeometry(result.locator('.file-title'))).x, rail, label + ' document title');
      const opened = result.locator('.initial-document');
      const body = await textGeometry(opened.locator('p').first());
      close(body.x, rail, label + ' opened document');
      assert.deepEqual([body.font, body.lineHeight], [intro.font, intro.lineHeight], 'Opening a document retains its typography');
      close((await textGeometry(opened.locator('a').first())).x, rail, label + ' opened identity link');
      if (touch) {
        const target = await opened.locator('a').first().boundingBox();
        assert.ok(target.width >= 44 && target.height >= 44, 'Opened document links retain their touch targets');
      }
      await run('cat README.md');
      close((await textGeometry(page.locator('.file-text').last())).x, rail, label + ' plain text');
      await run('bash');
      close((await textGeometry(page.locator('.error').last())).x, rail, label + ' error message');
      const toggle = page.locator('#tools-toggle');
      if (await toggle.isVisible()) await toggle.click();
      close((await textGeometry(page.getByRole('button', {name: 'Show commands', exact: true}))).x, rail, label + ' toolbar label');
      if (!touch && width > 600) {
        const next = await page.locator('#next').boundingBox(), submit = await page.locator('.run').boundingBox();
        close(next.x + next.width / 2, submit.x + submit.width / 2, label + ' right-side control centers');
      }
      await input.fill('h'); await input.press('Tab');
      const panel = await page.locator('#completion-panel').boundingBox(), form = await page.locator('#command-form').boundingBox();
      close(panel.x, form.x, label + ' completion left edge');
      close(panel.x + panel.width, form.x + form.width, label + ' completion right edge');
      close((await textGeometry(page.locator('#completion-status'))).x, rail, label + ' completion text');
      await input.press('Escape');
      await page.locator('#read-output').focus();
      close((await textGeometry(page.locator('#read-output'))).x, rail, label + ' keyboard reading control');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label + ' no page overflow');
    } finally { await page.close(); }
  }
}
