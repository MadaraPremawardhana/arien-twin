"""Headless check of the Objects pane: categories, drawing a building in 3D and on the map, floors and roof, save and reopen.
Usage: ARIEN_DEPS=... python3 test/buildings_check.py <outdir>"""
import json, sys, time
from pathlib import Path
src_file = Path(__file__).with_name('run_browser.py')
ns = {'__file__': str(src_file)}
argv = sys.argv; sys.argv = [argv[0], argv[1] if len(argv) > 1 else '/tmp/arien-buildings', 'none']
exec(src_file.read_text().split('with sync_playwright() as p:')[0], ns)
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
results = {}
def check(name, cond, detail=''):
    results[name] = bool(cond)
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))

HOUSES = '() => __arien.state.objects.filter(o => o.type === "house")'
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
    # --- the pane is "Objects", in three groups
    page.click('#rail button[data-panel="objects"]'); time.sleep(0.3)
    info = page.evaluate('''() => ({ rail: document.querySelector('#rail button[data-panel="objects"]').title, title: document.querySelector('#drawer-title') ? document.querySelector('#drawer-title').textContent : '',
        groups: [...document.querySelectorAll('#obj-lib .lib-group')].map(g => [g.querySelector('h4').textContent, [...g.querySelectorAll('button[data-type]')].map(b => b.dataset.type)]),
        obstacle: document.body.innerText.match(/obstacles? /gi) })''')
    groups = dict(info['groups'])
    check('pane is called Objects', info['rail'].startswith('Objects') and 'Objects' in info['title'], json.dumps([info['rail'], info['title']]))
    check('three categories in order', [g[0] for g in info['groups']] == ['Obstacles', 'Foliage', 'Buildings'], json.dumps(info['groups']))
    check('types sorted into categories', set(groups.get('Obstacles', [])) == {'wall', 'chimney', 'pole'} and set(groups.get('Foliage', [])) == {'tree', 'conifer', 'hedge'} and groups.get('Buildings', [])[:1] == ['house'], json.dumps(groups))
    # --- draw a building in 3D: settings first, then four corners and Enter
    page.fill('#bld-floors', '3'); page.dispatch_event('#bld-floors', 'change'); page.select_option('#bld-roof', 'hip')
    page.click('#obj-lib button[data-type="house"]'); time.sleep(0.2)
    check('drawing mode shows Finish', page.is_visible('#modebar') and page.is_visible('#modebar-done') and page.is_disabled('#modebar-done'), page.inner_text('#modebar'))
    canvas = page.query_selector('#globe canvas').bounding_box()
    cx, cy = canvas['x'] + canvas['width'] * 0.58, canvas['y'] + canvas['height'] * 0.72
    corners = [(cx - 70, cy - 40), (cx + 70, cy - 40), (cx + 70, cy + 40), (cx - 70, cy + 40)]
    for i, (x, y) in enumerate(corners):
        page.mouse.click(x, y); time.sleep(0.25)
        if i == 1: page.keyboard.press('Backspace'); time.sleep(0.1); page.mouse.click(x, y); time.sleep(0.25)  # undo one corner and redo it
    check('Finish enabled after three corners', not page.is_disabled('#modebar-done'), page.inner_text('#modebar'))
    page.screenshot(path=str(OUT / 'building-drawing.png'))
    page.keyboard.press('Enter'); time.sleep(1.5)
    hs = page.evaluate(HOUSES)
    h = hs[0] if hs else {}
    check('a building is made from the outline', len(hs) == 1 and len(h.get('poly', [])) == 4 and h['floors'] == 3 and h['roof'] == 'hip', json.dumps(h)[:300])
    area = page.evaluate('() => { const o = __arien.state.objects.find(o => o.type === "house"); return o ? Math.abs(ArienPhysics.polyArea(o.poly)) : 0; }')
    check('its floor area is sensible', 10 < area < 5000, f'{area:.1f} m2')
    check('height = 3 floors + hip roof', h and abs(h['dims']['height'] - (8.4 + __import__('math').tan(__import__('math').radians(30)) * h['dims']['width'] / 2)) < 0.01, json.dumps(h.get('dims')))
    check('editor shows building settings', page.is_visible('#obj-bld') and page.input_value('#bld-e-floors') == '3' and page.input_value('#bld-e-roof') == 'hip' and 'm²' in page.inner_text('#bld-info'), page.inner_text('#bld-info'))
    check('list names it', 'Building · 3 floors, hip roof' in page.inner_text('#obj-list'), page.inner_text('#obj-list'))
    time.sleep(2)
    lod = page.evaluate('() => __arien.lodOf(__arien.state.objects.find(o => o.type === "house").id)')
    check('3D model is built (not the fallback box)', lod in (0, 1, 2), str(lod))
    page.screenshot(path=str(OUT / 'building-3d.png'))
    # --- floors and roof
    page.fill('#bld-e-floors', '5'); page.dispatch_event('#bld-e-floors', 'change'); time.sleep(0.3)
    page.select_option('#bld-e-roof', 'flat'); time.sleep(0.4)
    d = page.evaluate('() => __arien.state.objects.find(o => o.type === "house").dims')
    check('5 floors with a flat roof = 14 m', abs(d['height'] - 14) < 1e-6 and not page.is_visible('#bld-e-pitch-wrap'), json.dumps(d))
    page.select_option('#bld-e-roof', 'gable'); time.sleep(0.3)
    page.evaluate('() => { const el = document.querySelector("#bld-e-pitch"); el.value = 45; el.dispatchEvent(new Event("input")); }'); time.sleep(0.6)
    d2 = page.evaluate('() => { const o = __arien.state.objects.find(o => o.type === "house"); return { h: o.dims.height, w: o.dims.width, p: o.pitch }; }')
    check('gable at 45° rises by half the width', d2['p'] == 45 and abs(d2['h'] - (14 + d2['w'] / 2)) < 1e-6, json.dumps(d2))
    # --- it shades: a ray from the building's south side at mid-height is blocked
    blk = page.evaluate('''() => { const o = __arien.state.objects.find(o => o.type === "house");
        const r = ArienPhysics.objectTrace(o, [o.x, o.y - 60, o.z + 5], [0, 1, 0]); return r && r.trans === 0; }''')
    check('shading traces the building', blk)
    # --- duplicate, scale, remove
    page.click('#obj-dup'); time.sleep(0.5)
    check('duplicate keeps the floor plan', len(page.evaluate(HOUSES)) == 2 and page.evaluate(HOUSES)[1]['poly'] == page.evaluate(HOUSES)[0]['poly'])
    L0 = page.evaluate(HOUSES)[1]['dims']['length']; page.keyboard.press(']'); time.sleep(0.3)
    check('] scales the footprint', abs(page.evaluate(HOUSES)[1]['dims']['length'] - L0 * 1.05) < 1e-3)
    page.click('#obj-del'); time.sleep(0.3)
    check('delete removes it', len(page.evaluate(HOUSES)) == 1)
    # --- crossing outline is refused
    page.click('#obj-lib button[data-type="house"]')
    for x, y in [(cx + 160, cy - 40), (cx + 260, cy + 40), (cx + 260, cy - 40), (cx + 160, cy + 40)]: page.mouse.click(x, y); time.sleep(0.2)
    page.keyboard.press('Enter'); time.sleep(0.4)
    check('crossing outline is refused, drawing continues', len(page.evaluate(HOUSES)) == 1 and page.is_visible('#modebar') and 'crosses' in page.inner_text('#toasts'), page.inner_text('#toasts')[-120:])
    page.keyboard.press('Escape'); time.sleep(0.2)
    check('Esc cancels drawing', not page.is_visible('#modebar'))
    # --- the 2D planner: Object tool, Building, click corners, Enter
    page.click('#rail button[data-view="design"]'); time.sleep(1.5)
    page.click('#pl-tools [data-tool="obst"]'); page.select_option('#pl-obtype', 'house'); time.sleep(0.2)
    opts = page.evaluate('() => [...document.querySelectorAll("#pl-obtype optgroup")].map(g => g.label)')
    check('planner object list has the categories', opts == ['Obstacles', 'Foliage', 'Buildings'], json.dumps(opts))
    check('planner shows floors and roof for a building', page.is_visible('#pl-ob-fl') and page.is_visible('#pl-ob-rf') and not page.is_visible('#pl-ob-h'))
    gap = page.evaluate('() => document.querySelector("#pl-layers").getBoundingClientRect().top - document.querySelector("#pl-tools").getBoundingClientRect().bottom')
    check('map switch sits below the tool panel', gap >= 0, f'{gap:.0f}px')
    page.fill('#pl-ob-fl', '4'); page.select_option('#pl-ob-rf', 'shed')
    mb = page.query_selector('#pl-map').bounding_box(); mx, my = mb['x'] + mb['width'] * 0.3, mb['y'] + mb['height'] * 0.55
    for x, y in [(mx, my), (mx + 120, my), (mx + 120, my + 60), (mx + 60, my + 60), (mx + 60, my + 110), (mx, my + 110)]: page.mouse.click(x, y); time.sleep(0.2)
    page.screenshot(path=str(OUT / 'planner-building-drawing.png'))
    page.mouse.click(mx, my); time.sleep(0.6)  # clicking the first corner closes it
    hs = page.evaluate(HOUSES); nb = [o for o in hs if o.get('fromPlanner')]
    check('planner draws an L-shaped building', len(nb) == 1 and len(nb[0]['poly']) == 6 and nb[0]['floors'] == 4 and nb[0]['roof'] == 'shed', json.dumps(nb)[:300])
    page.screenshot(path=str(OUT / 'planner-building.png'))
    check('planner editor offers floors and roof', page.is_visible('#pl-sel-fl') and page.is_visible('#pl-sel-rf'))
    # --- save and reopen
    page.fill('#pl-name', 'Buildings test'); page.click('#pl-save'); time.sleep(0.4)
    before = sorted([json.dumps([o['poly'], o['floors'], o['roof'], round(o['dims']['height'], 3)]) for o in page.evaluate(HOUSES)])
    page.fill('#pl-chat-q', 'clear'); page.press('#pl-chat-q', 'Enter'); time.sleep(0.6)
    page.evaluate('() => { __arien.state.objects.length = 0; }')
    page.click('.pl-left .saved-list .saved-open >> text=Buildings test'); time.sleep(2.5)
    after = sorted([json.dumps([o['poly'], o['floors'], o['roof'], round(o['dims']['height'], 3)]) for o in page.evaluate(HOUSES)])
    check('buildings reopen with plan, floors and roof', before == after and len(after) == 2, f'{len(before)} -> {len(after)}')
    # --- report / dashboard data carry the floor plan
    page.click('#pl-sim'); time.sleep(5)
    page.screenshot(path=str(OUT / 'twin-buildings.png'))
    errs = [l for l in logs if 'net::ERR_FAILED' not in l and '401' not in l]
    check('no page errors', not errs, ' | '.join(errs)[:600])
    b.close()
fails = [k for k, v in results.items() if not v]
print(f'{len(results) - len(fails)} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
