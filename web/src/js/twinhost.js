// The page around the digital twin ("Open Digital Twin" and "Dashboard").
// The twin runs in an iframe and keeps each user's project in their account through this page: it asks, this page
// reads and writes the user's SolarSite records with their token. The token, password and email never enter the twin.
// Message contract (shared with the twin's src/account.js): requests {source:'arien-twin', v:1, id, type, …},
// replies {source:'arien-base44', id, type, …} with the request's id.
import { CONFIG, $, $$, go, url } from './core.js';
import { auth, signedIn, SolarSite, displayName, planKey, siteLimit } from './api.js';

const TWIN_SRC = 'arien-twin', HOST_SRC = 'arien-base44', MAX_BYTES = 500 * 1024;
const FIELDS = ['name', 'latitude', 'longitude', 'panel_count', 'panel_watt', 'capacity_kwp', 'tilt_deg', 'azimuth_deg', 'system_losses_pct', 'import_tariff_p', 'export_tariff_p',
  'install_cost_gbp', 'obstructions', 'shading_pct', 'annual_kwh_cached', 'twin_scene', 'twin_results'];
const VIEWS = { design: { path: 'twin/', title: 'Digital Twin · Arien' }, dashboard: { path: 'dashboard/', title: 'Dashboard · Arien' } };
const PAGES = { '/plans': 'plans/', '/settings': 'settings/', '/contact': 'contact/', '/': '' };

const bytes = (o) => { try { return new TextEncoder().encode(JSON.stringify(o)).length; } catch (e) { return Infinity; } };
const summary = (s) => ({ id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude, capacity_kwp: s.capacity_kwp, panel_count: s.panel_count, updated_date: s.updated_date,
  has_twin_scene: !!(s.twin_scene && Object.keys(s.twin_scene).length > 0) });
/** A record as the twin gets it: no owner email; panels drawn in the web designer parsed when stored inline */
function full(s) {
  if (!s) return null;
  const { created_by, ...rec } = s;
  if (!rec.twin_scene && typeof rec.panels_json === 'string' && !/^https?:/.test(rec.panels_json)) { try { rec.panel_positions = JSON.parse(rec.panels_json); } catch (e) { rec.panel_positions = null; } }
  return rec;
}

/** The message handler, separate from the page so it can be tested: `api` is {auth, SolarSite}. */
export function createHandler(api, { openSiteId = null, openLast = true, navigate = () => {}, onView = () => {} } = {}) {
  let mine = new Set();
  const listSites = async (me) => { const rows = await api.SolarSite.filter({ created_by_id: me.id }, { sort: '-updated_date', limit: 200 }); mine = new Set(rows.map(r => r.id)); return rows; };
  /** Only the signed-in user's own records are touched, whatever id the twin sends (the server's access rules apply as well). */
  async function owned(id, me) {
    if (typeof id !== 'string' || !id) throw new Error('No site id');
    if (!mine.has(id)) await listSites(me);
    if (!mine.has(id)) throw new Error('Not your site');
  }
  async function save(msg, me) {
    const fields = msg.fields && typeof msg.fields === 'object' ? msg.fields : {}, rec = {};
    FIELDS.forEach(k => { if (fields[k] !== undefined) rec[k] = fields[k]; });
    if (msg.name !== undefined) rec.name = String(msg.name).slice(0, 200);
    if (msg.twin_scene !== undefined) rec.twin_scene = msg.twin_scene;
    if (msg.twin_results !== undefined) rec.twin_results = msg.twin_results;
    rec.source = 'twin'; rec.twin_saved_at = new Date().toISOString();
    if (msg.id) {
      await owned(msg.id, me);
      const s = await api.SolarSite.update(msg.id, rec);
      await api.auth.updateMe({ last_site_id: s.id }).catch(() => {});
      return { ok: true, id: s.id, name: s.name };
    }
    const limit = siteLimit(me.plan);
    if (Number.isFinite(limit) && (await api.SolarSite.count({ created_by_id: me.id })) >= limit) return { ok: false, reason: 'limit' };
    if (rec.panel_count === undefined) rec.panel_count = 0;
    const s = await api.SolarSite.create(rec); mine.add(s.id);
    await api.auth.updateMe({ last_site_id: s.id }).catch(() => {});
    return { ok: true, id: s.id, name: s.name };
  }
  return async function handle(msg) {
    const reply = { source: HOST_SRC, id: msg.id };
    switch (msg.type) {
      case 'hello': {
        const me = await api.auth.me(), sites = await listSites(me);
        // the site asked for; otherwise the project the user last worked on, so it follows them to any browser
        const want = msg.site || openSiteId || (openLast && sites.length ? (mine.has(me.last_site_id) ? me.last_site_id : sites[0].id) : null);
        let open = null;
        if (want && mine.has(want)) open = full(sites.find(s => s.id === want));
        const name = String(displayName(me) || '').trim(), first = name && !name.includes('@') ? name.split(/\s+/)[0] : '';
        const limit = siteLimit(me.plan);
        return { ...reply, type: 'session', user: { id: me.id, first_name: first, plan: planKey(me.plan) }, sites: sites.map(summary), open, siteLimit: Number.isFinite(limit) ? limit : null };
      }
      case 'site.list': { const me = await api.auth.me(); return { ...reply, type: msg.type, sites: (await listSites(me)).map(summary) }; }
      case 'site.get': { const me = await api.auth.me(); await owned(msg.id, me); return { ...reply, type: msg.type, site: full(await api.SolarSite.get(msg.id)) }; }
      case 'site.save': { const me = await api.auth.me(); return { ...reply, type: msg.type, ...(await save(msg, me)) }; }
      case 'site.results': {
        const me = await api.auth.me(); await owned(msg.id, me);
        const rec = { cached_at: new Date().toISOString() };
        if (msg.twin_results !== undefined) rec.twin_results = msg.twin_results;
        if (typeof msg.annual_kwh === 'number' && isFinite(msg.annual_kwh)) rec.annual_kwh_cached = msg.annual_kwh;
        await api.SolarSite.update(msg.id, rec);
        return { ...reply, type: msg.type, ok: true };
      }
      case 'site.delete': { const me = await api.auth.me(); await owned(msg.id, me); await api.SolarSite.remove(msg.id); mine.delete(msg.id); return { ...reply, type: msg.type, ok: true }; }
      case 'navigate': if (typeof msg.path === 'string') navigate(msg.path); return { ...reply, type: msg.type, ok: true };
      case 'view': onView(msg.view); return null;   // a notice from the twin, no reply
      default: return null;
    }
  };
}

export function startTwinHost(view) {
  const here = (v) => VIEWS[v].path + location.search;
  if (!signedIn()) { go('login/?returnTo=' + encodeURIComponent(here(view))); return; }
  const q = new URLSearchParams(location.search), twin = new URL(CONFIG.twinUrl), ORIGIN = twin.origin;
  const siteId = q.get('siteId') || q.get('site');
  twin.searchParams.set('embed', 'web');
  if (siteId) twin.searchParams.set('site', siteId);
  const lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lng') ?? q.get('lon'));
  const newPlace = !siteId && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;   // start a new design there
  if (newPlace) {
    twin.searchParams.set('lat', lat); twin.searchParams.set('lon', lon);
    if (q.get('q')) twin.searchParams.set('q', q.get('q').slice(0, 120));
  }
  const base = twin.href.split('#')[0];
  const frame = $('#twin-frame');
  let current = view;

  function paint(v) {
    $$('.seg a.seg-btn').forEach(a => a.classList.toggle('on', a.dataset.appView === 'dashboard' && v === 'dashboard'));
    if (VIEWS[v]) document.title = VIEWS[v].title;
  }
  /** Switch between the designer and the dashboard without reloading the twin (only the address fragment changes). */
  function show(v, { push = true, tellTwin = true } = {}) {
    if (!VIEWS[v]) return;
    if (tellTwin && v !== current) frame.src = base + '#' + v;
    current = v; paint(v);
    const target = url(here(v));
    if (location.href !== target) (push ? history.pushState : history.replaceState).call(history, { view: v }, '', target);
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-app-view]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault(); show(a.dataset.appView);
  });
  addEventListener('popstate', () => { const v = location.pathname.endsWith('/dashboard/') ? 'dashboard' : 'design'; show(v, { push: false }); });

  const handle = createHandler({ auth, SolarSite }, {
    openSiteId: siteId, openLast: !newPlace,
    navigate: (path) => { if (path in PAGES) go(PAGES[path]); },
    onView: (v) => { if (VIEWS[v]) show(v, { push: false, tellTwin: false }); else current = v; }
  });
  addEventListener('message', async (e) => {
    if (e.origin !== ORIGIN || e.source !== frame.contentWindow) return;
    const msg = e.data;
    if (!msg || typeof msg !== 'object' || msg.source !== TWIN_SRC || typeof msg.type !== 'string' || bytes(msg) > MAX_BYTES) return;
    let reply;
    try { reply = await handle(msg); }
    catch (err) {
      if (!signedIn()) { go('login/?returnTo=' + encodeURIComponent(here(current in VIEWS ? current : 'design'))); return; }   // the session ended
      reply = { source: HOST_SRC, id: msg.id, type: msg.type, ok: false };
    }
    if (reply && frame.contentWindow) frame.contentWindow.postMessage(reply, ORIGIN);
  });
  paint(view);
  frame.src = base + '#' + view;   // set after the listener is in place, so the twin's hello is never missed
}
