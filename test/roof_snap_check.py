"""Headless check: an array dragged onto a pitched roof takes the roof's pitch and facing and mounts flush.
Usage: ARIEN_DEPS=... python3 test/roof_snap_check.py <outdir>"""
import json, sys, time
from pathlib import Path
src_file = Path(__file__).with_name('run_browser.py')
ns = {'__file__': str(src_file)}
argv = sys.argv; sys.argv = [argv[0], argv[1] if len(argv) > 1 else '/tmp/arien-roofsnap', 'none']
exec(src_file.read_text().split('with sync_playwright() as p:')[0], ns)
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
results = {}
def check(name, cond, detail=''):
    results[name] = bool(cond)
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))

SCREEN = '''([x, y, z]) => { const ST = Cesium.SceneTransforms, f = ST.worldToWindowCoordinates || ST.wgs84ToWindowCoordinates;
  const w = f(__arien.viewer().scene, __arien.enu2ecef(x, y, z)); const r = __arien.viewer().canvas.getBoundingClientRect(); return [r.left + w.x, r.top + w.y]; }'''
A0 = '() => { const a = __arien.state.arrays[0]; return { x: a.x, y: a.y, z: a.z, tilt: a.tilt, az: a.azimuth, flush: !!a.flush, mount: a.mountHeight, rows: a.rows, cols: a.cols }; }'
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
    # a gable house east of the panels (ridge along east–west: faces south and north), and a flat-roofed one
    page.evaluate('''() => { const P = ArienPhysics, S = __arien.state;
      S.objects = S.objects.filter(o => o.type !== 'tree');
      const g = P.buildingFromOutline([[24, -6], [40, -6], [40, 4], [24, 4]], { floors: 2, roof: 'gable' });
      S.objects.push({ id: 'hg', type: 'house', z: 0, porosity: 0, worldSrc: 'none', ...g });
      const f = P.buildingFromOutline([[-40, -6], [-26, -6], [-26, 4], [-40, 4]], { floors: 2, roof: 'flat' });
      S.objects.push({ id: 'hf', type: 'house', z: 0, porosity: 0, worldSrc: 'none', ...f });
      __arien.rebuild();
      const v = __arien.viewer(), c = __arien.enu2ecef(0, -45, 75), t = __arien.enu2ecef(0, 0, 2);
      const dir = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(t, c, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      v.camera.setView({ destination: c, orientation: { direction: dir, up: Cesium.Cartesian3.normalize(c, new Cesium.Cartesian3()) } }); }''')
    time.sleep(3)
    a0 = page.evaluate(A0)
    def drag_to(target):
        c = page.evaluate('() => ArienPhysics.buildArrayGeometry(__arien.state.arrays[0]).panels[2].c')  # a panel's centre, not the gap between rows
        sx, sy = page.evaluate(SCREEN, c)
        page.evaluate('() => document.activeElement && document.activeElement.blur()')
        if page.is_visible('#drawer'): page.keyboard.press('Escape'); time.sleep(0.2)
        for _ in range(3):  # select (retry: the first frames after a rebuild may not be pickable yet)
            page.mouse.click(sx, sy); time.sleep(0.5)
            if page.evaluate('() => !!(__arien.state.sel && __arien.state.sel.kind === "array")'): break
        page.evaluate('() => document.activeElement && document.activeElement.blur()')
        if page.is_visible('#drawer'): page.keyboard.press('Escape'); time.sleep(0.2)  # close the drawer (it covers the left of the view); the array stays selected
        page.mouse.move(sx, sy); page.mouse.down(); time.sleep(0.1)
        tx, ty = page.evaluate(SCREEN, target)
        for k in range(1, 11): page.mouse.move(sx + (tx - sx) * k / 10, sy + (ty - sy) * k / 10); time.sleep(0.04)
        page.mouse.up(); time.sleep(1.2)
        if not page.is_visible('#drawer'): page.click('#rail button[data-panel="panels"]'); time.sleep(0.3)
    # --- onto the south slope of the gable roof
    roof = page.evaluate('() => ArienPhysics.roofAt(__arien.state.objects.find(o => o.id === "hg"), 32, -3)')
    drag_to([32, -3, roof['z']])
    a = page.evaluate(A0)
    check('selected the array', page.evaluate('() => __arien.state.sel && __arien.state.sel.kind') == 'array')
    check('dragged onto the roof: pitch 35°, facing south, flush', abs(a['tilt'] - 35) < 0.05 and a['az'] == 180 and a['flush'], json.dumps(a))
    on = page.evaluate('''() => { const a = __arien.state.arrays[0], o = __arien.state.objects.find(o => o.id === "hg"), g = ArienPhysics.buildArrayGeometry(a);
        return g.panels.map(p => { const r = ArienPhysics.roofAt(o, p.c[0], p.c[1]); return r && r.azimuth === 180 ? +(p.c[2] - r.z).toFixed(4) : null; }).filter(v => v !== null); }''')
    check('every panel lies 0.1 m above the roof face', len(on) > 0 and all(abs(v - 0.1) < 1e-3 for v in on), json.dumps(on[:8]))
    check('editor says flush on the roof', 'Flush on the roof' in page.inner_text('#arr-roof-note') and 'Snapped to the roof' in page.inner_text('#toasts'), page.inner_text('#arr-roof-note'))
    page.screenshot(path=str(OUT / 'snapped-south.png'))
    # --- onto the north slope: faces north
    nroof = page.evaluate('() => ArienPhysics.roofAt(__arien.state.objects.find(o => o.id === "hg"), 32, 2)')
    drag_to([32, 2, nroof['z']])
    a = page.evaluate(A0)
    page.screenshot(path=str(OUT / 'snapped-north.png'))
    check('north slope: faces north', abs(a['tilt'] - 35) < 0.05 and a['az'] == 0 and a['flush'], json.dumps(a))
    # --- back onto the ground: racked again, standing on the ground
    drag_to([0, -12, 0])
    a = page.evaluate(A0)
    check('back on the ground: racked, at ground height', not a['flush'] and abs(a['z'] - page.evaluate('() => __arien.state.site.groundZ')) < 0.05, json.dumps(a))
    # --- flat roof keeps the tilt
    page.evaluate('() => { const a = __arien.state.arrays[0]; a.tilt = 20; a.azimuth = 170; }')
    fl = page.evaluate('() => ArienPhysics.roofAt(__arien.state.objects.find(o => o.id === "hf"), -33, -1)')
    drag_to([-33, -1, fl['z']])
    a = page.evaluate(A0)
    check('flat roof: keeps tilt and facing, sits on the roof', a['tilt'] == 20 and a['az'] == 170 and not a['flush'] and abs(a['z'] - fl['z']) < 1e-6, json.dumps(a))
    # --- manual tilt makes a flush array racked; the snap toggle off leaves the angle alone
    drag_to([32, -3, roof['z']])
    page.evaluate('() => { const el = document.querySelector("#arr-tilt"); el.value = 30; el.dispatchEvent(new Event("input")); }'); time.sleep(0.5)
    check('changing tilt by hand makes it racked', not page.evaluate(A0)['flush'] and page.evaluate(A0)['tilt'] == 30, json.dumps(page.evaluate(A0)))
    page.click('#arr-snap-now'); time.sleep(0.5)
    check('"Snap to the roof here" restores the roof angle', abs(page.evaluate(A0)['tilt'] - 35) < 0.05 and page.evaluate(A0)['flush'])
    page.uncheck('#arr-snap'); drag_to([32, 2, nroof['z']])
    check('snap off: the angle stays as it was', page.evaluate(A0)['az'] == 180)
    # --- placing a new array straight onto a roof snaps it too
    page.check('#arr-snap')
    n0 = page.evaluate('() => __arien.state.arrays.length')
    if not page.is_visible('#arr-place'): page.click('#rail button[data-panel="panels"]'); time.sleep(0.3)
    add = page.query_selector('#arr-place')
    if add:
        add.click(); time.sleep(0.2)
        px, py = page.evaluate(SCREEN, [36, 2, nroof['z']]); page.mouse.click(px, py); time.sleep(1)
        na = page.evaluate('() => { const a = __arien.state.arrays[__arien.state.arrays.length - 1]; return { tilt: a.tilt, az: a.azimuth, flush: !!a.flush }; }')
        check('a new array placed on a roof snaps', page.evaluate('() => __arien.state.arrays.length') == n0 + 1 and na['az'] == 0 and na['flush'], json.dumps(na))
    page.screenshot(path=str(OUT / 'snapped-final.png'))
    errs = [l for l in logs if 'net::ERR_FAILED' not in l and '401' not in l]
    check('no page errors', not errs, ' | '.join(errs)[:600])
    b.close()
fails = [k for k, v in results.items() if not v]
print(f'{len(results) - len(fails)} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
