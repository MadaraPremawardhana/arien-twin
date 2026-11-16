// The sky theme: dawn, day, dusk or night from the sun's height where the user is.
// Location comes from, in order: the user's last saved site, their last search, the device (only if already allowed),
// otherwise the clock. Settings can pin day or night. Same rules as arien.base44.app.
import SunCalc from 'suncalc';
import { store } from './core.js';
import { auth, signedIn, SolarSite, cachedUser } from './api.js';

const LAST_SEARCH = 'arien:last-search', PHASE = 'arien:phase', THEME = 'arien:theme';
const REFRESH_MS = 5 * 60 * 1000;

export function phaseByClock(d = new Date()) {
  const h = d.getHours();
  return h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night';
}
/** Phase from the sun's elevation: below -6° night, above 6° day, between them dawn before solar noon and dusk after. */
export function phaseBySun(lat, lng, d = new Date()) {
  const elevation = SunCalc.getPosition(d, lat, lng).altitude * 180 / Math.PI;
  if (elevation < -6) return { phase: 'night', elevation };
  if (elevation >= 6) return { phase: 'day', elevation };
  const noon = SunCalc.getTimes(d, lat, lng).solarNoon;
  const before = !noon || Number.isNaN(noon.getTime()) ? d.getHours() < 12 : d < noon;
  return { phase: before ? 'dawn' : 'dusk', elevation };
}

export const lastSearch = () => { const t = store.json(LAST_SEARCH); return t && typeof t.lat === 'number' && typeof t.lng === 'number' ? t : null; };
export const saveSearch = ({ lat, lng, label }) => store.set(LAST_SEARCH, JSON.stringify({ lat, lng, label: label || '' }));

const state = { coords: null, source: 'time', mode: 'auto', phase: document.documentElement.dataset.phase || phaseByClock(), elevation: null, asking: false, blocked: false };
const listeners = new Set();
export const theme = {
  get state() { return state; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** Pin the theme ('day' | 'night') or follow the sun ('auto'). */
  setMode(mode) { state.mode = mode === 'day' || mode === 'night' ? mode : 'auto'; store.set(THEME, state.mode); apply(); },
  /** A location chosen on the page (search, "use my location"). */
  setCoords(lat, lng, source = 'search') { state.coords = { lat, lng }; state.source = source; apply(); },
  requestLocation() {
    if (!navigator.geolocation) { state.blocked = true; emit(); return; }
    state.asking = true; emit();
    navigator.geolocation.getCurrentPosition(
      p => { state.asking = false; state.blocked = false; theme.setCoords(p.coords.latitude, p.coords.longitude, 'device'); },
      () => { state.asking = false; state.blocked = true; emit(); }, { timeout: 10000 });
  }
};
function emit() { listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); }

function apply() {
  const pinned = state.mode === 'day' || state.mode === 'night';
  let phase;
  if (state.coords) { const r = phaseBySun(state.coords.lat, state.coords.lng); state.elevation = r.elevation; phase = pinned ? state.mode : r.phase; }
  else { state.elevation = null; phase = pinned ? state.mode : phaseByClock(); }
  state.phase = phase;
  document.documentElement.dataset.phase = phase;
  store.set(PHASE, JSON.stringify({ phase, t: Date.now() }));   // the next page paints with this before scripts load
  emit();
}

const siteCoords = (s) => { const lat = s && (s.latitude ?? s.lat), lng = s && (s.longitude ?? s.lng); return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null; };
async function deviceAllowed() {
  try { return !!navigator.geolocation && !!navigator.permissions && (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; }
  catch (e) { return false; }
}

async function locate() {
  let mode = store.get(THEME) || 'auto', coords = null, source = 'time';
  if (signedIn()) {
    try {
      const me = await auth.me();
      mode = (me.settings && me.settings.theme) || mode;
      const sites = await SolarSite.filter({ created_by_id: me.id }, { sort: '-created_date', limit: 10, fields: ['id', 'latitude', 'longitude'] });
      coords = siteCoords(sites.find(s => s.id === me.last_site_id)) || sites.map(siteCoords).find(Boolean) || null;
      if (coords) source = 'site';
    } catch (e) { /* signed out meanwhile, or offline: fall through */ }
  }
  state.mode = mode === 'day' || mode === 'night' ? mode : 'auto'; store.set(THEME, state.mode);
  if (!coords) {
    const s = lastSearch();
    if (s) { coords = { lat: s.lat, lng: s.lng }; source = 'search'; }
    else if (await deviceAllowed()) {
      navigator.geolocation.getCurrentPosition(p => theme.setCoords(p.coords.latitude, p.coords.longitude, 'device'), () => {}, { timeout: 8000 });
    }
  }
  if (coords && !state.coords) { state.coords = coords; state.source = source; }   // a place picked on the page meanwhile wins
  apply();
}

export function startTheme() {
  const u = cachedUser(); const pinned = (u && u.settings && u.settings.theme) || store.get(THEME);
  if (pinned === 'day' || pinned === 'night') state.mode = pinned;
  apply();
  locate();
  setInterval(apply, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) apply(); });
}
