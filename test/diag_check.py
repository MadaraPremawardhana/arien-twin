"""Check the connect screen's explanations when api.cesium.com cannot be reached.
Usage: ARIEN_DEPS=... python3 test/diag_check.py"""
import os, sys
from pathlib import Path
sys.argv = [sys.argv[0], '/tmp/arien-diag', 'none']
import importlib.util
spec = importlib.util.spec_from_file_location('rb', Path(__file__).with_name('run_browser.py'))
src = Path(__file__).with_name('run_browser.py').read_text()
# reuse helpers (handle, weather, serve_dep) without running the main block
helpers = src.split('with sync_playwright() as p:')[0]
ns = {'__file__': str(Path(__file__).with_name('run_browser.py'))}
exec(helpers, ns)
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / 'index.html').read_text()

def run(case):
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = b.new_context()
        def handle(route):
            u = route.request.url
            if case != 'file' and u.startswith('http://arien.test/'):
                headers = {'content-type': 'text/html'}
                if case == 'csp':
                    headers['content-security-policy'] = "default-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net data: blob:; connect-src 'self' https://cdn.jsdelivr.net data: blob: https://api.open-meteo.com; img-src * data: blob:; worker-src blob: data:"
                return route.fulfill(status=200, body=HTML, headers=headers)
            if 'api.cesium.com' in u: return route.abort()
            return ns['handle'](route)
        ctx.route('**/*', handle)
        page = ctx.new_page()
        logs = []
        page.on('console', lambda m: logs.append(m.text[:200])); page.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)[:200]))
        page.goto((ROOT / 'index.html').as_uri() if case == 'file' else 'http://arien.test/index.html')
        try: page.wait_for_function('() => window.__arien', timeout=30000)
        except Exception: print(f'[{case}] did not boot:', logs[:8]); b.close(); return
        page.select_option('#s-src', 'ion'); page.fill('#s-ion', 'some-token'); page.click('#s-world')
        page.wait_for_function('() => document.getElementById("s-world-msg").className.includes("err")', timeout=30000)
        print(f'[{case}]', page.evaluate('() => document.getElementById("s-world-msg").textContent'))
        b.close()

for c in ['csp', 'blocked', 'file']: run(c)
