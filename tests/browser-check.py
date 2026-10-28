"""Optional Playwright smoke checks; not a site dependency.
Run with an installed Chromium: python3 tests/browser-check.py --browser /path/to/chromium
Physical keyboards and assistive technology still need manual verification.
"""
from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--browser', default=shutil.which('chromium'))
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/'
    source = (ROOT / 'README.md').read_bytes().decode('utf-8')
    checks = []
    try:
        with sync_playwright() as playwright:
            options = {'headless': True}
            if args.browser:
                options['executable_path'] = args.browser
            browser = playwright.chromium.launch(**options)
            page = browser.new_page(viewport={'width': 1280, 'height': 900})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base)
            page.wait_for_selector('.initial-document, .block')
            command = page.locator('#command')
            assert page.locator('.site-name').inner_text() == 'Michael J. Crockett'
            assert page.locator('.site-status').inner_text() == 'Site in progress'
            assert page.locator('#keyboard-help').inner_text() == 'Type help for commands.'
            assert page.locator('.echo').count() == 0
            assert page.evaluate('document.activeElement === document.body')
            assert page.locator('.initial-document a').get_attribute('href') == 'https://github.com/mjcrock'
            checks.append('static identity, single hint, passive initial README and no autofocus')

            def run(value):
                command.fill(value)
                command.press('Enter')

            run('cat README.md')
            block = page.locator('.block').last
            assert block.locator('pre').text_content() == source
            assert block.locator('h2, a').count() == 0
            assert page.url == base
            run('open README.md')
            assert page.url.endswith('#/README.md')
            assert page.locator('.block').last.locator('a[href="https://github.com/mjcrock"]').count() == 1
            run('ls /')
            assert page.locator('.listing-row').count() == 1
            assert page.locator('.listing-row button').inner_text() == 'README.md'
            command.fill('draft')
            page.go_back()
            page.wait_for_function('location.hash === ""')
            assert command.input_value() == 'draft'
            page.go_forward()
            page.wait_for_function('location.hash === "#/README.md"')
            assert command.input_value() == 'draft'
            checks.append('exact raw cat, formatted same source, root listing and document Back/Forward')

            command.fill('cat R')
            before = command.bounding_box()
            command.press('Tab')
            assert command.bounding_box() == before
            assert page.locator('#completion-panel').is_hidden()
            assert command.input_value() == 'cat README.md'
            command.press('Tab')
            assert page.locator('.run').evaluate('(node) => node === document.activeElement')
            command.fill('h')
            command.press('Tab')
            count = page.locator('.block').count()
            command.press('ArrowDown')
            command.press('Enter')
            assert command.input_value() == 'history'
            assert page.locator('.block').count() == count
            command.fill('open /')
            page.locator('#complete').click()
            command.press('Escape')
            assert command.input_value() == 'open /README.md'
            checks.append('local completion, native Tab exit, choice acceptance and preserved draft')

            for width, height in [(320, 300), (390, 650), (1280, 900)]:
                page.set_viewport_size({'width': width, 'height': height})
                command.fill('')
                before = command.bounding_box()
                toolbar = page.locator('.toolbar').bounding_box()
                page.locator('#complete').click()
                assert command.bounding_box() == before
                assert page.locator('.toolbar').bounding_box() == toolbar
                assert page.locator('#completion-panel').evaluate('(node) => node.getBoundingClientRect().bottom <= document.querySelector(".entry").getBoundingClientRect().top + 1')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                assert page.locator('.toolbar').evaluate('(node) => node.getBoundingClientRect().bottom <= document.querySelector(".terminal").getBoundingClientRect().bottom')
                command.press('Enter')
                assert command.bounding_box() == before
                command.press('Enter')
                assert command.bounding_box() == before
                command.fill('zzz')
                command.press('Tab')
                assert command.bounding_box() == before
                command.fill('')
            checks.append('desktop and constrained stationary completion panel, acceptance and execution')

            page.goto(base + '#/writing/sample')
            page.wait_for_selector('.initial-document, .block')
            assert 'not available' in page.locator('#output').inner_text()
            page.route('**/README.md', lambda route: route.abort())
            page.goto(base)
            page.wait_for_selector('.initial-document')
            assert page.locator('.site-name').inner_text() == 'Michael J. Crockett'
            assert page.locator('.initial-document a').get_attribute('href') == 'https://github.com/mjcrock'
            page.locator('[data-command="help"]').click()
            assert page.locator('.help-list').count() == 1
            assert 'Tab completes once' not in page.locator('#output').inner_text()
            assert not errors, errors
            checks.append('removed routes fail safely; rendering does not depend on a README request')
            browser.close()
        print(json.dumps({'passed': checks}, indent=2))
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
