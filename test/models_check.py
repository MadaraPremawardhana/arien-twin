"""Render every obstacle type at each level of detail and check sizes and LOD switching.
Usage: ARIEN_DEPS=... python3 test/models_check.py <outdir>"""
import json, sys, time
from pathlib import Path
src = Path(__file__).with_name('run_browser.py').read_text()
ns = {'__file__': str(Path(__file__).with_name('run_browser.py'))}
argv = sys.argv; sys.argv = [argv[0], argv[1] if len(argv) > 1 else '/tmp/arien-models', 'none']
exec(src.split('with sync_playwright() as p:')[0], ns)
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 860}); ctx.route('**/*', ns['handle'])
    page = ctx.new_page(); logs = []
    page.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)[:300]))
    page.on('console', lambda m: logs.append(m.type + ' ' + m.text[:200]) if m.type in ('error', 'warning') else None)
    page.goto((ROOT / 'index.html').as_uri())
    page.wait_for_function('() => window.__arien', timeout=60000)
    page.select_option('#s-src', 'none'); page.click('#s-world')
    page.wait_for_function('() => document.getElementById("step-wx").dataset.state === "active"', timeout=120000)
    page.click('#s-wx')
    page.wait_for_function('() => document.getElementById("boot").classList.contains("gone") && window.__arien.state.run', timeout=120000)
    # triangle counts per type and LOD, and bounding boxes against the dimensions
    stats = page.evaluate('''() => { const out = {}; const T = THREE;
        for (const [k, t] of Object.entries(ArienPhysics.OBJECT_TYPES)) { out[k] = [];
          for (let lod = 0; lod < 3; lod++) { const g = ArienModels.buildGroup(k, t.dims, lod); const bb = new T.Box3().setFromObject(g);
            const sz = bb.getSize(new T.Vector3()); out[k].push({tris: ArienModels.triangleCount(g), size: [+sz.z.toFixed(2), +sz.x.toFixed(2), +sz.y.toFixed(2)], dims: [t.dims.length, t.dims.width, t.dims.height]}); } }
        return out; }''')
    for k, v in stats.items():
        print(f"{k:9s}", ' | '.join(f"LOD{i}: {s['tris']:>6} tris, E×N×U {s['size'][0]}×{s['size'][1]}×{s['size'][2]} (dims {s['dims'][0]}×{s['dims'][1]}×{s['dims'][2]})" for i, s in enumerate(v)))
    # place one of each type in a row south of the array
    page.evaluate('''() => { const s = window.__arien.state; const types = Object.keys(ArienPhysics.OBJECT_TYPES);
        window.__arien.placeObjects(types.map((t, i) => ({ type: t, x: -18 + i * 6, y: -16, z: 0 }))); }''')
    time.sleep(6)
    def cam(dist, x=0, y=-16, h=3):
        page.evaluate(f'''() => {{ const v = window.__arien.viewer(); const s = window.__arien.state;
            const c = window.__arien.enu2ecef({x}, {y}, {h});
            v.camera.lookAt(c, new Cesium.HeadingPitchRange(0.0, -0.25, {dist})); }}''')
    for name, dist, x in [('far', 220, 0), ('mid', 45, 0), ('near-tree', 11, -12), ('near-conifer', 13, -6), ('near-wall', 9, 0), ('near-building', 26, 18)]:
        cam(dist, x); time.sleep(4); cam(dist, x); time.sleep(3)
        lods = page.evaluate('() => window.__arien.state.objects.map(o => o.type + ":" + window.__arien.lodOf(o.id)).join(" ")')
        print(f"{name:14s} LODs: {lods}")
        page.screenshot(path=str(OUT / f'model-{name}.png'))
    print('console:', [l for l in logs if 'GLTFExporter' not in l][:12])
    b.close()
