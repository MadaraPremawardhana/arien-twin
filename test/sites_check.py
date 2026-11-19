"""Headless check: My sites sits at the top of the dashboard, marks the open site, and "New site" starts an empty
design (offering to save the open one first). Usage: ARIEN_DEPS=... python3 test/sites_check.py <outdir>"""
import json, sys, time
from pathlib import Path
src_file = Path(__file__).with_name('run_browser.py')
ns = {'__file__': str(src_file)}
argv = sys.argv; sys.argv = [argv[0], argv[1] if len(argv) > 1 else '/tmp/arien-sites', 'none']
exec(src_file.read_text().split('with sync_playwright() as p:')[0], ns)
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
results = {}
def check(name, cond, detail=''):
    results[name] = bool(cond)
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}); ctx.route('**/*', ns['handle'])
    page = ctx.new_page(); logs = []
    page.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)[:400]))
    page.on('console', lambda m: logs.append(m.type + ' ' + m.text[:300]) if m.type == 'error' else None)
    page.goto((ROOT / 'index.html').as_uri())
    page.wait_for_function('() => window.__arien', timeout=60000)
    page.select_option('#s-src', 'none'); page.click('#s-world')
    page.wait_for_function('() => document.getElementById("step-wx").dataset.state === "active"', timeout=120000)
    page.click('#s-wx')
    page.wait_for_function('() => document.getElementById("boot").classList.contains("gone") && window.__arien.state.run', timeout=120000)
    time.sleep(1)
    key = 'arien-twin-sites-v1'
    # --- save the current design as "Home roof", then look at the dashboard
    page.evaluate('() => __arien.saveNamedSite("Home roof")'); time.sleep(0.5)
    page.click('#rail button[data-view="dashboard"]'); time.sleep(2)
    first = page.evaluate('() => document.querySelector("#db-body").firstElementChild.id')
    check('My sites is the first card on the dashboard', first == 'db-sites', first)
    check('New site button in its header', page.is_visible('#db-sites .db-card-head #db-new-site'))
    li = page.evaluate('() => [...document.querySelectorAll("#db-sites .site-list li")].map(l => ({ open: l.classList.contains("open"), text: l.innerText }))')
    check('the open site is marked', len(li) == 1 and li[0]['open'] and 'OPEN NOW' in li[0]['text'].upper(), json.dumps(li))
    check('count in the title', page.inner_text('#db-sites .db-card-head h3').strip().endswith('1'), page.inner_text('#db-sites .db-card-head h3'))
    page.screenshot(path=str(OUT / '01-sites-top.png'))
    # --- unchanged design: New site starts at once
    page.click('#db-new-site'); time.sleep(1.5)
    st = page.evaluate('() => ({ view: __arien.state.view, arrays: __arien.state.arrays.length, objects: __arien.state.objects.length, name: __arien.state.designName })')
    check('saved design: New site starts straight away, empty, in Design', st['view'] == 'design' and st['arrays'] == 0 and st['objects'] == 0 and st['name'] == '', json.dumps(st))
    check('place search is ready', page.evaluate('() => document.activeElement && document.activeElement.id') == 'pl-q' and 'New site' in page.inner_text('#toasts'))
    # --- open "Home roof" again from the dashboard, change it, then New site → save first
    page.click('#rail button[data-view="dashboard"]'); time.sleep(1.5)
    page.click('#db-sites [data-open][data-view="design"]'); time.sleep(2.5)
    n0 = page.evaluate('() => __arien.state.arrays.length')
    check('the saved site reopens', n0 > 0, str(n0))
    page.evaluate('() => { const a = __arien.state.arrays[0]; a.tilt = 12; __arien.designChanged && __arien.designChanged(true); }')
    page.click('#rail button[data-view="dashboard"]'); time.sleep(1.5)
    page.click('#db-new-site'); time.sleep(0.6)
    ask = page.inner_text('#toasts')
    check('changed design: asks to save it first', 'Save “Home roof” before starting a new site?' in ask, ask[-160:])
    page.click('#toasts button:has-text("Save, then start new")'); time.sleep(1.5)
    saved = page.evaluate(f'() => JSON.parse(localStorage.getItem("{key}"))')
    saved = saved if isinstance(saved, list) else saved.get('sites', [])
    tilt = [s for s in saved if s['name'] == 'Home roof'][0]['snap']['arrays'][0]['tilt']
    check('it saved the change (one copy), then started new', len([s for s in saved if s['name'] == 'Home roof']) == 1 and tilt == 12 and page.evaluate('() => __arien.state.arrays.length') == 0, f'tilt {tilt}')
    # --- a new design with panels: "Start new without saving" leaves the saved sites alone
    page.evaluate('() => __arien.saveNamedSite("Barn")'); time.sleep(0.4)
    page.click('#rail button[data-view="dashboard"]'); time.sleep(1.5)
    page.click('#db-sites li:has-text("Home roof") [data-open][data-view="design"]'); time.sleep(2.5)
    page.evaluate('() => { const a = __arien.state.arrays[0]; a.tilt = 44; __arien.designChanged(true); }')
    page.click('#rail button[data-view="dashboard"]'); time.sleep(1.5)
    before = page.evaluate(f'() => localStorage.getItem("{key}")')
    page.click('#db-new-site'); time.sleep(0.6)
    check('asked again for the changed design', page.query_selector('#toasts button:has-text("Start new without saving")') is not None)
    page.click('#toasts button:has-text("Start new without saving")'); time.sleep(1.2)
    check('discarding leaves the saved sites as they were', page.evaluate(f'() => localStorage.getItem("{key}")') == before and page.evaluate('() => __arien.state.arrays.length') == 0)
    page.click('#rail button[data-view="dashboard"]'); time.sleep(1.5)
    li = page.evaluate('() => [...document.querySelectorAll("#db-sites .site-list li")].map(l => l.classList.contains("open"))')
    check('a new, unsaved design marks no site as open', len(li) == 2 and not any(li), json.dumps(li))
    check('header names the new site', page.inner_text('#db-site') == 'New site' and 'no panels yet' in page.inner_text('#db-sub'), page.inner_text('#db-site') + ' | ' + page.inner_text('#db-sub'))
    check('empty-design prompt sits below My sites', page.evaluate('() => document.querySelector("#db-body").firstElementChild.id') == 'db-sites' and page.is_visible('.db-empty'))
    page.screenshot(path=str(OUT / '02-new-site.png'))
    # --- per-site dashboards: make "Garage" (one 2 × 3 array) from Home roof, then switch between them
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.click('#db-sites li:has-text("Home roof") [data-open][data-view="design"]'); time.sleep(2.5)
    page.evaluate('''() => { const a = __arien.state.arrays[0]; a.rows = 2; a.cols = 3; __arien.rebuild(); __arien.designChanged(true); }''')
    page.evaluate('() => __arien.saveNamedSite("Garage")'); time.sleep(0.5)
    kpi = '() => ({ title: document.querySelector("#db-site").textContent, panels: (document.querySelector("#db-overview .kpi:nth-child(2) .kpi-value") || {}).textContent || null, pick: document.querySelector("#db-site-pick").selectedOptions[0].textContent, view: __arien.state.view, at: __arien.state.yieldRes && __arien.state.yieldRes.at })'
    ready = lambda name: page.wait_for_function(f'() => document.querySelector("#db-site").textContent === "{name}" && document.querySelector("#db-overview .kpi") && !document.querySelector("#db-site-pick").disabled', timeout=180000)
    page.click('#rail button[data-view="dashboard"]'); time.sleep(1)
    page.click('#db-sites li:has-text("Home roof") [data-open][data-view="dashboard"]'); ready('Home roof'); time.sleep(0.5)
    home = page.evaluate(kpi)
    check('Dashboard button on a row shows that site\'s overview', home['view'] == 'dashboard' and home['pick'] == 'Home roof' and home['panels'].startswith('12'), json.dumps(home))
    opts = page.evaluate('() => [...document.querySelectorAll("#db-site-pick option")].map(o => o.textContent)')
    check('the header picker lists every saved site', sorted(opts) == ['Barn', 'Garage', 'Home roof'], json.dumps(opts))
    page.select_option('#db-site-pick', label='Garage'); ready('Garage'); time.sleep(0.5)
    gar = page.evaluate(kpi)
    check('picker switches to Garage with its own figures', gar['panels'].startswith('6') and gar['pick'] == 'Garage', json.dumps(gar))
    page.select_option('#db-site-pick', label='Home roof'); time.sleep(1.2)
    back = page.evaluate(kpi)
    check('back to Home roof at once (results kept from earlier)', back['title'] == 'Home roof' and (back['panels'] or '').startswith('12') and back['at'] == home['at'], json.dumps(back))
    # an unsaved change: switching asks; Cancel keeps the site and the picker
    page.evaluate('() => { __arien.state.arrays[0].tilt = 20; __arien.designChanged(true); }'); time.sleep(0.3)
    page.select_option('#db-site-pick', label='Garage'); time.sleep(0.6)
    check('unsaved change: switching asks first', 'before switching site' in page.inner_text('#toasts'), page.inner_text('#toasts')[-120:])
    page.click('#toasts button:has-text("Cancel")'); time.sleep(0.6)
    pk = page.evaluate('() => document.querySelector("#db-site-pick").selectedOptions[0].textContent')
    check('Cancel keeps the open site and resets the picker', page.evaluate('() => __arien.state.designName') == 'Home roof' and pk.startswith('Home roof'), pk)
    # clicking the site name works like the Dashboard button
    page.select_option('#db-site-pick', label='Garage'); time.sleep(0.4)
    page.click('#toasts button:has-text("Switch without saving")'); time.sleep(1)
    ready('Garage')
    check('Switch without saving opens Garage on the dashboard', page.evaluate('() => __arien.state.view') == 'dashboard')
    page.click('#db-sites li:has-text("Home roof") .sl-main'); time.sleep(1.5)
    ready('Home roof')
    check('clicking a site in My sites shows its dashboard', page.evaluate('() => __arien.state.arrays[0].tilt') != 20)
    page.screenshot(path=str(OUT / '04-site-dashboards.png'))
    page.set_viewport_size({'width': 390, 'height': 844}); time.sleep(1)
    page.screenshot(path=str(OUT / '03-phone.png'))
    check('phone: no horizontal scroll', not page.evaluate('() => document.documentElement.scrollWidth > window.innerWidth + 1'))
    errs = [l for l in logs if 'net::ERR_FAILED' not in l and '401' not in l]
    check('no page errors', not errs, ' | '.join(errs)[:600])
    b.close()
fails = [k for k, v in results.items() if not v]
print(f'{len(results) - len(fails)} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
