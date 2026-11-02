"""Hosted-site flow: visitor auto-connect from config.json, and admin publishing to a mocked GitHub API.
Usage: ARIEN_DEPS=... python3 test/admin_check.py <outdir>"""
import base64, json, sys, time
from pathlib import Path
src = Path(__file__).with_name('run_browser.py').read_text()
ns = {'__file__': str(Path(__file__).with_name('run_browser.py'))}
sys_argv = sys.argv; sys.argv = [sys.argv[0], sys_argv[1] if len(sys_argv) > 1 else '/tmp/arien-admin', 'none']
exec(src.split('with sync_playwright() as p:')[0], ns)
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / 'index.html').read_text()
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
CONFIG = {'version': 1, 'updated': '2026-11-02T12:00:00Z', 'autoConnect': True,
          'site': {'name': 'Belloff building, Buckingham', 'lat': 51.9989, 'lon': -0.9872},
          'world': {'src': 'none'}, 'weather': {'mode': 'forecast'},
          'scene': {'arrays': [{'id': 'aCfg', 'name': 'Published roof array', 'x': 0, 'y': 0, 'z': 0, 'rows': 3, 'cols': 4, 'tilt': 30, 'azimuth': 170}],
                    'objects': [], 'live': 'hdkr', 'compare': {'rwghi': True, 'hdkr': True}}}
puts = []
def handle(route):
    u = route.request.url
    if u.startswith('https://madara.github.io/arien-twin/'):
        if u.split('?')[0].endswith('config.json'):
            return route.fulfill(status=200, body=json.dumps(CONFIG), headers={'content-type': 'application/json'})
        return route.fulfill(status=200, body=HTML, headers={'content-type': 'text/html'})
    if u.startswith('https://api.github.com/repos/madara/arien-twin/contents/config.json'):
        auth = route.request.headers.get('authorization', '')
        if auth != 'Bearer github_pat_test': return route.fulfill(status=401, body='{"message":"Bad credentials"}', headers={'access-control-allow-origin': '*'})
        if route.request.method == 'GET': return route.fulfill(status=404, body='{"message":"Not Found"}', headers={'access-control-allow-origin': '*', 'content-type': 'application/json'})
        if route.request.method == 'PUT':
            puts.append(json.loads(route.request.post_data))
            return route.fulfill(status=201, body=json.dumps({'commit': {'html_url': 'https://github.com/madara/arien-twin/commit/abc'}}), headers={'access-control-allow-origin': '*', 'content-type': 'application/json'})
        return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, PUT', 'access-control-allow-headers': 'authorization, accept, x-github-api-version, content-type'})
    return ns['handle'](route)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}); ctx.route('**/*', handle)
    page = ctx.new_page(); logs = []
    page.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)[:200]))
    page.goto('https://madara.github.io/arien-twin/')
    page.wait_for_function('() => window.__arien && document.getElementById("boot").classList.contains("gone") && window.__arien.state.run', timeout=180000)
    st = page.evaluate('() => { const s = window.__arien.state; return {site: s.site.name, arrays: s.arrays.map(a => a.name + " " + a.rows + "x" + a.cols), live: s.live, run: !!s.run} }')
    print('visitor auto-connect:', st)
    page.click('#rail button[data-panel="world"]'); page.click('#w-admin'); time.sleep(0.5)
    print('admin repo guess:', page.input_value('#ad-repo'), '| current:', page.text_content('#ad-current'))
    page.fill('#ad-token', 'wrong'); page.click('#ad-publish')
    page.wait_for_function('() => document.getElementById("ad-status").className.includes("err")', timeout=20000)
    print('bad token:', page.text_content('#ad-status'))
    page.fill('#ad-token', 'github_pat_test'); page.click('#ad-publish')
    page.wait_for_function('() => document.getElementById("ad-status").className.includes("ok")', timeout=20000)
    print('publish:', page.text_content('#ad-status'))
    body = json.loads(base64.b64decode(puts[-1]['content']).decode())
    print('published config:', {k: body[k] for k in ('autoConnect', 'site', 'world', 'weather')}, '| arrays:', len(body['scene']['arrays']), '| branch:', puts[-1]['branch'])
    page.screenshot(path=str(OUT / 'admin-pane.png'))
    print('errors:', logs)
    b.close()
