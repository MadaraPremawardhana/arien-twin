"""Quiet start-up from config.json: no connect screen, the published world, then the 7-day forecast.
Case 1: an ion key the mock refuses (401) -> map-only fallback with a warning, still no connect screen.
Case 2: map-only published -> straight in. Both: forecast mode loaded; World -> Connect still opens the setup card.
Usage: ARIEN_DEPS=... python3 test/quiet_start_check.py <outdir>"""
import json, sys, time
from pathlib import Path
src = Path(__file__).with_name('run_browser.py').read_text()
ns = {'__file__': str(Path(__file__).with_name('run_browser.py'))}
argv = sys.argv; sys.argv = [argv[0], argv[1] if len(argv) > 1 else '/tmp/arien-quiet', 'none']
exec(src.split('with sync_playwright() as p:')[0], ns)
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / 'index.html').read_text()
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
results = {}
def check(name, cond, detail=''):
    results[name] = bool(cond)
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))

def config(world):
    return {'version': 1, 'updated': '2026-11-10T12:00:00Z', 'autoConnect': True,
            'site': {'name': 'Buckingham, UK', 'lat': 51.9956, 'lon': -0.9906},
            'world': world, 'weather': {'mode': 'forecast'}}

def run(b, tag, world):
    cfg = config(world)
    def handle(route):
        u = route.request.url
        if u.startswith('https://madara.github.io/arien-twin/'):
            if u.split('?')[0].endswith('config.json'):
                return route.fulfill(status=200, body=json.dumps(cfg), headers={'content-type': 'application/json'})
            return route.fulfill(status=200, body=HTML, headers={'content-type': 'text/html'})
        return ns['handle'](route)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}); ctx.route('**/*', handle)
    page = ctx.new_page(); logs = []
    page.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)[:300]))
    # record whether the setup card is ever on screen while the page starts
    page.add_init_script('''window.__setupSeen = false; (function poll() {
        const s = document.getElementById('setup'), b = document.getElementById('boot');
        if (s && b && !b.classList.contains('gone') && s.offsetParent !== null && getComputedStyle(s).display !== 'none') window.__setupSeen = true;
        if (!window.__stopPoll) requestAnimationFrame(poll); })();''')
    page.goto('https://madara.github.io/arien-twin/')
    page.wait_for_function('() => document.querySelector("#boot.quiet .boot-splash")', timeout=60000)
    page.screenshot(path=str(OUT / f'{tag}-0-splash.png'))
    page.wait_for_function('() => window.__arien && document.getElementById("boot").classList.contains("gone") && window.__arien.state.run', timeout=180000)
    page.wait_for_function('() => window.__arien.state.wx && window.__arien.state.wx.series && window.__arien.state.wx.mode === "forecast"', timeout=120000)
    time.sleep(1)
    st = page.evaluate('''() => { window.__stopPoll = true; const s = __arien.state;
        return { setupSeen: window.__setupSeen, world: s.world.src, wx: s.wx.mode, days: Math.round((s.wx.series.end - s.wx.series.start) / 864e5),
                 toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent.trim()).join(' | ') }; }''')
    page.screenshot(path=str(OUT / f'{tag}-1-open.png'))
    # World -> Connect still opens the full setup card
    page.click('#rail button[data-panel="world"]'); time.sleep(0.3); page.click('#w-connect'); time.sleep(0.5)
    st['connectCard'] = page.evaluate('() => { const b = document.getElementById("boot"), s = document.getElementById("setup"); return !b.classList.contains("gone") && !b.classList.contains("quiet") && s.offsetParent !== null; }')
    st['errors'] = logs
    ctx.close()
    return st

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    a = run(b, 'refused', {'src': 'ion', 'ionToken': 'test-token'})
    check('refused key: connect screen never shown', not a['setupSeen'], json.dumps(a)[:300])
    check('refused key: falls back to the map with a warning', a['world'] == 'none' and 'did not load' in a['toasts'] and 'World → Connect' in a['toasts'], a['toasts'][:200])
    check('refused key: 7-day forecast loaded', a['wx'] == 'forecast' and a['days'] >= 6, f"{a['wx']} {a['days']} days")
    check('refused key: World → Connect opens the setup card', a['connectCard'])
    check('refused key: no page errors', not a['errors'], ' | '.join(a['errors'])[:300])
    m = run(b, 'map', {'src': 'none'})
    check('map published: connect screen never shown', not m['setupSeen'])
    check('map published: no fallback warning', 'did not load' not in m['toasts'], m['toasts'][:200])
    check('map published: 7-day forecast loaded', m['wx'] == 'forecast' and m['days'] >= 6, f"{m['wx']} {m['days']} days")
    check('map published: World → Connect opens the setup card', m['connectCard'])
    check('map published: no page errors', not m['errors'], ' | '.join(m['errors'])[:300])
    b.close()
fails = [k for k, v in results.items() if not v]
print(f'{len(results) - len(fails)} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
