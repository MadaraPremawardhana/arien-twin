/* ARIEN places — find a site by place name, street address, postcode or coordinates, and keep
 * named sites. Geocoders (all free, no key, called only when the user presses Search/Go):
 *   UK postcodes     → postcodes.io (ONS/OS open data)
 *   addresses, places, postcodes worldwide → OpenStreetMap Nominatim (max 1 request/s, no autocomplete)
 *   fallback          → Open-Meteo geocoding (place names)
 * With Google Photorealistic tiles the app passes a Google geocoder instead, as Google's terms require.
 * Browser: window.ArienPlaces; Node: module.exports. */
(function (root) {
  'use strict';
  const UK_FULL = /^\s*([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\s*$/i;
  const UK_OUT = /^\s*([A-Z]{1,2}\d[A-Z\d]?)\s*$/i;
  const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  /** "51.9956, -0.9906", "51.9956 -0.9906" or "51.9956N 0.9906W" → {lat, lon} or null */
  function parseCoords(s) {
    const t = String(s).trim().replace(/°/g, '');
    let m = t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) { const lat = +m[1], lon = +m[2]; return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null; }
    m = t.match(/^(\d{1,2}(?:\.\d+)?)\s*([NS])\s*[,;\s]?\s*(\d{1,3}(?:\.\d+)?)\s*([EW])$/i);
    if (m) { const lat = +m[1] * (/s/i.test(m[2]) ? -1 : 1), lon = +m[3] * (/w/i.test(m[4]) ? -1 : 1); return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null; }
    return null;
  }
  const isUkPostcode = (s) => UK_FULL.test(s);
  const isUkOutcode = (s) => UK_OUT.test(s) && /\d/.test(s) && String(s).trim().length <= 4;
  const normPostcode = (s) => { const m = String(s).match(UK_FULL); return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : String(s).trim().toUpperCase(); };

  async function json(f, url) {
    const r = await f(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return r.json();
  }
  async function postcodesIo(f, s) {
    if (isUkPostcode(s)) {
      const pc = normPostcode(s);
      try {
        const j = await json(f, `https://api.postcodes.io/postcodes/${encodeURIComponent(pc.replace(' ', ''))}`);
        const r = j.result; if (!r) return [];
        return [{ name: r.postcode, detail: [r.parish && !/unparished/i.test(r.parish) ? r.parish : null, r.admin_district, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude, source: 'postcodes.io', place: r.admin_district || r.postcode }];
      } catch (e) { if (e.status === 404) return []; throw e; }
    }
    const oc = String(s).trim().toUpperCase();
    try {
      const j = await json(f, `https://api.postcodes.io/outcodes/${encodeURIComponent(oc)}`);
      const r = j.result; if (!r || r.latitude == null) return [];
      const dist = Array.isArray(r.admin_district) ? r.admin_district.slice(0, 2).join(', ') : r.admin_district;
      return [{ name: `${r.outcode} (postcode area)`, detail: [dist, Array.isArray(r.country) ? r.country[0] : r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude, source: 'postcodes.io', place: Array.isArray(r.admin_district) ? r.admin_district[0] : r.outcode }];
    } catch (e) { if (e.status === 404) return []; throw e; }
  }
  async function nominatim(f, s) {
    const j = await json(f, `https://nominatim.openstreetmap.org/search?${q({ format: 'jsonv2', q: s, limit: 6, addressdetails: 1, 'accept-language': 'en' })}`);
    return (j || []).map(r => {
      const a = r.address || {};
      const parts = String(r.display_name || '').split(', ');
      const town = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || parts[1] || parts[0];
      return { name: parts.slice(0, 2).join(', '), detail: parts.slice(2, 5).join(', '), lat: +r.lat, lon: +r.lon, source: 'OpenStreetMap', place: town };
    });
  }
  async function openMeteo(f, s) {
    const j = await json(f, `https://geocoding-api.open-meteo.com/v1/search?${q({ name: s, count: 6, language: 'en', format: 'json' })}`);
    return (j.results || []).map(r => ({ name: r.name, detail: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude, source: 'Open-Meteo', place: r.name }));
  }

  /**
   * Search for a place. opts.google(query) → results replaces the open geocoders (Google tiles in view).
   * Returns {results:[{name, detail, lat, lon, source, place}], note}
   */
  async function search(s, opts = {}) {
    const f = opts.fetch || fetch;
    s = String(s || '').trim();
    if (s.length < 2) return { results: [], note: 'Type a place, address or postcode.' };
    const c = parseCoords(s);
    if (c) return { results: [{ name: `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`, detail: 'Coordinates', lat: c.lat, lon: c.lon, source: 'coordinates', place: '' }], note: '' };
    if (opts.google) {
      const results = await opts.google(s);
      return { results, note: results.length ? '' : 'Google found nothing. Try a fuller address, or enter coordinates.' };
    }
    const chain = [nominatim, openMeteo];
    if (isUkPostcode(s) || isUkOutcode(s)) chain.unshift(postcodesIo);
    let failed = 0;
    for (const g of chain) {
      try { const r = (await g(f, s)).filter(x => isFinite(x.lat) && isFinite(x.lon)); if (r.length) return { results: r, note: '' }; }
      catch (e) { failed++; }
    }
    if (failed === chain.length) throw new Error('Could not reach the place search. Check your connection, or enter coordinates.');
    return { results: [], note: isUkPostcode(s) ? 'That postcode was not found. Check it, or try the street and town.' : 'Nothing found. Try a town, a street with its town, or a postcode.' };
  }

  // ---------- names ----------
  const COMPASS8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const facingWord = (az) => COMPASS8[Math.round((((az % 360) + 360) % 360) / 45) % 8];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** Short place word from a site name: "Buckingham, England, United Kingdom" → "Buckingham" */
  function placeWord(site) {
    const n = String((site && site.name) || '').trim();
    if (!n || /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(n)) return `Site at ${Math.abs(site.lat).toFixed(3)}°${site.lat >= 0 ? 'N' : 'S'} ${Math.abs(site.lon).toFixed(3)}°${site.lon >= 0 ? 'E' : 'W'}`;
    return n.split(',')[0].replace(/\s*\(postcode area\)\s*/i, '').trim();
  }
  /**
   * Meaningful default name: "Buckingham 5.2 kWp south-facing", "Buckingham 9.8 kWp east–west",
   * or "Buckingham site, 2 Nov" with no arrays. Made unique against existing names.
   */
  function autoName(site, arrays, kwpOf, existing = [], now = Date.now()) {
    const place = placeWord(site);
    let base;
    if (arrays && arrays.length) {
      const kwp = arrays.reduce((s, a) => s + kwpOf(a), 0);
      const dirs = [...new Set(arrays.map(a => facingWord(a.azimuth)))];
      const facing = dirs.length === 1 ? `${dirs[0]}-facing` : dirs.length === 2 ? `${dirs[0]} + ${dirs[1]}` : 'mixed orientation';
      base = `${place} ${kwp >= 10 ? kwp.toFixed(1) : kwp.toFixed(2)} kWp ${facing}`;
    } else {
      const d = new Date(now); base = `${place} site, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    }
    return uniqueName(base, existing);
  }
  function uniqueName(base, existing) {
    const taken = new Set(existing.map(s => s.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; i < 1000; i++) { const n = `${base} (${i})`; if (!taken.has(n.toLowerCase())) return n; }
    return `${base} ${Date.now()}`;
  }

  // ---------- saved sites (this browser) ----------
  const STORE = 'arien-twin-sites-v1', MAX = 60;
  function listSites(storage) {
    try { const v = JSON.parse(storage.getItem(STORE) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  /** Save {name, snap}; a blank name gets an automatic one. Same name replaces. Returns the entry. */
  function saveSite(storage, { name, snap, auto, now = Date.now() }) {
    const list = listSites(storage);
    const clean = String(name || '').trim().slice(0, 80);
    const i = list.findIndex(s => s.name.toLowerCase() === clean.toLowerCase());
    const entry = { id: i >= 0 ? list[i].id : 's' + now.toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: clean, auto: !!auto, savedAt: new Date(now).toISOString(), snap };
    if (i >= 0) list.splice(i, 1);
    list.unshift(entry);
    storage.setItem(STORE, JSON.stringify(list.slice(0, MAX)));
    return { entry, replaced: i >= 0 };
  }
  function removeSite(storage, id) { storage.setItem(STORE, JSON.stringify(listSites(storage).filter(s => s.id !== id))); }
  function renameSite(storage, id, name) {
    const list = listSites(storage); const s = list.find(x => x.id === id); if (!s) return null;
    s.name = uniqueName(String(name).trim() || s.name, list.filter(x => x.id !== id).map(x => x.name)); s.auto = false;
    storage.setItem(STORE, JSON.stringify(list)); return s;
  }

  const api = { parseCoords, isUkPostcode, isUkOutcode, normPostcode, search, facingWord, placeWord, autoName, uniqueName, listSites, saveSite, removeSite, renameSite, STORE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArienPlaces = api;
})(typeof window !== 'undefined' ? window : globalThis);
