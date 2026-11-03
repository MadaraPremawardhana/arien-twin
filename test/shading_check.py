"""Headless check of per-cell line traces, shading in the forecast and yield, transparency and channels.
Usage: ARIEN_DEPS=... python3 test/shading_check.py <outdir>"""
import json, sys, time
from pathlib import Path
src_file = Path(__file__).with_name('run_browser.py')
ns = {'__file__': str(src_file)}
argv = sys.argv; sys.argv = [argv[0], argv[1] if len(argv) > 1 else '/tmp/arien-shading', 'none']
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
    # a low winter-ish sun: tomorrow 10:30 local, when the demo tree (south-east) and wall (south) shade the array
    page.evaluate('''() => { const s = __arien.state.wx.series, off = s.utcOffset * 1000, d = new Date(Date.now() + off);
        const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 10, 30) - off;
        const v = __arien.viewer(); v.clock.shouldAnimate = false; v.clock.currentTime = Cesium.JulianDate.fromDate(new Date(t)); __arien.simulateNow(true); }''')
    time.sleep(0.5)
    # put a tall hedge right in front so something is certainly shaded
    page.evaluate('''() => { __arien.placeObjects([{ type: 'hedge', x: 0, y: -5.5, z: 0 }]); const o = __arien.state.objects.at(-1); o.dims.height = 3.2; o.dims.length = 6; o.porosity = 0; __arien.rebuild(); __arien.designChanged(); __arien.simulateNow(true); }''')
    time.sleep(1.5)
    page.click('#rail button[data-panel="shading"]'); time.sleep(0.4)
    page.check('#sh-traces'); time.sleep(1.2)
    tl = page.evaluate('''() => { const L = __arien.traceLayer(); if (!L) return null; const vis = L.pl.filter(l => l.show);
        const kinds = {}; vis.forEach(l => { const c = l.material.uniforms.color; const k = c.red.toFixed(2) + ',' + c.green.toFixed(2); kinds[k] = (kinds[k] || 0) + 1; });
        return { lines: vis.length, points: L.pt.filter(p => p.show).length, kinds, cells: __arien.state.arrays.reduce((t, a) => t + a.rows * a.cols * a.cellsX * a.cellsY, 0) }; }''')
    check('a line trace per cell is drawn toward the sun', tl and tl['lines'] >= tl['cells'] * 0.9 and len(tl['kinds']) >= 2 and tl['points'] > 0, json.dumps(tl))
    now = page.inner_text('#sh-now')
    check('live readout: shaded cells and causes', 'cells shaded' in now and 'Hedge' in now, now.replace('\n', ' | ')[:240])
    # camera looking at the array and traces
    page.evaluate('''() => { const v = __arien.viewer(); v.camera.lookAt(__arien.enu2ecef(0, -1, 1), new Cesium.HeadingPitchRange(-0.9, -0.42, 26)); }''')
    time.sleep(2.5)
    page.screenshot(path=str(OUT / '01-traces.png'))
    # forecast includes the shading, split by cause
    page.evaluate('() => __arien.forecastWeek()'); page.wait_for_function('() => __arien.state.forecastRes && __arien.state.forecastRes.shading', timeout=60000)
    f1 = page.evaluate('() => { const s = __arien.state.forecastRes.shading; return { lost: s.lostKWh, pct: s.pct, by: s.by.map(r => [r.label, +r.kwh.toFixed(3)]) }; }')
    check('forecast loses energy to shading, split by cause', f1['lost'] > 0 and any('Hedge' in r[0] for r in f1['by']) and abs(sum(r[1] for r in f1['by']) - f1['lost']) < 0.02 * max(f1['lost'], 1), json.dumps(f1)[:400])
    # making the hedge 50% transparent re-runs the forecast by itself with less loss from it
    page.evaluate('''() => { const o = __arien.state.objects.find(x => x.type === 'hedge'); o.porosity = 0.5; __arien.designChanged(); }''')
    page.wait_for_function('() => __arien.state.forecastRes && !__arien.state.forecastRes.stale', timeout=60000); time.sleep(0.3)
    f2 = page.evaluate('() => { const s = __arien.state.forecastRes.shading; return { lost: s.lostKWh, hedge: (s.by.find(r => /Hedge/.test(r.label)) || {}).kwh || 0, label: (s.by.find(r => /Hedge/.test(r.label)) || {}).label }; }')
    hedge1 = next(r[1] for r in f1['by'] if 'Hedge' in r[0])
    check('transparency halves what the hedge takes; forecast refreshed itself', f2['lost'] < f1['lost'] and abs(f2['hedge'] / hedge1 - 0.5) < 0.12 and '50% transparent' in (f2['label'] or ''), f'{hedge1:.3f} → {f2["hedge"]:.3f} kWh · {f2["label"]}')
    # 4 rays per cell
    page.click('#sh-samples button[data-v="2"]')
    page.wait_for_function('() => __arien.state.forecastRes && !__arien.state.forecastRes.stale && __arien.state.forecastRes.shading.samples === 2', timeout=60000)
    f3 = page.evaluate('() => __arien.state.forecastRes.shading.lostKWh')
    check('4 rays per cell: similar total, partial cells', abs(f3 - f2['lost']) / max(f2['lost'], 1e-6) < 0.3, f'{f2["lost"]:.3f} → {f3:.3f} kWh')
    part = page.evaluate('() => __arien.state.shade.traces.some(r => Array.from(r.trans).some(t => t > 0.01 && t < 0.99 && Math.abs(t - 0.5) > 0.01))')
    check('partly covered cells exist with 4 rays', part)
    page.click('#sh-samples button[data-v="1"]')
    # obstacle channel off: no obstacle losses
    page.uncheck('#sh-ch-objects')
    page.wait_for_function('() => __arien.state.forecastRes && !__arien.state.forecastRes.stale && __arien.state.forecastRes.shading.samples === 1', timeout=60000); time.sleep(0.3)
    f4 = page.evaluate('() => __arien.state.forecastRes.shading.by.map(r => r.label)')
    check('obstacle channel off: only panel shading left', all('panels' in l for l in f4), json.dumps(f4))
    page.check('#sh-ch-objects')
    page.wait_for_function('() => __arien.state.forecastRes && !__arien.state.forecastRes.stale && __arien.state.forecastRes.shading.by.some(r => /Hedge/.test(r.label))', timeout=60000)
    # the year: shading by cause, and the dashboard card
    page.click('#rail button[data-view="dashboard"]')
    page.wait_for_selector('#db-shading .shade-list li', timeout=180000); time.sleep(1.2)
    ys = page.evaluate('() => (__arien.state.yieldRes.shadingBy || []).map(r => [r.label, Math.round(r.kwh)])')
    check('yearly yield charges each obstacle', len(ys) >= 1 and any('Hedge' in r[0] for r in ys), json.dumps(ys))
    card = page.inner_text('#db-shading')
    check('dashboard shading card: week and year by cause', 'next 7 days' in card and 'a year' in card and 'Hedge' in card, card.replace('\n', ' | ')[:300])
    page.evaluate('() => document.querySelector("#db-forecast").scrollIntoView()'); time.sleep(0.5)
    page.screenshot(path=str(OUT / '02-dashboard-shading.png'))
    rd = page.evaluate('() => { const d = ArienDashboard._reportData(); return d.shading && { year: d.shading.year.by.length, week: !!d.shading.week }; }')
    check('report data carries the shading', rd and rd['year'] >= 1 and rd['week'], json.dumps(rd))
    # traces button from the dashboard opens the 3D view with traces on
    page.click('#db-show-traces'); time.sleep(2)
    check('dashboard opens the traces in 3D', page.evaluate('() => __arien.state.view === "twin" && __arien.state.shade.showTraces && !document.getElementById("drawer").hidden'))
    page.keyboard.press('t'); time.sleep(0.3)
    check('T hides the traces', page.evaluate('() => !__arien.state.shade.showTraces && __arien.traceLayer().pl.every(l => !l.show)'))
    # planner: transparency on the obstruction tool
    page.click('#rail button[data-view="design"]'); time.sleep(1.2)
    page.click('#pl-tools [data-tool="obst"]'); page.select_option('#pl-obtype', 'tree'); page.fill('#pl-ob-tr', '30')
    box = page.locator('#pl-map').bounding_box(); page.mouse.click(box['x'] + box['width'] * 0.3, box['y'] + box['height'] * 0.75); time.sleep(0.6)
    tp = page.evaluate('() => __arien.state.objects.at(-1).porosity')
    check('planner places a tree with 30% transparency', abs(tp - 0.3) < 1e-9, str(tp))
    page.keyboard.press('2'); time.sleep(0.3)
    check('number keys pick planner tools without leaving the planner', page.evaluate('() => __arien.state.view') == 'design' and page.get_attribute('#pl-tools [data-tool="rect"]', 'aria-pressed') == 'true')
    errs = [l for l in logs if 'net::ERR_FAILED' not in l and '401' not in l]
    check('no page errors', not errs, ' | '.join(errs)[:600])
    b.close()
fails = [k for k, v in results.items() if not v]
print(f'{len(results) - len(fails)} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
