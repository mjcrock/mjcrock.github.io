"""Optional real-browser checks. Requires Python Playwright and installed Chromium.

    python3 tests/browser-check.py --browser /usr/bin/chromium

No results are claimed unless this script finishes successfully. Desktop Chromium
viewport emulation is not a substitute for Safari, a screen reader, or a physical
mobile keyboard. The site itself has no Python or Playwright dependency.
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
    parser.add_argument('--screenshots', type=Path)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    checks = []
    try:
        with sync_playwright() as playwright:
            options = {'headless': True}
            if args.browser:
                options['executable_path'] = args.browser
            browser = playwright.chromium.launch(**options)
            context = browser.new_context(viewport={'width': 1280, 'height': 900})
            page = context.new_page()
            errors, requests, violations = [], [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url))
            page.expose_function('recordViolation', lambda policy: violations.append(policy))
            page.add_init_script("document.addEventListener('securitypolicyviolation', event => window.recordViolation(event.violatedDirective))")
            page.goto(base)
            page.locator('.welcome').wait_for()
            assert page.evaluate('document.activeElement === document.body'), 'Unexpected autofocus'
            command = page.locator('#command')

            def run(value):
                command.fill(value)
                command.press('Enter')
                page.wait_for_timeout(30)

            page.get_by_role('button', name='sample', exact=True).click()
            assert page.locator('.file-title').inner_text() == 'Sample document'
            assert page.evaluate('document.activeElement.classList.contains("block")')
            run('cd writing')
            assert page.locator('#prompt').inner_text() == 'guest:~/writing $'
            assert command.evaluate('(node) => node === document.activeElement')
            command.fill('open s')
            command.press('Tab')
            assert command.input_value() == 'open sample'
            command.press('Enter')
            assert page.locator('.file-title').last.inner_text() == 'Sample document'
            command.fill('h')
            command.press('Tab')
            page.locator('#completions button').first.focus()
            for modifier in ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']:
                prevented = page.locator('#completions button').first.evaluate(
                    '(node, modifier) => { const event=new KeyboardEvent("keydown", {key:"Escape", bubbles:true, cancelable:true, [modifier]:true}); node.dispatchEvent(event); return event.defaultPrevented; }', modifier)
                assert not prevented, modifier
                assert page.locator('#completions').is_visible()
            page.locator('#completions button').first.press('Escape')
            assert not page.locator('#completions').is_visible()
            assert command.evaluate('(node) => node === document.activeElement')
            command.fill('unfinished')
            command.press('ArrowUp')
            assert command.input_value() == 'open sample'
            command.press('ArrowDown')
            assert command.input_value() == 'unfinished'
            command.press('Escape')
            assert command.input_value() == ''
            checks.append('typed/browse focus, navigation, completion, Escape, history draft')

            run('<img src=x onerror=alert(1)>')
            assert page.locator('#output img').count() == 0
            assert '<img' in page.locator('.echo').last.inner_text()
            page.evaluate("() => { const input=document.querySelector('#command'); input.value='help\\u202E'; document.querySelector('#command-form').requestSubmit(); }")
            assert '[invalid input]' in page.locator('.echo').last.inner_text()
            page.evaluate("() => { for(let i=0;i<200;i++) document.querySelector('[data-command=help]').click(); }")
            assert page.locator('#output > *').count() == 40
            page.evaluate('''() => {
                document.querySelector('[data-command=help]').click();
                const screen=document.querySelector('#screen');
                screen.scrollTop=123;
                screen.dispatchEvent(new Event('scroll'));
            }''')
            page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            assert page.locator('#screen').evaluate('(node) => node.scrollTop') == 123, 'Command stole later reader scroll'
            run('clear')
            assert page.locator('#output > *').count() == 0
            run('history')
            assert page.locator('.history-list li').count() == 50
            checks.append('literal hostile text, rejected bidi echo, 40 output and 50 history bounds')

            for width, height in [(320, 568), (390, 844), (1280, 900), (1024, 400)]:
                page.set_viewport_size({'width': width, 'height': height})
                page.wait_for_timeout(50)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, 'horizontal overflow')
                assert command.is_visible()
                if args.screenshots:
                    args.screenshots.mkdir(parents=True, exist_ok=True)
                    page.screenshot(path=str(args.screenshots / f'{width}x{height}.png'), full_page=True)
            checks.append('mobile/narrow/desktop/short viewport horizontal overflow')
            assert not errors, errors
            assert not violations, violations
            assert all(url.startswith(base + '/') or url.startswith('data:') for url in requests), requests
            assert page.evaluate('localStorage.length === 0 && sessionStorage.length === 0')
            checks.append('no script errors, CSP violations, external requests, or persistent storage')
            browser.close()
        print(json.dumps({'passed': checks}, indent=2))
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
