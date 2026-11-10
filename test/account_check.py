"""The twin inside the ARIEN web app: account sites, saving, plan limit, results, delete, designer sites, import, and
a foreign page that embeds the twin. The parent page runs a copy of the message handler arien.base44.app published on
10 Nov 2026 (same checks, fields and replies) over an in-memory SolarSite store.
Usage: ARIEN_DEPS=... python3 test/account_check.py <outdir>"""
import json, sys, time
from pathlib import Path
src = Path(__file__).with_name('run_browser.py').read_text()
ns = {'__file__': str(Path(__file__).with_name('run_browser.py'))}
argv = sys.argv; sys.argv = [argv[0], argv[1] if len(argv) > 1 else '/tmp/arien-account', 'none']
exec(src.split('with sync_playwright() as p:')[0], ns)
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / 'index.html').read_text()
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
TWIN = 'https://madarapremawardhana.github.io/arien-twin/'
CONFIG = {'version': 1, 'updated': '2026-11-10T12:00:00Z', 'autoConnect': True, 'site': {'name': 'Buckingham, UK', 'lat': 51.9956, 'lon': -0.9906},
          'world': {'src': 'none'}, 'weather': {'mode': 'forecast'}}
results = {}
def check(name, cond, detail=''):
    results[name] = bool(cond)
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))

LAT, LON = 51.9956435, -0.9906259
S1_SCENE = {'v': 1, 'site': {'name': 'Buckingham, UK', 'lat': LAT, 'lon': LON}, 'designName': 'Garage', 'finance': {}, 'zones': [],
            'arrays': [{'id': 'aS1', 'name': 'Garage roof', 'x': 0, 'y': 0, 'z': 0, 'azimuth': 180, 'tilt': 35, 'rows': 2, 'cols': 5, 'panelModel': 'longi-himo6-430',
                        'panelW': 1.134, 'panelL': 1.722, 'eff': 0.22, 'gammaPct': -0.29, 'cellsX': 6, 'cellsY': 18, 'colGap': 0.02, 'rowPitch': 3.2, 'mountHeight': 0.15,
                        'landscape': False, 'worldSrc': 'none'}],
            'objects': [{'id': 'oS1', 'type': 'tree', 'x': 6, 'y': -9, 'z': 0, 'heading': 0, 'dims': {'length': 5, 'width': 5, 'height': 8}, 'porosity': 0.3, 'worldSrc': 'none'}]}
S1 = {'id': 'S1', 'name': 'Garage', 'latitude': LAT, 'longitude': LON, 'panel_count': 10, 'tilt_deg': 35, 'azimuth_deg': 180, 'capacity_kwp': 4.3,
      'twin_scene': S1_SCENE, 'source': 'twin', 'created_by': 'someone@example.com', 'updated_date': '2026-11-09T10:00:00Z'}
# a site drawn in the web designer: 6 panels in one row facing south-west, a building to the south
def ll(x, y): return {'lat': 52.1 + y / 111320, 'lng': -1.2 + x / (111320 * 0.6134)}
S2 = {'id': 'S2', 'name': 'Barn (web)', 'latitude': 52.1, 'longitude': -1.2, 'panel_count': 6, 'tilt_deg': 25, 'azimuth_deg': 200, 'panel_model': 'rec_alpha',
      'panel_watt': 430, 'import_tariff_p': 25.1, 'updated_date': '2026-11-10T09:00:00Z', 'created_by': 'someone@example.com',
      'panels_json': json.dumps([{'id': i, 'latlng': ll(-3 + i * 1.04, 0), 'modelId': 'rec_alpha'} for i in range(6)]),
      'obstructions': [{'polygon': [ll(-4, -9), ll(4, -9), ll(4, -15), ll(-4, -15)], 'height_m': 6, 'label': 'Neighbour house'}]}

PARENT = """<!doctype html><html><head><meta charset="utf-8"><title>Arien web app (test)</title></head><body style="margin:0">
<iframe id="tw" src="%(src)s" allow="geolocation; clipboard-write; fullscreen" style="display:block;width:100%%;height:100vh;border:0"></iframe>
<script>
const KF = "https://madarapremawardhana.github.io", SRC = "arien-twin", PSRC = "arien-base44", MAX = 500 * 1024;
const FIELDS = ["name","latitude","longitude","panel_count","panel_watt","capacity_kwp","tilt_deg","azimuth_deg","system_losses_pct","import_tariff_p","export_tariff_p","install_cost_gbp","obstructions","shading_pct","annual_kwh_cached","twin_scene","twin_results"];
const store = window.__store = { sites: %(sites)s, user: { id: "u1", full_name: "Madara Premawardhana", plan: "%(plan)s", last_site_id: null }, log: [], navigated: null };
let nextId = 1; const now = () => new Date().toISOString();
const limitFor = (plan) => plan === "household" ? 1 : Infinity;
const size = (t) => { try { return new TextEncoder().encode(JSON.stringify(t)).length; } catch { return Infinity; } };
const summary = (t) => ({ id: t.id, name: t.name, latitude: t.latitude, longitude: t.longitude, capacity_kwp: t.capacity_kwp, panel_count: t.panel_count, updated_date: t.updated_date, has_twin_scene: !!(t.twin_scene && Object.keys(t.twin_scene).length > 0) });
const full = (t) => { if (!t) return null; const { created_by, ...e } = JSON.parse(JSON.stringify(t)); if (!e.twin_scene && e.panels_json) { try { e.panel_positions = JSON.parse(e.panels_json); } catch { e.panel_positions = null; } } return e; };
const list = () => store.sites.slice().sort((a, b) => String(b.updated_date).localeCompare(String(a.updated_date)));
const get = (id) => { const s = store.sites.find(x => x.id === id); if (!s) throw new Error("404"); return s; };
async function save(t) {
  const n = t.fields || {}, r = {};
  FIELDS.forEach(a => { n[a] !== undefined && (r[a] = n[a]); });
  t.name !== undefined && (r.name = t.name); t.twin_scene !== undefined && (r.twin_scene = t.twin_scene); t.twin_results !== undefined && (r.twin_results = t.twin_results);
  r.source = "twin"; r.twin_saved_at = now();
  if (t.id) { const s = get(t.id); Object.assign(s, r, { updated_date: now() }); store.user.last_site_id = s.id; return { ok: true, id: s.id, name: s.name }; }
  if (store.sites.length >= limitFor(store.user.plan)) return { ok: false, reason: "limit" };
  r.panel_count === undefined && (r.panel_count = 0);
  const s = { id: "N" + (nextId++), created_by: "someone@example.com", created_date: now(), updated_date: now(), ...r }; store.sites.push(s); store.user.last_site_id = s.id;
  return { ok: true, id: s.id, name: s.name };
}
async function handle(t, openSiteId) {
  const r = { source: PSRC, id: t.id }; store.log.push(t.type);
  switch (t.type) {
    case "hello": { const a = t.site || openSiteId, l = a ? full(store.sites.find(u => u.id === a)) : null, c = store.user.full_name.trim();
      return { ...r, type: "session", user: { id: store.user.id, first_name: c ? c.split(/\\s+/)[0] : "", plan: store.user.plan }, sites: list().map(summary), open: l, siteLimit: Number.isFinite(limitFor(store.user.plan)) ? limitFor(store.user.plan) : null }; }
    case "site.list": return { ...r, type: t.type, sites: list().map(summary) };
    case "site.get": return { ...r, type: t.type, site: full(get(t.id)) };
    case "site.save": return { ...r, type: t.type, ...(await save(t)) };
    case "site.results": { const s = get(t.id); s.cached_at = now(); s.updated_date = now(); t.twin_results !== undefined && (s.twin_results = t.twin_results); t.annual_kwh !== undefined && (s.annual_kwh_cached = t.annual_kwh); return { ...r, type: t.type, ok: true }; }
    case "site.delete": get(t.id); store.sites = store.sites.filter(x => x.id !== t.id); return { ...r, type: t.type, ok: true };
    case "navigate": typeof t.path == "string" && t.path.startsWith("/") && (store.navigated = t.path); return { ...r, type: t.type, ok: true };
    default: return null;
  }
}
const openSiteId = new URLSearchParams(location.search).get("siteId");
window.addEventListener("message", async (a) => {
  if (a.origin !== KF) return;
  const l = document.getElementById("tw").contentWindow;
  if (!l || a.source !== l || !(a.data && typeof a.data == "object" && a.data.source === SRC) || size(a.data) > MAX) return;
  let c; try { c = await handle(a.data, openSiteId); } catch { c = { source: PSRC, id: a.data && a.data.id, type: a.data && a.data.type, ok: !1 }; }
  c && l.postMessage(c, KF);
});
</script></body></html>"""

EVIL = """<!doctype html><html><body style="margin:0"><iframe id="tw" src="%s" style="width:100%%;height:100vh;border:0"></iframe>
<script>window.__got = []; addEventListener("message", e => window.__got.push(e.data));</script></body></html>"""

def context(b, parent_html, host='https://arien.base44.app/'):
    def route(r):
        u = r.request.url
        if u.startswith(host) and not u.startswith(TWIN):
            return r.fulfill(status=200, body=parent_html, headers={'content-type': 'text/html'})
        if u.startswith(TWIN):
            path = u.split('?')[0].split('#')[0]
            if path.endswith('config.json'): return r.fulfill(status=200, body=json.dumps(CONFIG), headers={'content-type': 'application/json'})
            if path.endswith('/arien-twin/') or path.endswith('index.html'): return r.fulfill(status=200, body=HTML, headers={'content-type': 'text/html'})
            return r.fulfill(status=404, body='not found')
        return ns['handle'](r)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}); ctx.route('**/*', route)
    page = ctx.new_page(); logs = []
    page.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)[:300]))
    page.on('console', lambda m: logs.append(m.type + ' ' + m.text[:200]) if m.type == 'error' else None)
    return ctx, page, logs

def twin(page):
    for _ in range(200):
        for f in page.frames:
            if f.url.startswith(TWIN): return f
        time.sleep(0.1)
    raise RuntimeError('twin frame not found')

def wait_twin(fr, cond='true', timeout=120000):
    fr.wait_for_function(f'() => window.__arien && document.getElementById("boot").classList.contains("gone") && ({cond})', timeout=timeout)

def store(page): return page.evaluate('() => JSON.parse(JSON.stringify(window.__store))')
def wait_store(page, js, timeout=30000): page.wait_for_function(f'() => {{ const s = window.__store; return {js}; }}', timeout=timeout)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])

    # ---- A: household account with one twin-made site, opened by id
    ctx, page, logs = context(b, PARENT % {'src': TWIN + '?embed=base44&site=S1#design', 'sites': json.dumps([S1]), 'plan': 'household'})
    page.goto('https://arien.base44.app/twin?siteId=S1'); fr = twin(page)
    wait_twin(fr, '__arien.state.account && __arien.state.accountSiteId === "S1"')
    st = fr.evaluate('''() => { const s = __arien.state; return { name: s.designName, arrays: s.arrays.length, panels: s.arrays.reduce((t, a) => t + a.rows * a.cols, 0), obj: s.objects.map(o => [o.type, o.porosity]),
        lat: s.site.lat, note: (document.querySelector('.saved-list .acct-note') || {}).textContent || '', items: [...document.querySelectorAll('.saved-list .saved-open')].map(b => b.textContent) }; }''')
    check('opens the account site it was given', st['name'] == 'Garage' and st['panels'] == 10 and st['obj'] == [['tree', 0.3]] and abs(st['lat'] - LAT) < 1e-9, json.dumps(st)[:300])
    check('saved list shows the account, signed-in name and plan', 'Madara' in st['note'] and 'Household' in st['note'] and any('Garage' in t for t in st['items']), st['note'])
    s0 = store(page)
    check('no email or token sent; only hello so far', s0['log'][:1] == ['hello'] and 'site.save' not in s0['log'])
    fr.wait_for_function('() => !__arien.state.accountDirty', timeout=20000)
    # forecast on the opened site → its results go to the account
    fr.evaluate('() => __arien.forecastWeek()')
    wait_store(page, 's.sites[0] && s.sites[0].twin_results && s.sites[0].twin_results.forecast_7d', 60000)
    r = store(page)['sites'][0]
    check('forecast results kept with the site', len(r['twin_results']['forecast_7d']) >= 6 and r['cached_at'] and r['twin_results']['engine'] == 'ARIEN twin', json.dumps(r['twin_results'])[:200])
    # save under the same name → updates S1
    fr.evaluate('() => __arien.saveNamedSite("")')
    wait_store(page, 's.sites[0].twin_saved_at')
    r = store(page)['sites'][0]
    ok_fields = r['id'] == 'S1' and r['panel_count'] == 10 and abs(r['capacity_kwp'] - 4.3) < 1e-6 and r['tilt_deg'] == 35 and len(r['obstructions']) == 1 and len(r['obstructions'][0]['polygon']) == 8 and r['twin_scene']['arrays'][0]['rows'] == 2
    check('save updates the same record with plain fields and the twin scene', ok_fields and r['source'] == 'twin', json.dumps({k: r.get(k) for k in ['id', 'panel_count', 'capacity_kwp', 'install_cost_gbp', 'import_tariff_p']}))
    # a new name on a 1-site plan → offer to replace, replace it
    fr.evaluate('() => __arien.saveNamedSite("Barn plan")')
    fr.wait_for_selector('.toast.with-actions', timeout=10000)
    t = fr.inner_text('.toast.with-actions')
    check('plan limit: offers replace or plans', 'Household plan keeps 1 site' in t and 'Replace' in t and 'See plans' in t, t.replace('\n', ' | ')[:200])
    page.screenshot(path=str(OUT / '01-limit.png'))
    fr.click('.toast.with-actions .btn.primary')
    wait_store(page, 's.sites.length === 1 && s.sites[0].name === "Barn plan"')
    check('replace keeps one site, renamed', store(page)['sites'][0]['id'] == 'S1')
    fr.evaluate('() => __arien.saveNamedSite("Another")'); fr.wait_for_selector('.toast.with-actions', timeout=10000)
    fr.click('.toast.with-actions >> text=See plans')
    wait_store(page, 's.navigated === "/plans"')
    check('See plans asks the web app to open /plans', True)
    # delete from the list, then save fresh
    fr.evaluate('() => document.querySelector(\'.saved-list .saved-del[data-id="S1"]\').click()')
    wait_store(page, 's.sites.length === 0')
    fr.wait_for_function('() => [...document.querySelectorAll(".saved-list")].every(l => /No saved sites yet/.test(l.textContent))', timeout=10000)
    check('delete removes it from the account and the list', fr.evaluate('() => __arien.state.accountSiteId') is None)
    fr.evaluate('() => __arien.saveNamedSite("Fresh")')
    wait_store(page, 's.sites.length === 1 && s.sites[0].name === "Fresh"')
    check('save after delete creates a new record', fr.evaluate('() => __arien.state.accountSiteId') == store(page)['sites'][0]['id'])
    # dashboard My sites shows the account
    fr.evaluate('() => __arien.setView("dashboard")'); time.sleep(1.5)
    card = fr.inner_text('#db-sites') if fr.query_selector('#db-sites') else ''
    check('dashboard My sites lists the account sites', 'ARIEN account' in card and 'Fresh' in card, card.replace('\n', ' | ')[:200])
    page.screenshot(path=str(OUT / '02-dashboard.png'))
    errs = [l for l in logs if 'net::ERR_FAILED' not in l and '404' not in l]
    check('A: no page errors', not errs, ' | '.join(errs)[:400])
    ctx.close()

    # ---- B: academic account, no site asked for: opens the latest site, a web-designer site, then imports a browser site
    ctx, page, logs = context(b, PARENT % {'src': TWIN + '?embed=base44#design', 'sites': json.dumps([S1, S2]), 'plan': 'academic'})
    page.goto('https://arien.base44.app/twin'); fr = twin(page)
    wait_twin(fr, '__arien.state.account && __arien.state.accountSiteId === "S2"')
    st = fr.evaluate('''() => { const s = __arien.state; return { name: s.designName, arrays: s.arrays.map(a => [a.rows * a.cols, a.panelModel, a.tilt, a.azimuth]), obj: s.objects.map(o => [o.type, o.dims.length, o.dims.width, o.dims.height]),
        lat: s.site.lat, imp: s.finance.importPrice }; }''')
    check('opens the latest account site built in the web designer', st['name'] == 'Barn (web)' and len(st['arrays']) == 1 and sum(a[0] for a in st['arrays']) == 6 and st['arrays'][0][1] == 'rec-alpha-430' and st['arrays'][0][2] == 25 and st['arrays'][0][3] == 200, json.dumps(st)[:300])
    o = st['obj'][0] if st['obj'] else None
    check('web obstruction becomes a building with its footprint and height', o and o[0] == 'building' and abs(o[1] - 8) < 0.1 and abs(o[2] - 6) < 0.1 and o[3] == 6, json.dumps(st['obj']))
    check('web tariff carried into the twin', st['imp'] == 25.1)
    # open the other site from the list
    fr.evaluate('() => document.querySelector(\'.saved-list .saved-open[data-id="S1"]\').click()')
    fr.wait_for_function('() => __arien.state.accountSiteId === "S1" && __arien.state.designName === "Garage"', timeout=30000)
    check('opening another account site from the list', fr.evaluate('() => __arien.state.objects.length') == 1)
    # a site saved only in this browser → offered once, copied in
    fr.evaluate('''() => localStorage.setItem("arien-twin-sites-v1", JSON.stringify([{ id: "loc1", name: "Old shed", auto: false, savedAt: new Date().toISOString(),
        snap: { v: 1, site: { name: "Shed", lat: 51.9, lon: -0.9 }, arrays: [{ x: 0, y: 0, z: 0, azimuth: 170, tilt: 30, rows: 1, cols: 4, panelModel: "longi-himo6-430", panelW: 1.134, panelL: 1.722, eff: 0.22, gammaPct: -0.29, cellsX: 6, cellsY: 18 }], objects: [] } }]))''')
    page.reload(); fr = twin(page)
    wait_twin(fr, '__arien.state.account')
    fr.wait_for_selector('.toast.with-actions >> text=Copy to my account', timeout=20000)
    fr.click('.toast.with-actions >> text=Copy to my account')
    wait_store(page, 's.sites.some(x => x.name === "Old shed" && x.panel_count === 4 && x.twin_scene)')
    check('sites saved in this browser copy into the account once', fr.evaluate('() => !!localStorage.getItem("arien-twin-import-u1")'))
    page.screenshot(path=str(OUT / '03-import.png'))
    errs = [l for l in logs if 'net::ERR_FAILED' not in l and '404' not in l]
    check('B: no page errors', not errs, ' | '.join(errs)[:400])
    ctx.close()

    # ---- C: another site embeds the twin: nothing is sent to it, the twin stays local and starts without waiting
    ctx, page, logs = context(b, EVIL % (TWIN + '?embed=base44&site=S1#design'), host='https://evil.example/')
    t0 = time.time(); page.goto('https://evil.example/'); fr = twin(page)
    wait_twin(fr)
    took = time.time() - t0
    got = page.evaluate('() => window.__got')
    check('a foreign page receives nothing', got == [], json.dumps(got)[:200])
    check('twin stays on browser saving there', fr.evaluate('() => __arien.state.account') is None and 'acct-note' not in fr.inner_html('.saved-list'))
    print(f'   (foreign embed boot {took:.1f} s)')
    ctx.close()
    b.close()
fails = [k for k, v in results.items() if not v]
print(f'{len(results) - len(fails)} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
