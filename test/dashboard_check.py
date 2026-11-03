"""Headless check of design focus, the Dashboard tab and the PDF report.
Usage: ARIEN_DEPS=... python3 test/dashboard_check.py <outdir>   (needs jspdf@2.5.1 in ARIEN_DEPS; pdftoppm/pdftotext optional)"""
import json, shutil, subprocess, sys, time
from pathlib import Path
src_file = Path(__file__).with_name('run_browser.py')
ns = {'__file__': str(src_file)}
argv = sys.argv; sys.argv = [argv[0], argv[1] if len(argv) > 1 else '/tmp/arien-dashboard', 'none']
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
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True); ctx.route('**/*', ns['handle'])
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
    # --- design away from the site centre, then Simulate: the camera should frame the panels
    page.click('#rail button[data-view="design"]'); time.sleep(1.2)
    page.fill('#pl-chat-q', 'clear'); page.press('#pl-chat-q', 'Enter'); time.sleep(0.5)
    page.evaluate('''() => { const s = __arien.state; }''')
    page.fill('#pl-chat-q', '12 panels south-facing at 35°'); page.press('#pl-chat-q', 'Enter')
    page.wait_for_function('() => /Placed/.test(document.querySelector("#pl-chat").lastElementChild.textContent)', timeout=30000)
    # move the block 45 m east and 30 m north of the site centre
    page.evaluate('''() => { const s = __arien.state; s.arrays.forEach(a => { a.x += 45; a.y += 30; }); s.zones.forEach(z => { z.poly = z.poly.map(p => [p[0] + 45, p[1] + 30]); }); }''')
    page.fill('#pl-chat-q', 'add a tree 9 m south, 10 m tall'); page.press('#pl-chat-q', 'Enter'); time.sleep(0.6)
    page.evaluate('() => ArienPlanner.focusDesign(false)'); time.sleep(0.6)
    fit = page.evaluate('''() => { const m = ArienPlanner._map(), a = __arien.state.arrays[0], s = __arien.state.site;
        const ll = L.latLng(s.lat + a.y / 111250, s.lon + a.x / (111320 * Math.cos(s.lat * Math.PI / 180))); return m.getBounds().contains(ll); }''')
    check('planner map fits the design', fit)
    page.screenshot(path=str(OUT / '01-planner.png'))
    check('result cards draw with Chart.js, not outlined SVG bars', page.evaluate('() => !document.querySelector("svg.bars")'))
    page.click('#pl-sim'); time.sleep(7)
    foc = page.evaluate('''() => { const v = __arien.viewer(), b = __arien.designBounds(); const c = __arien.enu2ecef(b.c[0], b.c[1], b.c[2]);
        const w = Cesium.SceneTransforms.worldToWindowCoordinates ? Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, c) : Cesium.SceneTransforms.wgs84ToWindowCoordinates(v.scene, c);
        const cv = v.scene.canvas; const dist = Cesium.Cartesian3.distance(v.camera.positionWC, c);
        return { x: w && w.x / cv.clientWidth, y: w && w.y / cv.clientHeight, dist, heading: v.camera.heading * 180 / Math.PI }; }''')
    check('Simulate frames the design (centred, close, from the front)', foc['x'] and 0.3 < foc['x'] < 0.7 and 0.25 < foc['y'] < 0.75 and foc['dist'] < 120 and (foc['heading'] < 25 or foc['heading'] > 335), json.dumps(foc))
    page.screenshot(path=str(OUT / '02-twin-focused.png'))
    page.wait_for_function('() => __arien.state.yieldRes && !__arien.state.yieldRes.stale', timeout=180000)
    check('yield runs in the background after Simulate', True)
    check('side panel renamed Analysis', page.inner_text('#btn-dash').strip().lower() == 'analysis')
    # --- dashboard
    page.click('#rail button[data-view="dashboard"]')
    page.wait_for_selector('#db-overview .kpi', timeout=120000); time.sleep(1.5)
    kp = page.evaluate('() => [...document.querySelectorAll("#db-overview .kpi")].map(k => [k.querySelector(".kpi-label").textContent, k.querySelector(".kpi-value").textContent])')
    labels = [k[0] for k in kp]
    check('overview has the eight figures', labels == ['System capacity', 'Panels', 'Estimated annual production', 'Estimated annual savings', 'CO₂ reduction', 'Estimated payback', 'Lifetime return', 'Battery storage'], json.dumps(kp))
    sav = page.inner_text('#db-overview .kpi:nth-child(4) .kpi-sub')
    check('savings explain how they are made', 'on bills' in sav and 'export income' in sav, sav.replace('\n', ' | '))
    charts = page.evaluate('() => ["db-today-chart", "db-finance-chart", "db-monthly-chart"].map(id => !!(window.Chart && Chart.getChart(document.getElementById(id))))')
    check('today, finance and monthly charts drawn', all(charts), str(charts))
    nb = page.evaluate('() => { const c = Chart.getChart(document.getElementById("db-monthly-chart")); return c.data.datasets[0].borderWidth; }')
    check('bars have no outline', nb == 0, str(nb))
    rec = page.evaluate('() => [...document.querySelectorAll(".reco-day")].map(d => d.querySelector("b").textContent + ": " + [...d.querySelectorAll("li")].map(li => li.querySelector(".dev").textContent + " " + li.querySelector(".when").textContent).join(", "))')
    check('recommendations for today and the next days', len(rec) >= 2 and 'Washing machine' in rec[0], ' || '.join(rec)[:400])
    f10 = page.inner_text('#db-finance .fin-sum')
    page.click('#db-horizon button[data-h="20"]'); time.sleep(0.6)
    f20 = page.inner_text('#db-finance .fin-sum')
    n20 = page.evaluate('() => Chart.getChart(document.getElementById("db-finance-chart")).data.labels.length')
    check('financial period toggle (10 → 20 years)', f10 != f20 and n20 == 20, f20.replace('\n', ' '))
    s0 = page.evaluate('() => ArienDashboard._compute().y1.selfSaving')
    page.fill('#db-assume input[data-k="importPrice"]', '35'); page.dispatch_event('#db-assume input[data-k="importPrice"]', 'change'); time.sleep(0.6)
    s1 = page.evaluate('() => ArienDashboard._compute().y1.selfSaving')
    check('editing an assumption updates the figures', abs(s1 / s0 - 35 / 26.32) < 1e-6, f'{s0:.1f} → {s1:.1f}')
    page.click('#db-as-reset'); time.sleep(0.5)
    page.screenshot(path=str(OUT / '03-dashboard-top.png'))
    page.evaluate('() => document.querySelector("#db-finance").scrollIntoView()'); time.sleep(0.5)
    page.screenshot(path=str(OUT / '04-dashboard-finance.png'))
    page.evaluate('() => document.querySelector("#db-monthly").scrollIntoView()'); time.sleep(0.5)
    page.screenshot(path=str(OUT / '05-dashboard-monthly.png'))
    foot = page.inner_text('#db-foot')
    check('footer: generated date and weather sources', 'Generated' in foot and 'ERA5' in foot and 'Open-Meteo' in foot, foot.replace('\n', ' | ')[:240])
    # --- my sites
    page.evaluate('() => __arien.saveNamedSite("")'); time.sleep(0.4); page.evaluate('() => ArienDashboard.show()'); time.sleep(0.8)
    nsites = page.evaluate('() => document.querySelectorAll("#db-sites .site-list li").length')
    check('My sites lists saved designs', nsites >= 1, str(nsites))
    # --- PDF report
    with page.expect_download(timeout=120000) as dl:
        page.click('#db-pdf')
    d = dl.value; pdf = OUT / 'report.pdf'; d.save_as(str(pdf))
    info = page.evaluate('() => window.__arienLastReport')
    check('PDF report downloads (5 pages)', info and info['pages'] == 5 and pdf.stat().st_size > 50000, json.dumps(info))
    if shutil.which('pdftotext'):
        txt = subprocess.run(['pdftotext', str(pdf), '-'], capture_output=True, text=True).stdout
        import zlib, re
        raw = pdf.read_bytes(); marks = 0
        for st in re.findall(rb'stream\r?\n(.*?)\r?\nendstream', raw, re.S):
            try: marks += b'Generated by Arien' in zlib.decompress(st)
            except Exception: pass
        check('watermark on every page', marks == 5, f'{marks} pages')
        need = ['PV array layout', 'System specification', 'Monthly yield', '7-day forecast', 'Financial summary', 'Assumptions', 'Weather data:', 'Scale 1:', 'Ofgem']
        miss = [n for n in need if n not in txt]
        check('PDF has every section, watermark and footer', not miss, 'missing: ' + ', '.join(miss))
    if shutil.which('pdftoppm'):
        subprocess.run(['pdftoppm', '-r', '70', '-png', str(pdf), str(OUT / 'report')], check=False)
    # --- open a saved site from the dashboard
    page.click('#db-sites [data-open][data-view="design"]'); time.sleep(2.5)
    check('Edit design opens the saved site in the planner', page.evaluate('() => __arien.state.view') == 'design')
    # phone width
    page.set_viewport_size({'width': 390, 'height': 844}); page.evaluate('() => __arien.setView("dashboard")'); time.sleep(1.5)
    page.screenshot(path=str(OUT / '06-dashboard-phone.png'))
    check('no horizontal scroll at phone width', not page.evaluate('() => document.documentElement.scrollWidth > window.innerWidth + 1'))
    errs = [l for l in logs if 'net::ERR_FAILED' not in l and '401' not in l]
    check('no page errors', not errs, ' | '.join(errs)[:600])
    b.close()
fails = [k for k, v in results.items() if not v]
print(f'{len(results) - len(fails)} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
