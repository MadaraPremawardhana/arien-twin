const P = require('../src/physics.js');
const W = require('../src/weather.js');
const PN = require('../src/panels.js');
const PL = require('../src/places.js');
let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { fails++; console.log('FAIL:', msg); } }
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(4)}, want ${b} ±${tol}`); }
const R2D = 180 / Math.PI;

// --- Solar position vs NOAA reference values ---
// London (51.5074, -0.1278), 2024-06-21 12:00 UTC: NOAA elevation ≈ 61.9°, azimuth ≈ 178.5°
let sp = P.solarPosition(Date.UTC(2024, 5, 21, 12, 0), 51.5074, -0.1278);
near(sp.alt * R2D, 61.9, 0.35, 'London solstice noon elevation');
near(sp.az * R2D, 178.5, 1.5, 'London solstice noon azimuth');
// Buckingham (51.9956,-0.9906) 2024-12-21 12:00 UTC: NOAA elev ≈ 14.5°, az ≈ 179.9°
sp = P.solarPosition(Date.UTC(2024, 11, 21, 12, 0), 51.9956, -0.9906);
near(sp.alt * R2D, 14.55, 0.35, 'Buckingham winter noon elevation');
// Afternoon sun should be west of south
sp = P.solarPosition(Date.UTC(2024, 5, 21, 16, 0), 51.9956, -0.9906);
ok(sp.az * R2D > 240 && sp.az * R2D < 280, 'afternoon azimuth in the west: ' + (sp.az * R2D).toFixed(1));
// Night
sp = P.solarPosition(Date.UTC(2024, 5, 21, 0, 0), 51.9956, -0.9906);
ok(sp.alt < 0, 'midnight below horizon');
// E0 range
near(P.E0(3), 1.034, 0.002, 'E0 at perihelion'); near(P.E0(185), 0.967, 0.002, 'E0 at aphelion');
// Air path z = 1 at zenith
near(P.airPathZ(Math.PI / 2), 1, 1e-9, 'z at zenith');

// --- Kasten clear sky, α = 60° ---
const sun60 = { alt: 60 / R2D, az: Math.PI, In: 1367 };
const k = P.kastenHorizontal(sun60, 0, P.DEFAULT_PARAMS.kasten);
near(k.ghi, 755, 6, 'Kasten clear-sky GHI at 60°');
ok(k.bh > 600 && k.bh < 680, 'Kasten clear-sky beam at 60°: ' + k.bh.toFixed(1));
const ko = P.kastenHorizontal(sun60, 1, P.DEFAULT_PARAMS.kasten);
ok(ko.bh === 0 && ko.ghi > 150 && ko.ghi < 260, 'Kasten overcast: no beam, diffuse GHI ' + ko.ghi.toFixed(1));

// --- Transposition: horizontal panel reproduces horizontal components ---
const ctx = { sun: sun60, sunVec: P.sunVectorENU(sun60.alt, sun60.az), N: 0.3, api: { ghi: 600, dhi: 200, dni: 0 } };
const nH = P.panelNormal(0, Math.PI);
for (const key of P.MODEL_KEYS) {
  const m = P.MODELS[key];
  const h = m.horizontal(ctx, P.DEFAULT_PARAMS);
  const t = m.transpose(h, ctx, nH, 0, P.DEFAULT_PARAMS);
  near(t.beam + t.diffuse + t.ground, h.ghi, 0.5, `${key}: horizontal POA equals GHI`);
}
// Tilted south panel at 30° on a winter sun gets more than horizontal for clear sky
const sunW = P.solarPosition(Date.UTC(2024, 11, 21, 12, 0), 51.9956, -0.9906);
const ctxW = { sun: sunW, sunVec: P.sunVectorENU(sunW.alt, sunW.az), N: 0, api: { ghi: 250, dhi: 60, dni: 0 } };
const nT = P.panelNormal(35 / R2D, Math.PI);
for (const key of ['hdkr', 'rwghi', 'kasten']) {
  const m = P.MODELS[key]; const h = m.horizontal(ctxW, P.DEFAULT_PARAMS); const t = m.transpose(h, ctxW, nT, 35 / R2D, P.DEFAULT_PARAMS);
  ok(t.beam + t.diffuse + t.ground > h.ghi * 1.4, `${key}: winter tilt gain ${((t.beam + t.diffuse + t.ground) / h.ghi).toFixed(2)}×`);
}
// North-facing panel gets no beam at noon
const nN = P.panelNormal(60 / R2D, 0);
ok(P.MODELS.hdkr.transpose(P.MODELS.hdkr.horizontal(ctxW), ctxW, nN, 60 / R2D, P.DEFAULT_PARAMS).beam === 0, 'north-facing steep panel: no beam');

// --- Seasonal rule ---
ok(P.seasonalModel(Date.UTC(2024, 6, 1), 52) === 'rwghi', 'July → RW-GHI');
ok(P.seasonalModel(Date.UTC(2024, 3, 1), 52) === 'hdkr', 'April → HDKR');
ok(P.seasonalModel(Date.UTC(2024, 10, 1), 52) === 'karamov', 'November → K–N');
ok(P.seasonalModel(Date.UTC(2024, 0, 1), -33) === 'rwghi', 'January southern hemisphere → RW-GHI');

// --- Thermal ---
const Teq = P.thermalEquilibrium(20, 800, 2, 0.2, -0.004);
ok(Teq > 40 && Teq < 50, 'thermal equilibrium at 800 W/m², 2 m/s: ' + Teq.toFixed(1));
let T = 20; for (let i = 0; i < 200; i++) T = P.thermalStep(T, 20, 800, 2, P.efficiency(0.2, -0.004, T), 60, 9600);
near(T, Teq, 0.2, 'thermal step converges to equilibrium');
const T1 = P.thermalStep(20, 20, 800, 2, 0.2, 60, 9600);
ok(T1 > 21 && T1 < 25, 'one-minute warm-up follows ~6 min time constant: ' + T1.toFixed(2));
near(P.efficiency(0.2, -0.004, 50), 0.18, 1e-9, 'efficiency temperature derating');

// --- Ray primitives ---
near(P.rayBox([0, 0, 5], [0, 0, -1], [-1, -1, 0], [1, 1, 1]), 4, 1e-9, 'ray box');
ok(P.rayBox([5, 0, 5], [0, 0, -1], [-1, -1, 0], [1, 1, 1]) === Infinity, 'ray box miss');
near(P.raySphere([0, 0, -5], [0, 0, 1], [0, 0, 0], 1), 4, 1e-9, 'ray sphere');
near(P.rayCylinder([-5, 0, 0.5], [1, 0, 0], 0, 0, 1, 0, 1), 4, 1e-9, 'ray cylinder side');
near(P.rayCylinder([0, 0, 5], [0, 0, -1], 0, 0, 1, 0, 1), 4, 1e-9, 'ray cylinder cap');
near(P.rayCone([-5, 0, 0], [1, 0, 0], 0, 0, 1, 0, 2), 4, 1e-6, 'ray cone at base height');
ok(P.rayCone([-5, 0, 1.9], [1, 0, 0], 0, 0, 1, 0, 2) < 5, 'ray cone near apex hits');
ok(P.rayCone([-5, 0, 2.1], [1, 0, 0], 0, 0, 1, 0, 2) === Infinity, 'ray cone above apex misses');
near(P.rayRect([0, 0, 5], [0, 0, -1], [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 1, 1), 5, 1e-9, 'ray rect');

// --- Objects: tree south of a panel blocks low winter sun; north tree does not ---
const tree = { type: 'tree', x: 0, y: -10, z: 0, heading: 0, dims: { length: 6, width: 6, height: 9 }, porosity: 0 };
const sunLow = { alt: 15 / R2D, az: Math.PI };
const dirLow = P.sunVectorENU(sunLow.alt, sunLow.az);
ok(P.objectTransmission(tree, [0, 0, 3], dirLow) === 0, 'tree to the south blocks low sun');
ok(P.objectTransmission({ ...tree, y: 10 }, [0, 0, 3], dirLow) === 1, 'tree to the north does not block');
ok(Math.abs(P.objectTransmission({ ...tree, porosity: 0.3 }, [0, 0, 5], dirLow) - 0.3) < 1e-9, 'porous canopy transmits 30%');
// rotated wall: 8 m long east-west at heading 0 blocks southern sun; rotated 90° (N-S) does not block when offset
const wall = { type: 'wall', x: 0, y: -2, z: 0, heading: 0, dims: { length: 8, width: 0.3, height: 3 } };
ok(P.objectTransmission(wall, [3, 0, 1], dirLow) === 0, 'E-W wall blocks at x=3');
ok(P.objectTransmission({ ...wall, heading: 90 }, [3, 0, 1], dirLow) === 1, 'N-S wall clear at x=3');

// --- Array geometry and row-to-row shading ---
const arr = { x: 0, y: 0, z: 0, azimuth: 180, tilt: 30, rows: 2, cols: 1, panelW: 1, panelL: 1.7, colGap: 0.02, rowPitch: 2.0, mountHeight: 0.1, cellsX: 6, cellsY: 10 };
const g = P.buildArrayGeometry(arr);
ok(g.panels.length === 2 && g.panels[0].cells.length === 60, 'array builds 2 panels × 60 cells');
near(g.n[2], Math.cos(30 / P.R2D * 1), 1e-9, 'panel normal z = cos(tilt)');
ok(g.n[1] < 0, 'south-facing normal points south');
ok(g.panels[1].c[1] > g.panels[0].c[1], 'second row sits north of first');
const shWin = P.shadeCells([g], [], dirLow, sunLow, null);
const row0 = shWin[0].slice(0, 60), row1 = shWin[0].slice(60);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
ok(mean(row0) === 1, 'front row fully lit at 15° sun');
ok(mean(row1) < 0.9 && mean(row1) > 0, 'back row partly shaded at tight pitch: ' + mean(row1).toFixed(2));
const sunHigh = { alt: 60 / R2D, az: Math.PI };
const shSum = P.shadeCells([g], [], P.sunVectorENU(sunHigh.alt, sunHigh.az), sunHigh, null);
ok(mean(shSum[0]) === 1, 'no row shading at 60° sun');
// horizon mask
const prof = new Float32Array(36).fill(10 / R2D);
ok(P.horizonBlocked(prof, Math.PI, 5 / R2D) && !P.horizonBlocked(prof, Math.PI, 15 / R2D), 'horizon lookup');
const shH = P.shadeCells([g], [], dirLow, sunLow, () => true);
ok(mean(shH[0]) === 0, 'horizon blocked → all cells shaded');

// --- Metrics ---
const m = P.metrics([1, 2, 3, 4], [1, 2, 3, 5]);
near(m.mae, 0.25, 1e-9, 'MAE'); near(m.rmse, 0.5, 1e-9, 'RMSE'); ok(m.r2 > 0.8, 'R²');

// --- Weather parsing & disaggregation ---
const lat = 51.9956, lon = -0.9906;
const t0 = Date.UTC(2024, 5, 21, 0) / 1000;
const hours = [...Array(48).keys()];
const fake = { latitude: lat, longitude: lon, utc_offset_seconds: 3600, timezone_abbreviation: 'BST', hourly: {
  time: hours.map(h => t0 + h * 3600),
  temperature_2m: hours.map(h => 15 + 5 * Math.sin((h % 24 - 9) / 24 * 2 * Math.PI)), cloud_cover: hours.map(() => 20),
  precipitation: hours.map(() => 0), rain: hours.map(() => 0), snowfall: hours.map(() => 0), weather_code: hours.map(() => 1),
  wind_speed_10m: hours.map(() => 3), wind_direction_10m: hours.map(h => (h * 20) % 360),
  shortwave_radiation: hours.map(h => { const tEnd = (t0 + h * 3600) * 1000; return 0.75 * P.meanExtraterrestrialHorizontal(tEnd, lat, lon); }),
  direct_radiation: hours.map(h => { const tEnd = (t0 + h * 3600) * 1000; return 0.55 * P.meanExtraterrestrialHorizontal(tEnd, lat, lon); }),
  diffuse_radiation: hours.map(h => { const tEnd = (t0 + h * 3600) * 1000; return 0.20 * P.meanExtraterrestrialHorizontal(tEnd, lat, lon); }),
  direct_normal_irradiance: hours.map(() => 0), relative_humidity_2m: hours.map(() => 70) } };
const s = W.parseOpenMeteo(fake, { mode: 'forecast' });
ok(s.time.length === 48 && s.hasRadiation, 'parsed 48 hours');
const noon = W.sample(s, Date.UTC(2024, 5, 21, 12, 7), lat, lon);
const spn = P.solarPosition(Date.UTC(2024, 5, 21, 12, 7), lat, lon);
near(noon.api.ghi / (spn.In * Math.sin(spn.alt)), 0.75, 0.01, 'disaggregated kt preserved');
near(noon.api.dhi / noon.api.ghi, 0.2 / 0.75, 0.01, 'diffuse fraction preserved');
ok(W.sample(s, Date.UTC(2024, 5, 21, 1, 0), lat, lon).api.ghi === 0, 'night GHI zero');
near(noon.N, 0.2, 1e-9, 'cloud fraction');
const wd = W.sample(s, Date.UTC(2024, 5, 21, 17, 30), lat, lon).windDir; // between 340 and 0(360)
ok(wd > 340 || wd < 1, 'wind direction wraps across north: ' + wd.toFixed(1));
// URL builder
const url = W.buildUrl({ mode: 'previous', lat, lon, start: '2024-05-01', end: '2024-05-07', leadDays: 3 });
ok(url.startsWith('https://previous-runs-api.open-meteo.com/v1/forecast?') && url.includes('shortwave_radiation_previous_day3') && url.includes('start_date=2024-05-01'), 'previous-runs URL');
ok(W.buildUrl({ mode: 'forecast', lat, lon }).includes('forecast_days=7'), 'forecast URL');
const ck = W.buildUrl({ mode: 'historical', lat, lon, start: '2025-01-01', end: '2025-01-07', apiKey: 'abc123' });
ok(ck.startsWith('https://customer-historical-forecast-api.open-meteo.com/') && ck.includes('apikey=abc123'), 'commercial key URL: ' + ck.slice(0, 60));
ok(!W.buildUrl({ mode: 'forecast', lat, lon, apiKey: '' }).includes('customer-'), 'no key → free host');
// Previous-runs parsing picks suffixed fields
const prevJson = JSON.parse(JSON.stringify(fake)); prevJson.hourly = { time: fake.hourly.time };
for (const kk of Object.keys(fake.hourly)) if (kk !== 'time') prevJson.hourly[kk + '_previous_day2'] = fake.hourly[kk];
const sp2 = W.parseOpenMeteo(prevJson, { mode: 'previous', leadDays: 2 });
ok(sp2.hasRadiation && sp2.cloud[5] === 20, 'previous-runs suffixed fields parsed');
// CSV
const csv = 'time,temperature,cloud_cover,wind_speed,ghi,measured_kw\n2024-06-21T10:00,18,30,3,500,2.1\n2024-06-21T11:00,19,25,3,600,2.6\n';
const pc = W.parseCsv(csv, lat, lon);
ok(pc.series && pc.series.time.length === 2 && pc.measured.kw[1] === 2.6, 'CSV with measured column');
ok(W.describe(61, 90) === 'Light rain' && W.describe(1, 10) === 'Clear sky', 'weather descriptions');

// Open-Meteo busy (503): retries then succeeds; keeps failing → clear message
(async () => {
  const okBody = JSON.stringify(fake);
  let calls = 0;
  const flaky = async () => { calls++; return calls < 3 ? { status: 503, ok: false, json: async () => ({ error: true, reason: 'The service is overloaded' }) } : { status: 200, ok: true, json: async () => JSON.parse(okBody) }; };
  const s1 = await W.fetchSeries({ mode: 'forecast', lat, lon, retryDelays: [1, 1, 1] }, flaky);
  ok(calls === 3 && s1.time.length === 48, 'retries a busy Open-Meteo and then loads');
  const busy = async () => ({ status: 503, ok: false, json: async () => ({ error: true, reason: 'The service is overloaded' }) });
  let msg = ''; try { await W.fetchSeries({ mode: 'forecast', lat, lon, retryDelays: [1, 1] }, busy); } catch (e) { msg = e.message; }
  ok(/busy right now \(HTTP 503: The service is overloaded\)/.test(msg), 'busy message: ' + msg.slice(0, 60));
  // precipitation estimated from the weather code when not requested
  const codeJson = JSON.parse(okBody); codeJson.hourly.weather_code = codeJson.hourly.weather_code.map((c, i) => i === 10 ? 63 : 1);
  delete codeJson.hourly.precipitation;
  const sc = W.parseOpenMeteo(codeJson, { mode: 'forecast' });
  ok(sc.precipFromCode && sc.precip[10] === 2.5 && sc.precip[11] === 0, 'rain rate from weather code 63');
  ok(W.BASE_VARS.length === 7 && !W.buildUrl({ mode: 'forecast', lat, lon }).includes('precipitation'), 'only the 7 thesis variables are requested');
  // cache: fresh cache wins without touching Open-Meteo; live busy → stale cache stands in
  const cacheJson = JSON.parse(okBody); cacheJson.arien_cached_at = new Date().toISOString();
  const routed = (live, cacheBody) => async (u) => u.startsWith('https://cache.test/') ? (cacheBody ? { status: 200, ok: true, json: async () => cacheBody } : { status: 404, ok: false, json: async () => ({}) }) : live(u);
  let liveCalls = 0; const liveBusy = async () => { liveCalls++; return { status: 503, ok: false, json: async () => ({ error: true, reason: 'The service is overloaded' }) }; };
  const c1 = await W.fetchSeries({ mode: 'forecast', lat, lon, cacheBase: 'https://cache.test/', retryDelays: [1] }, routed(liveBusy, cacheJson));
  ok(c1.fromCache && liveCalls === 0, 'fresh cache used first, Open-Meteo not called');
  const old = { ...cacheJson, arien_cached_at: new Date(Date.now() - 10 * 3600e3).toISOString() };
  const c2 = await W.fetchSeries({ mode: 'forecast', lat, lon, cacheBase: 'https://cache.test/', retryDelays: [1] }, routed(liveBusy, old));
  ok(c2.fromCache && c2.staleCache && liveCalls === 2, 'stale cache stands in when Open-Meteo is busy');
  const far = { ...cacheJson, latitude: 40 };
  let farMsg = ''; try { await W.fetchSeries({ mode: 'forecast', lat, lon, cacheBase: 'https://cache.test/', retryDelays: [1] }, routed(liveBusy, far)); } catch (e) { farMsg = e.message; }
  ok(/another site/.test(farMsg), 'cache for another site is not used: ' + farMsg.slice(-80));
  // historical slice from cache
  const hist = { ...cacheJson, utc_offset_seconds: 0 };
  const c3 = await W.fetchSeries({ mode: 'historical', lat, lon, start: '2024-06-22', end: '2024-06-22', cacheBase: 'https://cache.test/' }, routed(liveBusy, hist));
  ok(c3.fromCache && c3.time.length === 24, 'historical dates sliced from cache: ' + c3.time.length);
  // --- panel library ---
  PN.LIST.forEach(p => near(p.wp / (p.w * p.l * 1000), p.eff, 0.004, `${p.code}: datasheet power matches efficiency × area`));
  ok(new Set(PN.LIST.map(p => p.id)).size === PN.LIST.length && !!PN.byId(PN.DEFAULT_ID), 'panel ids unique, default exists');
  const arr = { rows: 2, cols: 5, panelW: 1, panelL: 1.6, eff: 0.2, gammaPct: -0.35, cellsX: 6, cellsY: 10, landscape: false };
  PN.applyTo(arr, 'aiko-2p-460');
  ok(arr.panelW === 1.134 && arr.panelL === 1.757 && arr.eff === 0.231 && arr.gammaPct === -0.26 && arr.cellsY === 18, 'applyTo copies datasheet values');
  near(PN.arrayKwp(arr), 4.6, 1e-9, '10 × 460 W = 4.6 kWp');
  ok(PN.matches(arr), 'array matches its model');
  PN.setLandscape(arr, true); ok(arr.panelW === 1.757 && arr.panelL === 1.134 && arr.cellsX === 18 && PN.matches(arr), 'landscape swaps sides and cells');
  arr.eff = 0.25; ok(!PN.matches(arr), 'edited efficiency no longer matches the model');
  // --- places ---
  const pc = PL.parseCoords('51.9956, -0.9906'); ok(pc && pc.lat === 51.9956 && pc.lon === -0.9906, 'coordinates parsed');
  const pc2 = PL.parseCoords('51.9956N 0.9906W'); ok(pc2 && pc2.lon === -0.9906, 'N/W coordinates parsed');
  ok(!PL.parseCoords('Buckingham') && !PL.parseCoords('95, 10'), 'non-coordinates rejected');
  ok(PL.isUkPostcode('mk18 1eg') && PL.isUkPostcode('SW1A1AA') && !PL.isUkPostcode('London') && PL.normPostcode('sw1a1aa') === 'SW1A 1AA', 'UK postcodes recognised');
  ok(PL.isUkOutcode('MK18') && !PL.isUkOutcode('Leeds'), 'UK outward codes recognised');
  const hits = [];
  const geoFetch = (fail) => async (u) => {
    hits.push(u.split('/')[2]);
    if (fail && fail.test(u)) return { ok: false, status: 503, json: async () => ({}) };
    if (u.includes('postcodes.io/postcodes/')) return { ok: true, status: 200, json: async () => ({ status: 200, result: { postcode: 'MK18 1EG', latitude: 51.999, longitude: -0.987, admin_district: 'Buckinghamshire', parish: 'Buckingham', country: 'England' } }) };
    if (u.includes('nominatim')) return { ok: true, status: 200, json: async () => [{ lat: '51.5034', lon: '-0.1276', display_name: '10 Downing Street, Westminster, London, Greater London, England, SW1A 2AA, United Kingdom', address: { city: 'London' } }] };
    return { ok: true, status: 200, json: async () => ({ results: [{ name: 'Leeds', admin1: 'England', country: 'United Kingdom', latitude: 53.8, longitude: -1.55 }] }) };
  };
  let r1 = await PL.search('MK18 1EG', { fetch: geoFetch() });
  ok(r1.results[0].source === 'postcodes.io' && r1.results[0].name === 'MK18 1EG' && hits[0] === 'api.postcodes.io', 'postcode → postcodes.io');
  r1 = await PL.search('10 Downing Street, London', { fetch: geoFetch() });
  ok(r1.results[0].source === 'OpenStreetMap' && r1.results[0].place === 'London' && Math.abs(r1.results[0].lat - 51.5034) < 1e-6, 'address → OpenStreetMap');
  r1 = await PL.search('Leeds', { fetch: geoFetch(/nominatim/) });
  ok(r1.results[0].source === 'Open-Meteo', 'falls back to Open-Meteo when OpenStreetMap fails');
  let gerr = ''; try { await PL.search('Leeds', { fetch: async () => { throw new TypeError('Failed to fetch'); } }); } catch (e) { gerr = e.message; }
  ok(/Could not reach the place search/.test(gerr), 'all geocoders down → clear error');
  r1 = await PL.search('Somewhere', { google: async () => [{ name: 'G', detail: '', lat: 1, lon: 2, source: 'Google' }] });
  ok(r1.results[0].source === 'Google' && hits.filter(h => h.includes('nominatim')).length === 2, 'Google geocoder used alone when Google tiles show');
  const site = { name: 'Buckingham, England, United Kingdom', lat: 51.99, lon: -0.99 };
  const kw = (a) => a.kwp;
  ok(PL.autoName(site, [{ azimuth: 180, kwp: 5.16 }], kw) === 'Buckingham 5.16 kWp south-facing', 'auto name: ' + PL.autoName(site, [{ azimuth: 180, kwp: 5.16 }], kw));
  ok(PL.autoName(site, [{ azimuth: 90, kwp: 3 }, { azimuth: 270, kwp: 3 }], kw) === 'Buckingham 6.00 kWp east + west', 'auto name east-west');
  ok(PL.autoName(site, [{ azimuth: 180, kwp: 5.16 }], kw, ['Buckingham 5.16 kWp south-facing']) === 'Buckingham 5.16 kWp south-facing (2)', 'auto name made unique');
  ok(PL.autoName({ name: '51.9956, -0.9906', lat: 51.9956, lon: -0.9906 }, [], kw, [], Date.UTC(2026, 10, 2)) === 'Site at 51.996°N 0.991°W site, 2 Nov', 'auto name without a place or arrays');
  const mem = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = String(v); }, removeItem(k) { delete this.d[k]; } };
  const e1 = PL.saveSite(mem, { name: 'Garage roof', snap: { v: 1 } }); const e2 = PL.saveSite(mem, { name: 'garage roof', snap: { v: 2 } });
  ok(e2.replaced && PL.listSites(mem).length === 1 && PL.listSites(mem)[0].snap.v === 2 && e2.entry.id === e1.entry.id, 'same name replaces the saved site');
  PL.saveSite(mem, { name: 'House', snap: {} }); PL.removeSite(mem, e1.entry.id);
  ok(PL.listSites(mem).length === 1 && PL.listSites(mem)[0].name === 'House', 'saved site removed');
  // --- 12-month weather for yield ---
  const yw = W.yearWindow(Date.UTC(2026, 10, 2));
  ok(yw.end === '2026-10-27' && yw.start === '2025-10-28', 'year window ends 6 days ago: ' + JSON.stringify(yw));
  ok(W.buildUrl({ mode: 'year', lat, lon, ...yw }).startsWith('https://archive-api.open-meteo.com/v1/archive?') && W.CACHE_FILES.year === 'year.json', 'year mode uses ERA5 archive and year.json');
  const yJson = JSON.parse(okBody); const t0 = Date.UTC(2025, 10, 1) / 1000;
  yJson.hourly = { time: Array.from({ length: 8760 }, (_, i) => t0 + i * 3600) };
  ['temperature_2m', 'cloud_cover', 'wind_speed_10m', 'wind_direction_10m', 'weather_code', 'shortwave_radiation', 'diffuse_radiation'].forEach(v => { yJson.hourly[v] = new Array(8760).fill(1); });
  yJson.arien_cached_at = new Date(Date.now() - 3 * 86400e3).toISOString();
  let yLive = 0; const yFetch = async (u) => u.startsWith('https://cache.test/') ? { status: 200, ok: true, json: async () => yJson } : (yLive++, { status: 503, ok: false, json: async () => ({}) });
  const ys = await W.fetchSeries({ mode: 'year', lat, lon, cacheBase: 'https://cache.test/' }, yFetch);
  ok(ys.fromCache && ys.time.length === 8760 && yLive === 0 && /last 12 months/.test(ys.source), 'a 3-day-old cached year is used without calling Open-Meteo');
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
  })();
