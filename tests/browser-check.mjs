// Optional tooling: node tests/browser-check.mjs [chromium firefox webkit]
// Install Playwright separately, or set PLAYWRIGHT_MODULE to its index.mjs path.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {startServer} from '../scripts/serve.mjs';

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
      const page = await browser.newPage({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('request', request => requests.push(request.url()));
      await page.goto(url);
      await page.locator('.initial-document').waitFor();
      await page.locator('.entry').waitFor();
      const input = page.locator('#command');
      const run = async value => { await input.fill(value); await input.press('Enter'); };
      assert.equal(await page.locator('.site-name').textContent(), 'Michael J. Crockett');
      const showCommands = page.getByRole('button', {name: 'Show commands', exact: true});
      await showCommands.waitFor();
      assert.equal(await page.locator('.echo').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
      await showCommands.click();
      assert.equal(await page.locator('.help-list').count(), 1, 'Show commands opens help in one click');
      assert.equal(await page.locator('.block').last().evaluate(node => node === document.activeElement), true);
      await run('cat README.md');
      assert.equal(await page.locator('.block').last().locator('pre').textContent(), source);
      assert.equal(page.url(), url);
      await run('open README.md');
      assert.equal(new URL(page.url()).hash, '#/README.md');
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
        await input.fill('');
        const before = await input.boundingBox();
        await page.locator('#complete').click();
        assert.deepEqual(await input.boundingBox(), before, `${engine} stationary prompt ${width}x${height}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await page.locator('#completion-panel').evaluate(node => node.getBoundingClientRect().bottom <= document.querySelector('.entry').getBoundingClientRect().top + 1), true);
        assert.equal(await page.locator('.toolbar').evaluate(node => node.getBoundingClientRect().bottom <= document.querySelector('.terminal').getBoundingClientRect().bottom), true);
        await input.press('Escape');
        const helpBounds = await showCommands.boundingBox();
        assert.ok(helpBounds.width >= 44 && helpBounds.height >= 44, `${engine} help target ${width}x${height}`);
        await showCommands.click();
        assert.equal(await page.locator('.block').last().locator('.help-list').count(), 1);
        assert.equal(await input.evaluate(node => node === document.activeElement), false, 'Browsing help does not focus the keyboard input');
        assert.deepEqual(await input.boundingBox(), before, 'Showing help keeps the command row stationary');
      }
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
