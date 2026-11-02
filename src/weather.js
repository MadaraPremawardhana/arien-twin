/* ARIEN weather layer — Open-Meteo request builders, parsing, CSV import and
 * time interpolation. Pure apart from fetch(). Browser: window.ArienWeather; Node: module.exports. */
(function (root) {
  'use strict';
  const PH = (typeof module !== 'undefined' && module.exports) ? require('./physics.js') : root.ArienPhysics;

  // Only what the thesis models and the UE "Response overview" use:
  //  temperature + wind speed → panel thermal model; cloud cover → Kasten, Bálint, Karamov–Naumov;
  //  GHI (shortwave) → Real-World GHI and HDKR; diffuse → HDKR beam/diffuse split;
  //  weather code → weather description (and rain/snow visuals); wind direction → overview.
  // Seven variables keep each request at the weight of a single Open-Meteo call.
  const BASE_VARS = ['temperature_2m', 'cloud_cover', 'wind_speed_10m', 'wind_direction_10m', 'weather_code',
    'shortwave_radiation', 'diffuse_radiation'];
  const PREV_VARS = BASE_VARS;
  /** Precipitation rate (mm/h) and snow estimated from the WMO weather code, used only for visuals */
  const CODE_PRECIP = { 51: 0.2, 53: 0.5, 55: 1, 56: 0.3, 57: 0.8, 61: 0.8, 63: 2.5, 65: 6, 66: 1, 67: 3, 80: 1.5, 81: 4, 82: 10, 95: 5, 96: 8, 99: 12 };
  const CODE_SNOW = { 71: 0.5, 73: 1.5, 75: 3, 77: 0.3, 85: 1, 86: 3 };

  const MODES = {
    current: { label: 'Now (live)', host: 'https://api.open-meteo.com/v1/forecast' },
    forecast: { label: 'Forecast, next 7 days', host: 'https://api.open-meteo.com/v1/forecast' },
    historical: { label: 'Historical weather', host: 'https://historical-forecast-api.open-meteo.com/v1/forecast' },
    era5: { label: 'Historical (ERA5 reanalysis)', host: 'https://archive-api.open-meteo.com/v1/archive' },
    previous: { label: 'Historical forecast, N days ahead', host: 'https://previous-runs-api.open-meteo.com/v1/forecast' },
    year: { label: 'ERA5 reanalysis weather, last 12 months', host: 'https://archive-api.open-meteo.com/v1/archive' }
  };
  /** The 365 days used for yield estimates: ERA5 is published about 5 days behind, so end 6 days ago */
  function yearWindow(now = Date.now()) {
    const end = new Date(now - 6 * 86400000), start = new Date(end.getTime() - 364 * 86400000);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }

  function q(params) { return Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); }

  /** opts: {mode, lat, lon, start (YYYY-MM-DD), end, leadDays (1-7)} */
  function buildUrl(opts) {
    let m = MODES[opts.mode]; if (!m) throw new Error('Unknown weather mode ' + opts.mode);
    const common = { latitude: opts.lat.toFixed(5), longitude: opts.lon.toFixed(5), timezone: 'auto', timeformat: 'unixtime', wind_speed_unit: 'ms' };
    // Commercial plan: "customer-" host prefix plus &apikey= (Open-Meteo docs, URL parameters table)
    const key = (opts.apiKey || '').trim();
    if (key) { common.apikey = key; m = { ...m, host: m.host.replace('https://', 'https://customer-') }; }
    if (opts.mode === 'current') return `${m.host}?${q({ ...common, hourly: BASE_VARS.join(','), past_days: 1, forecast_days: 2 })}`;
    if (opts.mode === 'forecast') return `${m.host}?${q({ ...common, hourly: BASE_VARS.join(','), forecast_days: 7 })}`;
    if (opts.mode === 'previous') {
      const n = Math.max(1, Math.min(7, opts.leadDays | 0));
      const vars = PREV_VARS.map(v => `${v}_previous_day${n}`);
      return `${m.host}?${q({ ...common, hourly: vars.join(','), start_date: opts.start, end_date: opts.end })}`;
    }
    return `${m.host}?${q({ ...common, hourly: BASE_VARS.join(','), start_date: opts.start, end_date: opts.end })}`;
  }

  /** Normalise Open-Meteo JSON into a series object */
  function parseOpenMeteo(json, opts) {
    if (json.error) throw new Error(json.reason || 'Open-Meteo error');
    const h = json.hourly || {};
    const sfx = opts.mode === 'previous' ? `_previous_day${Math.max(1, Math.min(7, opts.leadDays | 0))}` : '';
    const get = (k) => h[k + sfx] || h[k] || null;
    const time = (h.time || []).map(t => t * 1000);
    const s = {
      source: MODES[opts.mode].label + (opts.mode === 'previous' ? ` (issued ${opts.leadDays} day${opts.leadDays > 1 ? 's' : ''} before)` : ''),
      mode: opts.mode, lat: json.latitude, lon: json.longitude, elevation: json.elevation,
      utcOffset: json.utc_offset_seconds || 0, tz: json.timezone_abbreviation || json.timezone || 'UTC',
      time,
      temp: get('temperature_2m'), cloud: get('cloud_cover'), precip: get('precipitation'), rain: null, snow: get('snowfall'),
      code: get('weather_code'), wind: get('wind_speed_10m'), windDir: get('wind_direction_10m'),
      ghi: get('shortwave_radiation'), bhi: get('direct_radiation'), dhi: get('diffuse_radiation'), dni: null,
      radiationAveraging: 'backward-hour'
    };
    const code = s.code || [];
    if (!s.precip) { s.precip = code.map(c => CODE_PRECIP[c] || 0); s.precipFromCode = true; }
    if (!s.snow) s.snow = code.map(c => CODE_SNOW[c] || 0);
    return finalise(s);
  }

  /** Fill gaps, compute clearness/diffuse-fraction knots for sub-hourly disaggregation */
  function finalise(s) {
    const n = s.time.length;
    const fill = (arr, def) => {
      if (!arr) return new Array(n).fill(def);
      const out = arr.slice(); let last = null;
      for (let i = 0; i < n; i++) { if (out[i] == null || !isFinite(out[i])) out[i] = last; else last = out[i]; }
      let next = def; for (let i = n - 1; i >= 0; i--) { if (out[i] == null) out[i] = next; else next = out[i]; }
      return out.map(v => (v == null ? def : v));
    };
    s.temp = fill(s.temp, 10); s.cloud = fill(s.cloud, 50); s.precip = fill(s.precip, 0); s.rain = fill(s.rain, 0);
    s.snow = fill(s.snow, 0); s.code = fill(s.code, 0); s.wind = fill(s.wind, 2); s.windDir = fill(s.windDir, 225);
    s.hasRadiation = !!(s.ghi && s.ghi.some(v => v != null));
    s.ghi = fill(s.ghi, 0); s.dhi = fill(s.dhi, null); s.dni = fill(s.dni, 0); s.bhi = fill(s.bhi, null);
    for (let i = 0; i < n; i++) {
      if (s.dhi[i] == null) s.dhi[i] = s.bhi[i] != null ? Math.max(0, s.ghi[i] - s.bhi[i]) : s.ghi[i] * 0.5;
    }
    // Radiation values are averages over the hour ending at time[i]. Convert to clearness index kt
    // and diffuse fraction kd at the interval midpoint so we can rebuild instantaneous values.
    s.kt = new Array(n); s.kd = new Array(n); s.mid = new Array(n);
    const avg = s.radiationAveraging === 'instant' ? 0 : 1;
    for (let i = 0; i < n; i++) {
      s.mid[i] = s.time[i] - avg * 1800000;
      const E = avg ? PH.meanExtraterrestrialHorizontal(s.time[i], s.lat, s.lon) : (() => { const sp = PH.solarPosition(s.time[i], s.lat, s.lon); return Math.max(0, sp.In * Math.sin(sp.alt)); })();
      s.kt[i] = E > 5 ? Math.min(1.1, s.ghi[i] / E) : NaN;
      s.kd[i] = s.ghi[i] > 1 ? Math.min(1, s.dhi[i] / s.ghi[i]) : NaN;
    }
    // fill NaN knots (night) with nearest daytime neighbour so dawn/dusk interpolation stays sane
    for (const key of ['kt', 'kd']) {
      const a = s[key]; let last = NaN;
      for (let i = 0; i < n; i++) { if (isFinite(a[i])) last = a[i]; else if (isFinite(last)) a[i] = last; }
      let next = NaN; for (let i = n - 1; i >= 0; i--) { if (isFinite(a[i])) next = a[i]; else a[i] = isFinite(next) ? next : (key === 'kt' ? 0 : 1); }
    }
    s.start = n ? s.time[0] : 0; s.end = n ? s.time[n - 1] : 0;
    return s;
  }

  function lerpAt(times, arr, t) {
    const n = times.length; if (!n) return NaN;
    if (t <= times[0]) return arr[0]; if (t >= times[n - 1]) return arr[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
    const f = (t - times[lo]) / (times[hi] - times[lo]);
    return arr[lo] + (arr[hi] - arr[lo]) * f;
  }
  function nearestIndex(times, t) {
    const n = times.length; if (!n) return -1;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
    return (t - times[lo] < times[hi] - t) ? lo : hi;
  }
  /** Circular interpolation for wind direction */
  function lerpAngleAt(times, arr, t) {
    const s = lerpAt(times, arr.map(a => Math.sin(a * Math.PI / 180)), t), c = lerpAt(times, arr.map(a => Math.cos(a * Math.PI / 180)), t);
    return (Math.atan2(s, c) * 180 / Math.PI + 360) % 360;
  }

  /** Weather state at time t (ms UTC) for site lat/lon */
  function sample(s, t, lat, lon) {
    const sun = PH.solarPosition(t, lat, lon);
    const Eh = Math.max(0, sun.In * Math.sin(sun.alt));
    const kt = lerpAt(s.mid, s.kt, t), kd = Math.max(0, Math.min(1, lerpAt(s.mid, s.kd, t)));
    const ghi = s.hasRadiation ? Math.max(0, kt * Eh) : 0;
    const dhi = ghi * kd, bh = ghi - dhi;
    const dni = sun.alt > 0.02 ? bh / Math.sin(sun.alt) : 0;
    const i = nearestIndex(s.time, t);
    return {
      t, sun, N: Math.max(0, Math.min(1, lerpAt(s.time, s.cloud, t) / 100)),
      cloudPct: lerpAt(s.time, s.cloud, t), temp: lerpAt(s.time, s.temp, t), wind: Math.max(0, lerpAt(s.time, s.wind, t)),
      windDir: lerpAngleAt(s.time, s.windDir, t), precip: Math.max(0, lerpAt(s.time, s.precip, t)), snow: Math.max(0, lerpAt(s.time, s.snow, t)),
      code: s.code[i], api: { ghi, dhi, dni }, hasRadiation: s.hasRadiation
    };
  }

  // ---------- CSV import ----------
  const CSV_ALIASES = {
    time: ['time', 'timestamp', 'datetime', 'date', 'date_time'],
    temp: ['temperature', 'temp', 'temperature_2m', 't_air', 'tair'],
    cloud: ['cloud_cover', 'cloud', 'clouds', 'cloud_percentage', 'cloudcover'],
    wind: ['wind_speed', 'wind', 'wind_speed_10m', 'windspeed'],
    windDir: ['wind_direction', 'wind_dir', 'wind_direction_10m'],
    precip: ['precipitation', 'precip', 'rain_mm'],
    ghi: ['ghi', 'shortwave_radiation', 'global_horizontal'],
    dhi: ['dhi', 'diffuse_radiation', 'diffuse'],
    dni: ['dni', 'direct_normal_irradiance'],
    code: ['weather_code', 'wmo_code'],
    measured: ['measured_kw', 'measured', 'power_kw', 'actual_kw', 'pv_kw', 'generation_kw']
  };
  function splitCsvLine(line) {
    const out = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
      else if (ch === '"') inQ = true; else if (ch === ',' || ch === ';' || ch === '\t') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out.map(x => x.trim());
  }
  function parseTime(v) {
    if (/^\d{9,11}$/.test(v)) return Number(v) * 1000;
    if (/^\d{12,14}$/.test(v)) return Number(v);
    let s = v.replace(' ', 'T');
    if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
    const t = Date.parse(s); return isFinite(t) ? t : NaN;
  }
  /** Returns {series|null, measured:{time,kw}|null, columns} */
  function parseCsv(text, lat, lon) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    if (lines.length < 2) throw new Error('The CSV needs a header row and at least one data row.');
    const head = splitCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').replace(/[^a-z0-9_]/g, '_'));
    const col = {};
    for (const [k, al] of Object.entries(CSV_ALIASES)) { const i = head.findIndex(h => al.includes(h)); if (i >= 0) col[k] = i; }
    if (col.time == null) throw new Error('No time column found. Name it "time" (ISO 8601 UTC or Unix seconds).');
    const rows = lines.slice(1).map(splitCsvLine);
    const time = [], data = {}; Object.keys(col).forEach(k => { if (k !== 'time') data[k] = []; });
    for (const r of rows) {
      const t = parseTime(r[col.time]); if (!isFinite(t)) continue;
      time.push(t);
      for (const k of Object.keys(data)) { const v = parseFloat(r[col[k]]); data[k].push(isFinite(v) ? v : null); }
    }
    if (!time.length) throw new Error('No rows with a readable time value.');
    const order = time.map((t, i) => i).sort((a, b) => time[a] - time[b]);
    const pick = (arr) => arr ? order.map(i => arr[i]) : null;
    const T = order.map(i => time[i]);
    const hasWeather = ['temp', 'cloud', 'ghi'].some(k => data[k]);
    let series = null;
    if (hasWeather) {
      series = finalise({
        source: 'Uploaded CSV', mode: 'csv', lat, lon, utcOffset: 0, tz: 'UTC', time: T,
        temp: pick(data.temp), cloud: pick(data.cloud), precip: pick(data.precip), rain: null, snow: null, code: pick(data.code),
        wind: pick(data.wind), windDir: pick(data.windDir), ghi: pick(data.ghi), dhi: pick(data.dhi), dni: pick(data.dni), bhi: null,
        radiationAveraging: 'backward-hour'
      });
    }
    const measured = data.measured ? { time: T, kw: pick(data.measured) } : null;
    return { series, measured, columns: Object.keys(col) };
  }

  const WMO = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
    85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail'
  };
  function describe(code, cloudPct) {
    if (code != null && WMO[code] && code > 3) return WMO[code];
    if (cloudPct == null) return WMO[code] || '—';
    if (cloudPct < 15) return 'Clear sky'; if (cloudPct < 40) return 'Mainly clear'; if (cloudPct < 75) return 'Partly cloudy'; return 'Overcast';
  }

  const BUSY = [429, 500, 502, 503, 504];
  const CACHE_FILES = { current: 'forecast.json', forecast: 'forecast.json', historical: 'historical.json', era5: 'historical.json', previous: 'previous.json', year: 'year.json' };
  const DAY = 86400000;

  /** Keep only the hours between start and end dates (inclusive) of an Open-Meteo hourly block */
  function sliceHourly(json, startMs, endMs) {
    const h = json.hourly || {}, t = h.time || [];
    const keep = t.map((x, i) => (x * 1000 >= startMs && x * 1000 < endMs) ? i : -1).filter(i => i >= 0);
    const out = {};
    for (const [k, arr] of Object.entries(h)) out[k] = Array.isArray(arr) ? keep.map(i => arr[i]) : arr;
    return { ...json, hourly: out };
  }
  /** Try the GitHub-hosted cache. Returns a series or null (and the reason) */
  async function fromCache(opts, f, maxAgeMs) {
    const file = CACHE_FILES[opts.mode];
    if (!opts.cacheBase || !file) return { series: null, why: 'no cache for this mode' };
    if (opts.mode === 'previous' && (opts.leadDays | 0) > 4) return { series: null, why: 'the cache keeps lead times of 1 to 4 days' };
    if (opts.apiKey) return { series: null, why: 'commercial key in use' };
    let res, json;
    try { res = await f(opts.cacheBase + file + '?t=' + Math.floor(Date.now() / 300000), { cache: 'no-store' }); json = await res.json(); }
    catch (e) { return { series: null, why: 'cache unreachable' }; }
    if (!res.ok || !json || !json.hourly) return { series: null, why: 'cache not built yet' };
    if (Math.abs(json.latitude - opts.lat) > 0.06 || Math.abs(json.longitude - opts.lon) > 0.06) return { series: null, why: 'cache is for another site' };
    const age = Date.now() - Date.parse(json.arien_cached_at || 0);
    if (maxAgeMs != null && !(age <= maxAgeMs)) return { series: null, why: 'cache is older than allowed' };
    let data = json;
    if (opts.mode === 'year') {
      // any recent 12-month copy will do for a yield estimate; the exact end day does not matter
      if (!json.hourly.time || json.hourly.time.length < 300 * 24) return { series: null, why: 'cached year is incomplete' };
    } else if (opts.start && opts.end && (opts.mode === 'historical' || opts.mode === 'era5' || opts.mode === 'previous')) {
      const s0 = Date.parse(opts.start + 'T00:00:00Z'), s1 = Date.parse(opts.end + 'T00:00:00Z') + DAY;
      const t = (json.hourly.time || []).map(x => x * 1000);
      if (!t.length || s0 < t[0] - DAY || s1 > t[t.length - 1] + 2 * 3600000) return { series: null, why: 'dates are outside the cached window' };
      data = sliceHourly(json, s0 - (json.utc_offset_seconds || 0) * 1000, s1 - (json.utc_offset_seconds || 0) * 1000);
    }
    const series = parseOpenMeteo(data, opts.mode === 'era5' ? { ...opts, mode: 'historical' } : opts);
    if (!series.time.length) return { series: null, why: 'no cached hours for these dates' };
    series.cachedAt = json.arien_cached_at; series.fromCache = true;
    return { series, why: '' };
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /**
   * Weather for a mode. Order: fresh GitHub cache → live Open-Meteo (retries with jitter, avoiding the
   * full-hour peak when the free API sheds load) → the GitHub cache however old.
   */
  async function fetchSeries(opts, fetchImpl) {
    const f = fetchImpl || fetch;
    const maxFresh = opts.mode === 'current' || opts.mode === 'forecast' ? 3 * 3600000 : opts.mode === 'year' ? 8 * 86400000 : 30 * 3600000;
    if (opts.mode === 'year' && !(opts.start && opts.end)) Object.assign(opts, yearWindow());
    const cached = await fromCache(opts, f, maxFresh);
    if (cached.series) return cached.series;
    const url = buildUrl(opts);
    const delays = opts.retryDelays || [2500, 7000];
    let res, json, netErr = null;
    for (let attempt = 0; ; attempt++) {
      try { res = await f(url); try { json = await res.json(); } catch (e) { json = null; } netErr = null; }
      catch (e) { netErr = e; res = null; json = null; }
      const busy = netErr || (res && BUSY.includes(res.status));
      if (!busy || attempt >= delays.length) break;
      if (opts.onRetry) opts.onRetry(attempt + 1, delays.length, res ? res.status : 'network');
      await sleep(delays[attempt] * (0.75 + Math.random() * 0.5));
    }
    if (res && res.ok && json && !json.error) {
      const s = parseOpenMeteo(json, opts);
      if (!s.time.length) throw new Error('No hourly data for that period. Previous-run forecasts start in January 2024; historical forecasts in 2022.');
      s.url = url; return s;
    }
    // live failed: any cached copy is better than nothing
    const stale = await fromCache(opts, f, null);
    if (stale.series) { stale.series.staleCache = true; return stale.series; }
    if (netErr) throw netErr;
    if (res && BUSY.includes(res.status)) {
      const why = json && json.reason ? `: ${json.reason}` : '';
      const cacheNote = opts.cacheBase ? ` The site’s weather cache could not stand in (${stale.why}).` : '';
      throw new Error(`Open-Meteo is busy right now (HTTP ${res.status}${why}). Its free service drops requests at peak times, mostly around the full hour.${cacheNote} Try again in a few minutes, or load a CSV.`);
    }
    if (!json) throw new Error(`Weather service returned an unreadable response (HTTP ${res ? res.status : '?'}).`);
    throw new Error(json.reason || `Weather service error (HTTP ${res.status}).`);
  }
  async function geocode(name, fetchImpl) {
    const f = fetchImpl || fetch;
    const res = await f(`https://geocoding-api.open-meteo.com/v1/search?${q({ name, count: 6, language: 'en', format: 'json' })}`);
    const j = await res.json();
    return (j.results || []).map(r => ({ name: r.name, admin: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude }));
  }

  const api = { MODES, BASE_VARS, CACHE_FILES, yearWindow, buildUrl, parseOpenMeteo, finalise, sample, lerpAt, parseCsv, describe, fetchSeries, fromCache, sliceHourly, geocode, WMO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArienWeather = api;
})(typeof window !== 'undefined' ? window : globalThis);
