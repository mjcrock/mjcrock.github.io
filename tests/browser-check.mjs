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
      assert.equal(await page.locator('#keyboard-help').innerText(), 'Type help for commands.');
      assert.equal(await page.locator('.echo').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
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
      }
      await page.goto(url + '#/missing');
      await page.locator('.error').last().waitFor();
      assert.match(await page.locator('#output').textContent(), /not available/);
      await page.goto(url); await page.locator('.initial-document').waitFor();
      await page.locator('.entry').waitFor();
      await run('python');
      assert.equal(await page.locator('.snake').last().evaluate(node => getComputedStyle(node).animationName), 'none');
      await page.emulateMedia({reducedMotion: 'no-preference'});
      await run('python3');
      const finished = await page.locator('.snake').last().evaluate(async node => {
        const animations = node.getAnimations();
        if (!animations.length || animations.some(animation => animation.effect.getComputedTiming().endTime > 3000)) return false;
        await Promise.all(animations.map(animation => animation.finished));
        return node.getAnimations().every(animation => animation.playState !== 'running');
      });
      assert.equal(finished, true, 'snake animation ends within three seconds');
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
