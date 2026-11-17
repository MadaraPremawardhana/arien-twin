"""Headless check of the ARIEN web app with the account service, weather, geocoding and map tiles mocked.
Covers: the sky theme by clock and by place, the landing search and preview, sign-up with the emailed code, log-in
and the return to the page asked for, the twin page saving to the account, the dashboard switch without a reload,
plans, contact and settings.
Usage (from the repository root): ARIEN_DEPS=<node_modules with cesium, three, chart.js, leaflet> python3 web/test/web_check.py <outdir>
"""
import json, math, re, sys, time, urllib.parse as up
from datetime import datetime, timedelta, timezone
from pathlib import Path
WEB = Path(__file__).resolve().parent.parent
REPO = WEB.parent
twin_harness = REPO / 'test' / 'run_browser.py'
ns = {'__file__': str(twin_harness)}
argv = sys.argv; sys.argv = [argv[0], argv[1] if len(argv) > 1 else '/tmp/arien-web', 'none']
exec(twin_harness.read_text().split('with sync_playwright() as p:')[0], ns)   # reuse the twin's CDN, tile and weather mocks
from playwright.sync_api import sync_playwright
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
SITE = 'https://madarapremawardhana.github.io/arien-twin/web/'
TWIN = 'https://madarapremawardhana.github.io/arien-twin/'
API = 'https://arien.base44.app/api/apps/6a4fb7864ffb55c91635b7d7'
TWIN_CONFIG = {'version': 1, 'updated': '2026-11-16T12:00:00Z', 'autoConnect': True, 'site': {'name': 'Buckingham, UK', 'lat': 51.9956, 'lon': -0.9906}, 'world': {'src': 'none'}, 'weather': {'mode': 'forecast'}}
TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.txt': 'text/plain'}
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS'}
results = {}
def check(name, cond, detail=''):
    results[name] = bool(cond)
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))


class Backend:
    """An in-memory stand-in for the account service: users, tokens, SolarSite and the three form entities."""
    def __init__(self):
        self.users = {}; self.tokens = {}; self.sites = []; self.leads = []; self.waitlist = []; self.academic = []; self.pending = {}; self.calls = []; self.emails = []; self.google = []; self.n = 0
    def add_user(self, email, password, **kw):
        u = {'id': 'u%d' % (len(self.users) + 1), 'email': email, 'full_name': kw.get('full_name', ''), 'plan': kw.get('plan'), 'settings': {}, 'last_site_id': None, '_pw': password}
        self.users[email] = u; return u
    def token_for(self, u):
        t = 'tok-%s-%d' % (u['id'], len(self.tokens)); self.tokens[t] = u['email']; return t
    def public(self, u): return {k: v for k, v in u.items() if not k.startswith('_')}
    def handle(self, route):
        req = route.request; u = up.urlparse(req.url); path = u.path.split('/api/apps/6a4fb7864ffb55c91635b7d7', 1)[1]; qs = up.parse_qs(u.query)
        def send(status, body): return route.fulfill(status=status, body=json.dumps(body), headers={'content-type': 'application/json', **CORS})
        if req.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
        body = json.loads(req.post_data) if req.post_data else {}
        auth = req.headers.get('authorization', ''); me = self.users.get(self.tokens.get(auth[7:])) if auth.startswith('Bearer ') else None
        self.calls.append((req.method, path, bool(me), req.headers.get('x-app-id')))
        if path == '/auth/login':
            usr = self.users.get(body.get('email'))
            if not usr or usr['_pw'] != body.get('password'): return send(401, {'message': 'Invalid email or password'})
            return send(200, {'access_token': self.token_for(usr), 'user': self.public(usr)})
        if path == '/auth/register':
            if body.get('email') in self.users: return send(400, {'message': 'An account with this email already exists'})
            self.pending[body['email']] = body['password']; return send(200, {'ok': True})
        if path == '/auth/verify-otp':
            if body.get('otp_code') != '424242' or body.get('email') not in self.pending: return send(400, {'message': 'Invalid verification code'})
            usr = self.add_user(body['email'], self.pending.pop(body['email'])); return send(200, {'access_token': self.token_for(usr)})
        if path == '/auth/resend-otp' or path == '/auth/reset-password-request': return send(200, {'ok': True})
        if path == '/integration-endpoints/Core/SendEmail': self.emails.append(body); return send(200, {'success': True})
        if path == '/entities/User/me':
            if not me: return send(401, {'message': 'Authentication required to view users'})
            if req.method == 'PUT': me.update({k: v for k, v in body.items() if k in ('settings', 'plan', 'last_site_id')})
            return send(200, self.public(me))
        m = re.match(r'^/entities/(SalesLead|Waitlist|AcademicApplication)$', path)
        if m and req.method == 'POST':
            {'SalesLead': self.leads, 'Waitlist': self.waitlist, 'AcademicApplication': self.academic}[m.group(1)].append(body); return send(200, {'id': 'x', **body})
        if path.startswith('/entities/SolarSite'):
            rest = path[len('/entities/SolarSite'):].strip('/')
            mine = [s for s in self.sites if me and s['created_by_id'] == me['id']]   # row-level security: only the owner's rows
            if rest == 'count': return send(200, {'count': len(mine)})
            if not rest and req.method == 'GET':
                rows = sorted(mine, key=lambda s: s['updated_date'], reverse=True)[:int(qs.get('limit', ['50'])[0])]
                return send(200, rows)
            if not me: return send(401, {'message': 'Authentication required'})
            now = datetime.now(timezone.utc).isoformat()
            if not rest and req.method == 'POST':
                self.n += 1; s = {'id': 'S%d' % self.n, 'created_by_id': me['id'], 'created_by': me['email'], 'created_date': now, 'updated_date': now, **body}; self.sites.append(s); return send(200, s)
            s = next((x for x in mine if x['id'] == rest), None)
            if not s: return send(404, {'message': 'Entity SolarSite with ID %s not found' % rest})
            if req.method == 'GET': return send(200, s)
            if req.method == 'PUT': s.update(body); s['updated_date'] = now; return send(200, s)
            if req.method == 'DELETE': self.sites.remove(s); return send(200, {'ok': True})
        return send(404, {'message': 'not mocked: ' + path})


def preview_weather(qs):
    """Open-Meteo forecast in the shape the landing preview asks for: ISO local times and a UTC offset."""
    lat, lon = float(qs['latitude'][0]), float(qs['longitude'][0]); off = round(lon / 15) * 3600
    start = (datetime.now(timezone.utc) + timedelta(seconds=off)).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    t, ghi, dni, dhi, temp = [], [], [], [], []
    for i in range(24 * int(qs.get('forecast_days', ['2'])[0])):
        local = start + timedelta(hours=i); utc = local.replace(tzinfo=timezone.utc).timestamp() - off
        alt = ns['sun_alt'](utc, lat, lon); s = max(0.0, math.sin(alt))
        t.append(local.strftime('%Y-%m-%dT%H:%M')); dni.append(round(780 * s ** 0.3, 1) if s > 0 else 0); dhi.append(round(110 * s ** 0.5, 1)); ghi.append(round(dni[-1] * s + dhi[-1], 1)); temp.append(11.0)
    return {'utc_offset_seconds': off, 'hourly': {'time': t, 'shortwave_radiation': ghi, 'direct_normal_irradiance': dni, 'diffuse_radiation': dhi, 'temperature_2m': temp}}


def router(backend):
    twin_html = (REPO / 'index.html').read_text()
    def route(r):
        url = r.request.url; u = up.urlparse(url)
        if url.startswith(SITE):
            rel = u.path[len(up.urlparse(SITE).path):]
            f = WEB / rel
            if rel == '' or rel.endswith('/'): f = WEB / rel / 'index.html'
            elif f.is_dir(): return r.fulfill(status=301, headers={'location': u.path + '/' + ('?' + u.query if u.query else '')})
            if not f.is_file() or 'node_modules' in rel: return r.fulfill(status=404, body='not found')
            return r.fulfill(status=200, body=f.read_bytes(), headers={'content-type': TYPES.get(f.suffix, 'application/octet-stream')})
        if url.startswith(TWIN):
            rel = u.path[len(up.urlparse(TWIN).path):]
            if rel == 'config.json': return r.fulfill(status=200, body=json.dumps(TWIN_CONFIG), headers={'content-type': 'application/json'})
            if rel in ('', 'index.html'): return r.fulfill(status=200, body=twin_html, headers={'content-type': 'text/html'})
            return r.fulfill(status=404, body='not found')
        if u.netloc == 'arien.base44.app' and u.path == '/api/apps/auth/login':   # Google sign-in: only returns to its own app's address
            q = up.parse_qs(u.query); backend.google.append(q)
            ref = r.request.headers.get('referer', '')   # like the real service: the return domain is the page the sign-in started from
            if not q['from_url'][0].startswith('https://arien.base44.app/') or not ref.startswith('https://arien.base44.app/'): return r.fulfill(status=400, body=json.dumps({'error_type': 'HTTPException', 'message': 'Domain is not valid'}), headers={'content-type': 'application/json'})
            return r.fulfill(status=302, headers={'location': q['from_url'][0] + '?access_token=' + backend.token_for(backend.users[backend.google_user])})
        if u.netloc == 'arien.base44.app' and u.path == '/sso-return':            # the relay page of the Base44 app: on to this site, session in the fragment
            qs = up.parse_qs(u.query)
            if qs.get('start') == ['google']:
                return r.fulfill(status=200, body='<script>location.href = "/api/apps/auth/login?app_id=6a4fb7864ffb55c91635b7d7&from_url=" + encodeURIComponent("https://arien.base44.app/sso-return")</script>', headers={'content-type': 'text/html'})
            tok = qs['access_token'][0]
            return r.fulfill(status=200, body='<script>location.replace(%s)</script>' % json.dumps(SITE + '#access_token=' + tok), headers={'content-type': 'text/html'})
        if u.netloc == 'arien.base44.app': return backend.handle(r)
        if u.netloc in ('fonts.googleapis.com', 'fonts.gstatic.com'): return r.fulfill(status=200, body='', headers={'content-type': 'text/css'})
        if u.netloc == 'nominatim.openstreetmap.org':
            qs = up.parse_qs(u.query)
            if u.path.endswith('/reverse'): body = {'address': {'town': 'Reykjavik', 'postcode': '101'}}
            else:
                q = qs.get('q', [''])[0].lower()
                body = [{'lat': '-33.8688', 'lon': '151.2093'}] if 'sydney' in q else [] if 'nowhere' in q else [{'lat': '51.9989', 'lon': '-0.9872'}]
            return r.fulfill(status=200, body=json.dumps(body), headers={'content-type': 'application/json', **CORS})
        if u.netloc == 'api.open-meteo.com' and 'direct_normal_irradiance,diffuse_radiation,temperature_2m&forecast_days' in u.query and 'timezone=auto' in u.query:
            return r.fulfill(status=200, body=json.dumps(preview_weather(up.parse_qs(u.query))), headers={'content-type': 'application/json', **CORS})
        if u.netloc.endswith('tile.openstreetmap.org'): return r.fulfill(status=200, body=ns['TILE'], headers={'content-type': 'image/png', **CORS})
        return ns['handle'](r)
    return route


def new_page(b, backend, width=1440, height=900, fixed=None, **ctx_kw):
    ctx = b.new_context(viewport={'width': width, 'height': height}, timezone_id='Europe/London', **ctx_kw)
    ctx.route('**/*', router(backend))
    page = ctx.new_page(); logs = []
    page.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)[:300]))
    page.on('console', lambda m: logs.append(m.type + ' ' + m.text[:200]) if m.type == 'error' and 'net::ERR' not in m.text and 'status of 4' not in m.text else None)
    if fixed:   # a shifted but running clock (a frozen one stalls debounced code such as the globe's)
        page.add_init_script('(() => { const off = %d - Date.now(), RD = Date; class D extends RD { constructor(...a) { if (a.length) super(...a); else super(RD.now() + off); } static now() { return RD.now() + off; } } window.Date = D; })();' % int(fixed.timestamp() * 1000))
    return ctx, page, logs

phase = lambda page: page.evaluate('() => document.documentElement.dataset.phase')
def settle(page, js, timeout=15000): page.wait_for_function(js, timeout=timeout)
def twin_frame(page):
    for _ in range(300):
        for f in page.frames:
            if f.url.startswith(TWIN) and not f.url.startswith(SITE): return f
        page.wait_for_timeout(100)   # not time.sleep: the mocked network only answers while Playwright is pumping events
    raise RuntimeError('twin frame not found')
def twin_ready(fr, cond='true', timeout=150000):
    fr.wait_for_function(f'() => window.__arien && document.getElementById("boot").classList.contains("gone") && ({cond})', timeout=timeout)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])

    # ---------- 1. sky theme by clock, and by the sun at a place
    be = Backend()
    for hour, want in [(6, 'dawn'), (12, 'day'), (18, 'dusk'), (23, 'night')]:
        ctx, page, logs = new_page(b, be, fixed=datetime(2026, 11, 16, hour, 30, tzinfo=timezone.utc))
        page.goto(SITE); settle(page, '() => document.querySelector("#loc-chip")')
        page.wait_for_timeout(1000 * 0.4); got = phase(page)
        check(f'no location: {hour}:30 on the clock is {want}', got == want, got)
        if hour == 12:
            st = page.evaluate('() => ({ nav: [...document.querySelectorAll(".nav-right > .when-out")].filter(e => e.offsetParent).map(e => e.textContent), inHidden: [...document.querySelectorAll(".when-in")].every(e => !e.offsetParent), sky: getComputedStyle(document.querySelector(".st")).backgroundColor, chip: !document.querySelector("#loc-chip").hidden })')
            check('signed out: Log in and Register shown, account controls hidden', st['nav'] == ['Log in', 'Register'] and st['inHidden'], json.dumps(st))
            check('day sky colour and "Use my location" chip', st['sky'] == 'rgb(46, 99, 246)' and st['chip'], st['sky'])
        ctx.close()
    # London clock says midday; the last search was Sydney, where it is night
    ctx, page, logs = new_page(b, be, fixed=datetime(2026, 11, 16, 12, 30, tzinfo=timezone.utc))
    page.add_init_script('localStorage.setItem("arien:last-search", JSON.stringify({ lat: -33.8688, lng: 151.2093, label: "Sydney" }))')
    page.goto(SITE); settle(page, '() => document.documentElement.dataset.phase === "night"')
    page.wait_for_timeout(4000)   # the sky fades over 1.5 s
    sky = page.evaluate('() => getComputedStyle(document.querySelector(".st")).backgroundColor')
    check('a remembered place sets the sky: Sydney at 12:30 UTC is night', phase(page) == 'night' and sky == 'rgb(18, 14, 43)', sky)
    check('chip hidden once a place is known', page.evaluate('() => !document.querySelector("#loc-chip").offsetParent'))
    ctx.close()
    # device location already allowed: Reykjavik at 09:20 UTC in mid November is before sunrise, but in twilight -> dawn
    ctx, page, logs = new_page(b, be, fixed=datetime(2026, 11, 16, 9, 20, tzinfo=timezone.utc), geolocation={'latitude': 64.1466, 'longitude': -21.9426}, permissions=['geolocation'])
    page.goto(SITE); settle(page, '() => document.querySelector(".fcard")')
    settle(page, '() => document.documentElement.dataset.phase === "dawn"')
    card = page.inner_text('.fcard')
    check('device location: sky by the sun there (Reykjavik 09:20 is dawn) and a preview for it', 'Reykjavik · 101' in card, card.replace('\n', ' | ')[:120])
    ctx.close()

    # ---------- 2. landing: search, preview card, globe
    ctx, page, logs = new_page(b, be, fixed=datetime(2026, 11, 16, 12, 30, tzinfo=timezone.utc))
    page.goto(SITE); settle(page, '() => document.querySelector("#loc-form")')
    page.fill('#loc-input', 'nowhere at all'); page.click('#loc-go'); settle(page, '() => !document.querySelector("#loc-err").hidden')
    check('unknown place: message under the search box', page.inner_text('#loc-err') == "Couldn't find that location")
    page.fill('#loc-input', '95, 10'); page.click('#loc-go'); page.wait_for_timeout(1000 * 0.2)
    check('coordinates out of range refused', page.inner_text('#loc-err') == 'Coordinates out of range')
    page.click('#live-forecast'); settle(page, '() => document.querySelector("#fc-chart svg rect")')
    c = page.evaluate('''() => ({ loc: document.querySelector('.fcard .loc').textContent, bars: document.querySelectorAll('#fc-chart rect').length, tomorrow: document.querySelector('#fc-tomorrow').textContent,
        best: document.querySelector('#fc-best').textContent, bestK: document.querySelector('#fc-best-k').textContent, peak: document.querySelector('#fc-peak').textContent, save: document.querySelector('.fcard a.btn').getAttribute('href'),
        stored: JSON.parse(localStorage.getItem('arien:last-search')), input: document.querySelector('#loc-input').value })''')
    kwh = float(c['tomorrow'].split()[0]); peak = float(c['peak'].split()[0])
    check('"See a live forecast" builds the 48-hour preview', c['input'] == 'MK18 1EG' and c['bars'] == 48 and 'MK18 1EG · 4 kWp · 35° tilt' in c['loc'], json.dumps(c)[:300])
    check('preview numbers are plausible for 4 kWp in November', 2 < kwh < 14 and 0.8 < peak < 3.6 and re.match(r'^\d\d:00–\d\d:00$', c['best']) and 'BEST 3 HOURS ·' in c['bestK'], f"{c['tomorrow']} · {c['peak']} · {c['best']} · {c['bestK']}")
    check('"Save this site" goes to sign-up and returns to the twin at that place', '/register/?returnTo=' in c['save'] and 'twin%2F%3Flat%3D51.9989%26lng%3D-0.9872%26q%3DMK18%25201EG' in c['save'], c['save'][-110:])
    check('the place is remembered for the sky theme', c['stored'] and abs(c['stored']['lat'] - 51.9989) < 1e-6)
    settle(page, '() => document.querySelector("#fc-map .leaflet-tile")', 20000)
    settle(page, '() => document.querySelector(".globe-stage-inner.ready canvas")', 60000)
    g = page.evaluate('() => { const c = document.querySelector(".globe-stage canvas"), s = document.querySelector(".globe-stage"); return { canvas: c.clientWidth, stage: s.clientWidth, placeholder: !!document.querySelector(".globe-placeholder") }; }')
    check('globe drawn, sized to its stage', abs(g['canvas'] / g['stage'] - 1.22) < 0.03 and not g['placeholder'], json.dumps(g))
    page.wait_for_timeout(1000 * 1.5); page.screenshot(path=str(OUT / '01-home-desktop.png'))
    m = page.evaluate('''() => { const map = document.querySelector('#fc-map'), r = map.getBoundingClientRect(); scrollBy(0, r.top - 20); const r2 = map.getBoundingClientRect();
        const el = document.elementFromPoint(r2.left + r2.width / 2, 40); return { top: Math.round(r2.top), inHeader: !!(el && el.closest('header.nav')), what: el && (el.className || el.tagName).toString().slice(0, 40) }; }''')
    check('the preview map passes under the sticky header, not over it', m['inHeader'] and m['top'] < 40, json.dumps(m))
    page.evaluate('() => scrollTo(0, 0)'); page.wait_for_timeout(200)
    page.evaluate('() => { window.__ys = []; addEventListener("scroll", () => window.__ys.push(Math.round(scrollY))); }')
    page.click('.nav-links a[href$="#pricing"]')
    settle(page, '() => document.activeElement && document.activeElement.id === "pricing"')
    ys = page.evaluate('() => window.__ys'); mid = len(set(ys))   # in-between positions, always moving down: a glide, not a jump (few frames in this software-rendered browser)
    sc = page.evaluate('() => { const h = document.querySelector("header.nav").offsetHeight, t = document.querySelector("#pricing .sec-head").getBoundingClientRect().top; return { gap: Math.round(t - h), y: Math.round(scrollY), hash: location.hash }; }')
    check('menu link glides to the section title, just under the header', mid >= 3 and ys == sorted(ys) and abs(sc['gap'] - 20) <= 2 and sc['hash'] == '#pricing', json.dumps({'steps': mid, **sc}))
    page.evaluate('() => scrollTo(0, 0)'); page.wait_for_timeout(200)
    page.fill('#loc-input', 'Sydney'); page.click('#loc-go'); settle(page, '() => document.documentElement.dataset.phase === "night"')
    check('searching Sydney at midday UTC turns the sky to night', True)
    page.screenshot(path=str(OUT / '02-home-night.png'))
    check('landing: no page errors', not logs, ' | '.join(logs)[:400])
    ctx.close()

    # ---------- 3. sign-up with the emailed code, on the Household plan, lands in the twin
    be = Backend(); ctx, page, logs = new_page(b, be)
    page.goto(SITE + 'twin/?lat=52.2053&lng=0.1218&q=Cambridge')
    settle(page, '() => location.pathname.endsWith("/login/")')
    check('signed out: the twin page sends you to log in, remembering where you were going', 'returnTo=twin%2F%3Flat%3D52.2053' in page.url, page.url[-80:])
    page.click('text=Create one'); settle(page, '() => location.pathname.endsWith("/register/")')
    check('the return address follows to the sign-up page', 'returnTo=' in page.url)
    page.fill('#email', 'new.user@example.test'); page.fill('#password', 'test-pass-1'); page.fill('#confirm', 'different'); page.click('button[type=submit]')
    settle(page, '() => document.querySelector("#auth-error") && !document.querySelector("#auth-error").hidden')
    check('mismatched passwords are caught before anything is sent', page.inner_text('#auth-error') == 'Passwords do not match' and not any(c[1] == '/auth/register' for c in be.calls))
    page.fill('#confirm', 'test-pass-1'); page.click('button[type=submit]'); settle(page, '() => document.querySelector("#otp")')
    check('sign-up asks for the emailed code', 'We sent a code to new.user@example.test' in page.inner_text('body'))
    page.fill('#otp', '111111'); page.click('button[type=submit]'); settle(page, '() => document.querySelector("#auth-error") && !document.querySelector("#auth-error").hidden')
    check('a wrong code is refused', 'Invalid verification code' in page.inner_text('#auth-error'))
    page.fill('#otp', '424242'); page.click('button[type=submit]')
    settle(page, '() => location.pathname.endsWith("/twin/")', 20000)
    check('after the code: signed in and back at the twin page with the place', 'lat=52.2053' in page.url and page.evaluate('() => !!localStorage.getItem("base44_access_token") && document.documentElement.dataset.auth === "in"'))
    fr = twin_frame(page)
    twin_ready(fr, '__arien.state.account && Math.abs(__arien.state.site.lat - 52.2053) < 1e-6')
    st = fr.evaluate('() => ({ user: __arien.state.account.user, lat: __arien.state.site.lat, lon: __arien.state.site.lon, name: __arien.state.site.name, arrays: __arien.state.arrays.length, view: __arien.state.view, limit: __arien.state.account.siteLimit, search: location.search })')
    check('the twin opens signed in, on a new design at the chosen place', st['arrays'] == 0 and abs(st['lon'] - 0.1218) < 1e-6 and st['name'] == 'Cambridge' and st['limit'] == 1 and st['user']['plan'] == 'household', json.dumps(st)[:260])
    check('nothing secret reaches the twin: no email, token or password in its address or session', 'tok-' not in st['search'] and 'example.test' not in json.dumps(st) and 'email' not in st['user'])
    settle(fr, '() => __arien.state.view === "design"', 20000)
    # place panels and save from the twin: the record is created in the account by this page
    fr.evaluate('''() => { const s = __arien.state; s.arrays.push(Object.assign({ id: 'a1', name: 'Roof', x: 0, y: 0, z: 0, azimuth: 180, tilt: 35, rows: 2, cols: 4, colGap: 0.02, rowPitch: 3.2, mountHeight: 0.15, landscape: false, worldSrc: 'none' },
        ArienPanels.applyTo({}, 'longi-himo6-430'))); __arien.rebuild(); __arien.designChanged(); __arien.saveNamedSite('Cambridge roof'); }''')
    for _ in range(100):
        if be.sites: break
        page.wait_for_timeout(100)
    s = be.sites[0] if be.sites else {}
    check('Save in the twin creates the site in the user\'s account', s.get('name') == 'Cambridge roof' and s.get('panel_count') == 8 and abs(s.get('capacity_kwp', 0) - 3.44) < 1e-6 and s.get('source') == 'twin' and s.get('twin_scene', {}).get('arrays') and s.get('created_by_id') == 'u1', json.dumps({k: s.get(k) for k in ['id', 'name', 'panel_count', 'capacity_kwp', 'latitude', 'source']}))
    check('the account call carried the app id and the user\'s token', any(c[0] == 'POST' and c[1] == '/entities/SolarSite' and c[2] and c[3] == '6a4fb7864ffb55c91635b7d7' for c in be.calls))
    fr.wait_for_function('() => __arien.state.accountSiteId === "S1" && __arien.state.account.sites.length === 1', timeout=15000)
    check('the user record remembers the last site', be.users['new.user@example.test']['last_site_id'] == 'S1')
    # a second site on the one-site plan is refused by the page, and the twin offers to replace
    fr.evaluate('() => __arien.saveNamedSite("Second roof")'); fr.wait_for_selector('.toast.with-actions', timeout=10000)
    check('Household plan: a second site is not created; the twin offers to replace or upgrade', len(be.sites) == 1 and 'Household plan keeps 1 site' in fr.inner_text('.toast.with-actions'))
    fr.click('.toast.with-actions >> text=See plans'); settle(page, '() => location.pathname.endsWith("/plans/")')
    check('"See plans" in the twin opens this site\'s plans page', True)

    # ---------- 4. Open Digital Twin and Dashboard: one twin, no reload between them
    page.goto(SITE); settle(page, '() => document.querySelector("#avatar")')
    nav = page.evaluate('() => ({ inn: [...document.querySelectorAll(".nav-right .when-in")].filter(e => e.offsetParent).map(e => e.textContent.trim().replace(/\\s+/g, " ").slice(0, 30)), hero: [...document.querySelectorAll(".hero-cta a")].filter(e => e.offsetParent).map(e => e.textContent), avatar: document.querySelector("#avatar").textContent })')
    check('signed in: Home/Dashboard, Open Digital Twin and the account menu', any('Home' in x and 'Dashboard' in x for x in nav['inn']) and 'Open Digital Twin' in nav['inn'] and nav['hero'] == ['Open Digital Twin'], json.dumps(nav))
    page.screenshot(path=str(OUT / '03-home-signed-in.png'))
    page.click('.nav-right a.dt-btn.when-in'); settle(page, '() => location.pathname.endsWith("/twin/")')
    fr = twin_frame(page); src = page.get_attribute('#twin-frame', 'src')
    check('Open Digital Twin embeds the twin at #design', src.startswith(TWIN + '?embed=web') and src.endswith('#design'), src)
    twin_ready(fr, '__arien.state.account && __arien.state.accountSiteId === "S1" && __arien.state.view === "design"')
    st = fr.evaluate('() => ({ name: __arien.state.designName, panels: __arien.state.arrays.reduce((t, a) => t + a.rows * a.cols, 0), lat: __arien.state.site.lat })')
    check('coming back, the twin opens the user\'s saved project', st['name'] == 'Cambridge roof' and st['panels'] == 8 and abs(st['lat'] - 52.2053) < 1e-6, json.dumps(st))
    fr.evaluate('() => { window.__sameDocument = true; }')
    page.wait_for_timeout(1000 * 1); page.screenshot(path=str(OUT / '04-twin-page.png'))
    page.click('.seg a[data-app-view="dashboard"]')
    settle(page, '() => location.pathname.endsWith("/dashboard/")')
    fr.wait_for_function('() => __arien.state.view === "dashboard"', timeout=20000)
    check('Dashboard switches the same twin to its dashboard without reloading it', fr.evaluate('() => window.__sameDocument === true') and page.get_attribute('#twin-frame', 'src').endswith('#dashboard') and page.evaluate('() => document.querySelector(".seg a[data-app-view=dashboard]").classList.contains("on") && document.title') == 'Dashboard · Arien')
    fr.wait_for_selector('#db-sites', timeout=120000); page.wait_for_timeout(1000 * 1.5)
    page.screenshot(path=str(OUT / '05-dashboard-page.png'))
    page.go_back(); fr.wait_for_function('() => __arien.state.view === "design"', timeout=20000)
    check('Back returns to the designer, still without a reload', page.url.endswith('/twin/') and fr.evaluate('() => window.__sameDocument === true'))
    fr.evaluate('() => __arien.setView("dashboard")'); settle(page, '() => location.pathname.endsWith("/dashboard/")')
    check('switching inside the twin moves this page\'s address and header with it', page.evaluate('() => document.querySelector(".seg a[data-app-view=dashboard]").classList.contains("on")'))
    # the dashboard address loads the twin straight at #dashboard
    page.goto(SITE + 'dashboard/'); fr = twin_frame(page)
    check('the Dashboard address embeds the twin at #dashboard', page.get_attribute('#twin-frame', 'src').endswith('#dashboard'))
    twin_ready(fr, '__arien.state.account && __arien.state.view === "dashboard"')
    # results of a run are kept with the site
    fr.evaluate('() => __arien.forecastWeek()')
    for _ in range(300):
        if be.sites[0].get('twin_results', {}).get('forecast_7d'): break
        page.wait_for_timeout(100)
    check('forecast results are stored with the site', len(be.sites[0].get('twin_results', {}).get('forecast_7d', [])) >= 6 and be.sites[0].get('cached_at'))
    check('twin pages: no page errors', not logs, ' | '.join(logs)[:400])

    # ---------- 5. account menu, settings, sign out
    page.goto(SITE + 'settings/'); settle(page, '() => document.querySelector("#set-email").textContent')
    check('settings shows the account and plan', page.inner_text('#set-email') == 'new.user@example.test' and page.inner_text('#set-plan') == 'Household' and '1 saved site of 1' in page.inner_text('#set-sites'))
    page.fill('#set-name', 'Ada Lovelace'); page.dispatch_event('#set-name', 'change'); settle(page, '() => document.querySelector("#set-saved").textContent === "Saved"')
    page.select_option('#set-theme', 'night'); settle(page, '() => document.documentElement.dataset.phase === "night"')
    page.wait_for_timeout(1000 * 0.6)
    u = be.users['new.user@example.test']
    check('display name and "Always night" are saved on the account and applied', u['settings'] == {'display_name': 'Ada Lovelace', 'theme': 'night'}, json.dumps(u['settings']))
    page.screenshot(path=str(OUT / '06-settings.png'))
    page.goto(SITE); settle(page, '() => document.querySelector("#avatar").textContent === "AL"')
    check('pinned night theme holds on the landing page; initials in the header', phase(page) == 'night')
    page.click('#avatar'); settle(page, '() => !document.querySelector("#acct-menu").hidden')
    menu = page.evaluate('() => [...document.querySelectorAll("#acct-menu [role=menuitem]")].map(e => e.textContent)')
    check('account menu: Manage plan, Dashboard, Settings, Sign out', menu == ['Manage plan', 'Dashboard', 'Settings', 'Sign out'] and page.inner_text('#acct-name') == 'Ada Lovelace', json.dumps(menu))
    page.click('#acct-menu [data-signout]'); settle(page, '() => document.documentElement.dataset.auth === "out"')
    check('Sign out clears the session', page.evaluate('() => !localStorage.getItem("base44_access_token") && !localStorage.getItem("arien:user")'))

    # ---------- 6. log in again (wrong, then right), plan pages
    page.goto(SITE + 'login/?plan=academic'); settle(page, '() => document.querySelector("#password")')
    page.screenshot(path=str(OUT / '07-login.png'))
    page.fill('#email', 'new.user@example.test'); page.fill('#password', 'wrong'); page.click('button[type=submit]')
    settle(page, '() => document.querySelector("#auth-error") && !document.querySelector("#auth-error").hidden')
    check('wrong password: message, still signed out', 'Invalid email or password' in page.inner_text('#auth-error') and page.evaluate('() => !localStorage.getItem("base44_access_token")'))
    page.fill('#password', 'test-pass-1'); page.click('button[type=submit]')
    settle(page, '() => location.pathname.endsWith("/plans/") && document.querySelector("dialog.modal")')
    check('log in from the Academic plan opens the academic application', 'Academic access' in page.inner_text('dialog.modal') and page.input_value('#ac-email') == 'new.user@example.test')
    page.fill('#ac-name', 'Ada Lovelace'); page.fill('#ac-inst', 'University of Buckingham'); page.fill('#ac-email', 'ada@buckingham.ac.uk'); page.click('dialog.modal button[type=submit]')
    settle(page, '() => /Approved/.test(document.querySelector("dialog.modal").textContent)')
    check('an academic address is approved and the plan upgraded', be.academic and be.academic[0]['status'] == 'approved' and be.users['new.user@example.test']['plan'] == 'Academic')
    page.click('dialog.modal [data-close]'); page.click('[data-plan="pro"]'); settle(page, '() => document.querySelector("#wl-email")')
    page.fill('#wl-name', 'Ada Lovelace'); page.click('dialog.modal button[type=submit]'); settle(page, '() => /on the list/.test(document.querySelector("dialog.modal").textContent)')
    check('Pro waitlist entry saved', be.waitlist and be.waitlist[0]['interest'] == 'Pro / Installer' and be.waitlist[0]['email'] == 'new.user@example.test')
    page.click('dialog.modal [data-close]'); page.wait_for_timeout(1000 * 0.3); page.screenshot(path=str(OUT / '08-plans.png'), full_page=True)
    page.click('[data-plan="industry"]'); settle(page, '() => location.pathname.endsWith("/contact/")')
    page.fill('[name=name]', 'Ada Lovelace'); page.fill('[name=organisation]', 'Sunrise Energy Ltd'); page.fill('[name=num_sites]', '12'); page.select_option('[name=use_case]', 'grid')
    settle(page, '() => document.querySelector("[name=email]").value'); page.click('#contact-form button[type=submit]')
    settle(page, '() => /reply within 2 working days/.test(document.body.textContent)')
    to = re.search(r"contactEmail: '([^']+)'", (WEB / 'config.js').read_text()).group(1)
    mail = [e for e in be.emails if 'enquiry' in e.get('subject', '')]
    check('the enquiry is emailed to the address in config.js', len(mail) == 1 and mail[0]['to'] == to and 'Ada Lovelace (Sunrise Energy Ltd)' in mail[0]['subject'] and 'Sunrise Energy Ltd' in mail[0]['body'] and 'grid' in mail[0]['body'], mail[0]['subject'] if mail else 'none')
    check('waitlist and academic applications are emailed too', sum('waitlist' in e['subject'] for e in be.emails) == 1 and sum('academic application' in e['subject'] for e in be.emails) == 1 and all(e['to'] == to for e in be.emails))
    check('contact form saves a sales lead', be.leads and be.leads[0]['num_sites'] == 12 and be.leads[0]['use_case'] == 'grid' and be.leads[0]['organisation'] == 'Sunrise Energy Ltd', json.dumps(be.leads[:1])[:200])
    # Continue with Google: out through the account service, back through the Base44 relay page, on to the page asked for
    page.evaluate('() => localStorage.clear()'); be.google_user = 'new.user@example.test'
    page.goto(SITE + 'login/?returnTo=' + up.quote('settings/', safe='')); settle(page, '() => document.querySelector("#password")')
    page.click('text=Continue with Google')
    settle(page, '() => location.pathname.endsWith("/settings/") && document.documentElement.dataset.auth === "in"', 20000)
    gq = be.google[-1]
    check('Google sign-in returns through the Base44 relay page and lands on the page asked for', gq['from_url'] == ['https://arien.base44.app/sso-return'] and gq['app_id'] == ['6a4fb7864ffb55c91635b7d7'] and 'access_token' not in page.url
          and page.evaluate('() => !!localStorage.getItem("base44_access_token") && sessionStorage.getItem("arien:after-login") === null'), page.url)
    # the older form, with the token in the query, is still accepted and cleaned
    page.evaluate('() => localStorage.clear()')
    tok = be.token_for(be.users['new.user@example.test'])
    page.goto(SITE + 'twin/?access_token=' + tok + '&is_new_user=false'); settle(page, '() => document.documentElement.dataset.auth === "in"')
    check('Google return: token stored, address cleaned', 'access_token' not in page.url and page.evaluate('() => !!localStorage.getItem("base44_access_token")'), page.url)
    check('account pages: no page errors', not logs, ' | '.join(logs)[:400])
    ctx.close()

    # ---------- 7. another user sees none of it; a returnTo to another site is ignored
    be.add_user('other@example.test', 'pw-2', full_name='Bo Other', plan='Pro')
    ctx, page, logs = new_page(b, be)
    page.goto(SITE + 'login/?returnTo=' + up.quote('https://evil.example/steal', safe='')); settle(page, '() => document.querySelector("#password")')
    page.fill('#email', 'other@example.test'); page.fill('#password', 'pw-2'); page.click('button[type=submit]')
    settle(page, '() => document.documentElement.dataset.auth === "in" && !location.pathname.endsWith("/login/")')
    check('a return address on another site is ignored (goes home)', page.url == SITE, page.url)
    page.goto(SITE + 'twin/?siteId=S1'); fr = twin_frame(page); twin_ready(fr, '__arien.state.account')
    st = fr.evaluate('() => ({ sites: __arien.state.account.sites.length, open: __arien.state.accountSiteId, limit: __arien.state.account.siteLimit, first: __arien.state.account.user.first_name })')
    check('a second user gets their own empty account, even when asking for someone else\'s site id', st == {'sites': 0, 'open': None, 'limit': None, 'first': 'Bo'}, json.dumps(st))
    ctx.close()

    # ---------- 8. phone width: menu, layout
    ctx, page, logs = new_page(b, be, width=390, height=844, fixed=datetime(2026, 11, 16, 12, 30, tzinfo=timezone.utc))
    page.goto(SITE); settle(page, '() => document.querySelector("#menu-btn")')
    m = page.evaluate('() => ({ btn: !!document.querySelector("#menu-btn").offsetParent, links: !!document.querySelector(".nav-links").offsetParent, overflow: document.documentElement.scrollWidth - innerWidth })')
    page.click('#menu-btn'); settle(page, '() => !document.querySelector("#mobile-menu").hidden')
    items = page.evaluate('() => [...document.querySelectorAll("#mobile-menu .mm-item")].filter(e => e.offsetParent).map(e => e.textContent)')
    check('phone: menu button, no sideways scroll, menu lists the pages and Log in / Register', m['btn'] and not m['links'] and m['overflow'] <= 0 and items == ['How it works', "Who it's for", 'Pricing', 'Log in', 'Register'], json.dumps([m, items]))
    page.screenshot(path=str(OUT / '09-phone-menu.png'))
    ctx.close()
    ctx, page, logs = new_page(b, be, width=721, height=904, fixed=datetime(2026, 11, 16, 12, 30, tzinfo=timezone.utc))
    page.goto(SITE); settle(page, '() => document.querySelector(".globe-stage-inner.ready canvas")', 60000); page.wait_for_timeout(1000 * 2)
    page.screenshot(path=str(OUT / '10-home-721.png'))
    for slug in ['accuracy', 'privacy', 'register', 'forgot-password', 'reset-password', 'contact']:
        page.goto(SITE + slug + '/'); page.wait_for_timeout(1000 * 0.5); page.screenshot(path=str(OUT / f'11-{slug}.png'))
    ctx.close()
    b.close()
fails = [k for k, v in results.items() if not v]
print(f'{len(results) - len(fails)} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
