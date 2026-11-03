"""Headless check of dist/arien-twin-studio.html with CDN, map tiles and Open-Meteo served locally.
Usage: python3 test/run_browser.py <outdir> [scenario]
"""
import json, math, os, sys, time, zlib, struct, urllib.parse as up
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
# npm install cesium@1.146.0 three@0.147.0 chart.js@4.4.1 ; point ARIEN_DEPS at that node_modules
DEPS = Path(os.environ.get('ARIEN_DEPS', 'node_modules')).resolve()
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/arien-shots'); OUT.mkdir(parents=True, exist_ok=True)
SCEN = sys.argv[2] if len(sys.argv) > 2 else 'basic'

def png(r, g, b, size=256):
    raw = b''.join(b'\x00' + bytes([r, g, b]) * size for _ in range(size))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
TILE = png(178, 196, 160)
SAT = png(92, 104, 86)

def sun_alt(t, lat, lon):
    d = datetime.fromtimestamp(t, timezone.utc); n = d.timetuple().tm_yday
    g = 2 * math.pi * (n - 1) / 365
    decl = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g)
    h = d.hour + d.minute / 60 + lon / 15
    w = math.radians(15 * (h - 12)); p = math.radians(lat)
    return math.asin(math.sin(decl) * math.sin(p) + math.cos(decl) * math.cos(p) * math.cos(w))

def weather(qs):
    lat = float(qs['latitude'][0]); lon = float(qs['longitude'][0])
    vars_ = qs['hourly'][0].split(',')
    if 'start_date' in qs:
        t0 = datetime.fromisoformat(qs['start_date'][0]).replace(tzinfo=timezone.utc)
        t1 = datetime.fromisoformat(qs['end_date'][0]).replace(tzinfo=timezone.utc) + timedelta(hours=23)
    else:
        now = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        t0 = now - timedelta(days=int(qs.get('past_days', ['0'])[0]))
        t1 = now + timedelta(days=int(qs.get('forecast_days', ['7'])[0])) - timedelta(hours=1)
    times = []
    t = t0
    while t <= t1: times.append(int(t.timestamp())); t += timedelta(hours=1)
    out = {'time': times}
    for v in vars_:
        base = v.split('_previous_day')[0]; arr = []
        for ts in times:
            hrs = (ts - times[0]) / 3600
            N = min(1, max(0, 0.5 + 0.48 * math.sin(hrs / 9.0)))
            rain = 1.8 if N > 0.9 else 0.0
            alt = sun_alt(ts - 1800, lat, lon)
            clear = max(0, 1050 * math.sin(alt) ** 1.15) if alt > 0 else 0
            ghi = clear * (1 - 0.75 * N ** 3.4)
            dhi = ghi * min(1, 0.3 + 0.7 * N * N)
            val = {'temperature_2m': 9 + 5 * math.sin((hrs % 24 - 9) / 24 * 2 * math.pi), 'relative_humidity_2m': 80,
                   'cloud_cover': round(N * 100), 'precipitation': rain, 'rain': rain, 'snowfall': 0.0,
                   'weather_code': 95 if (hrs % 40) == 20 else (61 if rain else (3 if N > 0.8 else 2 if N > 0.4 else 1)),
                   'wind_speed_10m': 4 + 2 * math.sin(hrs / 5), 'wind_direction_10m': (200 + hrs * 3) % 360,
                   'shortwave_radiation': round(ghi, 1), 'direct_radiation': round(ghi - dhi, 1), 'diffuse_radiation': round(dhi, 1),
                   'direct_normal_irradiance': round((ghi - dhi) / max(0.05, math.sin(alt)), 1) if alt > 0 else 0}[base]
            arr.append(val)
        out[v] = arr
    return {'latitude': lat, 'longitude': lon, 'elevation': 112.0, 'utc_offset_seconds': 0, 'timezone': 'Europe/London', 'timezone_abbreviation': 'GMT', 'hourly': out}

def serve_dep(route, base, rel):
    p = (DEPS / base / rel).resolve()
    if not p.exists(): return route.fulfill(status=404, body='missing')
    ct = 'application/javascript' if p.suffix == '.js' else 'text/css' if p.suffix == '.css' else 'application/json' if p.suffix == '.json' else 'application/octet-stream'
    if p.suffix in ('.png', '.jpg'): ct = 'image/' + p.suffix[1:]
    route.fulfill(status=200, body=p.read_bytes(), headers={'content-type': ct, 'access-control-allow-origin': '*'})

def handle(route):
    url = route.request.url; u = up.urlparse(url)
    if u.netloc == 'cdn.jsdelivr.net':
        path = u.path.replace('/npm/', '', 1)
        pkg, rel = path.split('/', 1)
        name = pkg.rsplit('@', 1)[0]
        return serve_dep(route, name, rel)
    if u.netloc == 'cdnjs.cloudflare.com' and '/jspdf/' in u.path:
        return serve_dep(route, 'jspdf', 'dist/' + u.path.rsplit('/', 1)[1])
    if u.netloc == 'cdnjs.cloudflare.com' and '/leaflet/' in u.path:
        return serve_dep(route, 'leaflet', 'dist/' + u.path.rsplit('/', 1)[1].replace('.min.', '.'))
    if u.netloc == 'server.arcgisonline.com':
        return route.fulfill(status=200, body=SAT, headers={'content-type': 'image/png', 'access-control-allow-origin': '*'})
    if u.netloc == 'api.postcodes.io':
        body = {'status': 200, 'result': {'postcode': 'MK18 1EG', 'latitude': 51.9989, 'longitude': -0.9872, 'admin_district': 'Buckinghamshire', 'parish': 'Buckingham', 'country': 'England'}}
        return route.fulfill(status=200, body=json.dumps(body), headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
    if u.netloc == 'nominatim.openstreetmap.org':
        q = up.parse_qs(u.query).get('q', [''])[0].lower()
        res = [{'lat': '51.5072', 'lon': '-0.1276', 'display_name': 'London, Greater London, England, United Kingdom', 'address': {'city': 'London'}}] if 'london' in q else \
              [{'lat': '51.9989', 'lon': '-0.9872', 'display_name': 'Buckingham, Buckinghamshire, England, United Kingdom', 'address': {'town': 'Buckingham'}}]
        return route.fulfill(status=200, body=json.dumps(res), headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
    if u.netloc == 'tile.openstreetmap.org':
        return route.fulfill(status=200, body=TILE, headers={'content-type': 'image/png', 'access-control-allow-origin': '*'})
    if 'open-meteo.com' in u.netloc:
        qs = up.parse_qs(u.query)
        if 'geocoding' in u.netloc:
            body = {'results': [{'name': 'Buckingham', 'admin1': 'England', 'country': 'United Kingdom', 'latitude': 51.9989, 'longitude': -0.987}]}
        else: body = weather(qs)
        return route.fulfill(status=200, body=json.dumps(body), headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
    if u.netloc == 'api.cesium.com':
        return route.fulfill(status=401, body='{"code":"InvalidCredentials","message":"Invalid access token"}', headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
    if u.scheme in ('file', 'data', 'blob'): return route.continue_()
    return route.abort()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True,
                          args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
    ctx.route('**/*', handle)
    if SCEN == 'sandbox':
        # mimic an embedded viewer that refuses blob: workers (the Claude preview error)
        ctx.add_init_script('''(() => { const OW = window.Worker; window.Worker = function (u, o) {
            if (String(u).startsWith('blob:')) throw new DOMException("Failed to construct 'Worker': Script at '" + u + "' cannot be accessed from origin", 'SecurityError');
            return new OW(u, o); }; window.Worker.prototype = OW.prototype; })();''')
    page = ctx.new_page()
    logs = []
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    page.goto((ROOT / 'index.html').as_uri())
    page.wait_for_function('() => window.__arien', timeout=60000); time.sleep(1.5)
    page.screenshot(path=str(OUT / '00-connect.png'))
    # step 1: an ion token that the (mocked) API rejects, to check the error path
    page.select_option('#s-src', 'ion'); page.fill('#s-ion', 'bad-token'); page.click('#s-world')
    page.wait_for_function('() => document.getElementById("s-world-msg").className.includes("err")', timeout=30000)
    print('ion error message:', page.evaluate('() => document.getElementById("s-world-msg").textContent'))
    page.select_option('#s-src', 'none'); page.click('#s-world')
    page.wait_for_function('() => document.getElementById("step-wx").dataset.state === "active"', timeout=120000)
    time.sleep(1.5); page.screenshot(path=str(OUT / '00b-world-loaded.png'))
    if SCEN == 'probe':
        print(page.evaluate('''() => { const v = window.__arien.viewer(); const c = v.camera.positionCartographic;
           return JSON.stringify({h: c.height, lat: c.latitude*180/Math.PI, lon: c.longitude*180/Math.PI, pitch: v.camera.pitch, t: Cesium.JulianDate.toDate(v.clock.currentTime).toISOString(), globe: v.scene.globe.tilesLoaded, light: v.scene.light && v.scene.light.intensity, render: v.useDefaultRenderLoop}); }'''))
        page.evaluate('() => { document.getElementById("boot").style.display = "none"; }'); time.sleep(1)
        page.screenshot(path=str(OUT / '00c-no-overlay.png')); b.close(); sys.exit(0)
    page.click('#s-wx')
    page.wait_for_function('() => document.getElementById("boot").classList.contains("gone") && window.__arien.state.run', timeout=120000)
    time.sleep(3)
    page.screenshot(path=str(OUT / '01-start.png'))
    info = page.evaluate('''() => { const s = window.__arien.state; return {
        kw: document.getElementById('hud-kw').textContent, sub: document.getElementById('hud-sub').textContent,
        wx: document.getElementById('hud-wx').textContent, clock: document.getElementById('t-clock').textContent,
        runKeys: s.run && s.run.keys, energy: s.run && s.run.energy, steps: s.run && s.run.times.length, ms: s.run && s.run.ms,
        reco: document.getElementById('reco').textContent, arrays: s.arrays.length, objects: s.objects.length } }''')
    print(json.dumps(info, indent=1))
    if SCEN == 'sandbox':
        print('worker fallback used:', page.evaluate('() => !!window.__arienWorkerFallback'),
              '| setup note:', page.evaluate('() => document.getElementById("setup-note").hidden ? "none" : document.getElementById("setup-note").textContent'),
              '| array primitive ready:', page.evaluate('() => { const v = window.__arien.viewer(); return v.scene.primitives._primitives.filter(p => p.geometryInstances !== undefined || p.ready).map(p => p.ready).join(",") }'))
    if SCEN in ('basic', 'full'):
        # find a sunny midday and a rainy hour in the run, and show them
        t_noon = page.evaluate('''() => { const r = window.__arien.state.run; let best = 0, bi = 0; r.kw.rwghi.forEach((v,i)=>{ if (v>best){best=v;bi=i;} }); return r.times[bi]; }''')
        page.evaluate(f'''() => {{ const v = window.__arien.viewer(); v.clock.currentTime = Cesium.JulianDate.fromDate(new Date({t_noon})); window.__arien.simulateNow(true); }}''')
        page.click('#btn-dash'); time.sleep(2.5)
        page.screenshot(path=str(OUT / '02-sunny-dashboard.png'))
        page.click('#btn-dash')
        t_rain = page.evaluate('''() => { const s = window.__arien.state.wx.series; for (let i=0;i<s.time.length;i++){ if (s.precip[i]>1 && s.time[i] > s.start + 3600e3) { const d=new Date(s.time[i]); const h=d.getUTCHours(); if (h>=10 && h<=15) return s.time[i]; } } return s.time[30]; }''')
        page.evaluate(f'''() => {{ const v = window.__arien.viewer(); v.clock.currentTime = Cesium.JulianDate.fromDate(new Date({t_rain})); window.__arien.simulateNow(true);
             v.camera.setView({{ destination: v.camera.position, orientation: {{ heading: v.camera.heading, pitch: -0.12, roll: 0 }} }}); }}''')
        time.sleep(2.5)
        page.screenshot(path=str(OUT / '03-rain-lookup.png'))
        # partial cloud, looking at sky
        t_pc = page.evaluate('''() => { const s = window.__arien.state.wx.series; for (let i=0;i<s.time.length;i++){ const d=new Date(s.time[i]); if (s.cloud[i]>45 && s.cloud[i]<70 && d.getUTCHours()===13) return s.time[i]; } return s.time[37]; }''')
        page.evaluate(f'''() => {{ const v = window.__arien.viewer(); v.clock.currentTime = Cesium.JulianDate.fromDate(new Date({t_pc})); window.__arien.simulateNow(true);
             v.camera.setView({{ destination: v.camera.position, orientation: {{ heading: v.camera.heading, pitch: 0.12, roll: 0 }} }}); }}''')
        time.sleep(2.5)
        page.screenshot(path=str(OUT / '04-partly-cloudy-sky.png'))
        # panels drawer with selection + shading map
        page.evaluate(f'''() => {{ const v = window.__arien.viewer(); v.clock.currentTime = Cesium.JulianDate.fromDate(new Date({t_noon} - 4*3600e3)); window.__arien.simulateNow(true); }}''')
        page.click('#rail button[data-panel="shading"]'); time.sleep(0.5)
        page.click('#sh-colour button[data-v="map"]'); time.sleep(0.4)
        page.evaluate('''() => { const v = window.__arien.viewer(); const s = window.__arien.state;
            v.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(s.site.lon, s.site.lat, 2), 10), {offset: new Cesium.HeadingPitchRange(0.3, -0.75, 34), duration: 0}); }''')
        time.sleep(3)
        page.screenshot(path=str(OUT / '05-shading-map.png'))
        page.click('#rail button[data-panel="panels"]'); time.sleep(0.3)
        page.click('#arr-list li'); time.sleep(2.5)
        page.screenshot(path=str(OUT / '06-array-editor.png'))
        page.click('#rail button[data-panel="time"]'); time.sleep(0.3)
        page.click('#wx-mode button[data-mode="previous"]'); time.sleep(0.3)
        page.screenshot(path=str(OUT / '07-weather-pane.png'))
        page.set_viewport_size({'width': 400, 'height': 820}); time.sleep(1.5)
        page.screenshot(path=str(OUT / '08-phone.png'))
    if SCEN in ('interact', 'full'):
        page.set_viewport_size({'width': 1440, 'height': 900}); time.sleep(0.5)
        # place a conifer by clicking the library then the canvas
        page.click('#rail button[data-panel="objects"]'); time.sleep(0.3)
        page.click('#obj-lib button[data-type="conifer"]'); time.sleep(0.2)
        page.mouse.click(1000, 450); time.sleep(2)
        n_obj = page.evaluate('() => window.__arien.state.objects.length')
        sel = page.evaluate('() => window.__arien.state.sel')
        print('objects after place:', n_obj, 'selected:', sel)
        before = page.evaluate('() => { const s = window.__arien.state; const o = s.objects.find(x => x.id === s.sel.id); return [o.x, o.y]; }')
        # drag it 120 px left
        page.mouse.move(1000, 440); page.mouse.down(); page.mouse.move(940, 440, steps=6); page.mouse.move(880, 440, steps=6); page.mouse.up(); time.sleep(1)
        after = page.evaluate('() => { const s = window.__arien.state; const o = s.objects.find(x => x.id === s.sel.id); return [o.x, o.y]; }')
        print('drag moved object from', before, 'to', after)
        page.keyboard.press('e'); page.keyboard.press(']'); time.sleep(0.5)
        page.screenshot(path=str(OUT / '10-placed-object.png'))
        # skyline in map-only world should redirect to World pane
        page.click('#rail button[data-panel="shading"]'); time.sleep(0.2); page.click('#sh-run'); time.sleep(0.6)
        print('pane after trace in map-only:', page.evaluate('() => document.getElementById("drawer-title").textContent'))
        # past forecast mode, 3-day lead
        page.click('#rail button[data-panel="time"]'); page.click('#wx-mode button[data-mode="previous"]')
        page.fill('#wx-start', '2025-06-10'); page.fill('#wx-end', '2025-06-16')
        page.evaluate('() => { const r = document.getElementById("wx-lead"); r.value = 3; r.dispatchEvent(new Event("input")); }')
        page.click('#wx-load')
        page.wait_for_function('() => document.getElementById("wx-status").className.includes("ok") && window.__arien.state.run', timeout=120000)
        print('previous-runs status:', page.evaluate('() => document.getElementById("wx-status").textContent'))
        # measured CSV made from the run with noise → metrics
        csv = page.evaluate(r'''() => { const r = window.__arien.state.run; const k = r.keys[0]; return "time,measured_kw\n" + r.times.filter((t,i)=>i%4===0).map((t,i)=>new Date(t).toISOString()+","+(r.kw[k][i*4]*(0.9+0.2*Math.sin(i))).toFixed(3)).join("\n"); }''')
        mp = OUT / 'measured.csv'; mp.write_text(csv)
        page.set_input_files('#meas-csv', str(mp)); time.sleep(1)
        print('u2 debug:', page.evaluate(r"""() => { const r = window.__arien.state.run; const meas = window.__arien.measuredAligned(r.times);
            const k = r.keys[0]; const m = ArienPhysics.metrics(r.kw[k], meas); let pairs = 0, fin = 0;
            for (let i=0;i<meas.length-1;i++){ if (isFinite(meas[i])) fin++; if (meas[i]>1e-3 && isFinite(meas[i+1])) pairs++; }
            return JSON.stringify({u2: m.u2, pairs, fin, n: meas.length, sample: meas.slice(40,52), mt: window.__arien.state.wx.measured.time.slice(0,3), rt: r.times.slice(0,3)}); }"""))
        page.click('#btn-dash'); time.sleep(2)
        print('metrics table:', page.evaluate('() => document.getElementById("results-table").innerText.replace(/\s+/g," ").slice(0,400)'))
        page.screenshot(path=str(OUT / '11-dashboard-metrics.png'))
        # run all physics models
        page.click('#rail button[data-panel="models"]'); page.click('#model-all')
        page.wait_for_function('() => window.__arien.state.run && window.__arien.state.run.keys.length >= 5', timeout=120000)
        print('all-model energies:', page.evaluate('() => JSON.stringify(Object.fromEntries(Object.entries(window.__arien.state.run.energy).map(([k,v])=>[k,+v.toFixed(1)])))'), 'ms', page.evaluate('() => Math.round(window.__arien.state.run.ms)'))
        page.screenshot(path=str(OUT / '12-models.png'))
    if SCEN == 'u2':
        print(page.evaluate(r"""() => { const r = window.__arien.state.run; const k = r.keys[0];
          const obs = r.times.map((t,i) => i%4===2 ? NaN : r.kw[k][i]*(0.9+0.2*Math.sin(i)));
          const m = ArienPhysics.metrics(r.kw[k], obs); let pairs=0, small=0;
          for (let i=0;i<obs.length-1;i++){ if (obs[i]>1e-3 && isFinite(obs[i+1])) pairs++; if (obs[i]>0 && obs[i]<0.05) small++; }
          return JSON.stringify({m, pairs, small}); }"""))
    errs = [l for l in logs if 'error' in l.lower() or 'pageerror' in l]
    print('CONSOLE (%d lines, %d errors):' % (len(logs), len(errs)))
    for l in logs[:60]: print('  ', l[:300])
    b.close()
