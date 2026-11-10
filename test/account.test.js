// Unit checks for the account bridge: obstacle and panel conversions, scene <-> record, results, and the message channel.
const AC = require('../src/account.js');
const PN = require('../src/panels.js');
const FI = require('../src/finance.js');
let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { fails++; console.log('FAIL:', msg); } }
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, `${msg}: got ${Number(a).toFixed(4)}, want ${b} ±${tol}`); }
const site = { name: 'Buckingham, UK', lat: 51.9956435, lon: -0.9906259 };
const ctx = { PN, financeDefaults: FI.DEFAULTS, costPerKwpFor: FI.costPerKwpFor };

// --- the web app's obstruction filter (copied from arien.base44.app, 10 Nov 2026): ≥3 finite points, height > 0
const webAccepts = (ob) => Array.isArray(ob.polygon) && ob.polygon.length >= 3 && Number(ob.height_m) > 0 && ob.polygon.every(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));

// --- obstacles: twin → web → twin
const wall = { type: 'wall', x: -1, y: -4.5, z: 0, heading: 30, dims: { length: 5, width: 0.3, height: 1.4 }, porosity: 0 };
const tree = { type: 'tree', x: 9, y: -11, z: 0, heading: 0, dims: { length: 6, width: 6, height: 9 }, porosity: 0.4 };
const chimney = { type: 'chimney', x: 2, y: 3, z: 6, heading: 0, dims: { length: 0.7, width: 0.7, height: 1.5 }, porosity: 0 };
const ow = AC.objectToObstruction(wall, site), ot = AC.objectToObstruction(tree, site), oc = AC.objectToObstruction(chimney, site);
ok(webAccepts(ow) && webAccepts(ot) && webAccepts(oc), 'obstructions pass the web app filter');
ok(ow.polygon.length === 4 && ot.polygon.length === 8, 'box footprint has 4 corners, tree 8');
near(oc.height_m, 7.5, 1e-9, 'chimney height measured from the ground');
ok(/40% transparent/.test(ot.label), 'transparency carried in the label: ' + ot.label);
const bw = AC.obstructionToObject(ow, site), bt = AC.obstructionToObject(ot, site);
ok(bw.type === 'wall' && bt.type === 'tree', 'types come back: ' + bw.type + ', ' + bt.type);
near(bw.x, wall.x, 0.01, 'wall x round trip'); near(bw.y, wall.y, 0.01, 'wall y round trip');
near(bw.dims.length, 5, 0.01, 'wall length'); near(bw.dims.width, 0.3, 0.01, 'wall thickness'); near(bw.dims.height, 1.4, 1e-9, 'wall height');
near(((bw.heading - 30) % 180 + 180) % 180, 0, 0.05, 'wall heading round trip');
near(bt.x, 9, 0.01, 'tree x'); near(bt.y, -11, 0.01, 'tree y'); near(bt.dims.length, 6, 0.05, 'tree canopy diameter'); near(bt.porosity, 0.4, 1e-9, 'tree transparency round trip');
ok(AC.obstructionToObject({ polygon: [{ lat: 1, lng: 1 }, { lat: 1, lng: 1.0001 }], height_m: 3 }, site) === null, 'two-point polygon refused');
ok(AC.obstructionToObject({ polygon: ow.polygon, height_m: 0 }, site) === null, 'zero height refused');
ok(AC.typeFromLabel('Big oak tree') === 'tree' && AC.typeFromLabel('Leylandii hedge') === 'conifer' && AC.typeFromLabel('Garden fence') === 'wall' && AC.typeFromLabel('Obstruction') === 'building', 'labels map to obstacle types');

// --- panels from the web designer
const A = 180 * Math.PI / 180;
const mk = (x, y, modelId = 'jinko_tiger') => ({ id: Math.random(), latlng: AC.toLL(site, x, y), modelId });
// two rows of 4 facing south (row along x), plus a separate pair 10 m east
const pos = [];
for (let c = 0; c < 4; c++) { pos.push(mk(-1.73 + c * 1.154, 0)); pos.push(mk(-1.73 + c * 1.154, -3)); }
pos.push(mk(10, 0), mk(11.154, 0));
const arr = AC.positionsToArrays(pos, { tilt_deg: 30, azimuth_deg: 180, panel_watt: 580 }, site, PN);
ok(arr.length === 3, 'two rows and a separate pair make 3 arrays: ' + arr.length);
ok(arr.reduce((t, a) => t + a.rows * a.cols, 0) === 10, 'every panel kept');
ok(arr.every(a => a.panelModel === 'jinko-tn72-580' && a.tilt === 30 && a.azimuth === 180), 'web Jinko maps to the library model, tilt and azimuth kept');
const four = arr.filter(a => a.cols === 4); near(four[0].x, 0, 0.02, 'row centred where its panels are');
const skew = AC.positionsToArrays(Array.from({ length: 6 }, (_, i) => mk(-3 + i * 1.04, 0, 'rec_alpha')), { tilt_deg: 25, azimuth_deg: 200 }, site, PN);
ok(skew.length === 1 && skew[0].cols === 6 && skew[0].azimuth === 200, 'an east–west row facing SSW stays one array: ' + skew.map(a => a.cols).join('+'));
const cust = AC.positionsToArrays([mk(0, 0, 'longi_hi_mo')], { tilt_deg: 35, azimuth_deg: 180 }, site, PN)[0];
ok(cust.panelModel === 'custom' && Math.abs(cust.panelW * cust.panelL * cust.eff * 1000 - 530) < 2, 'web LONGi 530 W becomes a 530 W custom panel');
const cnt = AC.countToArrays({ panel_count: 12, tilt_deg: 40, azimuth_deg: 170 }, PN)[0];
ok(cnt.rows * cnt.cols === 12 && cnt.tilt === 40 && cnt.azimuth === 170, 'count only: one array of 12');

// --- scene → plain fields → scene
const arrays = [Object.assign(PN.applyTo({ rows: 2, cols: 6, tilt: 35, azimuth: 180, landscape: false }, 'longi-himo6-430'), { x: 0, y: 0, z: 0, name: 'South roof' })];
const snap = { v: 1, site, arrays, objects: [wall, tree], zones: [], designName: 'Home', finance: { importPrice: 24.5 } };
const f = AC.flatFields(snap, ctx);
ok(f.panel_count === 12 && f.panel_watt === 430 && Math.abs(f.capacity_kwp - 5.16) < 1e-9, 'count, watt and kWp: ' + JSON.stringify([f.panel_count, f.panel_watt, f.capacity_kwp]));
ok(f.tilt_deg === 35 && f.azimuth_deg === 180 && f.import_tariff_p === 24.5 && f.export_tariff_p === FI.DEFAULTS.exportPrice && f.system_losses_pct === 14, 'orientation and tariffs');
near(f.install_cost_gbp, 5.16 * FI.costPerKwpFor(5.16), 1, 'install cost from the twin cost model');
ok(f.obstructions.length === 2 && f.obstructions.every(webAccepts), 'obstacles become web obstructions');
const rec = { id: 'S1', name: 'Home', ...f, twin_scene: snap };
let back = AC.recordToSnapshot(rec, ctx);
ok(!back.rebuilt && back.snap.arrays.length === 1 && back.snap.objects.length === 2 && back.snap.designName === 'Home', 'twin scene used as saved');
// edited in the web designer afterwards: 14 panels now, so rebuild from the record
back = AC.recordToSnapshot({ ...rec, panel_count: 14, panel_positions: Array.from({ length: 14 }, (_, i) => mk(-7 + i * 1.154, 0, 'rec_alpha')) }, ctx);
ok(back.rebuilt && back.snap.arrays.reduce((t, a) => t + a.rows * a.cols, 0) === 14 && back.snap.arrays[0].panelModel === 'rec-alpha-430', 'designer edit detected and rebuilt');
ok(back.snap.objects.length === 2 && back.snap.finance.importPrice === 24.5, 'obstacles and tariffs kept when rebuilt');
// a designer-only site
const web = { id: 'S2', name: 'Barn', latitude: 52.1, longitude: -1.2, panel_count: 3, tilt_deg: 20, azimuth_deg: 200, panel_model: 'canadian_hiku', panel_watt: 600, import_tariff_p: 25, obstructions: [ow] };
const wb = AC.recordToSnapshot(web, ctx).snap;
ok(wb.site.lat === 52.1 && wb.arrays.length === 1 && wb.arrays[0].rows * wb.arrays[0].cols === 3 && wb.objects.length === 1 && wb.finance.importPrice === 25, 'designer-only site builds a scene');

// --- results summary
const yieldRes = { model: 'rw', kwp: 5.16, total: 5000, specific: 969, months: new Array(12).fill(5000 / 12), shadingLoss: 0.05, shadingBy: [{ label: 'Hedge', kwh: 100 }], source: 'ERA5', start: Date.UTC(2025, 10, 1), end: Date.UTC(2026, 9, 31) };
const forecastRes = { days: [{ t: Date.UTC(2026, 10, 10), kwh: 4 }, { t: Date.UTC(2026, 10, 11), kwh: 6 }], total: 10, source: 'Forecast', at: Date.UTC(2026, 10, 10, 9) };
const sm = AC.summarise({ yieldRes, forecastRes, acYear: 0.86 * 0.99, acDay: 0.86, modelLabel: (k) => 'Model ' + k });
ok(sm.annual_kwh === Math.round(5000 * 0.86 * 0.99) && sm.monthly_kwh.length === 12 && sm.shading_loss_pct === 5 && sm.shading_by[0].label === 'Hedge', 'yield summary after losses');
ok(sm.forecast_7d.length === 2 && sm.forecast_7d[1].date === '2026-11-11' && sm.forecast_total_kwh === 8.6, 'forecast summary');
ok(!('annual_kwh' in AC.summarise({ yieldRes: { ...yieldRes, stale: true } })), 'stale results are not sent');

// --- message channel with a fake page that behaves like the web app (id = request id, or the site id)
(async () => {
  const listeners = [];
  const parent = { posted: [], postMessage(msg, origin) { this.posted.push({ msg, origin }); if (origin !== 'https://arien.base44.app') return; setTimeout(() => respond(msg), 5); } };
  const win = { parent, addEventListener: (t, fn) => listeners.push(fn) };
  const fire = (data, origin = 'https://arien.base44.app', source = parent) => listeners.forEach(fn => fn({ data, origin, source }));
  let nextId = 100;
  function respond(m) {
    const r = { source: 'arien-base44', id: m.id };
    if (m.type === 'hello') fire({ ...r, type: 'session', user: { id: 'u1', first_name: 'Madara', plan: 'household' }, sites: [], open: null, siteLimit: 1 });
    else if (m.type === 'site.save') fire(m.id ? { ...r, type: 'site.save', ok: true, id: m.id, name: m.name } : { ...r, type: 'site.save', ok: true, id: 'S' + (nextId++), name: m.name });
    else if (m.type === 'site.results') fire({ ...r, type: 'site.results', ok: true });
  }
  const br = AC.createBridge({ win, timeout: 300 });
  ok(br.embedded, 'detects a parent window');
  const s = await br.hello();
  ok(s.type === 'session' && s.user.first_name === 'Madara' && br.origin === 'https://arien.base44.app', 'hello gets the session');
  ok(parent.posted.every(p => p.origin !== '*') && parent.posted[0].msg.source === 'arien-twin', 'never posts to "*"');
  const [a, b] = await Promise.all([br.save({ name: 'One', fields: {} }), br.save({ id: 'S7', name: 'Seven', fields: {} })]);
  ok(a.ok && a.id === 'S100' && b.id === 'S7', 'new and existing saves pair with their replies: ' + a.id + ', ' + b.id);
  ok(!('id' in parent.posted.find(p => p.msg.name === 'One').msg), 'a new site is sent without an id');
  // replies from the wrong origin or window are ignored
  const late = br.results('S7', { v: 1 }, 1);
  fire({ source: 'arien-base44', id: 'S7', type: 'site.results', ok: false }, 'https://evil.example');
  fire({ source: 'arien-base44', id: 'S7', type: 'site.results', ok: false }, 'https://arien.base44.app', {});
  ok((await late).ok === true, 'foreign messages ignored');
  let tooBig = null; try { await br.save({ name: 'Huge', twin_scene: { blob: 'x'.repeat(AC.MAX_BYTES) } }); } catch (e) { tooBig = e.code; }
  ok(tooBig === 'too-big', 'oversized design refused before sending');
  const silent = AC.createBridge({ win: { parent: { postMessage() {} }, addEventListener() {} }, timeout: 50 });
  let to = null; try { await silent.request('site.list', {}, { ms: 50 }); } catch (e) { to = e.code; }
  ok(to === 'timeout', 'no answer times out');
  ok(!AC.createBridge({ win: { addEventListener() {}, get parent() { return this; } } }).embedded, 'top-level page is not embedded');
  ok(!AC.createBridge({ win: { parent: {}, addEventListener() {}, location: { ancestorOrigins: ['https://evil.example'] } } }).embedded, 'framed by another site: stays local');
  ok(!AC.createBridge({ win: { parent: {}, addEventListener() {}, document: { referrer: 'https://preview.example.com/app' } } }).embedded, 'referrer from another site: stays local');
  ok(AC.createBridge({ win: { parent: {}, addEventListener() {}, location: { ancestorOrigins: ['https://arien.base44.app'] } } }).embedded, 'framed by the ARIEN web app: account mode');
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
