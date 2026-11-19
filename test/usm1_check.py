"""Headless check of USM-1 (experimental) in the twin: the model list, inputs loaded on demand, live power,
the period comparison, the yield estimate and the weather overview.
Usage: ARIEN_DEPS=... python3 test/usm1_check.py <outdir>"""
import json, sys, time
from pathlib import Path
src_file = Path(__file__).with_name('run_browser.py')
ns = {'__file__': str(src_file)}
argv = sys.argv; sys.argv = [argv[0], argv[1] if len(argv) > 1 else '/tmp/arien-usm1', 'none']
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
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    reqs = []
    def handle(route):
        u = route.request.url
        if 'open-meteo.com' in u and 'geocoding' not in u: reqs.append(u)
        return ns['handle'](route)
    ctx.route('**/*', handle)
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
    extra = lambda: [u for u in reqs if 'cloud_cover_low' in u or 'air-quality' in u or 'snow_depth' in u]
    check('not in use: no extra weather requests', not extra(), json.dumps(extra())[:200])
    # --- the model pane
    page.click('#rail button[data-panel="models"]'); time.sleep(0.4)
    lbl = page.inner_text('#model-live')
    check('USM-1 listed as experimental', 'USM\u20111' in lbl and 'EXPERIMENTAL' in lbl.upper(), lbl[-200:])
    # --- choose it as the live model
    page.check('#model-live input[value="usm1"]')
    page.wait_for_function('() => { const s = window.__arien.state.wx.series; return s && s.usm; }', timeout=30000); time.sleep(1.5)
    check('inputs fetched on demand: extras, snow, aerosol', len(extra()) == 3 and any('air-quality-api' in u for u in extra()), '\n'.join(extra())[:400])
    st = page.inner_text('#model-usm-status')
    check('status says the inputs loaded, no fallbacks', 'USM-1 inputs loaded' in st and 'Fallbacks' not in st, st)
    hud = page.evaluate('() => { const r = __arien.state.sim.lastRes, w = __arien.state.sim.lastW; return { key: r.key, kw: r.kw, usm: w.usm, alt: w.sun.alt }; }')
    check('live power comes from USM-1', hud['key'] == 'usm1' and hud['usm'] is not None, json.dumps(hud)[:300])
    # --- period run includes USM-1 alongside the others
    page.check('#model-compare input[value="rwghi"]')
    page.click('#t-run'); time.sleep(1)
    page.wait_for_function('() => { const r = __arien.state.run; return r && r.keys.includes("usm1") && !document.querySelector("#t-run").disabled; }', timeout=120000)
    run = page.evaluate('''() => { const r = __arien.state.run, e = (k) => r.kw[k].reduce((s, v) => s + v, 0) * 0.25;
        return { keys: r.keys, usm: e('usm1'), rw: e('rwghi'), peak: Math.max(...r.kw.usm1) }; }''')
    check('period run compares USM-1 with RW-GHI', 'usm1' in run['keys'] and run['usm'] > 0 and run['rw'] > 0, json.dumps(run))
    check('USM-1 energy is the same order as RW-GHI', 0.4 < run['usm'] / run['rw'] < 2.5, f"{run['usm'] / run['rw']:.2f}")
    w = page.evaluate('() => { const w = __arien.state.sim.lastW; return { layers: w.layers, usm: w.usm }; }')
    check('weather sample carries the cloud layers', w['layers'] and len(w['layers']) == 3, json.dumps(w)[:200])
    # --- the yield estimate uses USM-1 for the year (inputs fetched for that series too)
    n0 = len(extra())
    y = page.evaluate('async () => { const r = await __arien.estimateYield(); return r && { model: r.model, total: r.total, per: r.perModel }; }')
    check('yield estimate runs on USM-1 for the last 12 months', y and y['model'] == 'usm1' and y['total'] > 0 and len(extra()) >= n0 + 3, json.dumps(y))
    # --- reports name it experimental
    lab = page.evaluate('() => __arien.modelLabel("usm1")')
    check('reports say experimental', lab.endswith('(experimental)'), lab)
    # --- saved and restored as the live model
    saved = page.evaluate('() => JSON.parse(localStorage.getItem("arien-twin-scene-v1") || "{}").live')
    check('live model saved', saved == 'usm1', str(saved))
    page.screenshot(path=str(OUT / 'usm1-models.png'))
    errs = [l for l in logs if 'net::ERR_FAILED' not in l and '401' not in l]
    check('no page errors', not errs, ' | '.join(errs)[:600])
    b.close()
fails = [k for k, v in results.items() if not v]
print(f'{len(results) - len(fails)} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
