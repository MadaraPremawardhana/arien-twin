/* ARIEN Design planner — a 2D satellite map for roughing out a PV layout before simulating it in the
 * 3D twin. Panels placed here are the same arrays the twin simulates (shared state, same physics).
 * Tools: Place (single panel), Rectangle and Freehand (roof areas filled with panels), Obstruction.
 * The Design kit sizes a roof area and understands short typed requests ("10 panels in London,
 * south-facing"). It is rules-based and runs in the browser; no AI service is called.
 * Needs Leaflet 1.9 (window.L). Browser: window.ArienPlanner. */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const STORE = 'arien-planner-v1';
  let api = null, S = null, PN = null, PH = null, map = null, ready = false;
  let tool = 'place', obType = 'tree', base = 'sat', sel = null, drawing = null, drag = null, suppressClick = false;
  const layers = {};
  const D = { panelModel: null, tilt: 35, azimuth: 180, landscape: false, mount: 'flush', pitchAuto: true, rowPitch: 3.2, colGap: 0.02, setback: 0.3, mountHeight: 0.15 };

  // ---------------------------------------------------------------- local frame (same east/north metres as the twin)
  function radii() {
    const a = 6378137, e2 = 0.00669437999014, sn = Math.sin(S.site.lat * D2R), den = 1 - e2 * sn * sn;
    return { kx: a / Math.sqrt(den) * Math.cos(S.site.lat * D2R) * D2R, ky: a * (1 - e2) / Math.pow(den, 1.5) * D2R };
  }
  function ll2en(lat, lon) { const r = radii(); return [(lon - S.site.lon) * r.kx, (lat - S.site.lat) * r.ky]; }
  function en2ll(x, y) { const r = radii(); return [S.site.lat + y / r.ky, S.site.lon + x / r.kx]; }
  const llOf = (p) => { const [la, lo] = en2ll(p[0], p[1]); return L.latLng(la, lo); };
  const enOf = (ll) => ll2en(ll.lat, ll.lng);

  // ---------------------------------------------------------------- geometry helpers
  function pointInPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function distToSeg(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  const minEdgeDist = (p, poly) => poly.reduce((m, a, i) => Math.min(m, distToSeg(p, a, poly[(i + 1) % poly.length])), Infinity);
  const polyArea = (poly) => Math.abs(poly.reduce((s, a, i) => { const b = poly[(i + 1) % poly.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
  function simplify(pts, tol) { // Douglas–Peucker
    if (pts.length < 3) return pts;
    let dmax = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = distToSeg(pts[i], pts[0], pts[pts.length - 1]); if (d > dmax) { dmax = d; idx = i; } }
    if (dmax <= tol) return [pts[0], pts[pts.length - 1]];
    return simplify(pts.slice(0, idx + 1), tol).slice(0, -1).concat(simplify(pts.slice(idx), tol));
  }

  // ---------------------------------------------------------------- panels and roof areas
  function panelDims(set) {
    const p = PN.byId(set.panelModel) || PN.byId(PN.DEFAULT_ID);
    return set.landscape ? { W: p.l, L: p.w, p } : { W: p.w, L: p.l, p };
  }
  /** Row pitch: flush roofs touch; racked rows clear the winter-solstice noon sun (same rule as the twin) */
  function pitchFor(set, L) {
    const depth = L * Math.cos(set.tilt * D2R);
    if (set.mount === 'flush') return depth + 0.02;
    if (!set.pitchAuto) return Math.max(depth + 0.05, set.rowPitch);
    const alt = Math.max(5, 90 - Math.abs(S.site.lat) - 23.44) * D2R, h = L * Math.sin(set.tilt * D2R);
    return +(depth + h / Math.tan(alt) * Math.max(0.2, Math.abs(Math.cos(set.azimuth * D2R)))).toFixed(2);
  }
  /** Fill a polygon (east/north metres) with rows of panels; returns runs {x, y, cols, row} */
  function layoutPolygon(poly, set, maxPanels = Infinity) {
    const { W, L } = panelDims(set), az = set.azimuth * D2R;
    const f = [Math.sin(az), Math.cos(az)], u = [Math.cos(az), -Math.sin(az)];
    const depth = L * Math.cos(set.tilt * D2R), pitch = pitchFor(set, L), gap = set.colGap, sb = set.setback;
    const st = poly.map(p => [p[0] * u[0] + p[1] * u[1], p[0] * f[0] + p[1] * f[1]]);
    const smin = Math.min(...st.map(p => p[0])), smax = Math.max(...st.map(p => p[0]));
    const tmin = Math.min(...st.map(p => p[1])), tmax = Math.max(...st.map(p => p[1]));
    const fits = (s0, t0) => [[s0, t0], [s0 + W, t0], [s0 + W, t0 + depth], [s0, t0 + depth], [s0 + W / 2, t0 + depth / 2]]
      .every(c => pointInPoly(c, st) && minEdgeDist(c, st) >= sb - 1e-6);
    const runs = []; let n = 0;
    // rows from the front (sunny edge) backwards, so a partly filled area keeps its best rows
    for (let r = 0; ; r++) {
      const t0 = tmax - sb - depth - r * pitch; if (t0 < tmin + sb - 1e-6) break;
      let run = null;
      for (let s0 = smin + sb; s0 + W <= smax - sb + 1e-6; s0 += W + gap) {
        if (n < maxPanels && fits(s0, t0)) { if (!run) run = { s0, cols: 0, row: r }; run.cols++; n++; }
        else if (run) { runs.push({ ...run, t0 }); run = null; }
      }
      if (run) runs.push({ ...run, t0 });
      if (n >= maxPanels) break;
    }
    return runs.map(rn => {
      const sc = rn.s0 + (rn.cols * W + (rn.cols - 1) * gap) / 2, tc = rn.t0 + depth / 2;
      return { x: sc * u[0] + tc * f[0], y: sc * u[1] + tc * f[1], cols: rn.cols, row: rn.row };
    });
  }
  const zoneSettings = (z) => ({ panelModel: z.panelModel, tilt: z.tilt, azimuth: z.azimuth, landscape: z.landscape, mount: z.mount, pitchAuto: z.pitchAuto, rowPitch: z.rowPitch, colGap: z.colGap, setback: z.setback, mountHeight: z.mountHeight });
  function fillZone(z) {
    S.arrays.filter(a => a.zone === z.id).forEach(a => api.removeArray(a.id));
    const runs = layoutPolygon(z.poly, z, z.count || Infinity);
    const { L } = panelDims(z), pitch = pitchFor(z, L);
    // flush rows lie on one roof plane: each row back from the front sits higher by pitch × tan(tilt),
    // so rows do not shade each other (racked rows on a flat roof all start at the same height)
    const rise = z.mount === 'flush' ? pitch * Math.tan(z.tilt * D2R) : 0;
    runs.forEach((rn, i) => api.newArray({ x: rn.x, y: rn.y, z: rn.row * rise, planeRow: z.mount === 'flush' ? rn.row : null, zoneRow: rn.row, tilt: z.tilt, azimuth: z.azimuth, rows: 1, cols: rn.cols, rowPitch: pitchFor(z, L), colGap: z.colGap,
      mountHeight: z.mountHeight, panelModel: z.panelModel, landscape: z.landscape, zone: z.id, name: `${z.name} · row ${rn.row + 1}${runs.filter(x => x.row === rn.row).length > 1 ? String.fromCharCode(97 + runs.filter((x, j) => x.row === rn.row && j < i).length) : ''}` }));
    return runs.reduce((t, r) => t + r.cols, 0);
  }
  let zoneCounter = 0;
  function newZone(poly, extra = {}) {
    zoneCounter = Math.max(zoneCounter, ...S.zones.map(z => +(String(z.name).match(/(\d+)$/) || [0, 0])[1])) + 1;
    const z = { id: 'z' + Date.now().toString(36) + Math.floor(Math.random() * 1e3), name: `Roof area ${zoneCounter}`, poly, ...zoneSettings(D), ...extra };
    S.zones.push(z);
    const n = fillZone(z);
    if (!n) { S.zones = S.zones.filter(x => x !== z); api.toast('No panels fit that area with the current panel, spacing and edge setback. Draw a larger area or reduce the setback (Advanced).', 'warn', 7000); return null; }
    sel = 'z:' + z.id;
    return z;
  }
  function placeSingle(x, y) {
    const a = api.newArray({ x, y, z: 0, tilt: D.tilt, azimuth: D.azimuth, rows: 1, cols: 1, panelModel: D.panelModel, landscape: D.landscape, mountHeight: D.mountHeight, colGap: D.colGap });
    a.name = `Panel ${S.arrays.filter(b => !b.zone).length}`;
    return a;
  }

  // ---------------------------------------------------------------- groups and selection
  const groupKey = (a) => a.zone ? 'z:' + a.zone : 'a:' + a.id;
  function groupArrays(key) { return key.startsWith('z:') ? S.arrays.filter(a => a.zone === key.slice(2)) : S.arrays.filter(a => a.id === key.slice(2)); }
  const groupZone = (key) => key && key.startsWith('z:') ? S.zones.find(z => z.id === key.slice(2)) : null;
  function removeGroup(key) {
    if (key.startsWith('o:')) { api.removeObject(key.slice(2)); }
    else { groupArrays(key).forEach(a => api.removeArray(a.id)); if (key.startsWith('z:')) S.zones = S.zones.filter(z => z.id !== key.slice(2)); }
    if (sel === key) sel = null;
    commit();
  }
  /** Apply the left-panel settings to the selected group, or to the whole design when nothing is selected */
  function applySettings(fields) {
    Object.assign(D, fields); saveD();
    const keys = sel && !sel.startsWith('o:') ? [sel] : [...new Set(S.arrays.map(groupKey))];
    keys.forEach(k => {
      const z = groupZone(k);
      if (z) { Object.assign(z, fields); fillZone(z); return; }
      groupArrays(k).forEach(a => {
        if ('panelModel' in fields) { const land = !!a.landscape; PN.setLandscape(a, false); PN.applyTo(a, fields.panelModel); PN.setLandscape(a, land); }
        if ('landscape' in fields) PN.setLandscape(a, fields.landscape);
        if ('tilt' in fields) a.tilt = fields.tilt;
        if ('azimuth' in fields) a.azimuth = fields.azimuth;
        if ('mountHeight' in fields) a.mountHeight = fields.mountHeight;
        if ('colGap' in fields) a.colGap = fields.colGap;
        api.updateArray(a);
      });
    });
    commit();
  }
  function commit() { api.changed(); redraw(); refreshSummary(); }

  // ---------------------------------------------------------------- drawing on the map
  const COL = { panel: '#1b2d47', panelEdge: '#9fb3c4', sel: '#f3b23c', zone: '#f3b23c', tree: '#5fae63', conifer: '#3f8a55', hedge: '#5f9b4a', building: '#c9c2b6', wall: '#b9ad98', chimney: '#b36b55', pole: '#a5825e' };
  function redraw() {
    if (!ready) return;
    ['zones', 'panels', 'objects'].forEach(k => layers[k].clearLayers());
    for (const z of S.zones) {
      const on = sel === 'z:' + z.id;
      const pg = L.polygon(z.poly.map(llOf), { color: COL.zone, weight: on ? 2.4 : 1.4, dashArray: '5 4', fillColor: COL.zone, fillOpacity: on ? 0.1 : 0.05, renderer: layers.canvas, bubblingMouseEvents: false });
      bindGroup(pg, 'z:' + z.id); layers.zones.addLayer(pg);
    }
    for (const a of S.arrays) {
      const key = groupKey(a), on = sel === key;
      const g = PH.buildArrayGeometry({ ...a, cellsX: 1, cellsY: 1 });
      for (const p of g.panels) {
        const c = p.c, u = p.u, v = p.v;
        const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [c[0] + u[0] * p.hu * i + v[0] * p.hv * j, c[1] + u[1] * p.hu * i + v[1] * p.hv * j]);
        const pg = L.polygon(pts.map(llOf), { color: on ? COL.sel : COL.panelEdge, weight: on ? 1.6 : 0.8, fillColor: COL.panel, fillOpacity: 0.92, renderer: layers.canvas, bubblingMouseEvents: false });
        bindGroup(pg, key); layers.panels.addLayer(pg);
      }
    }
    for (const o of S.objects) {
      const key = 'o:' + o.id, on = sel === key, col = COL[o.type] || '#ccc', T = PH.OBJECT_TYPES[o.type];
      let shape;
      if (o.type === 'tree' || o.type === 'conifer' || o.type === 'pole') shape = L.circle(llOf([o.x, o.y]), { radius: Math.max(0.3, o.dims.length / 2), color: on ? COL.sel : col, weight: on ? 2.4 : 1.4, fillColor: col, fillOpacity: 0.35, renderer: layers.canvas, bubblingMouseEvents: false });
      else {
        const h = -o.heading * D2R, c = Math.cos(h), s = Math.sin(h), hl = o.dims.length / 2, hw = (o.dims.width ?? o.dims.length) / 2;
        const pts = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([x, y]) => [o.x + x * c - y * s, o.y + x * s + y * c]);
        shape = L.polygon(pts.map(llOf), { color: on ? COL.sel : col, weight: on ? 2.4 : 1.4, fillColor: col, fillOpacity: 0.4, renderer: layers.canvas, bubblingMouseEvents: false });
      }
      shape.bindTooltip(`${T.label} · ${o.dims.height.toFixed(1)} m high`, { direction: 'top', sticky: true, className: 'pl-tip' });
      bindGroup(shape, key); layers.objects.addLayer(shape);
    }
    layers.site.setLatLng([S.site.lat, S.site.lon]);
  }
  function bindGroup(layer, key) {
    layer.on('mousedown', (e) => {
      if (tool === 'rect' || tool === 'free' || e.originalEvent.button !== 0) return;
      L.DomEvent.stopPropagation(e); L.DomEvent.preventDefault(e.originalEvent);
      drag = { key, start: enOf(e.latlng), last: enOf(e.latlng), moved: false };
      map.dragging.disable();
    });
    layer.on('click', (e) => { L.DomEvent.stopPropagation(e); suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); });
    layer.on('contextmenu', (e) => { L.DomEvent.stopPropagation(e); L.DomEvent.preventDefault(e.originalEvent); removeGroup(key); api.toast(key.startsWith('o:') ? 'Obstruction removed.' : 'Panels removed.', 'info', 2500); });
  }
  function translateGroup(key, dx, dy) {
    if (key.startsWith('o:')) { const o = S.objects.find(x => x.id === key.slice(2)); if (o) { o.x += dx; o.y += dy; } return; }
    const z = groupZone(key); if (z) z.poly = z.poly.map(p => [p[0] + dx, p[1] + dy]);
    groupArrays(key).forEach(a => { a.x += dx; a.y += dy; });
  }
  let rafPending = false;
  const redrawSoon = () => { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; redraw(); }); };

  function onMouseDown(e) {
    if (e.originalEvent.button !== 0) return;
    if (tool === 'rect') drawing = { kind: 'rect', a: e.latlng, shape: L.rectangle([e.latlng, e.latlng], { color: COL.zone, weight: 1.6, dashArray: '5 4', fillOpacity: 0.08 }).addTo(map) };
    else if (tool === 'free') drawing = { kind: 'free', pts: [e.latlng], shape: L.polyline([e.latlng], { color: COL.zone, weight: 2 }).addTo(map) };
  }
  function onMouseMove(e) {
    if (drag) {
      const p = enOf(e.latlng), dx = p[0] - drag.last[0], dy = p[1] - drag.last[1];
      if (!drag.moved && Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) < 0.15) return;
      drag.moved = true; translateGroup(drag.key, dx, dy); drag.last = p; redrawSoon(); return;
    }
    if (!drawing) return;
    if (drawing.kind === 'rect') drawing.shape.setBounds(L.latLngBounds(drawing.a, e.latlng));
    else { const last = drawing.pts[drawing.pts.length - 1]; if (map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(e.latlng)) > 4) { drawing.pts.push(e.latlng); drawing.shape.setLatLngs(drawing.pts); } }
  }
  function onMouseUp(e) {
    if (drag) {
      const d = drag; drag = null; map.dragging.enable();
      if (d.moved) {
        if (d.key.startsWith('o:')) { const o = S.objects.find(x => x.id === d.key.slice(2)); if (o) api.updateObject(o); }
        else groupArrays(d.key).forEach(a => api.updateArray(a));
        suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
        commit();
      } else { sel = sel === d.key ? null : d.key; syncInputs(); redraw(); refreshSummary(); }
      return;
    }
    if (!drawing) return;
    const dr = drawing; drawing = null; map.removeLayer(dr.shape);
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    let poly;
    if (dr.kind === 'rect') {
      const a = enOf(dr.a), b = enOf(e.latlng);
      if (Math.abs(a[0] - b[0]) < 1 || Math.abs(a[1] - b[1]) < 1) { api.toast('Drag a larger rectangle (at least 1 m each way).', 'warn'); return; }
      poly = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
    } else {
      const pts = simplify(dr.pts.map(enOf), 0.25);
      if (pts.length < 3 || polyArea(pts) < 2) { api.toast('Draw around the roof outline and release to close it.', 'warn'); return; }
      poly = pts;
    }
    const z = newZone(poly);
    if (z) { api.toast(`${z.name}: ${polyArea(poly).toFixed(0)} m², ${S.arrays.filter(a => a.zone === z.id).reduce((t, a) => t + a.cols * a.rows, 0)} panels.`, 'ok', 3500); $('#pl-area').value = Math.round(polyArea(poly)); }
    commit();
  }
  function onMapClick(e) {
    if (suppressClick || drawing) return;
    const p = enOf(e.latlng);
    if (tool === 'place') { const a = placeSingle(p[0], p[1]); sel = null; commit(); return a; }
    if (tool === 'obst') { const o = api.newObject(obType, p[0], p[1]); const h = Number($('#pl-ob-h').value); if (h > 0) { o.dims.height = h; api.updateObject(o, true); } sel = 'o:' + o.id; commit(); return o; }
  }

  // ---------------------------------------------------------------- left panel
  function saveD() { try { localStorage.setItem(STORE, JSON.stringify(D)); } catch (e) { /* fine */ } }
  function loadD() { try { Object.assign(D, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) { /* fine */ } if (!PN.byId(D.panelModel)) D.panelModel = PN.DEFAULT_ID; }
  /** What the sliders show: the selected group, else the design defaults */
  function current() {
    const z = groupZone(sel); if (z) return z;
    if (sel && sel.startsWith('a:')) { const a = S.arrays.find(x => x.id === sel.slice(2)); if (a) return { panelModel: PN.byId(a.panelModel) ? a.panelModel : D.panelModel, tilt: a.tilt, azimuth: a.azimuth, landscape: !!a.landscape, mount: D.mount, pitchAuto: D.pitchAuto, rowPitch: a.rowPitch, colGap: a.colGap, setback: D.setback, mountHeight: a.mountHeight }; }
    return D;
  }
  function azNote(az) {
    const best = S.site.lat >= 0 ? 180 : 0, off = Math.abs(((az - best + 540) % 360) - 180);
    const word = api.compass(az);
    return off <= 22.5 ? `${S.site.lat >= 0 ? 'South' : 'North'} ✓ (best for this hemisphere)` : `Facing ${word}, ${Math.round(off)}° off ${S.site.lat >= 0 ? 'south' : 'north'}`;
  }
  function syncInputs() {
    const c = current();
    $('#pl-model').value = c.panelModel; $('#pl-tilt').value = c.tilt; $('#pl-az').value = c.azimuth;
    $('#pl-tilt-out').textContent = `${c.tilt}°`; $('#pl-az-out').textContent = `${c.azimuth}°`;
    $('#pl-az-note').textContent = azNote(c.azimuth);
    $$('#pl-orient button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.v === 'landscape') === !!c.landscape)));
    $$('#pl-mount button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === c.mount)));
    $('#pl-pitch').value = pitchFor(c, panelDims(c).L).toFixed(2); $('#pl-pitch').disabled = c.mount === 'flush' || c.pitchAuto;
    $('#pl-pitch-auto').checked = !!c.pitchAuto; $('#pl-pitch-auto').disabled = c.mount === 'flush';
    $('#pl-gap').value = c.colGap; $('#pl-setback').value = c.setback; $('#pl-mounth').value = c.mountHeight;
    const p = PN.byId(c.panelModel);
    $('#pl-model-info').textContent = p ? `${p.wp} W · ${(p.eff * 100).toFixed(1)}% efficient · ${p.gamma} %/°C · ${p.tech}` : '';
    const z = groupZone(sel), a = sel && sel.startsWith('a:') ? S.arrays.find(x => x.id === sel.slice(2)) : null, o = sel && sel.startsWith('o:') ? S.objects.find(x => x.id === sel.slice(2)) : null;
    const nGroups = new Set(S.arrays.map(groupKey)).size;
    $('#pl-editing').innerHTML = z ? `Editing <b>${api.escapeHtml(z.name)}</b> · <button class="link" id="pl-desel">whole design</button>`
      : a ? `Editing <b>${api.escapeHtml(a.name)}</b> · <button class="link" id="pl-desel">whole design</button>`
      : o ? `Selected <b>${PH.OBJECT_TYPES[o.type].label}</b> (${o.dims.height.toFixed(1)} m) · right-click or Delete removes it · <button class="link" id="pl-desel">deselect</button>`
      : nGroups > 1 ? `Settings apply to all ${nGroups} groups. Click panels on the map to edit one group.` : 'Settings apply to the whole design and to new panels.';
    const ds = $('#pl-desel'); if (ds) ds.onclick = () => { sel = null; syncInputs(); redraw(); };
  }
  function refreshSummary() {
    if (!api) return;
    const n = S.arrays.reduce((t, a) => t + a.rows * a.cols, 0), kwp = api.totalKwp();
    const models = [...new Set(S.arrays.map(a => a.panelModel))];
    const one = S.arrays[0];
    const dims = one ? `${one.panelW.toFixed(2)} m × ${one.panelL.toFixed(2)} m each${models.length > 1 ? ' (first group)' : ''}` : (() => { const d = panelDims(D); return `${d.W.toFixed(2)} m × ${d.L.toFixed(2)} m each`; })();
    const ql = api.quickLoss(), y = S.yieldRes;
    const loss = !n ? '<b>—</b>' : y && !y.stale ? `<b>${(y.shadingLoss * 100).toFixed(1)}%</b> a year <span class="hint">(from a year of weather)</span>` : ql == null ? '<b>…</b>' : `<b>${(ql * 100).toFixed(1)}%</b> a year <span class="hint">(clear-sky estimate)</span>`;
    $('#pl-summary').innerHTML = `<span class="eyebrow">Array</span><div><b>${n}</b> panel${n === 1 ? '' : 's'}</div><div><b>${kwp.toFixed(2)} kWp</b></div><div class="hint">${dims}</div><div>Estimated shading loss: ${loss}</div>`;
    const area = S.zones.reduce((t, z) => t + polyArea(z.poly), 0);
    if (area && !$('#pl-area').value) $('#pl-area').placeholder = Math.round(area);
    ['#pl-sim', '#pl-forecast', '#pl-yield'].forEach(id => { $(id).disabled = !n; });
  }

  // ---------------------------------------------------------------- Design kit: area analysis
  async function analyse() {
    const typed = Number($('#pl-area').value);
    const area = typed > 0 ? typed : S.zones.reduce((t, z) => t + polyArea(z.poly), 0);
    const out = $('#pl-analysis'); out.hidden = false;
    if (!(area > 0)) { out.innerHTML = '<p class="hint">Enter a roof area, or draw one on the map first.</p>'; return; }
    const set = { ...current() }, { W, L, p } = panelDims(set);
    // packing: flush roofs lose a setback strip around the edge; racked rows also lose the gaps between rows
    const side = Math.sqrt(area), usable = Math.max(0, (side - 2 * set.setback)) ** 2;
    const depth = L * Math.cos(set.tilt * D2R), rowShare = set.mount === 'flush' ? 1 : depth / pitchFor(set, L);
    const n = Math.max(0, Math.floor(usable * rowShare * 0.92 / (W * depth + set.colGap * depth)));
    const kwp = n * p.wp / 1000;
    out.innerHTML = `<div class="result-card"><span class="eyebrow">Roof area ${Math.round(area)} m²</span><div class="rc-big"><b>${n}</b> panels <small>${kwp.toFixed(2)} kWp of ${api.escapeHtml(PN.short(p))}</small></div><p class="hint" id="pl-an-y">Working out a year of output at ${set.tilt}° facing ${api.compass(set.azimuth)}…</p></div>`;
    try {
      const sy = (await api.specificYield(set)) * api.acFactor();
      $('#pl-an-y').innerHTML = sy ? `About <b>${Math.round(sy * kwp).toLocaleString()} kWh a year</b> (${Math.round(sy)} kWh/kWp from the last 12 months of weather here, unshaded, after system losses). Rough sizing: edges, vents and roof shape reduce the count.` : 'Weather for a yield estimate is not available right now.';
    } catch (e) { $('#pl-an-y').textContent = 'Yield needs weather: ' + (e.message || e); }
  }

  // ---------------------------------------------------------------- Design kit: typed requests (rules-based)
  const MAKERS = [
    [/\blongi\b.*\bx10\b|\bx10\b/i, 'longi-x10-485'], [/\blongi\b/i, 'longi-himo6-430'], [/\baiko\b/i, 'aiko-2p-460'],
    [/\bjinko\b.*\b(72|580|large)\b|\b580\s*w/i, 'jinko-tn72-580'], [/\bjinko\b/i, 'jinko-tn54-440'], [/\bja\s*solar\b|\bdeepblue\b/i, 'ja-db4-450'],
    [/\btrina\b|\bvertex\b/i, 'trina-vsplus-440'], [/\bq\.?\s*cells\b|\bqcells\b|\bq\.tron\b|\bhanwha\b/i, 'qcells-tron-430'], [/\brec\b|\balpha pure\b/i, 'rec-alpha-430'],
    [/\bmaxeon\b|\bsunpower\b/i, 'maxeon7-445']
  ];
  const DIRS = { north: 0, 'north-east': 45, northeast: 45, east: 90, 'south-east': 135, southeast: 135, south: 180, 'south-west': 225, southwest: 225, west: 270, 'north-west': 315, northwest: 315 };
  const STOP = '(?=\\s*(?:,|\\.|;|!|\\?|$|\\s(?:facing|south|north|east|west|with|using|tilt|tilted|at\\s+\\d|on\\s+a|landscape|portrait|and\\s+(?:forecast|estimate|simulate|save)|then)\\b))';
  function parseRequest(text) {
    const t = ' ' + text.trim() + ' ', r = {};
    const pc = t.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
    const loc = t.match(new RegExp('\\b(?:in|at|near|to|for)\\s+([A-Za-z][\\w\'’.\\- ]{1,60}?)' + STOP, 'i'));
    if (pc) r.place = pc[1]; else if (loc && !/^(the|a|an|my|this)\s/i.test(loc[1] + ' ') && !/^\d/.test(loc[1]) && !/\b(panels?|kwp?|degrees?|roof|area)\b/i.test(loc[1])) r.place = loc[1].trim();
    const ll = t.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/); if (ll) r.place = `${ll[1]}, ${ll[2]}`;
    const cnt = t.match(/\b(\d{1,4})\s*(?:x\s*)?(?:solar\s+)?(?:pv\s+)?(?:panels?|modules?)\b/i); if (cnt) r.count = +cnt[1];
    const kw = t.match(/\b(\d+(?:\.\d+)?)\s*kw\s*p?\b(?!h)/i); if (kw) r.kwp = +kw[1];
    if (/\beast[\s-]*(?:and|\/|-)?[\s-]*west\b/i.test(t)) r.azimuth = 'ew';
    else { const d = t.match(/\b(north|south)[\s-]?(east|west)\b|\b(north|south|east|west)\b/i); if (d) r.azimuth = DIRS[(d[1] ? `${d[1]}-${d[2]}` : d[3]).toLowerCase()]; }
    const azn = t.match(/\bazimuth\s*(?:of|=|:)?\s*(\d{1,3})/i); if (azn) r.azimuth = +azn[1] % 360;
    const tl = t.match(/\btilt(?:ed)?\s*(?:of|at|=|:)?\s*(\d{1,2})\b/i) || t.match(/\b(\d{1,2})\s*(?:°|deg\b|degrees?\b)/i); if (tl) r.tilt = clamp(+tl[1], 0, 90);
    if (/\bflat\s+roof\b|\bflat\b/i.test(t)) { r.mount = 'rows'; if (r.tilt == null) r.tilt = 15; }
    if (/\bground[\s-]?mount/i.test(t)) { r.mount = 'rows'; if (r.tilt == null) r.tilt = 30; }
    if (/\blandscape\b/i.test(t)) r.landscape = true; else if (/\bportrait\b/i.test(t)) r.landscape = false;
    const w = t.match(/\b(4\d\d|5\d\d|6\d\d)\s*w(?:att)?s?\b/i);
    for (const [re, id] of MAKERS) if (re.test(t)) { r.panelModel = id; break; }
    if (!r.panelModel && w) { const target = +w[1]; r.panelModel = PN.LIST.reduce((b, p) => Math.abs(p.wp - target) < Math.abs(b.wp - target) ? p : b).id; }
    const ar = t.match(/\b(\d+(?:\.\d+)?)\s*(?:m2|m²|sq\.?\s*m|square\s+met(?:re|er)s?)\b/i); if (ar) r.area = +ar[1];
    const ob = t.match(/\b(tree|conifer|hedge|building|chimney|wall|pole)\b(?:[^.]*?\b(\d+(?:\.\d+)?)\s*m(?:etres?|eters?)?\b)?(?:[^.]*?\b(north|south|east|west)\b)?(?:[^.]*?\b(\d+(?:\.\d+)?)\s*m(?:etres?|eters?)?\s*(?:tall|high)\b)?/i);
    if (ob && /\b(add|place|put|there(?:'s| is)|with)\b/i.test(t)) r.obstacle = { type: ob[1].toLowerCase(), dist: ob[2] ? +ob[2] : 8, dir: ob[3] ? ob[3].toLowerCase() : 'south', height: ob[4] ? +ob[4] : null };
    if (/\bforecast\b/i.test(t)) r.forecast = true;
    if (/\b(yield|annual|per year|a year|estimate)\b/i.test(t)) r.yield = true;
    if (/\b(simulate|3d|twin)\b/i.test(t)) r.simulate = true;
    const sv = t.match(/\bsave(?:\s+(?:it|this|site))?(?:\s+as\s+["“']?([^"”']+?)["”']?)?\s*(?:$|[.,;])/i); if (sv) r.save = (sv[1] || '').trim() || true;
    if (/\b(clear|reset|start over|remove all|delete all)\b/i.test(t)) r.clear = true;
    return r;
  }
  function chatSay(who, html) {
    const el = document.createElement('div'); el.className = 'msg ' + who; el.innerHTML = html;
    $('#pl-chat').appendChild(el); el.scrollIntoView({ block: 'end', behavior: 'smooth' });
    return el;
  }
  /** Lay out n panels as a block near the site centre (beside any existing panels) */
  function placeBlock(n, set, label) {
    const { W, L } = panelDims(set), depth = L * Math.cos(set.tilt * D2R);
    const rows = n <= 6 ? 1 : n <= 18 ? 2 : Math.ceil(Math.sqrt(n / 3));
    const cols = Math.ceil(n / rows), pitch = pitchFor(set, L);
    const az = set.azimuth * D2R, f = [Math.sin(az), Math.cos(az)], u = [Math.cos(az), -Math.sin(az)];
    const sw = cols * W + (cols - 1) * set.colGap + 2 * set.setback + 0.02, tw = (rows - 1) * pitch + depth + 2 * set.setback + 0.02;
    let cx = 0, cy = 0;
    if (S.arrays.length) { const xs = S.arrays.map(a => a.x), ys = S.arrays.map(a => a.y); cx = Math.max(...xs) + sw / 2 + 3; cy = (Math.min(...ys) + Math.max(...ys)) / 2; }
    const corners = [[-sw / 2, -tw / 2], [sw / 2, -tw / 2], [sw / 2, tw / 2], [-sw / 2, tw / 2]].map(([s, t]) => [cx + s * u[0] + t * f[0], cy + s * u[1] + t * f[1]]);
    return newZone(corners, { ...set, count: n, name: label });
  }
  async function handleRequest(text) {
    chatSay('me', api.escapeHtml(text));
    const r = parseRequest(text), done = [];
    const thinking = chatSay('bot', '<span class="spinner"></span> Working…');
    try {
      if (r.clear) { [...new Set(S.arrays.map(groupKey))].forEach(k => groupArrays(k).forEach(a => api.removeArray(a.id))); S.zones = []; [...S.objects].forEach(o => api.removeObject(o.id)); sel = null; commit(); done.push('Cleared the design.'); }
      if (r.place) {
        const { results, note } = await api.searchPlaces(r.place);
        if (!results.length) done.push(`Could not find “${api.escapeHtml(r.place)}”. ${api.escapeHtml(note || '')}`);
        else { const g = results[0]; await api.goToSite(g.lat, g.lon, g.detail && g.source !== 'coordinates' ? `${g.name}, ${g.detail}` : g.name); done.push(`Moved the site to <b>${api.escapeHtml(g.name)}</b>${g.detail ? ', ' + api.escapeHtml(g.detail) : ''} (${g.source}).`); }
      }
      const set = { ...D };
      if (r.panelModel) set.panelModel = r.panelModel;
      if (r.tilt != null) set.tilt = r.tilt;
      if (typeof r.azimuth === 'number') set.azimuth = r.azimuth;
      if (r.landscape != null) set.landscape = r.landscape;
      if (r.mount) set.mount = r.mount;
      const p = PN.byId(set.panelModel);
      let n = r.count || (r.kwp ? Math.ceil(r.kwp * 1000 / p.wp) : 0);
      if (!n && r.area && !r.count) { $('#pl-area').value = r.area; }
      if (n) {
        n = Math.min(n, 2000);
        if (r.azimuth === 'ew') {
          set.tilt = r.tilt ?? 10; set.mount = 'flush';
          const half = Math.ceil(n / 2);
          placeBlock(half, { ...set, azimuth: 90 }, 'East face'); placeBlock(n - half, { ...set, azimuth: 270 }, 'West face');
          done.push(`Placed <b>${n} × ${api.escapeHtml(PN.short(p))}</b> (${(n * p.wp / 1000).toFixed(2)} kWp) east–west at ${set.tilt}°.`);
        } else {
          placeBlock(n, set, `${n} panels`);
          done.push(`Placed <b>${n} × ${api.escapeHtml(PN.short(p))}</b> (${(n * p.wp / 1000).toFixed(2)} kWp) facing ${api.compass(set.azimuth)} at ${set.tilt}°${set.landscape ? ', landscape' : ''}.`);
        }
        Object.assign(D, { ...set, azimuth: typeof r.azimuth === 'number' ? r.azimuth : D.azimuth }); saveD(); sel = null; commit();
      } else {
        const fields = {};
        ['panelModel', 'tilt', 'landscape', 'mount'].forEach(k => { if (r[k] != null) fields[k] = r[k]; });
        if (typeof r.azimuth === 'number') fields.azimuth = r.azimuth;
        if (Object.keys(fields).length) {
          if (S.arrays.length) applySettings(fields); else { Object.assign(D, fields); saveD(); }
          done.push(`Set ${Object.entries(fields).map(([k, v]) => k === 'panelModel' ? api.escapeHtml(PN.label(PN.byId(v))) : k === 'tilt' ? `tilt ${v}°` : k === 'azimuth' ? `facing ${api.compass(v)}` : k === 'landscape' ? (v ? 'landscape' : 'portrait') : (v === 'rows' ? 'racked rows' : 'flush mounting')).join(', ')}${S.arrays.length ? '' : ' for new panels'}.`);
        }
      }
      if (r.obstacle) {
        const o0 = r.obstacle, xs = S.arrays.map(a => a.x), ys = S.arrays.map(a => a.y);
        const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0, cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
        const v = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] }[o0.dir];
        const o = api.newObject(o0.type, cx + v[0] * o0.dist, cy + v[1] * o0.dist);
        if (o0.height) { o.dims.height = o0.height; api.updateObject(o, true); }
        commit(); done.push(`Added a ${PH.OBJECT_TYPES[o0.type].label.toLowerCase()} ${o0.dist} m ${o0.dir} of the panels (${o.dims.height.toFixed(1)} m high).`);
      }
      if (r.area && !n) { await analyse(); done.push(`Sized a ${r.area} m² roof (see the result above).`); }
      syncInputs(); refreshSummary();
      if (r.save) { const e = api.saveSite(typeof r.save === 'string' ? r.save : ''); if (e) done.push(`Saved as “${api.escapeHtml(e.name)}”.`); }
      if (r.forecast) { const f = await api.forecast(); if (f) done.push(`Forecast: <b>${f.total.toFixed(1)} kWh</b> over the next ${f.days.length} days.`); }
      if (r.yield) { const y = await api.estimateYield(); if (y) done.push(`Estimated yield: <b>${Math.round(y.total).toLocaleString()} kWh a year</b> (${Math.round(y.specific)} kWh/kWp).`); }
      if (r.simulate) { done.push('Opening the 3D twin…'); setTimeout(() => api.simulate(), 300); }
      thinking.innerHTML = done.length ? done.join('<br>') : 'I did not catch a site, panel count, size or action there. Try: <i>“12 panels south-facing at 30°”</i>, <i>“5 kWp of Aiko panels in MK18 1EG”</i>, <i>“add a tree 10 m south, 12 m tall”</i>, <i>“east-west 16 panels”</i>, <i>“estimate yield”</i> or <i>“save as Garage roof”</i>.';
    } catch (e) { thinking.textContent = 'That did not work: ' + (e.message || e); }
  }

  // ---------------------------------------------------------------- map setup
  /** Fit the map to the design (panels, roof areas, obstructions), or centre on the site when empty */
  function focusDesign(animate = true) {
    if (!map) return;
    const pts = [];
    S.arrays.forEach(a => PH.buildArrayGeometry({ ...a, cellsX: 1, cellsY: 1 }).panels.forEach(p => pts.push(p.c)));
    S.zones.forEach(z => z.poly.forEach(p => pts.push(p)));
    S.objects.forEach(o => { const r = Math.max(o.dims.length, o.dims.width ?? o.dims.length) / 2; pts.push([o.x - r, o.y - r], [o.x + r, o.y + r]); });
    if (!pts.length) { map.setView([S.site.lat, S.site.lon], 19, { animate }); return; }
    const b = L.latLngBounds(pts.map(llOf));
    map.fitBounds(b.pad(0.15), { padding: [70, 70], maxZoom: 20.5, animate });
  }
  function setBase(b) {
    base = b;
    [layers.sat, layers.osm].forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
    (b === 'sat' ? layers.sat : layers.osm).addTo(map);
    $$('#pl-layers button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.layer === b)));
  }
  const HINTS = {
    place: 'Click to place a panel · Drag to move · Right-click to remove',
    rect: 'Drag a rectangle over the roof · it fills with panels · Place tool to pan',
    free: 'Drag around the roof outline · release to fill it · Place tool to pan',
    obst: 'Click to place an obstruction · Drag to move · Right-click to remove'
  };
  function setTool(t) {
    tool = t;
    $$('#pl-tools [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    $('#pl-obwrap').hidden = t !== 'obst';
    $('#pl-hint').textContent = HINTS[t];
    if (!map) return;
    if (t === 'rect' || t === 'free') map.dragging.disable(); else map.dragging.enable();
    map.getContainer().style.cursor = t === 'place' ? '' : 'crosshair';
  }
  function initMap() {
    if (map || !root.L) return;
    map = L.map('pl-map', { zoomControl: true, maxZoom: 22, zoomSnap: 0.5, attributionControl: true, doubleClickZoom: false }).setView([S.site.lat, S.site.lon], 19);
    layers.sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 22, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
    layers.osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 22, attribution: '© OpenStreetMap contributors' });
    layers.canvas = L.canvas({ padding: 0.4, tolerance: 2 });
    layers.zones = L.layerGroup().addTo(map); layers.panels = L.layerGroup().addTo(map); layers.objects = L.layerGroup().addTo(map);
    layers.site = L.circleMarker([S.site.lat, S.site.lon], { radius: 4, color: '#ffffff', weight: 1.5, fillColor: '#6cc3e8', fillOpacity: 1, interactive: false }).addTo(map);
    setBase(base);
    map.on('mousedown', onMouseDown); map.on('mousemove', onMouseMove); map.on('mouseup', onMouseUp); map.on('click', onMapClick);
    map.on('contextmenu', (e) => L.DomEvent.preventDefault(e.originalEvent));
    document.addEventListener('mouseup', (e) => { if (drag || drawing) onMouseUp({ latlng: map.mouseEventToLatLng(e), originalEvent: e }); });
    ready = true; setTool(tool);
  }

  function wire() {
    $('#pl-model').innerHTML = api.panelOptionsHtml(false);
    $('#pl-model').addEventListener('change', (e) => applySettings({ panelModel: e.target.value }));
    $('#pl-tilt').addEventListener('input', (e) => { $('#pl-tilt-out').textContent = e.target.value + '°'; });
    $('#pl-tilt').addEventListener('change', (e) => applySettings({ tilt: +e.target.value }));
    $('#pl-az').addEventListener('input', (e) => { $('#pl-az-out').textContent = e.target.value + '°'; $('#pl-az-note').textContent = azNote(+e.target.value); });
    $('#pl-az').addEventListener('change', (e) => applySettings({ azimuth: +e.target.value }));
    $('#pl-orient').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) applySettings({ landscape: b.dataset.v === 'landscape' }); syncInputs(); });
    $('#pl-mount').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) applySettings({ mount: b.dataset.v }); syncInputs(); });
    $('#pl-pitch-auto').addEventListener('change', (e) => { applySettings({ pitchAuto: e.target.checked }); syncInputs(); });
    $('#pl-pitch').addEventListener('change', (e) => { const v = +e.target.value; if (v > 0) applySettings({ rowPitch: v, pitchAuto: false }); syncInputs(); });
    $('#pl-gap').addEventListener('change', (e) => { const v = +e.target.value; if (v >= 0) applySettings({ colGap: clamp(v, 0, 1) }); });
    $('#pl-setback').addEventListener('change', (e) => { const v = +e.target.value; if (v >= 0) applySettings({ setback: clamp(v, 0, 5) }); });
    $('#pl-mounth').addEventListener('change', (e) => { const v = +e.target.value; if (v >= 0) applySettings({ mountHeight: clamp(v, 0, 5) }); });
    $('#pl-tools').addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
    $('#pl-obtype').innerHTML = Object.entries(PH.OBJECT_TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('');
    $('#pl-obtype').addEventListener('change', (e) => { obType = e.target.value; $('#pl-ob-h').value = PH.OBJECT_TYPES[obType].dims.height; });
    $('#pl-ob-h').value = PH.OBJECT_TYPES[obType].dims.height;
    $('#pl-layers').addEventListener('click', (e) => { const b = e.target.closest('[data-layer]'); if (b) setBase(b.dataset.layer); });
    $('#pl-locate').addEventListener('click', () => map && map.setView([S.site.lat, S.site.lon], Math.max(map.getZoom(), 19)));
    $('#pl-search').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = $('#pl-q').value.trim(); if (!q) return;
      const ul = $('#pl-results'); ul.innerHTML = '<li class="hint">Searching…</li>'; ul.hidden = false;
      try {
        const { results, note } = await api.searchPlaces(q);
        if (!results.length) { ul.innerHTML = `<li class="hint">${api.escapeHtml(note)}</li>`; return; }
        const go = async (g) => { ul.hidden = true; ul.innerHTML = ''; await api.goToSite(g.lat, g.lon, g.detail && g.source !== 'coordinates' ? `${g.name}, ${g.detail}` : g.name); };
        if (results.length === 1) { go(results[0]); return; }
        ul.innerHTML = results.map((g, i) => `<li><button type="button" data-i="${i}">${api.escapeHtml(g.name)}<small>${api.escapeHtml([g.detail, g.source].filter(Boolean).join(' · '))}</small></button></li>`).join('');
        ul.onclick = (ev) => { const b = ev.target.closest('button'); if (b) go(results[+b.dataset.i]); };
      } catch (err) { ul.innerHTML = `<li class="hint">${api.escapeHtml(err.message || 'Search failed.')}</li>`; }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#pl-search')) $('#pl-results').hidden = true; });
    $('#pl-sim').addEventListener('click', () => api.simulate());
    $('#pl-forecast').addEventListener('click', () => api.forecast());
    $('#pl-yield').addEventListener('click', () => api.estimateYield());
    $('#pl-save').addEventListener('click', () => api.saveSite($('#pl-name').value));
    $('#pl-name').addEventListener('change', (e) => { S.designName = e.target.value.trim(); S.designAuto = !S.designName; });
    $('#pl-analyse').addEventListener('click', analyse);
    $('#pl-area').addEventListener('keydown', (e) => { if (e.key === 'Enter') analyse(); });
    $('#pl-chat-form').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#pl-chat-q').value.trim(); if (!q) return; $('#pl-chat-q').value = ''; handleRequest(q); });
    document.addEventListener('keydown', (e) => {
      if (S.view !== 'design' || e.target.closest('input, select, textarea')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeGroup(sel); }
      if (e.key === 'Escape') { sel = null; syncInputs(); redraw(); }
      const keyTool = { 1: 'place', 2: 'rect', 3: 'free', 4: 'obst' }[e.key]; if (keyTool) setTool(keyTool);
    });
    chatSay('bot', 'Describe the array or type a location and I’ll move the map, place panels and set the parameters. For example <i>“10 panels in London, south-facing”</i> or <i>“4 kWp of LONGi panels at 30° in MK18 1EG”</i>. You can also draw a roof area with the tools on the map.');
  }

  const ArienPlanner = {
    init(a) { api = a; S = a.state; PN = a.PN; PH = a.PH; loadD(); wire(); syncInputs(); },
    show() {
      if (!root.L) { $('#pl-map').innerHTML = '<p class="hint" style="padding:20px">The map library (Leaflet) did not load. Check the connection and reload.</p>'; return; }
      initMap(); setTimeout(() => { map.invalidateSize(); focusDesign(false); }, 30);
      focusDesign(false);
      syncInputs(); redraw(); refreshSummary(); api.renderSavedSites(); api.renderResults();
    },
    siteMoved(moved) { if (moved) sel = null; focusDesign(false); syncInputs(); redraw(); refreshSummary(); },
    focusDesign,
    redraw() { if (S && S.view === 'design') { redraw(); syncInputs(); refreshSummary(); } },
    refreshSummary() { if (S && S.view === 'design') refreshSummary(); },
    // exposed for tests
    parseRequest, layoutPolygon: (poly, set, max) => layoutPolygon(poly, { ...D, ...set }, max), polyArea, handleRequest, setTool,
    _map: () => map, _sel: () => sel
  };
  root.ArienPlanner = ArienPlanner;
})(typeof window !== 'undefined' ? window : globalThis);
