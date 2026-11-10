/**
 * ARIEN account bridge.
 * Inside the ARIEN web app (arien.base44.app) the twin keeps saved sites and results in the signed-in user's account
 * (the web app's SolarSite records). The page around the twin does every read and write under the account's access
 * rules; the twin only exchanges postMessage messages with that page, so no password, token or email reaches the twin.
 * Opened on its own (github.io), nothing here runs and sites stay in this browser.
 *
 * Messages: {source:'arien-twin', v:1, id, type, ...} → page; page → {source:'arien-base44', id, type, ...}.
 * The web app uses `id` both to pair a reply with its request and as the site's record id, so requests go one at a
 * time and a reply is matched on its type and (when known) that id.
 */
(function (root) {
  'use strict';
  const PARENTS = ['https://arien.base44.app'];
  const SRC = 'arien-twin', PARENT_SRC = 'arien-base44', VERSION = 1;
  const MAX_BYTES = 480 * 1024; // the page refuses messages over 500 KB
  const M_PER_DEG = 111320, D2R = Math.PI / 180;
  const round = (v, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f; };
  const num = (v, dflt) => (v === null || v === undefined || v === '' || !isFinite(Number(v)) ? dflt : Number(v));
  const byteSize = (o) => { try { return new TextEncoder().encode(JSON.stringify(o)).length; } catch (e) { return Infinity; } };

  // ---------- metres around the site origin <-> lat/lng (equirectangular: millimetres over a few hundred metres)
  const kx = (site) => M_PER_DEG * Math.cos(site.lat * D2R);
  const toLL = (site, x, y) => ({ lat: round(site.lat + y / M_PER_DEG, 8), lng: round(site.lon + x / kx(site), 8) });
  const toXY = (site, p) => ({ x: (Number(p.lng) - site.lon) * kx(site), y: (Number(p.lat) - site.lat) * M_PER_DEG });

  // ---------- obstacles <-> the web app's obstructions: [{polygon:[{lat,lng}…≥3], height_m > 0, label}]
  const ROUND = { tree: true, conifer: true, pole: true };
  const LABELS = { tree: 'Broadleaf tree', conifer: 'Conifer', hedge: 'Hedge', wall: 'Wall', chimney: 'Chimney', building: 'Building', pole: 'Pole' };
  /** A twin obstacle as a footprint polygon with its height above the ground */
  function objectToObstruction(o, site, groundZ = 0) {
    const L = num(o.dims && o.dims.length, 1), W = num(o.dims && o.dims.width, L), pts = [];
    if (ROUND[o.type]) for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; pts.push([L / 2 * Math.cos(a), L / 2 * Math.sin(a)]); }
    else pts.push([-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]);
    const th = num(o.heading, 0) * D2R, c = Math.cos(th), s = Math.sin(th); // the twin turns obstacles clockwise from east
    const polygon = pts.map(([lx, ly]) => toLL(site, o.x + c * lx + s * ly, o.y - s * lx + c * ly));
    const height_m = round(Math.max(0.1, num(o.z, 0) - groundZ + num(o.dims && o.dims.height, 1)), 2);
    const tr = o.porosity > 0 ? ` (${Math.round(o.porosity * 100)}% transparent)` : '';
    return { polygon, height_m, label: (LABELS[o.type] || 'Obstruction') + tr };
  }
  function typeFromLabel(label) {
    const t = String(label || '').toLowerCase();
    if (/conifer|pine|fir|spruce|cypress|leylandii/.test(t)) return 'conifer';
    if (/tree|oak|ash|beech|bush|shrub/.test(t)) return 'tree';
    if (/hedge/.test(t)) return 'hedge';
    if (/wall|fence|parapet/.test(t)) return 'wall';
    if (/chimney|vent|flue|dormer/.test(t)) return 'chimney';
    if (/pole|mast|post|lamp|aerial|antenna/.test(t)) return 'pole';
    return 'building';
  }
  /** A web-app obstruction as a twin obstacle (no id; the app adds one). Null when the polygon is unusable. */
  function obstructionToObject(ob, site) {
    if (!ob || !Array.isArray(ob.polygon)) return null;
    const pts = ob.polygon.map(p => toXY(site, p)).filter(p => isFinite(p.x) && isFinite(p.y));
    const h = num(ob.height_m, 0);
    if (pts.length < 3 || !(h > 0)) return null;
    const type = typeFromLabel(ob.label);
    // orient on the longest edge, measure the footprint in that frame
    let best = 0, e = [1, 0];
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], d = Math.hypot(b.x - a.x, b.y - a.y); if (d > best) { best = d; e = [b.x - a.x, b.y - a.y]; } }
    let heading = ROUND[type] ? 0 : ((Math.atan2(-e[1], e[0]) / D2R) % 180 + 180) % 180;
    const th = heading * D2R, c = Math.cos(th), s = Math.sin(th);
    const loc = pts.map(p => [c * p.x - s * p.y, s * p.x + c * p.y]);
    const lx0 = Math.min(...loc.map(q => q[0])), lx1 = Math.max(...loc.map(q => q[0])), ly0 = Math.min(...loc.map(q => q[1])), ly1 = Math.max(...loc.map(q => q[1]));
    const mx = (lx0 + lx1) / 2, my = (ly0 + ly1) / 2;
    let length = Math.max(0.1, lx1 - lx0), width = Math.max(0.1, ly1 - ly0);
    if (ROUND[type]) { length = width = Math.max(length, width); heading = 0; }
    const m = /(\d+(?:\.\d+)?)%\s*transparent/i.exec(String(ob.label || ''));
    return { type, x: round(c * mx + s * my, 3), y: round(-s * mx + c * my, 3), z: 0, heading: round(heading, 2),
      dims: { length: round(length, 2), width: round(width, 2), height: round(h, 2) }, porosity: m ? Math.min(0.95, Number(m[1]) / 100) : 0, worldSrc: 'none' };
  }

  // ---------- panels placed in the web app's designer → twin arrays
  /** The web app's panel list (id → twin library id, or a custom size and power) */
  const WEB_PANELS = {
    longi_hi_mo: { wp: 530, w: 1.13, l: 2.28 }, jinko_tiger: { id: 'jinko-tn72-580' }, sunpower_max: { wp: 440, w: 1.04, l: 1.69 },
    rec_alpha: { id: 'rec-alpha-430' }, canadian_hiku: { wp: 600, w: 1.13, l: 2.38 }
  };
  function panelSpec(modelId, wattHint, PN) {
    const m = WEB_PANELS[modelId];
    if (m && m.id && PN && PN.byId(m.id)) { const p = PN.byId(m.id); return { panelModel: p.id, panelW: p.w, panelL: p.l, eff: p.eff, gammaPct: p.gamma, cellsX: p.cellsX, cellsY: p.cellsY }; }
    const wp = m ? m.wp : num(wattHint, 0), w = m ? m.w : 1.134, l = m ? m.l : 1.722;
    if (!m && !(wp > 0) && PN) { const p = PN.byId(PN.DEFAULT_ID); return { panelModel: p.id, panelW: p.w, panelL: p.l, eff: p.eff, gammaPct: p.gamma, cellsX: p.cellsX, cellsY: p.cellsY }; }
    return { panelModel: 'custom', panelW: w, panelL: l, eff: round(Math.min(0.26, Math.max(0.12, wp / (w * l * 1000))), 4), gammaPct: -0.3, cellsX: 6, cellsY: l > 2 ? 24 : 18 };
  }
  /**
   * Group panel positions into rows of touching panels, one twin array per run. Rows are looked for across the facing
   * direction and, since the web designer may draw rows east–west whatever the facing, also east–west; the grouping
   * with fewer arrays wins.
   */
  function positionsToArrays(positions, rec, site, PN) {
    const az = num(rec.azimuth_deg, 180), A = az * D2R;
    const facing = groupPanels(positions, rec, site, PN, [Math.cos(A), -Math.sin(A)], [Math.sin(A), Math.cos(A)]);
    const eastWest = groupPanels(positions, rec, site, PN, [1, 0], [0, 1]);
    return eastWest.length < facing.length ? eastWest : facing;
  }
  function groupPanels(positions, rec, site, PN, u, f) {
    const tilt = num(rec.tilt_deg, 35), az = num(rec.azimuth_deg, 180);
    const groups = new Map();
    (positions || []).forEach(p => {
      const ll = p && (p.latlng || p); if (!ll) return;
      const q = toXY(site, { lat: ll.lat, lng: ll.lng ?? ll.lon }); if (!isFinite(q.x) || !isFinite(q.y)) return;
      const key = p.modelId || rec.panel_model || ''; if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ x: q.x, y: q.y, pu: q.x * u[0] + q.y * u[1], pf: q.x * f[0] + q.y * f[1] });
    });
    const out = [];
    groups.forEach((pts, key) => {
      const spec = panelSpec(key, rec.panel_watt, PN);
      const rowTol = 0.5 * spec.panelL * Math.cos(tilt * D2R) + 0.3, gapMax = (spec.panelW + 0.02) * 1.6;
      pts.sort((a, b) => a.pf - b.pf);
      const rows = []; pts.forEach(p => { const r = rows[rows.length - 1]; if (r && p.pf - r[0].pf <= rowTol) r.push(p); else rows.push([p]); });
      rows.forEach(r => {
        r.sort((a, b) => a.pu - b.pu);
        let run = [r[0]];
        const flush = () => { out.push({ ...spec, name: `Row ${out.length + 1}`, x: round(run.reduce((t, p) => t + p.x, 0) / run.length, 3), y: round(run.reduce((t, p) => t + p.y, 0) / run.length, 3), z: 0,
          azimuth: az, tilt, rows: 1, cols: run.length, colGap: 0.02, landscape: false, worldSrc: 'none' }); };
        for (let i = 1; i < r.length; i++) { if (r[i].pu - r[i - 1].pu > gapMax) { flush(); run = []; } run.push(r[i]); }
        flush();
      });
    });
    return out;
  }
  /** Only a panel count: one array at the site origin, as square as the count allows */
  function countToArrays(rec, PN) {
    const n = Math.max(0, Math.round(num(rec.panel_count, 0))); if (!n) return [];
    let rows = 1; for (const r of [2, 3, 4]) if (n % r === 0 && n / r <= 14) { rows = r; break; }
    return [{ ...panelSpec(rec.panel_model, rec.panel_watt, PN), name: 'Array 1', x: 0, y: 0, z: 0, azimuth: num(rec.azimuth_deg, 180), tilt: num(rec.tilt_deg, 35),
      rows, cols: n / rows, colGap: 0.02, landscape: false, worldSrc: 'none' }];
  }

  // ---------- twin scene → the record's plain fields
  function flatFields(snap, ctx = {}) {
    const PN = ctx.PN, arrays = snap.arrays || [], site = snap.site || {};
    const count = arrays.reduce((t, a) => t + a.rows * a.cols, 0), kwp = PN ? arrays.reduce((t, a) => t + PN.arrayKwp(a), 0) : 0;
    const big = arrays.slice().sort((a, b) => b.rows * b.cols - a.rows * a.cols)[0];
    const fin = { ...(ctx.financeDefaults || {}), ...(snap.finance || {}) };
    const perKwp = fin.costPerKwp > 0 ? fin.costPerKwp : (ctx.costPerKwpFor ? ctx.costPerKwpFor(kwp) : 1600);
    const capex = fin.totalCostOverride > 0 ? fin.totalCostOverride : kwp * perKwp;
    const f = { latitude: round(site.lat, 7), longitude: round(site.lon, 7), panel_count: count, panel_watt: count ? Math.round(kwp * 1000 / count) : 0, capacity_kwp: round(kwp, 2),
      tilt_deg: big ? round(big.tilt, 1) : 35, azimuth_deg: big ? round(big.azimuth, 1) : 180,
      obstructions: (snap.objects || []).map(o => objectToObstruction(o, site, ctx.groundZ || 0)) };
    if (isFinite(fin.systemLosses)) f.system_losses_pct = fin.systemLosses;
    if (isFinite(fin.importPrice)) f.import_tariff_p = fin.importPrice;
    if (isFinite(fin.exportPrice)) f.export_tariff_p = fin.exportPrice;
    if (kwp > 0) f.install_cost_gbp = Math.round(capex);
    return f;
  }
  const sameish = (a, b, tol) => Math.abs(num(a, NaN) - num(b, NaN)) <= tol;
  /** Was the record changed in the web app's designer after the twin saved it? */
  function editedElsewhere(rec, snap, ctx) {
    const f = flatFields(snap, ctx);
    return !(sameish(rec.latitude, f.latitude, 2e-5) && sameish(rec.longitude, f.longitude, 2e-5) && num(rec.panel_count, -1) === f.panel_count
      && (!f.panel_count || (sameish(rec.tilt_deg, f.tilt_deg, 0.6) && sameish(rec.azimuth_deg, f.azimuth_deg, 0.6))));
  }
  /**
   * A record from the account as a twin scene. Uses the twin's own scene when the record has one and it still matches the
   * record; otherwise builds one from the web designer's panels, obstructions and settings. Returns {snap, rebuilt}.
   */
  function recordToSnapshot(rec, ctx = {}) {
    const PN = ctx.PN, ts = rec.twin_scene;
    const site = { name: rec.address_label || rec.name || '', lat: num(rec.latitude, ts && ts.site ? ts.site.lat : 51.5), lon: num(rec.longitude, ts && ts.site ? ts.site.lon : -0.12) };
    if (ts && ts.v === 1 && !editedElsewhere(rec, ts, ctx)) {
      const snap = JSON.parse(JSON.stringify(ts));
      snap.site = { ...(snap.site || {}), lat: snap.site && isFinite(snap.site.lat) ? snap.site.lat : site.lat, lon: snap.site && isFinite(snap.site.lon) ? snap.site.lon : site.lon, name: (snap.site && snap.site.name) || site.name };
      snap.designName = rec.name || snap.designName || '';
      return { snap, rebuilt: false };
    }
    const base = ts && ts.v === 1 ? JSON.parse(JSON.stringify(ts)) : { v: 1 };
    const positions = Array.isArray(rec.panel_positions) ? rec.panel_positions : (Array.isArray(ctx.positions) ? ctx.positions : null);
    const arrays = positions && positions.length ? positionsToArrays(positions, rec, site, PN) : countToArrays(rec, PN);
    const obs = Array.isArray(rec.obstructions) ? rec.obstructions.map(o => obstructionToObject(o, site)).filter(Boolean) : null;
    const fin = { ...(base.finance || {}) };
    if (isFinite(num(rec.import_tariff_p, NaN))) fin.importPrice = Number(rec.import_tariff_p);
    if (isFinite(num(rec.export_tariff_p, NaN))) fin.exportPrice = Number(rec.export_tariff_p);
    if (isFinite(num(rec.system_losses_pct, NaN)) && Number(rec.system_losses_pct) > 0) fin.systemLosses = Number(rec.system_losses_pct);
    const snap = { ...base, v: 1, site, arrays, objects: obs || (ts ? base.objects || [] : []), zones: [], designName: rec.name || '', finance: fin, worldSrc: undefined };
    delete snap.worldSrc;
    return { snap, rebuilt: !!ts };
  }

  // ---------- results the web app keeps with the site (twin_results)
  const isoDate = (t) => new Date(t).toISOString().slice(0, 10);
  function summarise({ yieldRes, forecastRes, acYear = 1, acDay = 1, modelLabel, utcOffset = 0, objects = 0 } = {}) {
    const out = { v: 1, engine: 'ARIEN twin', computed_at: new Date().toISOString() };
    const y = yieldRes && !yieldRes.stale ? yieldRes : null, f = forecastRes && !forecastRes.stale ? forecastRes : null;
    if (y) Object.assign(out, {
      model: y.model, model_label: modelLabel ? modelLabel(y.model) : y.model, capacity_kwp: round(y.kwp, 2),
      annual_kwh: Math.round(y.total * acYear), kwh_per_kwp: Math.round(y.specific * acYear), monthly_kwh: y.months.map(v => Math.round(v * acYear)),
      shading_loss_pct: round((y.shadingLoss || 0) * 100, 1), shading_by: (y.shadingBy || []).slice(0, 8).map(r => ({ label: r.label, kwh: Math.round(r.kwh * acYear) })),
      weather: { source: y.source, from: isoDate(y.start), to: isoDate(y.end) }, obstacles: objects
    });
    if (f) Object.assign(out, {
      forecast_7d: f.days.map(d => ({ date: isoDate(d.t + utcOffset), kwh: round(d.kwh * acDay, 2) })), forecast_total_kwh: round(f.total * acDay, 1),
      forecast_source: f.source, forecast_at: new Date(f.at).toISOString()
    });
    return out;
  }

  // ---------- the message channel
  /** The page around us, when the browser tells (ancestorOrigins in Chrome and Safari, else the referrer) */
  function parentOriginHint(win) {
    try {
      const anc = win.location && win.location.ancestorOrigins;
      if (anc && anc.length) return anc[0];
      const ref = win.document && win.document.referrer;
      return ref ? new URL(ref).origin : null;
    } catch (e) { return null; }
  }
  function createBridge({ win = root, parents = PARENTS, timeout = 20000 } = {}) {
    const framed = !!(win && win.parent && win.parent !== win), hint = framed ? parentOriginHint(win) : null;
    const embedded = framed && (!hint || parents.includes(hint)); // framed by another site: stay local without waiting
    let origin = null, seq = 0, chain = Promise.resolve(), waiting = null;
    if (embedded) win.addEventListener('message', (e) => {
      if (e.source !== win.parent || !parents.includes(e.origin)) return;
      if (origin && e.origin !== origin) return;
      const d = e.data; if (!d || typeof d !== 'object' || d.source !== PARENT_SRC) return;
      if (!waiting || !waiting.match(d)) return;
      if (!origin) origin = e.origin;
      const w = waiting; waiting = null; clearTimeout(w.t); w.resolve(d);
    });
    /** One request at a time. `id` is the site id for site requests; hello and list carry a request id. */
    function request(type, body = {}, { siteId, ms = timeout } = {}) {
      const run = () => new Promise((resolve, reject) => {
        if (!embedded) { reject(new Error('Not inside the ARIEN web app.')); return; }
        const reqId = siteId || (type === 'hello' || type === 'site.list' ? 't' + Date.now().toString(36) + (++seq) : undefined);
        const msg = { ...body, source: SRC, v: VERSION, type };
        if (reqId !== undefined) msg.id = reqId; else delete msg.id;
        const bytes = byteSize(msg);
        if (bytes > MAX_BYTES) { reject(Object.assign(new Error(`This design is too large to keep in your account (${Math.round(bytes / 1024)} KB, the limit is ${MAX_BYTES / 1024} KB).`), { code: 'too-big' })); return; }
        const want = type === 'hello' ? ['session', 'hello'] : [type];
        const match = (d) => want.includes(d.type) && (reqId === undefined || d.id === reqId);
        waiting = { match, resolve, t: setTimeout(() => { if (waiting && waiting.match === match) waiting = null; reject(Object.assign(new Error('The ARIEN web app did not answer.'), { code: 'timeout' })); }, ms) };
        try { (origin ? [origin] : parents).forEach(o => win.parent.postMessage(msg, o)); }
        catch (err) { clearTimeout(waiting.t); waiting = null; reject(err); }
      });
      const p = chain.then(run, run);
      chain = p.catch(() => {});
      return p;
    }
    return {
      embedded, get origin() { return origin; }, request,
      hello: (site) => request('hello', site ? { site } : {}, { ms: 5000 }),
      list: () => request('site.list'),
      get: (id) => request('site.get', {}, { siteId: id }),
      save: ({ id, name, fields, twin_scene, twin_results }) => request('site.save', { name, fields, twin_scene, twin_results }, { siteId: id || undefined }),
      results: (id, twin_results, annual_kwh) => request('site.results', { twin_results, annual_kwh }, { siteId: id }),
      remove: (id) => request('site.delete', {}, { siteId: id }),
      navigate: (path) => request('navigate', { path }, { ms: 4000 })
    };
  }

  const api = { PARENTS, MAX_BYTES, createBridge, objectToObstruction, obstructionToObject, positionsToArrays, countToArrays, flatFields, editedElsewhere, recordToSnapshot, summarise, toLL, toXY, typeFromLabel, WEB_PANELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArienAccount = api;
})(typeof window !== 'undefined' ? window : globalThis);
