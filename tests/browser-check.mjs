// Optional tooling: node tests/browser-check.mjs [chromium firefox webkit]
// Install Playwright separately, or set PLAYWRIGHT_MODULE to its index.mjs path.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {startServer} from '../scripts/serve.mjs';
import {checkAlignment} from './alignment-check.mjs';

const playwright = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const engines = process.argv.slice(2);
if (!engines.length) engines.push('chromium');
for (const engine of engines) assert.ok(['chromium', 'firefox', 'webkit'].includes(engine), `Unknown browser: ${engine}`);
const source = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const {server, url} = await startServer();
const frames = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
try {
  for (const engine of engines) {
    const browser = await playwright[engine].launch({headless: true, timeout: 20000});
    try {
      await checkAlignment(browser, url, engine);
      const page = await browser.newPage({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('request', request => requests.push(request.url()));
      await page.goto(url);
      await page.locator('.initial-document').waitFor();
      await page.locator('.entry').waitFor();
      const icons = await page.evaluate(async () => {
        const sizes = [];
        for (const rel of ['icon', 'apple-touch-icon']) {
          const image = new Image();
          image.src = document.querySelector(`link[rel="${rel}"]`).href;
          await image.decode();
          sizes.push([image.naturalWidth, image.naturalHeight]);
        }
        return sizes;
      });
      assert.deepEqual(icons, [[64, 64], [180, 180]], 'Generated icons decode under the site CSP');
      const frame = await page.locator('.terminal').boundingBox();
      assert.deepEqual([frame.width, frame.height], [960, 560], 'Fine-pointer desktop frame stays unchanged');
      const input = page.locator('#command');
      const run = async value => { await input.fill(value); await input.press('Enter'); };
      const openTools = async () => {
        const toggle = page.locator('#tools-toggle');
        if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
      };
      assert.equal(await page.locator('.site-name').textContent(), 'Michael J. Crockett');
      const showCommands = page.getByRole('button', {name: 'Show commands', exact: true});
      await showCommands.waitFor();
      assert.equal(await page.locator('.echo').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
      await input.fill('unfinished command');
      await showCommands.click();
      assert.equal(await page.locator('.help-list').count(), 1, 'Show commands opens help in one click');
      assert.equal(await input.inputValue(), 'unfinished command', 'Opening help preserves an unfinished command');
      assert.equal(await page.locator('.block').last().evaluate(node => node === document.activeElement), true);
      await run('cat README.md');
      assert.equal(await page.locator('.block').last().locator('pre').textContent(), source);
      assert.equal(page.url(), url);
      await run('open README.md');
      assert.equal(new URL(page.url()).hash, '#/README.md');
      await input.fill('draft while browsing');
      await page.getByRole('button', {name: 'open README.md', exact: true}).click();
      assert.equal(await input.inputValue(), 'draft while browsing', 'Opening a document preserves an unfinished command');
      await run('ls /');
      assert.equal(await page.locator('.listing-row button').last().textContent(), 'README.md');
      await input.fill('draft');
      await page.goBack();
      await page.waitForFunction(() => location.hash === '');
      await page.goForward();
      await page.waitForFunction(() => location.hash === '#/README.md');
      assert.equal(await input.inputValue(), 'draft');
      await input.fill('cat R');
      await input.press('Tab');
      assert.equal(await input.inputValue(), 'cat README.md');
      assert.equal(await page.locator('#completion-panel').isHidden(), true);
      await input.press('Tab');
      assert.equal(await input.evaluate(node => node === document.activeElement), false);
      await input.fill('h');
      await input.press('Tab');
      const count = await page.locator('.block').count();
      await input.press('ArrowDown');
      await input.press('Enter');
      assert.equal(await input.inputValue(), 'history');
      assert.equal(await page.locator('.block').count(), count);
      await run('bash');
      const hint = page.locator('.block').last().locator('button');
      await hint.click();
      assert.equal(await input.inputValue(), 'help');
      assert.equal(await input.evaluate(node => node === document.activeElement), true);
      for (const [width, height] of [[320, 300], [390, 200], [390, 650], [844, 390], [1280, 900]]) {
        await page.setViewportSize({width, height}); await frames(page);
        if (width > 600) assert.equal(await page.locator('.terminal').evaluate(node => node.classList.contains('compact')), false, 'Fine-pointer desktop layout stays expanded');
        await input.fill('');
        const before = await input.boundingBox();
        await openTools();
        await page.locator('#complete').click();
        assert.deepEqual(await input.boundingBox(), before, `${engine} stationary prompt ${width}x${height}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await page.locator('#completion-panel').evaluate(node => node.getBoundingClientRect().bottom <= document.querySelector('.entry').getBoundingClientRect().top + 1), true);
        assert.equal(await page.locator('.toolbar').evaluate(node => node.getBoundingClientRect().bottom <= document.querySelector('.terminal').getBoundingClientRect().bottom), true);
        await input.press('Escape');
        await openTools();
        const helpBounds = await showCommands.boundingBox();
        assert.ok(helpBounds.width >= 44 && helpBounds.height >= 44, `${engine} help target ${width}x${height}`);
        await showCommands.click();
        assert.equal(await page.locator('.block').last().locator('.help-list').count(), 1);
        assert.equal(await input.evaluate(node => node === document.activeElement), false, 'Browsing help does not focus the keyboard input');
        assert.deepEqual(await input.boundingBox(), before, 'Showing help keeps the command row stationary');
      }

      const listing = await browser.newPage({viewport: {width: 390, height: 780}, hasTouch: true, reducedMotion: 'reduce'});
      listing.on('pageerror', error => errors.push(String(error)));
      await listing.goto(url); await listing.locator('.entry').waitFor();
      await listing.locator('#command').fill('ls'); await listing.locator('#command').press('Enter');
      await listing.locator('.listing-row').evaluate(row => {
        const wrapped = row.cloneNode(true);
        wrapped.querySelector('button').textContent = 'a-long-filename-that-wraps-across-several-lines.md';
        wrapped.querySelector('span').textContent = 'A description that wraps onto several lines beside the filename.';
        row.parentNode.append(wrapped);
      });
      await listing.locator('#command').fill('history'); await listing.locator('#command').press('Enter');
      await listing.locator('.history-list li').last().evaluate(row => {
        const wrapped = row.cloneNode(true);
        wrapped.querySelector('button').textContent = 'a long recalled command that wraps onto several lines';
        row.parentNode.append(wrapped);
      });
      for (const fontSize of [16, 24, 32]) {
        await listing.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
        const rows = await listing.locator('.listing-row,.history-list li').evaluateAll(nodes => nodes.map(row => {
          const text = node => {
            const range = document.createRange();
            range.selectNodeContents(node);
            const lines = range.getClientRects().length;
            range.setEnd(node.firstChild, 1);
            return {top: range.getBoundingClientRect().top, lines};
          };
          return {name: text(row.firstElementChild), description: text(row.lastElementChild), height: row.querySelector('button').getBoundingClientRect().height};
        }));
        for (const row of rows) {
          assert.ok(Math.abs(row.name.top - row.description.top) < .5, `${engine} listing/history text aligns at ${fontSize}px`);
          assert.ok(row.height >= 44, 'Aligned filenames and recalled commands retain full touch targets');
        }
        assert.ok(rows[1].name.lines > 1 && rows[1].description.lines > 1, 'The alignment fixture exercises wrapping in both columns');
        assert.ok(rows.at(-1).description.lines > 1, 'The history fixture exercises a wrapped command');
      }
      await listing.close();

      const compact = await browser.newPage({reducedMotion: 'reduce', hasTouch: true});
      const field = compact.locator('#command');
      const tools = compact.locator('#tools-toggle');
      const toolbar = compact.locator('#command-tools');
      compact.on('pageerror', error => errors.push(String(error)));
      const outputSpace = () => compact.locator('.screen').evaluate(node => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const paddingTop = parseFloat(style.paddingTop), paddingBottom = parseFloat(style.paddingBottom);
        const line = parseFloat(getComputedStyle(node.querySelector('.initial-document')).lineHeight);
        const top = visualViewport?.offsetTop ?? 0;
        const bottom = top + (visualViewport?.height ?? innerHeight);
        return {
          lines: (rect.height - paddingTop - paddingBottom) / line,
          visibleLines: Math.max(0, Math.min(rect.bottom - paddingBottom, bottom) - Math.max(rect.top + paddingTop, top)) / line,
          pageScrolls: document.documentElement.scrollHeight > innerHeight,
        };
      });
      for (const [width, height, fontSize] of [[320, 220, 16], [390, 220, 24], [320, 260, 24], [390, 260, 32]]) {
        await compact.setViewportSize({width, height});
        await compact.goto(url);
        await compact.locator('.entry').waitFor();
        await compact.evaluate(size => {
          document.documentElement.style.fontSize = `${size}px`;
          window.dispatchEvent(new Event('resize'));
        }, fontSize);
        await field.fill('unfinished command'); await field.focus(); await frames(compact);
        assert.equal(await compact.locator('.bar').isHidden(), true);
        assert.equal(await toolbar.isHidden(), true);
        assert.equal(await field.evaluate(node => parseFloat(getComputedStyle(node).fontSize)), fontSize);
        assert.equal(await compact.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        for (const control of [tools, compact.locator('.run')]) {
          const rect = await control.boundingBox();
          assert.ok(rect.width >= 44 && rect.height >= 44, 'Typing controls preserve full touch targets');
        }
        const space = await outputSpace();
        assert.ok(space.visibleLines >= 3, `${engine} ${width}×${height}, ${fontSize}px text: ${space.visibleLines.toFixed(2)} visible output lines`);
        const before = await field.boundingBox();
        await tools.tap();
        assert.equal(await tools.getAttribute('aria-expanded'), 'true');
        assert.equal(await field.evaluate(node => document.activeElement === node), true, 'Tapping Tools preserves typing focus');
        assert.equal(await field.inputValue(), 'unfinished command');
        assert.deepEqual(await field.boundingBox(), before, 'The shallow Tools row keeps the input stationary');
        await field.press('Escape');
        assert.equal(await toolbar.isHidden(), true);
        assert.equal(await field.evaluate(node => document.activeElement === node), true);
      }
      await tools.focus(); await tools.press('Enter');
      assert.equal(await toolbar.isVisible(), true);
      // macOS WebKit uses Option-Tab for all controls with its default settings.
      const nextControl = engine === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
      await tools.press(nextControl);
      assert.equal(await compact.locator('.run').evaluate(node => document.activeElement === node), true);
      assert.equal(await toolbar.isVisible(), true, 'Tab can cross the Run button without closing Tools');
      await compact.locator('.run').press(nextControl);
      const compactHelp = compact.getByRole('button', {name: 'Show commands', exact: true});
      assert.equal(await compactHelp.evaluate(node => document.activeElement === node), true);
      await compactHelp.press('Escape');
      assert.equal(await toolbar.isHidden(), true);
      assert.equal(await tools.evaluate(node => document.activeElement === node), true);
      await field.fill('draft'); await tools.tap(); await field.press('x');
      assert.equal(await field.inputValue(), 'draftx');
      assert.equal(await toolbar.isHidden(), true, 'Typing dismisses Tools without losing input');
      await field.fill('h'); await tools.tap(); await field.press('Tab');
      assert.equal(await toolbar.isHidden(), true, 'Keyboard completion dismisses Tools');
      assert.equal(await compact.locator('#completion-panel').isVisible(), true);
      await field.press('Escape');
      await field.fill('h');
      await tools.click(); await compact.locator('#complete').click();
      assert.equal(await toolbar.isHidden(), true);
      assert.equal(await compact.locator('#completion-panel').isVisible(), true);
      await tools.click();
      assert.equal(await compact.locator('#completion-panel').isHidden(), true, 'Tools and completion panels are mutually exclusive');
      await compact.getByRole('button', {name: 'Show commands', exact: true}).click();
      assert.equal(await compact.locator('.help-list').count(), 1);
      assert.equal(await field.inputValue(), 'h', 'Opening compact help preserves the draft');
      await field.fill('draft');
      await tools.click(); await compact.locator('#previous').click();
      assert.equal(await field.inputValue(), 'help');
      assert.equal(await toolbar.isHidden(), true);
      await tools.click(); await compact.locator('#next').click();
      assert.equal(await field.inputValue(), 'draft');
      await tools.click();
      await compact.locator('#previous').focus();
      await compact.locator('#previous').press('Escape');
      assert.equal(await tools.evaluate(node => document.activeElement === node), true, 'Keyboard dismissal returns focus to the disclosure');

      // The expanded controls must leave a separate, scrollable reading area.
      for (const [width, height, fontSize] of [[320, 200, 16], [320, 250, 24], [320, 280, 32], [390, 260, 32]]) {
        await compact.setViewportSize({width, height});
        await compact.goto(url); await compact.locator('.entry').waitFor();
        await compact.evaluate(size => {
          document.documentElement.style.fontSize = `${size}px`;
          window.dispatchEvent(new Event('resize'));
        }, fontSize);
        await field.fill('help'); await field.press('Enter');
        assert.equal(await compact.locator('.help-list dt').evaluateAll(nodes => nodes.every(node => {
          const start = node.textContent.indexOf('[path]');
          if (start < 0) return true;
          const range = document.createRange();
          range.setStart(node.firstChild, start); range.setEnd(node.firstChild, start + 6);
          return range.getClientRects().length === 1;
        })), true, 'Larger text keeps optional path arguments together');
        await field.fill('unfinished command'); await field.focus(); await frames(compact);
        const before = await field.boundingBox();
        await tools.tap(); await frames(compact);
        assert.equal(await tools.getAttribute('aria-expanded'), 'true');
        assert.equal(await field.evaluate(node => document.activeElement === node), true);
        assert.equal(await field.inputValue(), 'unfinished command');
        assert.deepEqual(await field.boundingBox(), before, 'Opening Tools preserves the typing position');
        assert.equal(await toolbar.locator('.wide-label').isHidden(), true);
        assert.equal(await toolbar.locator('.compact-label').innerText(), 'Commands');
        const geometry = await toolbar.evaluate(node => {
          const bar = node.getBoundingClientRect();
          const screen = document.querySelector('.screen').getBoundingClientRect();
          const form = document.querySelector('form').getBoundingClientRect();
          const controls = [...node.querySelectorAll('button')].map(button => {
            const rect = button.getBoundingClientRect();
            return {top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height};
          });
          return {height: bar.height, top: bar.top, bottom: bar.bottom, screenBottom: screen.bottom, formTop: form.top, controls};
        });
        assert.ok(geometry.height <= 45, `${engine} ${width}×${height}, ${fontSize}px: Tools stays one shallow row`);
        assert.ok(geometry.screenBottom <= geometry.top, 'Output ends above Tools rather than behind it');
        assert.ok(geometry.bottom <= geometry.formTop, 'Tools does not cover the input');
        assert.ok((await outputSpace()).visibleLines >= 1, 'An expanded toolbar leaves a readable output line');
        for (const control of geometry.controls) {
          assert.ok(control.width >= 44 && control.height >= 44, 'Expanded Tools retains full touch targets');
          assert.ok(Math.abs(control.top - geometry.controls[0].top) <= 1, 'All shortcuts share one row');
          assert.ok(control.bottom <= geometry.bottom + 1, 'Controls fit the toolbar vertically');
        }
        await compact.locator('#next').scrollIntoViewIfNeeded();
        assert.equal(await compact.locator('#next').evaluate(node => {
          const rect = node.getBoundingClientRect(), bar = document.querySelector('#command-tools').getBoundingClientRect();
          return rect.left >= bar.left - 1 && rect.right <= bar.right + 1;
        }), true, 'Even at enlarged text the last shortcut remains reachable');
        assert.equal(await compact.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await compact.locator('.screen').evaluate(node => { node.scrollTop = node.scrollHeight; });
        await frames(compact);
        assert.equal(await compact.locator('.block').last().locator('.inline-command').last().evaluate(node => {
          const rect = node.getBoundingClientRect(), screen = document.querySelector('.screen').getBoundingClientRect();
          const bar = document.querySelector('#command-tools').getBoundingClientRect();
          return rect.top >= screen.top && rect.bottom <= Math.min(screen.bottom, bar.top, innerHeight);
        }), true, 'The last help example can scroll fully above the controls');
        await field.press('Escape');
        assert.equal(await toolbar.isHidden(), true);
      }

      for (const [width, height] of [[320, 180], [320, 200], [844, 220]]) {
        await compact.setViewportSize({width, height});
        await compact.goto(url); await compact.locator('.entry').waitFor();
        await compact.evaluate(() => {
          document.documentElement.style.fontSize = '32px';
          window.dispatchEvent(new Event('resize'));
        });
        await field.focus(); await frames(compact);
        const space = await outputSpace();
        assert.ok(space.lines >= 3, 'Extreme text sizes retain readable output instead of clipping its container');
        assert.equal(space.pageScrolls, true, 'Insufficient physical height falls back to normal page scrolling');
        assert.equal(await compact.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await compact.evaluate(() => window.scrollTo(0, 0));
        assert.ok(await compact.locator('.screen').evaluate(node => node.getBoundingClientRect().top >= 0));
        await compact.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        assert.ok(await field.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight;
        }), 'The full-size input remains reachable by scrolling');
      }
      for (const [width, height, fontSize, isCompact] of [
        [320, 421, 20, true], [320, 441, 20, false],
        [320, 479, 24, true], [320, 480, 24, true], [320, 481, 24, false],
        [390, 639, 32, true], [390, 640, 32, true], [390, 641, 32, false],
        [844, 300, 24, true],
      ]) {
        await compact.setViewportSize({width, height});
        await compact.goto(url); await compact.locator('.entry').waitFor();
        await compact.evaluate(size => {
          document.documentElement.style.fontSize = `${size}px`;
          window.dispatchEvent(new Event('resize'));
        }, fontSize);
        await field.focus(); await frames(compact);
        assert.equal(await compact.locator('.terminal').evaluate(node => node.classList.contains('compact')), isCompact, `${engine} compact boundary ${width}×${height}, ${fontSize}px text`);
        assert.ok((await outputSpace()).visibleLines >= 3, `${engine} readable output at ${width}×${height}, ${fontSize}px text`);
        assert.equal(await compact.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await field.evaluate(node => {
          const rect = node.getBoundingClientRect();
          const terminal = node.closest('.terminal').getBoundingClientRect();
          const top = visualViewport?.offsetTop ?? 0;
          const bottom = top + (visualViewport?.height ?? innerHeight);
          return rect.top >= Math.max(terminal.top, top) && rect.bottom <= Math.min(terminal.bottom, bottom);
        }), true, 'The input remains fully visible at the compact boundary');
        for (const control of [compact.locator('.run'), isCompact ? tools : compact.getByRole('button', {name: 'Show commands', exact: true})]) {
          const rect = await control.boundingBox();
          assert.ok(rect.width >= 44 && rect.height >= 44, 'Boundary layouts retain full touch targets');
        }
      }
      await field.fill('draft across layout changes'); await tools.focus();
      await compact.setViewportSize({width: 844, height: 481}); await frames(compact);
      assert.equal(await tools.isHidden(), true);
      assert.equal(await compact.getByRole('button', {name: 'Show commands', exact: true}).evaluate(node => document.activeElement === node), true, 'Leaving compact mode transfers focus to the visible toolbar');
      await compact.setViewportSize({width: 844, height: 480}); await frames(compact);
      assert.equal(await toolbar.isVisible(), true, 'Entering compact mode keeps a focused toolbar visible');
      assert.equal(await compact.getByRole('button', {name: 'Show commands', exact: true}).evaluate(node => document.activeElement === node), true);
      assert.equal(await field.inputValue(), 'draft across layout changes');
      await compact.setViewportSize({width: 390, height: 300});
      await compact.goto(url); await compact.locator('.entry').waitFor();
      await compact.evaluate(() => {
        document.documentElement.style.fontSize = '24px';
        // CSSOM assignments preserve the site's CSP while exercising user text spacing.
        for (const node of document.querySelectorAll('*')) Object.assign(node.style, {lineHeight: '1.5', letterSpacing: '.12em', wordSpacing: '.16em'});
        for (const paragraph of document.querySelectorAll('p')) paragraph.style.marginBottom = '2em';
        window.dispatchEvent(new Event('resize'));
      });
      await field.focus(); await frames(compact);
      assert.ok((await outputSpace()).visibleLines >= 3, 'User text spacing leaves readable output');
      assert.equal(await compact.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await compact.goto(url); await compact.locator('.entry').waitFor();
      await compact.evaluate(() => { document.documentElement.style.fontSize = ''; });
      await compact.setViewportSize({width: 1280, height: 900}); await frames(compact);
      const desktop = await compact.locator('.terminal').boundingBox();
      assert.deepEqual([desktop.width, desktop.height], [960, 884], 'Wide touch layouts keep the same frame before and after keyboard use');
      assert.equal(await tools.isHidden(), true);
      assert.equal(await compact.locator('.bar').isVisible(), true);
      assert.equal(await compact.getByRole('button', {name: 'Show commands', exact: true}).isVisible(), true);
      await compact.close();

      // Phone keyboards can pan a smaller visual viewport without resizing the
      // layout viewport. Whole-window resizing alone cannot exercise this path.
      const panning = await browser.newPage({hasTouch: true, reducedMotion: 'no-preference'});
      panning.on('pageerror', error => errors.push(String(error)));
      await panning.addInitScript(() => {
        const viewport = new EventTarget();
        Object.assign(viewport, {height: innerHeight, offsetTop: 0, pageTop: 0, scale: 1});
        Object.defineProperty(window, 'visualViewport', {value: viewport});
        window.panViewport = (height, offsetTop, event = 'resize', scale = 1) => {
          Object.assign(viewport, {height, offsetTop, scale, pageTop: scrollY + offsetTop});
          viewport.dispatchEvent(new Event(event));
        };
      });
      const pan = async (height, offset, event = 'resize', scale = 1) => {
        await panning.evaluate(args => panViewport(...args), [height, offset, event, scale]);
        await frames(panning);
      };
      const typing = panning.locator('#command');
      for (const [width, layoutHeight, openHeight, fontSize] of [
        [320, 650, 220, 16], [390, 800, 260, 24], [390, 900, 280, 32], [844, 800, 300, 24],
      ]) {
        await panning.setViewportSize({width, height: layoutHeight});
        await panning.goto(url); await panning.locator('.entry').waitFor();
        await panning.evaluate(size => {
          document.documentElement.style.fontSize = size + 'px';
          dispatchEvent(new Event('resize'));
        }, fontSize);
        await typing.fill('help'); await typing.press('Enter');
        await typing.fill('unfinished command'); await frames(panning);
        const readerScroll = await panning.locator('.screen').evaluate(node => { node.scrollTop = 37; return node.scrollTop; });
        // Either resize or scroll can deliver the latest viewport dimensions.
        for (const height of [openHeight + 80, openHeight + 40, openHeight, openHeight + 40, openHeight + 80]) {
          await pan(height, layoutHeight - height, height % 80 ? 'scroll' : 'resize');
          const state = await panning.evaluate(() => {
            const terminal = document.querySelector('.terminal'), screen = document.querySelector('.screen');
            const field = document.querySelector('#command'), entry = document.querySelector('.entry').getBoundingClientRect();
            const rect = screen.getBoundingClientRect(), style = getComputedStyle(screen);
            const top = visualViewport.offsetTop, bottom = top + visualViewport.height;
            return {
              terminalTop: terminal.getBoundingClientRect().top - top,
              inputVisible: field.getBoundingClientRect().top >= top && field.getBoundingClientRect().bottom <= bottom,
              lines: (Math.min(bottom, rect.bottom - parseFloat(style.paddingBottom)) - Math.max(top, rect.top + parseFloat(style.paddingTop))) / parseFloat(getComputedStyle(screen.querySelector('.block')).lineHeight),
              overlap: rect.bottom > entry.top, scroll: screen.scrollTop,
              focused: document.activeElement === field, draft: field.value,
              animations: screen.getAnimations().length,
            };
          });
          assert.ok(Math.abs(state.terminalTop - 8) < 1, engine + ' frame follows visual viewport panning');
          assert.equal(state.inputVisible, true, 'The full-size input stays inside the visible viewport');
          assert.ok(state.lines >= 3, engine + ' panned viewport retains three readable lines at ' + fontSize + 'px');
          assert.equal(state.overlap, false); assert.equal(state.scroll, readerScroll);
          assert.equal(state.focused, true); assert.equal(state.draft, 'unfinished command');
          assert.equal(state.animations, 0, 'Keyboard movement has no competing output animation');
        }
        await pan(layoutHeight, 150); // Height can recover before the pan resets.
        assert.equal(await panning.locator('.terminal').evaluate(node => node.style.marginTop), '');
        await pan(layoutHeight, 0, 'scroll');
        assert.equal(await typing.inputValue(), 'unfinished command');
      }
      await panning.setViewportSize({width: 390, height: 650});
      await panning.goto(url); await panning.locator('.entry').waitFor();
      const revealWhilePanning = async phase => {
        // A tall result prevents the bottom scroll limit from hiding an offset error.
        await typing.fill('x'.repeat(450)); await typing.press('Enter');
        const result = await panning.locator('.block').last().evaluate(node => ({
          top: node.getBoundingClientRect().top - document.querySelector('.screen').getBoundingClientRect().top,
          scroll: document.querySelector('.screen').scrollTop,
        }));
        assert.ok(result.scroll > 0);
        assert.ok(Math.abs(result.top - 12) < 1, engine + ' result reveal stays aligned ' + phase + ' (' + result.top + 'px)');
      };
      await revealWhilePanning('before keyboard opening');
      await pan(260, 390); await revealWhilePanning('with keyboard open');
      await typing.fill('draft across zoom');
      const beforeZoom = await panning.locator('.terminal').evaluate(node => node.style.cssText);
      await pan(130, 520, 'scroll', 2);
      assert.equal(await panning.locator('.terminal').evaluate(node => node.style.cssText), beforeZoom, 'Pinch zoom does not reposition or resize the frame');
      await pan(300, 350, 'scroll');
      assert.equal(await typing.inputValue(), 'draft across zoom');
      await panning.emulateMedia({reducedMotion: 'reduce'});
      await pan(260, 390);
      assert.equal(await panning.locator('.screen').evaluate(node => node.getAnimations().length), 0);
      await pan(650, 0); await revealWhilePanning('after keyboard closing');
      // With very large text and little height, normal document scrolling must
      // still reach the input. Following pageTop instead would chase the reader.
      await panning.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
      await pan(180, 470);
      await panning.evaluate(() => {
        window.scrollTo(0, 100);
        panViewport(180, 470, 'scroll');
      });
      await frames(panning);
      const scrolled = await panning.evaluate(() => {
        const input = document.querySelector('#command').getBoundingClientRect();
        return {scroll: scrollY, margin: document.querySelector('.terminal').style.marginTop,
          visible: input.top >= visualViewport.offsetTop && input.bottom <= visualViewport.offsetTop + visualViewport.height};
      });
      assert.ok(scrolled.scroll > 0, 'Oversized text retains document scrolling');
      assert.equal(scrolled.margin, '470px', 'Frame compensation ignores document scrolling');
      assert.equal(scrolled.visible, true, 'Scrolling can bring the oversized layout input into view');
      await panning.evaluate(() => { document.documentElement.style.fontSize = ''; window.scrollTo(0, 0); });
      await panning.setViewportSize({width: 1280, height: 900}); await pan(900, 0);
      const normal = await panning.locator('.terminal').boundingBox();
      assert.deepEqual([normal.width, normal.height], [960, 884]);
      assert.equal(await panning.locator('.terminal').evaluate(node => node.style.marginTop), '');

      // Exercise native pointer defaults, not only the DOM test model's clicks.
      await panning.setViewportSize({width: 390, height: 900});
      await panning.goto(url); await panning.locator('.entry').waitFor();
      await typing.fill('pwd');
      await panning.evaluate(() => {
        window.inputBlurs = 0;
        document.querySelector('#command').addEventListener('blur', () => inputBlurs++);
      });
      await panning.locator('.run').tap();
      await typing.fill('bash'); await typing.press('Enter');
      await panning.locator('[data-recall="help"]').tap();
      await typing.fill('h'); await typing.press('Tab');
      await panning.locator('#completions button').first().tap();
      await typing.fill('history'); await typing.press('Enter');
      await panning.locator('.history-list button').last().tap();
      assert.equal(await panning.evaluate(() => inputBlurs), 0, 'Input actions never blur and refocus between pointer down and click');
      await panning.getByRole('button', {name: 'Show commands', exact: true}).tap();
      assert.equal(await panning.locator('.block').last().evaluate(node => document.activeElement === node), true, 'Browsing still intentionally focuses the result');

      for (const [width, fontSize, openHeight] of [[390, 16, 260], [390, 24, 260], [320, 32, 280], [844, 24, 300]]) {
        await panning.setViewportSize({width, height: 900});
        await panning.goto(url); await panning.locator('.entry').waitFor();
        await panning.emulateMedia({reducedMotion: 'no-preference'});
        await panning.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; dispatchEvent(new Event('resize')); }, fontSize);
        for (let n = 0; n < 3; n++) { await typing.fill('x'.repeat(450)); await typing.press('Enter'); }
        await typing.fill('steady draft');
        const readerScroll = await panning.locator('.screen').evaluate(node => { node.scrollTop = 37; return node.scrollTop; });
        const threshold = Math.max(440, 20 * fontSize);
        // Both a one-pixel boundary crossing and a single, late keyboard report.
        for (const [from, to] of [[threshold + 1, threshold], [900, openHeight], [openHeight, 900]]) {
          await panning.emulateMedia({reducedMotion: 'reduce'}); await pan(from, 900 - from);
          const stationary = await typing.boundingBox();
          await panning.emulateMedia({reducedMotion: 'no-preference'});
          await pan(to, 900 - to);
          const animationCount = await panning.evaluate(() => {
            window.folds = document.querySelector('.terminal').getAnimations({subtree: true});
            for (const animation of folds) animation.pause();
            return folds.length;
          });
          assert.ok(animationCount > 0 && animationCount <= 3, 'Only the small header and toolbar regions fold');
          let previousHeader;
          for (const progress of [0, .25, .5, .75, 1]) {
            const state = await panning.evaluate(progress => {
              for (const animation of folds) {
                const timing = animation.effect.getTiming();
                if (timing.duration > 200 || timing.iterations !== 1) throw new Error('Unbounded fold');
                animation.currentTime = timing.duration * progress;
              }
              const field = document.querySelector('#command'), screen = document.querySelector('.screen');
              const rect = screen.getBoundingClientRect(), style = getComputedStyle(screen);
              const entry = document.querySelector('.entry').getBoundingClientRect();
              return {input: field.getBoundingClientRect().toJSON(), header: document.querySelector('.bar').getBoundingClientRect().height,
                scroll: screen.scrollTop, focus: document.activeElement === field, draft: field.value,
                lines: (rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(getComputedStyle(screen.querySelector('.initial-document')).lineHeight),
                overlap: rect.bottom > entry.top + .5, pageScroll: scrollY};
            }, progress);
            assert.ok(Math.abs(state.input.x - stationary.x) < .5 && Math.abs(state.input.y - stationary.y) < .5, engine + ' caret stays stationary throughout fold');
            assert.ok(Math.abs(state.input.width - stationary.width) < .5 && state.input.height >= 44);
            assert.ok(state.input.top >= 900 - to && state.input.bottom <= 900, 'An abrupt keyboard report cannot clip the input');
            assert.ok(state.lines >= 3, 'Chrome yields to protected reading space even at the start of a fold');
            assert.equal(state.overlap, false); assert.equal(state.focus, true); assert.equal(state.draft, 'steady draft');
            assert.equal(state.scroll, readerScroll); assert.equal(state.pageScroll, 0);
            if (previousHeader !== undefined) assert.ok(to < from ? state.header <= previousHeader + .5 : state.header >= previousHeader - .5, 'Header movement is monotonic');
            previousHeader = state.header;
          }
          await panning.evaluate(() => { for (const animation of folds) animation.finish(); });
          await frames(panning);
          assert.equal(await panning.locator('.bar').isHidden(), to <= threshold, 'No partial heading remains at rest');
        }
        // Reverse an unfinished fold at the boundary instead of queuing another.
        await panning.emulateMedia({reducedMotion: 'reduce'}); await pan(threshold + 1, 899 - threshold);
        await panning.emulateMedia({reducedMotion: 'no-preference'}); await pan(threshold, 900 - threshold);
        const halfway = await panning.evaluate(() => {
          for (const animation of document.querySelector('.terminal').getAnimations({subtree: true})) {
            animation.pause(); animation.currentTime = animation.effect.getTiming().duration / 2;
          }
          return document.querySelector('.bar').getBoundingClientRect().height;
        });
        const fixedInput = await typing.boundingBox();
        await pan(threshold + 1, 899 - threshold);
        const reversed = await panning.evaluate(() => {
          const animations = document.querySelector('.terminal').getAnimations({subtree: true});
          for (const animation of animations) { animation.pause(); animation.currentTime = 0; }
          const height = document.querySelector('.bar').getBoundingClientRect().height;
          for (const animation of animations) animation.finish();
          return {height, count: animations.length};
        });
        assert.ok(Math.abs(reversed.height - halfway) < 1, 'A reversed fold starts from its current position');
        assert.ok(reversed.count <= 3, 'Rapid direction changes do not accumulate animations');
        assert.deepEqual(await typing.boundingBox(), fixedInput, 'Reversing motion does not move or resize the input');
        await pan(openHeight, 900 - openHeight);
        await panning.emulateMedia({reducedMotion: 'reduce'}); await frames(panning);
        assert.equal(await panning.locator('.terminal').evaluate(node => node.getAnimations({subtree: true}).length), 0, 'Reduced motion cancels an in-flight fold');
        const beforeTools = await typing.boundingBox();
        await panning.locator('#tools-toggle').tap(); await frames(panning);
        const afterTools = await typing.boundingBox();
        assert.deepEqual(afterTools, beforeTools, 'Tools opens above the command without moving it');
      }
      await panning.close();
      const deep = await browser.newPage({viewport: {width: 390, height: 260}, hasTouch: true, reducedMotion: 'reduce'});
      await deep.route('**/', async route => {
        const response = await route.fetch();
        const opening = '<section class="initial-document" aria-label="README.md">';
        const body = (await response.text()).replace(opening, opening + '<p>A longer public document exercises initial scrolling.</p>'.repeat(80));
        await route.fulfill({response, body});
      });
      await deep.goto(url + '#/README.md'); await deep.locator('.entry').waitFor();
      const firstView = await deep.locator('.block').evaluate(node => {
        const screen = document.querySelector('.screen');
        return {top: node.getBoundingClientRect().top - screen.getBoundingClientRect().top, scroll: screen.scrollTop, overflows: screen.scrollHeight > screen.clientHeight};
      });
      assert.equal(firstView.overflows, true, 'The initial deep-link fixture really needs scrolling');
      assert.ok(firstView.top >= 0 && firstView.top <= 12, 'A first deep link is positioned using final mobile geometry');
      assert.equal(firstView.scroll, 0, 'Startup cannot leave a delayed scroll correction');
      await deep.close();

      const scrollbars = await browser.newPage({viewport: {width: 1280, height: 900}});
      await scrollbars.goto(url); await scrollbars.locator('.entry').waitFor();
      const initialWidth = await scrollbars.locator('.screen').evaluate(node => node.clientWidth);
      for (let i = 0; i < 3; i++) { await scrollbars.locator('#command').fill('help'); await scrollbars.locator('#command').press('Enter'); }
      assert.equal(await scrollbars.locator('.screen').evaluate(node => node.scrollHeight > node.clientHeight), true);
      assert.equal(await scrollbars.locator('.screen').evaluate(node => node.clientWidth), initialWidth, 'Overflow does not change the text column width');
      assert.equal(await scrollbars.locator('.tools-clip').evaluate(node => getComputedStyle(node).overflow), 'visible', 'Desktop toolbar focus outlines are not clipped');
      await scrollbars.close();
      await page.goto(url + '#/missing');
      await page.locator('.error').last().waitFor();
      assert.match(await page.locator('#output').textContent(), /not available/);
      await page.goto(url); await page.locator('.initial-document').waitFor();
      await page.locator('.entry').waitFor();
      await run('python');
      const still = await page.locator('.snake').last().textContent();
      assert.ok(still.includes(')--<'));
      assert.equal(await page.locator('.snake-active').count(), 0);

      const animation = await browser.newPage({viewport: {width: 320, height: 650}, reducedMotion: 'no-preference'});
      await animation.clock.install();
      await animation.goto(url);
      await animation.locator('.entry').waitFor();
      await animation.clock.pauseAt(new Date(await animation.evaluate(() => Date.now()) + 1000));
      const command = animation.locator('#command');
      await command.fill('python3'); await command.press('Enter');
      const art = animation.locator('.snake').last();
      const bounds = await art.boundingBox();
      const promptBounds = await command.boundingBox();
      assert.equal(await animation.locator('.snake-active').count(), 1);
      const durations = [240, 320, 80, 100, 80, 220, 200, 120, 160, 80, 80, 120, 80, 80, 80, 160, 80, 280, 400];
      for (const [index, duration] of durations.entries()) {
        assert.deepEqual((await art.textContent()).split('\n').map(line => line.length), Array(12).fill(34));
        assert.doesNotMatch((await art.textContent()).split('\n')[2].slice(27), /_/, 'No cursor prop beside the tongue');
        assert.deepEqual(await art.boundingBox(), bounds, 'The coil keeps its fixed geometry');
        assert.deepEqual(await command.boundingBox(), promptBounds, 'The real input never moves');
        assert.equal(await animation.locator('.snake-active').count(), index === 18 ? 0 : 1);
        await animation.clock.runFor(duration);
      }
      const rest = await art.textContent();
      await animation.clock.runFor(5000);
      assert.equal(await art.textContent(), rest, 'The sequence does not loop');
      await command.fill('python'); await command.press('Enter');
      await animation.clock.runFor(1040);
      await command.press('x');
      assert.equal(await command.inputValue(), 'x');
      assert.equal(await animation.locator('.snake-active').count(), 0);
      await command.fill('python'); await command.press('Enter');
      await animation.emulateMedia({reducedMotion: 'reduce'});
      await animation.waitForFunction(() => !document.querySelector('.terminal').classList.contains('snake-active'));
      assert.equal(await art.textContent(), still);
      for (const [width, height] of [[320, 300], [390, 650], [844, 390], [1280, 900]]) {
        await animation.setViewportSize({width, height});
        await animation.clock.runFor(32);
        assert.equal(await animation.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await art.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
        assert.equal(await art.evaluate(node => getComputedStyle(node).fontVariantLigatures), 'none');
      }
      await animation.close();
      await run('help');
      assert.doesNotMatch(await page.locator('.help-list').last().textContent(), /python/);
      assert.ok(requests.every(request => new URL(request).origin === new URL(url).origin));
      assert.ok(requests.every(request => new URL(request).pathname !== '/README.md'));
      assert.deepEqual(errors, []);
      const blocked = await page.evaluate(async () => {
        const script = document.createElement('script');
        script.textContent = 'window.inlineExecuted = true';
        document.body.append(script);
        const connection = await fetch('README.md').then(() => false, () => true);
        return !window.inlineExecuted && connection;
      });
      assert.equal(blocked, true, 'CSP blocks inline code and connections');
      const noJS = await browser.newPage({javaScriptEnabled: false});
      await noJS.goto(url);
      assert.equal(await noJS.locator('.initial-document').isVisible(), true);
      assert.equal(await noJS.locator('.initial-document a').first().getAttribute('href'), 'https://github.com/mjcrock');
      assert.equal(await noJS.locator('.entry').isHidden(), true);
      console.log(`${engine}: content, navigation, keyboard, mobile layout, CSP, and no-JavaScript checks passed`);
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
