// Landing page: location search, "use my location", the 48-hour preview card and the globe.
import { $, esc, url } from './core.js';
import { signedIn } from './api.js';
import { theme, saveSearch } from './theme.js';
import { previewForecast, summarise, chartSvg, hourLabel } from './forecast.js';

const DEMO_PLACE = 'MK18 1EG';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
let globe = null, marker = null, cardSeq = 0;

async function reverseLabel(lat, lng) {
  try {
    const a = (await (await fetch(`${NOMINATIM}/reverse?lat=${lat}&lon=${lng}&format=json`, { headers: { Accept: 'application/json' } })).json()).address || {};
    return [a.town || a.city || a.village || a.suburb || a.county || '', a.postcode].filter(Boolean).join(' · ');
  } catch (e) { return ''; }
}

function showError(msg) { const el = $('#loc-err'); el.textContent = msg || ''; el.hidden = !msg; }

/** A place was chosen: remember it, turn the globe to it, tint the sky for it and build the preview. */
function choose(lat, lng, label, { fly = true, remember = true, source = 'search' } = {}) {
  marker = { lat, lng };
  if (remember) saveSearch({ lat, lng, label });
  theme.setCoords(lat, lng, source);
  if (globe) { globe.setMarker(marker); if (fly) globe.flyTo(marker); }
  renderCard(lat, lng, label);
}

async function search(text) {
  showError('');
  const q = (text ?? $('#loc-input').value).trim(); if (!q) return;
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(q)) {
    const [lat, lng] = q.split(',').map(v => parseFloat(v.trim()));
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) { showError('Coordinates out of range'); return; }
    choose(lat, lng, q); return;
  }
  const btn = $('#loc-go'), icon = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const r = await (await fetch(`${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=json&limit=1`, { headers: { Accept: 'application/json' } })).json();
    if (r && r[0]) choose(parseFloat(r[0].lat), parseFloat(r[0].lon), q); else showError("Couldn't find that location");
  } catch (e) { showError('Location search failed — try again'); }
  finally { btn.disabled = false; btn.innerHTML = icon; }
}

function renderCard(lat, lng, label) {
  const slot = $('#fcard-slot'), seq = ++cardSeq;
  const place = `twin/?lat=${lat}&lng=${lng}${label ? `&q=${encodeURIComponent(label)}` : ''}`;
  const save = signedIn() ? url(place) : url(`register/?returnTo=${encodeURIComponent(place)}`);
  slot.innerHTML = `<div class="fcard" style="margin-top: 14px;">
    <div class="fcard-top"><div><div class="ttl">Your 48-hour solar preview</div><div class="loc">${esc(label)} · 4 kWp · 35° tilt · south-facing</div></div><span class="badge badge-sun">● physics model</span></div>
    <div style="display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px;">
      <div id="fc-chart" style="flex: 1 1 190px; min-width: 170px; height: 110px; display: flex; align-items: flex-end;"><div style="display: flex; align-items: center; gap: 8px; font-family: var(--fm); font-size: 12px; color: var(--ink-3);"><span class="spinner"></span> Building your forecast…</div></div>
      <div id="fc-map" style="flex: 0 0 124px; min-width: 110px; height: 110px; border-radius: 12px; overflow: hidden; border: 1px solid var(--line);"></div>
    </div>
    <div class="fcard-foot" style="margin-top: 14px;">
      <div><div class="k">TOMORROW</div><div class="v" id="fc-tomorrow">—</div></div>
      <div><div class="k" id="fc-best-k">BEST 3 HOURS</div><div class="v" id="fc-best">—</div></div>
      <div><div class="k">PEAK</div><div class="v" id="fc-peak">—</div></div>
    </div>
    <a class="btn btn-sun" style="width: 100%; justify-content: center; margin-top: 14px;" href="${esc(save)}">Save this site, free <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a>
  </div>`;
  previewForecast(lat, lng, 48).then(rows => {
    if (seq !== cardSeq) return;
    if (!rows.length) throw new Error('empty');
    const s = summarise(rows);
    $('#fc-chart').innerHTML = chartSvg(rows);
    $('#fc-tomorrow').textContent = `${s.tomorrowKwh.toFixed(1)} kWh`;
    $('#fc-peak').textContent = `${s.peakKw.toFixed(1)} kW`;
    if (s.best) {
      const d = s.best.start.day, when = d === s.today ? 'today' : d === s.tomorrowDay ? 'tomorrow' : new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      $('#fc-best-k').textContent = `BEST 3 HOURS · ${when.toUpperCase()}`;
      $('#fc-best').textContent = `${hourLabel(s.best.start)}–${hourLabel(s.best.end)}`;
    }
  }).catch(() => {
    if (seq !== cardSeq) return;
    $('#fc-chart').innerHTML = `<div style="font-family: var(--fb); font-size: 13px; color: var(--down); line-height: 1.5;">Couldn't load the forecast for this location — try another.</div>`;
  });
  import('./minimap.js').then(m => { if (seq === cardSeq) m.miniMap($('#fc-map'), lat, lng); }).catch(() => {});
}

function webgl() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); }
  catch (e) { return false; }
}
function startGlobe() {
  const stage = $('#globe-stage'); if (!stage) return;
  if (!webgl()) { stage.innerHTML = `<img class="globe-static" src="${url('assets/earth-day.jpg')}" alt="" aria-hidden="true">`; return; }
  setTimeout(() => import('./globe.js').then(m => {
    globe = m.heroGlobe(stage, { day: url('assets/earth-day.jpg'), night: url('assets/earth-night.jpg'), onReady: () => { const p = stage.querySelector('.globe-placeholder'); if (p) p.remove(); } });
    if (marker) { globe.setMarker(marker); globe.flyTo(marker); }
    else if (theme.state.coords) globe.setMarker(theme.state.coords);
    theme.onChange(() => globe.refreshColours());
  }).catch(e => console.warn('globe', e)), 350);
}

function paintChip() {
  const chip = $('#loc-chip'), s = theme.state;
  chip.hidden = !!s.coords; chip.disabled = s.asking;
  $('#loc-chip-text').textContent = s.asking ? 'Locating…' : s.blocked ? 'Location blocked in your browser' : 'Use my location';
}

/** The device's position, unless the browser has already refused it (as on arien.base44.app, this may ask). */
async function deviceLocation() {
  if (!navigator.geolocation) return null;
  try { const p = await navigator.permissions?.query?.({ name: 'geolocation' }); if (p && p.state === 'denied') return null; } catch (e) { /* ask anyway */ }
  const pos = await new Promise(res => navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }));
  if (!pos) return null;
  const lat = pos.coords.latitude, lng = pos.coords.longitude;
  return { lat, lng, label: (await reverseLabel(lat, lng)) || 'Your location' };
}

export function startHome() {
  $('#loc-form').addEventListener('submit', (e) => { e.preventDefault(); search(); });
  $('#live-forecast').addEventListener('click', () => { $('#loc-input').value = DEMO_PLACE; search(DEMO_PLACE); });
  $('#loc-chip').addEventListener('click', () => theme.requestLocation());
  theme.onChange(paintChip); paintChip();
  startGlobe();
  deviceLocation().then(here => { if (here && !marker) choose(here.lat, here.lng, here.label, { remember: false, source: 'device' }); });
  // the theme's own place (last site or search) puts the marker on the globe, as on the original
  theme.onChange((s) => { if (!marker && s.coords && globe) globe.setMarker(s.coords); });
}
