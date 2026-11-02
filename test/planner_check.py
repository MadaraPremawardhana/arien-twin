"""Headless check of the Design planner, panel library, saved sites, search, forecast and yield.
Usage: ARIEN_DEPS=... python3 test/planner_check.py <outdir>"""
import json, sys, time
from pathlib import Path
src_file = Path(__file__).with_name('run_browser.py')
ns = {'__file__': str(src_file)}
argv = sys.argv; sys.argv = [argv[0], argv[1] if len(argv) > 1 else '/tmp/arien-planner', 'none']
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
    check('logo in rail', page.evaluate('() => { const i = document.querySelector("#rail .brand img"); return i && i.naturalWidth > 100; }'))
    # --- twin: panel model in the arrays editor
    page.click('#rail button[data-panel="panels"]'); page.click('#arr-list li[data-id]')
    info = page.evaluate('() => ({ model: document.querySelector("#arr-model").value, opts: document.querySelectorAll("#arr-model option").length, eff: document.querySelector("#arr-eff").value, cap: document.querySelector("#arr-capacity").textContent })')
    check('array editor shows panel models', info['opts'] >= 11, json.dumps(info))
    page.select_option('#arr-model', 'maxeon7-445'); time.sleep(0.5)
    a0 = page.evaluate('() => { const a = __arien.state.arrays[0]; return { m: a.panelModel, eff: a.eff, w: a.panelW, kwp: document.querySelector("#arr-capacity").textContent }; }')
    check('choosing a model sets efficiency and size', a0['m'] == 'maxeon7-445' and abs(a0['eff'] - 0.241) < 1e-9 and a0['w'] == 1.035 and '5.34 kWp' in a0['kwp'], json.dumps(a0))
    page.fill('#arr-eff', '20'); page.dispatch_event('#arr-eff', 'change'); time.sleep(0.3)
    check('editing efficiency makes it a custom panel', page.evaluate('() => __arien.state.arrays[0].panelModel') == 'custom' and page.eval_on_selector('#arr-model', 'e => e.value') == 'custom')
    # --- site search: postcode and address
    page.click('#rail button[data-panel="site"]')
    page.fill('#site-search', 'MK18 1EG'); page.click('#site-search-go'); page.wait_for_selector('#site-results button', timeout=10000)
    check('postcode search via postcodes.io', 'postcodes.io' in page.inner_text('#site-results'), page.inner_text('#site-results')[:80])
    # --- saved sites with an automatic name
    page.fill('#site-name', ''); page.click('#site-save'); time.sleep(0.4)
    saved = page.evaluate('() => __arien.listSites().map(s => s.name)')
    check('save without a name gives a meaningful one', len(saved) == 1 and 'kWp' in saved[0] and 'south' in saved[0], json.dumps(saved))
    page.screenshot(path=str(OUT / 'twin-site-pane.png'))
    # --- design view
    page.click('#rail button[data-view="design"]'); time.sleep(1.5)
    check('design view opens', page.evaluate('() => !document.getElementById("planner").hidden && document.body.classList.contains("view-design")'))
    page.screenshot(path=str(OUT / 'planner-start.png'))
    n0 = page.evaluate('() => __arien.state.arrays.reduce((t, a) => t + a.rows * a.cols, 0)')
    box = page.locator('#pl-map').bounding_box(); cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    # rectangle tool: draw 9 m × 6 m-ish (zoom 19 ≈ 0.19 m/px at 52°N → ~48 px per 9 m)
    page.click('#pl-tools [data-tool="rect"]')
    page.mouse.move(cx - 260, cy + 60); page.mouse.down(); page.mouse.move(cx - 180, cy + 100, steps=5); page.mouse.move(cx - 120, cy + 140, steps=5); page.mouse.up(); time.sleep(0.8)
    z = page.evaluate('() => ({ zones: __arien.state.zones.length, inZone: __arien.state.arrays.filter(a => a.zone).reduce((t, a) => t + a.cols, 0), area: ArienPlanner.polyArea(__arien.state.zones[0] ? __arien.state.zones[0].poly : [[0,0]]) })')
    check('rectangle fills a roof area with panels', z['zones'] == 1 and z['inZone'] >= 4, json.dumps(z))
    # freehand
    page.click('#pl-tools [data-tool="free"]')
    page.mouse.move(cx + 40, cy + 40); page.mouse.down()
    for (dx, dy) in [(120, 40), (150, 110), (90, 160), (40, 130), (40, 40)]: page.mouse.move(cx + dx, cy + dy, steps=6)
    page.mouse.up(); time.sleep(0.8)
    check('freehand area fills with panels', page.evaluate('() => __arien.state.zones.length') == 2 and page.evaluate('() => __arien.state.arrays.filter(a => a.zone === __arien.state.zones[1].id).length') >= 1)
    # place single panel
    page.click('#pl-tools [data-tool="place"]'); page.mouse.click(cx - 200, cy - 150); time.sleep(0.5)
    singles = page.evaluate('() => __arien.state.arrays.filter(a => !a.zone && a.rows * a.cols === 1).length')
    check('place tool adds a single panel', singles >= 1, str(singles))
    # obstruction
    page.click('#pl-tools [data-tool="obst"]'); page.select_option('#pl-obtype', 'tree'); page.fill('#pl-ob-h', '11')
    nobj = page.evaluate('() => __arien.state.objects.length'); page.mouse.click(cx - 190, cy + 230); time.sleep(0.6)
    tree = page.evaluate('() => { const o = __arien.state.objects.at(-1); return { n: __arien.state.objects.length, type: o.type, h: o.dims.height }; }')
    check('obstruction tool places a tree with its height', tree['n'] == nobj + 1 and tree['type'] == 'tree' and tree['h'] == 11, json.dumps(tree))
    time.sleep(0.8)
    loss = page.evaluate('() => __arien.state.quickLoss')
    check('shading loss estimate shown', loss is not None and 0 <= loss < 0.6 and 'a year' in page.inner_text('#pl-summary'), f'{loss} {page.inner_text("#pl-summary")[:120]!r}')
    # tilt and model change refill the zones
    before = page.evaluate('() => __arien.state.arrays.filter(a => a.zone).reduce((t, a) => t + a.cols, 0)')
    page.select_option('#pl-model', 'jinko-tn72-580'); time.sleep(0.6)
    after = page.evaluate('() => ({ n: __arien.state.arrays.filter(a => a.zone).reduce((t, a) => t + a.cols, 0), models: [...new Set(__arien.state.arrays.map(a => a.panelModel))] })')
    check('changing the panel model re-fills the areas', after['models'] == ['jinko-tn72-580'] and after['n'] <= before, f'{before} → {json.dumps(after)}')
    page.evaluate('() => { const el = document.querySelector("#pl-tilt"); el.value = 20; el.dispatchEvent(new Event("change")); }'); time.sleep(0.5)
    check('tilt applies to the design', all(t == 20 for t in page.evaluate('() => __arien.state.arrays.map(a => a.tilt)')))
    page.select_option('#pl-model', 'longi-himo6-430'); time.sleep(0.5)
    page.screenshot(path=str(OUT / 'planner-drawn.png'))
    # drag the first zone by 40 px east
    z0 = page.evaluate('() => { const z = __arien.state.zones[0]; return { x: z.poly[0][0], ax: __arien.state.arrays.find(a => a.zone === z.id).x }; }')
    page.click('#pl-tools [data-tool="place"]')
    pt = page.evaluate('''() => { const m = ArienPlanner._map(), a = __arien.state.arrays.find(x => x.zone === __arien.state.zones[0].id);
        const r = 6378137, lat = __arien.state.site.lat * Math.PI / 180; const ll = L.latLng(__arien.state.site.lat + a.y / 111250, __arien.state.site.lon + a.x / (111320 * Math.cos(lat)));
        const p = m.latLngToContainerPoint(ll); const b = m.getContainer().getBoundingClientRect(); return [b.left + p.x, b.top + p.y]; }''')
    page.mouse.move(pt[0], pt[1]); page.mouse.down(); page.mouse.move(pt[0] + 20, pt[1], steps=4); page.mouse.move(pt[0] + 40, pt[1], steps=4); page.mouse.up(); time.sleep(0.6)
    z1 = page.evaluate('() => { const z = __arien.state.zones[0]; return { x: z.poly[0][0], ax: __arien.state.arrays.find(a => a.zone === z.id).x }; }')
    check('dragging moves a roof area and its panels', z1['x'] - z0['x'] > 3 and abs((z1['x'] - z0['x']) - (z1['ax'] - z0['ax'])) < 1e-6, f'{z0} → {z1}')
    # right-click removes the single panel
    ns_before = page.evaluate('() => __arien.state.arrays.filter(a => !a.zone).length')
    page.mouse.click(cx - 200, cy - 150, button='right'); time.sleep(0.5)
    check('right-click removes a panel', page.evaluate('() => __arien.state.arrays.filter(a => !a.zone).length') == ns_before - 1)
    # Design kit: roof area analysis
    page.fill('#pl-area', '60'); page.click('#pl-analyse')
    page.wait_for_function('() => /kWh a year|not available|needs weather/.test(document.querySelector("#pl-analysis").textContent)', timeout=90000)
    an = page.inner_text('#pl-analysis')
    check('roof area analysis gives panels, kWp and a year of kWh', 'panels' in an and 'kWp' in an and 'kWh a year' in an, an.replace('\n', ' ')[:200])
    # typed request with a location
    page.fill('#pl-chat-q', '10 panels in London, south-facing at 30°'); page.press('#pl-chat-q', 'Enter')
    page.wait_for_function('() => /Placed/.test(document.querySelector("#pl-chat").lastElementChild.textContent)', timeout=30000)
    st = page.evaluate('() => ({ site: __arien.state.site.name, lat: __arien.state.site.lat, n: __arien.state.arrays.reduce((t, a) => t + a.rows * a.cols, 0), tilt: [...new Set(__arien.state.arrays.map(a => a.tilt))], az: [...new Set(__arien.state.arrays.map(a => a.azimuth))] })')
    check('typed request moves to London and places 10 panels', 'London' in st['site'] and abs(st['lat'] - 51.5072) < 1e-3 and st['n'] == 10 and st['tilt'] == [30] and st['az'] == [180], json.dumps(st))
    page.fill('#pl-chat-q', 'add a tree 9 m south, 12 m tall'); page.press('#pl-chat-q', 'Enter'); time.sleep(0.8)
    check('typed request adds an obstruction', page.evaluate('() => { const o = __arien.state.objects.at(-1); return o && o.type === "tree" && o.dims.height === 12; }'))
    pr = page.evaluate('''() => [ArienPlanner.parseRequest("5 kWp of Aiko panels in MK18 1EG landscape"), ArienPlanner.parseRequest("east-west 16 panels flat roof"), ArienPlanner.parseRequest("save as Garage roof")]''')
    check('request parser understands kWp, maker, postcode, east-west and save', pr[0].get('kwp') == 5 and pr[0].get('panelModel') == 'aiko-2p-460' and pr[0].get('place', '').upper().replace(' ', '') == 'MK181EG' and pr[0].get('landscape') is True
          and pr[1].get('azimuth') == 'ew' and pr[1].get('count') == 16 and pr[1].get('mount') == 'rows' and pr[2].get('save') == 'Garage roof', json.dumps(pr))
    time.sleep(1)
    page.screenshot(path=str(OUT / 'planner-london.png'))
    # forecast and yield
    page.click('#pl-forecast')
    page.wait_for_function('() => /Forecast · next 7 days/i.test(document.querySelector(".pl-right .results-slot").textContent)', timeout=120000)
    fc = page.evaluate('() => __arien.state.forecastRes && { days: __arien.state.forecastRes.days.length, total: __arien.state.forecastRes.total }')
    check('forecast gives 7 days of kWh', fc and fc['days'] == 7 and fc['total'] > 0, json.dumps(fc))
    t0 = time.time(); page.click('#pl-yield')
    page.wait_for_function('() => __arien.state.yieldRes && !document.querySelector(".pl-right .results-slot .busy")', timeout=180000)
    y = page.evaluate('() => { const r = __arien.state.yieldRes; return { total: r.total, specific: r.specific, loss: r.shadingLoss, months: r.months.length, kwp: r.kwp, models: Object.keys(r.perModel) }; }')
    check('yield estimate over 12 months', y['months'] == 12 and y['total'] > 0 and 300 < y['specific'] < 2000 and 0 <= y['loss'] < 0.5, f'{json.dumps(y)} in {time.time() - t0:.1f}s')
    page.screenshot(path=str(OUT / 'planner-results.png'))
    # save with a typed name, then open it again after clearing
    page.fill('#pl-name', 'London test roof'); page.click('#pl-save'); time.sleep(0.4)
    page.fill('#pl-chat-q', 'clear'); page.press('#pl-chat-q', 'Enter'); time.sleep(0.6)
    check('clear empties the design', page.evaluate('() => __arien.state.arrays.length') == 0)
    page.click('.pl-left .saved-list .saved-open >> text=London test roof'); time.sleep(2.5)
    check('saved site reopens with its panels', page.evaluate('() => __arien.state.arrays.reduce((t, a) => t + a.rows * a.cols, 0)') == 10 and 'London' in page.evaluate('() => __arien.state.site.name'))
    # simulate in 3D
    page.click('#pl-sim'); time.sleep(6)
    tw = page.evaluate('() => ({ view: __arien.state.view, run: !!__arien.state.run, dash: !document.getElementById("dash").hidden, fresh: __arien.state.arrays.filter(a => a.fromPlanner).length })')
    check('simulate opens the 3D twin and runs', tw['view'] == 'twin' and tw['run'] and tw['fresh'] == 0, json.dumps(tw))
    page.click('#btn-yield'); page.wait_for_function('() => __arien.state.yieldRes && !__arien.state.yieldRes.stale && !document.querySelector("#dash .results-slot .busy")', timeout=180000)
    check('Est. yield button works in the twin', 'estimated yield' in page.inner_text('#dash .results-slot').lower())
    page.screenshot(path=str(OUT / 'twin-after-simulate.png'))
    # narrow screen planner
    page.set_viewport_size({'width': 390, 'height': 844}); page.evaluate('() => __arien.setView("design")'); time.sleep(1.2)
    page.screenshot(path=str(OUT / 'planner-phone.png'), full_page=False)
    over = page.evaluate('() => document.documentElement.scrollWidth > window.innerWidth + 1')
    check('no horizontal scroll at phone width', not over)
    errs = [l for l in logs if 'net::ERR_FAILED' not in l and '401' not in l]
    check('no page errors', not errs, ' | '.join(errs)[:600])
    b.close()
fails = [k for k, v in results.items() if not v]
print(f'{len(results) - len(fails)} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
