/* ARIEN Twin Studio — browser digital twin (CesiumJS world, Open-Meteo weather, thesis physics). */
(function () {
  'use strict';
  const PH = window.ArienPhysics, WX = window.ArienWeather;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const DEFAULT_SITE = { name: 'Buckingham, UK', lat: 51.99564350977578, lon: -0.9906258867252853 };
  const LIVE_KEYS = ['rwghi', 'hdkr', 'karamov', 'kasten', 'balint', 'seasonal'];
  const MODEL_COLORS = { rwghi: '#f3b23c', hdkr: '#6cc3e8', karamov: '#a594f9', kasten: '#e5675c', balint: '#69c38a', seasonal: '#eef2f5' };
  const modelLabel = (k) => k === 'seasonal' ? 'Seasonal rule (thesis)' : PH.MODELS[k].label;
  const modelShort = (k) => k === 'seasonal' ? 'Seasonal' : PH.MODELS[k].short;
  const MODEL_NOTE = { rwghi: 'API GHI', hdkr: 'API GHI + DHI', karamov: 'cloud cover', kasten: 'cloud cover', balint: 'cloud cover', seasonal: 'switches by season' };
  const STORE_SCENE = 'arien-twin-scene-v1', STORE_KEYS = 'arien-twin-keys-v1';
  const MAX_RENDER_CELLS = 24000;

  let uidCounter = 1;
  const newId = (p) => p + Date.now().toString(36).slice(-4) + (uidCounter++);

  // ------------------------------------------------------------------ state
  const state = {
    site: { ...DEFAULT_SITE, groundZ: 0, elevation: null },
    world: { src: 'none', ion: '', google: '', remember: false },
    wx: { mode: 'forecast', series: null, measured: null, csvFile: null },
    arrays: [], objects: [], sel: null,
    live: 'rwghi',
    compare: { rwghi: true, hdkr: true, karamov: true, kasten: true, balint: false, seasonal: false },
    params: clone(PH.DEFAULT_PARAMS), thermalCa: 9600,
    visuals: 'high', shadowsOn: true, colourMode: 'real',
    sim: { lastT: null, T: {}, energyWh: 0, lastW: null, lastRes: null, playing: false },
    shade: { dirty: true, lastSun: null, trans: [], useTiles: false, profiles: {}, step: 10, scope: 'array' },
    run: null, placing: null
  };
  const geoms = new Map();      // array id -> PH geometry
  let viewer = null, scene = null, siteM = null, siteMinv = null, tileset = null, handler = null, cloudStage = null;
  const arrayPrims = new Map(); // id -> {prim, simplified}
  const objModels = new Map();  // id -> primitive/model
  const glbUrls = {};
  let chart = null;
  const vis = { wind: [0, 0], flash: 0, lastReal: performance.now(), lastSimT: null };

  // ------------------------------------------------------------------ utilities
  function toast(msg, kind = 'info', ms = 4500) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind; el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }
  function setStatus(id, msg, kind = '') { const el = $(id); el.textContent = msg || ''; el.className = 'status ' + kind; }
  const utcOffset = () => state.wx.series ? state.wx.series.utcOffset * 1000 : Math.round(state.site.lon / 15) * 3600000;
  const tzLabel = () => state.wx.series ? state.wx.series.tz : 'local';
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  function fmtTime(t, withDate = true) {
    const d = new Date(t + utcOffset());
    const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    return withDate ? `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hm}` : hm;
  }
  const fmtDay = (t) => { const d = new Date(t + utcOffset()); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
  const isoDate = (t) => new Date(t).toISOString().slice(0, 10);
  const compass = (deg) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  const fmt = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d);
  const inputTarget = (e) => e.target.closest('input, select, textarea, [contenteditable]');
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function download(name, text, type = 'text/csv') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  // ------------------------------------------------------------------ persistence
  function saveScene() {
    try {
      localStorage.setItem(STORE_SCENE, JSON.stringify(sceneSnapshot()));
      if (state.world.remember) localStorage.setItem(STORE_KEYS, JSON.stringify({ ion: state.world.ion, google: state.world.google, om: state.wx.apiKey || '', src: state.world.src }));
      else localStorage.removeItem(STORE_KEYS);
    } catch (e) { /* storage unavailable: fine */ }
  }
  let saveTimer = null;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveScene, 600); };
  function sceneSnapshot() {
    return { v: 1, site: { name: state.site.name, lat: state.site.lat, lon: state.site.lon }, worldSrc: state.world.src,
      arrays: state.arrays, objects: state.objects, live: state.live, compare: state.compare, params: state.params, thermalCa: state.thermalCa,
      visuals: state.visuals, shadowsOn: state.shadowsOn, colourMode: state.colourMode };
  }
  function applySnapshot(s) {
    if (!s || s.v !== 1) return false;
    Object.assign(state.site, s.site || {});
    state.arrays = (s.arrays || []).map(a => ({ ...defaultArray(0, 0, 0), ...a }));
    state.objects = (s.objects || []).filter(o => PH.OBJECT_TYPES[o.type]);
    if (s.live && LIVE_KEYS.includes(s.live)) state.live = s.live;
    if (s.compare) state.compare = { ...state.compare, ...s.compare };
    if (s.params) state.params = { ...clone(PH.DEFAULT_PARAMS), ...s.params };
    if (s.thermalCa) state.thermalCa = s.thermalCa;
    if (s.visuals) state.visuals = s.visuals;
    if (typeof s.shadowsOn === 'boolean') state.shadowsOn = s.shadowsOn;
    if (s.colourMode) state.colourMode = s.colourMode;
    if (s.worldSrc) state.world.src = s.worldSrc;
    return true;
  }
  function loadStored() {
    let had = false;
    try {
      const s = JSON.parse(localStorage.getItem(STORE_SCENE) || 'null'); had = applySnapshot(s);
      const k = JSON.parse(localStorage.getItem(STORE_KEYS) || 'null');
      if (k) { state.world.ion = k.ion || ''; state.world.google = k.google || ''; state.wx.apiKey = k.om || ''; state.world.remember = true; if (k.src) state.world.src = k.src; }
    } catch (e) { /* ignore */ }
    if (!['none'].includes(state.world.src) && !(state.world.ion || state.world.google)) state.world.src = 'none';
    return had;
  }

  // ------------------------------------------------------------------ defaults
  function defaultArray(x, y, z) {
    return { id: newId('a'), name: `Array ${state.arrays.length + 1}`, x, y, z, azimuth: 180, tilt: 35, rows: 2, cols: 6,
      panelW: 1.134, panelL: 1.722, colGap: 0.02, rowPitch: 3.2, mountHeight: 0.15, cellsX: 6, cellsY: 18,
      eff: 0.21, gammaPct: -0.35, worldSrc: state.world.src };
  }
  function defaultObject(type, x, y, z) {
    const t = PH.OBJECT_TYPES[type];
    return { id: newId('o'), type, x, y, z, heading: 0, dims: { ...t.dims }, porosity: 0, worldSrc: state.world.src };
  }
  function demoScene() {
    state.arrays = [defaultArray(0, 0, 0)];
    state.arrays[0].name = 'South roof (demo)';
    state.objects = [defaultObject('tree', 9, -11, 0), defaultObject('wall', -1, -4.5, 0)];
    state.objects[1].dims.length = 5; state.objects[1].dims.height = 1.4;
  }

  // ------------------------------------------------------------------ site frame
  function setSiteFrame() {
    const origin = Cesium.Cartesian3.fromDegrees(state.site.lon, state.site.lat, 0);
    siteM = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
    siteMinv = Cesium.Matrix4.inverse(siteM, new Cesium.Matrix4());
  }
  const enu2ecef = (x, y, z) => Cesium.Matrix4.multiplyByPoint(siteM, new Cesium.Cartesian3(x, y, z), new Cesium.Cartesian3());
  const ecef2enu = (c) => { const r = Cesium.Matrix4.multiplyByPoint(siteMinv, c, new Cesium.Cartesian3()); return [r.x, r.y, r.z]; };
  const vecEnu2Ecef = (d) => Cesium.Cartesian3.normalize(Cesium.Matrix4.multiplyByPointAsVector(siteM, new Cesium.Cartesian3(d[0], d[1], d[2]), new Cesium.Cartesian3()), new Cesium.Cartesian3());
  const vecEcef2Enu = (d) => { const r = Cesium.Matrix4.multiplyByPointAsVector(siteMinv, d, new Cesium.Cartesian3()); return [r.x, r.y, r.z]; };
  function localMatrix(pos, u, v, n) {
    const rot = new Cesium.Matrix3(u[0], v[0], n[0], u[1], v[1], n[1], u[2], v[2], n[2]);
    const m = Cesium.Matrix4.fromRotationTranslation(rot, new Cesium.Cartesian3(pos[0], pos[1], pos[2]));
    return Cesium.Matrix4.multiply(siteM, m, new Cesium.Matrix4());
  }

  // ------------------------------------------------------------------ viewer / world
  async function createViewer() {
    const w = state.world;
    if (viewer) { try { viewer.destroy(); } catch (e) { /* ignore */ } viewer = null; arrayPrims.clear(); objModels.clear(); tileset = null; cloudStage = null; }
    $('#globe').innerHTML = '';
    Cesium.Ion.defaultAccessToken = w.ion || '';
    let baseLayer = false, terrain;
    if (w.src === 'none') baseLayer = new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }));
    else if (w.src === 'ion') { baseLayer = Cesium.ImageryLayer.fromWorldImagery(); terrain = Cesium.Terrain.fromWorldTerrain({ requestVertexNormals: true }); }
    viewer = new Cesium.Viewer($('#globe'), {
      baseLayer, terrain, animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      vrButton: false, scene3DOnly: true, shadows: state.shadowsOn, terrainShadows: Cesium.ShadowMode.RECEIVE_ONLY,
      msaaSamples: 4, shouldAnimate: false, showRenderLoopErrors: false
    });
    scene = viewer.scene;
    scene.renderError.addEventListener((sc, err) => onRenderError(err));
    scene.globe.enableLighting = true;
    scene.globe.depthTestAgainstTerrain = true;
    scene.fog.enabled = true;
    viewer.shadowMap.size = 2048; viewer.shadowMap.softShadows = true; viewer.shadowMap.maximumDistance = 1500; viewer.shadowMap.darkness = 0.35;
    viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
    viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
    viewer.clock.multiplier = Number($('#t-speed').value);
    viewer.clock.onTick.addEventListener(onTick);
    scene.preRender.addEventListener(onPreRender);
    if (terrain) terrain.errorEvent.addEventListener(() => toast('Cesium terrain did not load. Check the ion token.', 'err'));
    setSiteFrame();
    setupInput();
    setupCloudStage();
    if (state.wx.series) configureClock(false);

    let worldErr = null;
    if (w.src === 'ion') {
      try { tileset = await Cesium.createOsmBuildingsAsync(); scene.primitives.add(tileset); }
      catch (e) { worldErr = 'Cesium OSM Buildings did not load: ' + describeErr(e); }
    } else if (w.src === 'google' || w.src === 'google-ion') {
      try {
        if (w.src === 'google') Cesium.GoogleMaps.defaultApiKey = w.google;
        tileset = await Cesium.createGooglePhotorealistic3DTileset(
          w.src === 'google' ? { key: w.google, onlyUsingWithGoogleGeocoder: true } : { onlyUsingWithGoogleGeocoder: true },
          { showCreditsOnScreen: true, maximumScreenSpaceError: 8 });
        scene.primitives.add(tileset);
        scene.globe.show = false;
      } catch (e) { worldErr = 'Google 3D tiles did not load: ' + describeErr(e) + (w.src === 'google' ? ' Check the key, that Map Tiles API is enabled, and any website restriction on the key.' : ' Check the ion token.'); }
    }
    if (tileset) tileset.tileFailed.addEventListener((err) => { if (!tileset._arienWarned) { tileset._arienWarned = true; toast('Some 3D tiles failed to load.', 'warn'); } });
    rebuildAll();
    updateSiteSearchAvailability();
    return worldErr;
  }
  function describeErr(e) {
    if (!e) return 'unknown error.';
    let detail = '';
    try { const r = typeof e.response === 'string' ? JSON.parse(e.response) : e.response; detail = (r && ((r.error && (r.error.message || r.error)) || r.message)) || ''; } catch (x) { /* not JSON */ }
    const code = e.statusCode ? `HTTP ${e.statusCode}` : '';
    const msg = [code, detail || e.message || ''].filter(Boolean).join(': ');
    return (msg || String(e)).replace(/\s+/g, ' ').slice(0, 220) + (/[.!?]$/.test(msg) ? '' : '.');
  }
  let renderErrShown = false;
  function onRenderError(err) {
    const text = String((err && (err.message || err)) || '');
    const workerBlocked = /Worker|blob/i.test(text);
    const msg = workerBlocked
      ? 'This viewer blocks the background threads the 3D engine needs. Download the file and open it in Chrome or Edge.'
      : '3D rendering stopped: ' + text.slice(0, 160);
    if (!renderErrShown) { renderErrShown = true; toast(msg, 'err', 15000); showSetupNote(msg); }
    console.error(err);
    // keep rendering once the cause is gone (e.g. a single bad tile)
    if (!workerBlocked) setTimeout(() => { if (viewer && !viewer.isDestroyed()) viewer.useDefaultRenderLoop = true; }, 1000);
  }
  /** Check an ion token before building the world, so the person gets a plain reason if it fails */
  async function checkIonToken(token) {
    try {
      const r = await fetch(`https://api.cesium.com/v1/assets/1/endpoint?access_token=${encodeURIComponent(token)}`);
      if (r.ok) return null;
      if (r.status === 401) return 'Cesium ion rejected this token. Copy it again from cesium.com/ion → Access Tokens.';
      if (r.status === 403) return 'This token is not allowed here. In Cesium ion, check its scopes (assets:read) and Allowed URLs.';
      return `Cesium ion answered HTTP ${r.status}.`;
    } catch (e) { return 'Could not reach api.cesium.com. ' + await diagnoseBlocked('api.cesium.com'); }
  }
  /** Work out why a request never got an HTTP answer, and say what to do about it */
  async function diagnoseBlocked(host) {
    await sleep(60); // let any securitypolicyviolation event arrive
    if (cspBlocked.has(host)) return `This viewer’s security policy blocks ${host}. Download the file and open it in Chrome or Edge.`;
    const emb = embeddedIn();
    if (emb === 'claude') return 'The page is open inside Claude’s file preview, which blocks outside requests. Download the file and open it in Chrome or Edge.';
    const omOk = host.includes('open-meteo') ? false : await reachable('https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&hourly=temperature_2m&forecast_days=1');
    if (!omOk) {
      if (emb === 'frame') return 'The page is embedded in another page that blocks outside requests. Open the file directly in Chrome or Edge.';
      if (!host.includes('open-meteo')) return 'This browser could not reach Cesium or Open-Meteo. Check the internet connection, VPN or firewall.';
    }
    if (location.protocol === 'file:') return `The page is open as a local file, and ${host} may refuse requests from local files. Serve the folder instead (run “python -m http.server 8000” in it, then open http://localhost:8000/arien-twin-studio.html), or choose “Map only” for now.`;
    return `${host} is blocked from this browser while other sites work. A privacy or ad-blocking extension, VPN or firewall is the usual cause: allow ${host} and assets.ion.cesium.com, or try another network. “Map only” works meanwhile.`;
  }
  async function reachable(url) { try { await fetch(url, { cache: 'no-store' }); return true; } catch (e) { return false; } }

  function flyToSite(duration = 1.8, topDown = false) {
    const c = enu2ecef(0, 0, state.site.groundZ);
    const range = topDown ? 260 : 110;
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(c, 20), {
      offset: new Cesium.HeadingPitchRange(topDown ? 0 : -0.35, topDown ? -Cesium.Math.PI_OVER_TWO + 0.02 : -0.55, range), duration
    });
    return sleep(duration * 1000 + 200);
  }
  async function waitTiles(timeout = 10000) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeout) {
      const g = !scene.globe.show || scene.globe.tilesLoaded;
      const t = !tileset || tileset.tilesLoaded;
      if (g && t) return true;
      await sleep(200);
    }
    return false;
  }
  async function sampleGround() {
    const carto = Cesium.Cartographic.fromDegrees(state.site.lon, state.site.lat);
    try {
      if (state.world.src === 'ion') { const [c] = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [carto]); return c.height || 0; }
      if (state.world.src.startsWith('google') && tileset) { const [c] = await scene.sampleHeightMostDetailed([carto], excludeList()); return isFinite(c.height) ? c.height : 0; }
    } catch (e) { /* ignore */ }
    return 0;
  }
  /** Load (or reload) the world, land on the site, settle heights of items made in another world */
  async function loadWorld() {
    const w = state.world;
    if ((w.src === 'ion' || w.src === 'google-ion')) { const bad = await checkIonToken(w.ion); if (bad) return { ok: false, msg: bad }; }
    const worldErr = await createViewer();
    if (worldErr) { setStatus('#w-status', worldErr, 'err'); return { ok: false, msg: worldErr }; }
    state.site.groundZ = 0;
    await flyToSite(0.01);
    if (state.world.src !== 'none') {
      setStatus('#w-status', 'Loading tiles around the site…');
      await waitTiles(12000);
      state.site.groundZ = await sampleGround();
      const stale = [...state.arrays, ...state.objects].filter(i => i.worldSrc !== state.world.src);
      if (stale.length) { await dropItems(stale); }
      setStatus('#w-status', worldLabel() + ' loaded.', 'ok');
    } else {
      const stale = [...state.arrays, ...state.objects].filter(i => i.worldSrc !== 'none');
      stale.forEach(i => { i.z = 0; i.worldSrc = 'none'; });
      if (stale.length) rebuildAll();
      setStatus('#w-status', 'Map-only world loaded. Add a key to see buildings and terrain.', '');
    }
    await flyToSite(1.2);
    renderSiteFacts();
    return { ok: true, msg: worldLabel() + ' loaded.' };
  }
  const worldLabel = () => ({ none: 'Map only', ion: 'Cesium ion terrain + OSM Buildings', google: 'Google Photorealistic 3D Tiles', 'google-ion': 'Google Photorealistic (via ion)' })[state.world.src];

  function excludeList() {
    const ex = [];
    arrayPrims.forEach(v => ex.push(v.prim));
    objModels.forEach(m => ex.push(m));
    return ex;
  }
  /** Drop items onto whatever surface is under them (3D tiles or terrain) */
  async function dropItems(items) {
    if (state.world.src === 'none') { items.forEach(i => { i.z = 0; i.worldSrc = 'none'; }); rebuildAll(); return; }
    const ex = excludeList();
    for (const it of items) {
      const top = Math.max(it.z, state.site.groundZ) + 400;
      const origin = enu2ecef(it.x, it.y, top);
      const dir = vecEnu2Ecef([0, 0, -1]);
      let hit;
      try { hit = scene.pickFromRay(new Cesium.Ray(origin, dir), ex, 0.2); } catch (e) { hit = null; }
      if (hit && hit.position) { it.z = ecef2enu(hit.position)[2]; }
      else it.z = state.site.groundZ;
      it.worldSrc = state.world.src;
    }
    rebuildAll(); state.shade.dirty = true; clearProfiles(); saveSoon();
  }

  // ------------------------------------------------------------------ arrays: geometry + rendering
  const FRAME_COLOR = () => Cesium.Color.fromCssColorString('#cfd5da');
  const CELL_COLOR = () => Cesium.Color.fromCssColorString('#15243a');
  const LEG_COLOR = () => Cesium.Color.fromCssColorString('#8d969d');
  function geomFor(a) { const g = PH.buildArrayGeometry(a); geoms.set(a.id, g); return g; }
  function cellCount(a) { return a.rows * a.cols * a.cellsX * a.cellsY; }

  function buildArrayPrimitive(a) {
    const old = arrayPrims.get(a.id);
    if (old) { scene.primitives.remove(old.prim); arrayPrims.delete(a.id); }
    const g = geomFor(a);
    const total = state.arrays.reduce((s, x) => s + cellCount(x), 0);
    const simplified = total > MAX_RENDER_CELLS;
    const vf = Cesium.PerInstanceColorAppearance.VERTEX_FORMAT;
    const frameGeo = Cesium.BoxGeometry.fromDimensions({ dimensions: new Cesium.Cartesian3(a.panelW + 0.03, a.panelL + 0.03, 0.035), vertexFormat: vf });
    const cw = a.panelW / a.cellsX, cl = a.panelL / a.cellsY;
    const cellGeo = Cesium.BoxGeometry.fromDimensions({ dimensions: new Cesium.Cartesian3(cw * 0.92, cl * 0.94, 0.008), vertexFormat: vf });
    const fc = Cesium.ColorGeometryInstanceAttribute.fromColor(FRAME_COLOR()), cc = Cesium.ColorGeometryInstanceAttribute.fromColor(CELL_COLOR());
    const lc = Cesium.ColorGeometryInstanceAttribute.fromColor(LEG_COLOR());
    const inst = [];
    const tilt = a.tilt * D2R;
    g.panels.forEach((p, pi) => {
      const um = [-p.u[0], -p.u[1], -p.u[2]]; // (−u, v, n) is right-handed
      const back = [p.c[0] - p.n[0] * 0.02, p.c[1] - p.n[1] * 0.02, p.c[2] - p.n[2] * 0.02];
      inst.push(new Cesium.GeometryInstance({ geometry: frameGeo, modelMatrix: localMatrix(back, um, p.v, p.n), id: `arr:${a.id}:f${pi}`, attributes: { color: simplified ? cc : fc } }));
      if (!simplified) {
        p.cells.forEach((cell, ci) => {
          const pos = [cell.p[0] + p.n[0] * 0.004, cell.p[1] + p.n[1] * 0.004, cell.p[2] + p.n[2] * 0.004];
          inst.push(new Cesium.GeometryInstance({ geometry: cellGeo, modelMatrix: localMatrix(pos, um, p.v, p.n), id: `arr:${a.id}:c${pi}:${ci}`, attributes: { color: cc } }));
        });
      }
      // mounting legs: front and back posts down to the mount base
      const baseZ = a.z;
      for (const side of [-1, 1]) for (const edge of [-1, 1]) {
        const ex = p.c[0] + p.u[0] * side * a.panelW * 0.38 + p.v[0] * edge * a.panelL * 0.45;
        const ey = p.c[1] + p.u[1] * side * a.panelW * 0.38 + p.v[1] * edge * a.panelL * 0.45;
        const ez = p.c[2] + p.v[2] * edge * a.panelL * 0.45 - 0.03;
        const h = ez - baseZ;
        if (h < 0.04) continue;
        const legGeo = Cesium.BoxGeometry.fromDimensions({ dimensions: new Cesium.Cartesian3(0.04, 0.04, h), vertexFormat: vf });
        inst.push(new Cesium.GeometryInstance({ geometry: legGeo, modelMatrix: localMatrix([ex, ey, baseZ + h / 2], g.u, g.f, [0, 0, 1]), id: `arr:${a.id}:l${pi}${side}${edge}`, attributes: { color: lc } }));
      }
    });
    void tilt;
    const prim = new Cesium.Primitive({
      geometryInstances: inst, appearance: new Cesium.PerInstanceColorAppearance({ closed: true, translucent: false }),
      shadows: Cesium.ShadowMode.ENABLED, asynchronous: true
    });
    scene.primitives.add(prim);
    arrayPrims.set(a.id, { prim, simplified });
    waitReady(prim).then(() => paintCells());
  }
  async function waitReady(prim) { for (let i = 0; i < 300 && !prim.ready; i++) await nextFrame(); }

  /** Colour cells by direct-sun share (map mode) or restore realistic colours */
  function paintCells() {
    if (!scene) return;
    const sunUp = state.sim.lastW && state.sim.lastW.sun.alt > 0;
    const lit = Cesium.Color.fromCssColorString('#f3b23c'), shade = Cesium.Color.fromCssColorString('#3a3f8f'), off = Cesium.Color.fromCssColorString('#1d2733');
    const real = CELL_COLOR(), tmp = new Cesium.Color();
    state.arrays.forEach((a, ai) => {
      const rec = arrayPrims.get(a.id); if (!rec || !rec.prim.ready) return;
      const g = geoms.get(a.id); const tr = state.shade.trans[ai];
      let k = 0;
      g.panels.forEach((p, pi) => {
        const ci0 = PH.cosIncidence(state.sim.lastSunVec || [0, 0, 1], p.n);
        if (rec.simplified) {
          let s = 0; for (let c = 0; c < p.cells.length; c++) s += tr ? tr[k + c] : 1;
          const share = s / p.cells.length; k += p.cells.length;
          const col = state.colourMode === 'map' ? (!sunUp || ci0 <= 0 ? off : Cesium.Color.lerp(shade, lit, share, tmp)) : real;
          const at = rec.prim.getGeometryInstanceAttributes(`arr:${a.id}:f${pi}`); if (at) at.color = Cesium.ColorGeometryInstanceAttribute.toValue(col);
          return;
        }
        p.cells.forEach((cell, ci) => {
          const share = tr ? tr[k] : 1; k++;
          const col = state.colourMode === 'map' ? (!sunUp || ci0 <= 0 ? off : Cesium.Color.lerp(shade, lit, share, tmp)) : real;
          const at = rec.prim.getGeometryInstanceAttributes(`arr:${a.id}:c${pi}:${ci}`);
          if (at) at.color = Cesium.ColorGeometryInstanceAttribute.toValue(col);
        });
      });
    });
  }

  // ------------------------------------------------------------------ obstacles: three.js models
  function buildThreeGroup(type) {
    const T = window.THREE; const g = new T.Group();
    let seed = { tree: 7, conifer: 11, hedge: 3, wall: 5, chimney: 9, building: 13, pole: 17 }[type] || 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const mat = (hex, rough = 0.88) => new T.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0, flatShading: true });
    const add = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1) => {
      const ng = geo.index ? geo.toNonIndexed() : geo; ng.computeVertexNormals();
      const mesh = new T.Mesh(ng, m); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); g.add(mesh);
    };
    switch (type) {
      case 'tree': {
        add(new T.CylinderGeometry(0.035, 0.055, 0.44, 7), mat('#6b4a2f'), 0, 0.22, 0);
        add(new T.IcosahedronGeometry(1, 1), mat('#3f6b2e'), 0, 0.62, 0, 0.44, 0.34, 0.44);
        const greens = ['#4b7a35', '#36602a', '#56853c', '#2f5a26'];
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * Math.PI * 2 + rnd() * 0.5, r = 0.26 + rnd() * 0.06;
          add(new T.IcosahedronGeometry(1, 0), mat(greens[i % 4]), Math.cos(a) * r, 0.58 + (rnd() - 0.4) * 0.24, Math.sin(a) * r, 0.2, 0.17, 0.2);
        }
        add(new T.IcosahedronGeometry(1, 0), mat('#4b7a35'), 0, 0.86, 0, 0.24, 0.13, 0.24);
        break;
      }
      case 'conifer': {
        add(new T.CylinderGeometry(0.04, 0.06, 0.16, 6), mat('#5c4029'), 0, 0.08, 0);
        add(new T.ConeGeometry(0.5, 0.42, 9), mat('#2f5a3a'), 0, 0.12 + 0.21, 0);
        add(new T.ConeGeometry(0.39, 0.38, 9), mat('#2a5134'), 0, 0.42 + 0.19, 0);
        add(new T.ConeGeometry(0.26, 0.4, 9), mat('#24482e'), 0, 0.8, 0);
        break;
      }
      case 'hedge': {
        const geo = new T.BoxGeometry(1, 1, 1, 6, 3, 2).toNonIndexed();
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y > 0.4) pos.setY(i, y + (rnd() - 0.5) * 0.12); }
        add(geo, mat('#3d6630'), 0, 0.5, 0);
        break;
      }
      case 'wall': add(new T.BoxGeometry(1, 1, 1), mat('#b9ad98', 0.95), 0, 0.5, 0); break;
      case 'chimney':
        add(new T.BoxGeometry(0.9, 0.9, 0.9), mat('#8a4b3a', 0.95), 0, 0.45, 0);
        add(new T.BoxGeometry(1, 0.1, 1), mat('#6f7275'), 0, 0.95, 0); break;
      case 'building':
        add(new T.BoxGeometry(1, 0.92, 1), mat('#c9c2b6', 0.9), 0, 0.46, 0);
        add(new T.BoxGeometry(1.02, 0.08, 1.02), mat('#56626b'), 0, 0.96, 0); break;
      case 'pole': add(new T.CylinderGeometry(0.5, 0.5, 1, 10), mat('#7a5c3e'), 0, 0.5, 0); break;
    }
    return g;
  }
  async function glbUrl(type) {
    if (glbUrls[type] !== undefined) return glbUrls[type];
    if (!window.THREE || !THREE.GLTFExporter) { glbUrls[type] = null; return null; }
    try {
      const group = buildThreeGroup(type);
      const buf = await new Promise((res, rej) => new THREE.GLTFExporter().parse(group, res, rej, { binary: true }));
      glbUrls[type] = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
    } catch (e) { console.warn('three.js model export failed', e); glbUrls[type] = null; }
    return glbUrls[type];
  }
  function objMatrix(o) {
    const t = Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(o.x, o.y, o.z));
    const r = Cesium.Matrix4.fromRotationTranslation(Cesium.Matrix3.fromRotationZ(-o.heading * D2R));
    const s = Cesium.Matrix4.fromScale(new Cesium.Cartesian3(o.dims.length, o.dims.width ?? o.dims.length, o.dims.height));
    const m = Cesium.Matrix4.multiply(t, r, new Cesium.Matrix4());
    Cesium.Matrix4.multiply(m, s, m);
    return Cesium.Matrix4.multiply(siteM, m, m);
  }
  /** Fallback when three.js is unavailable: Cesium primitives in the same unit space */
  function fallbackPrimitive(o) {
    const vf = Cesium.PerInstanceColorAppearance.VERTEX_FORMAT, I = [], col = (h) => Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(h));
    const at = (x, y, z) => Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(x, y, z));
    const box = (sx, sy, sz, z, c) => I.push(new Cesium.GeometryInstance({ geometry: Cesium.BoxGeometry.fromDimensions({ dimensions: new Cesium.Cartesian3(sx, sy, sz), vertexFormat: vf }), modelMatrix: at(0, 0, z), id: 'obj:' + o.id, attributes: { color: col(c) } }));
    const cyl = (len, rt, rb, z, c) => I.push(new Cesium.GeometryInstance({ geometry: new Cesium.CylinderGeometry({ length: len, topRadius: rt, bottomRadius: rb, vertexFormat: vf }), modelMatrix: at(0, 0, z), id: 'obj:' + o.id, attributes: { color: col(c) } }));
    const ell = (rx, ry, rz, z, c) => I.push(new Cesium.GeometryInstance({ geometry: new Cesium.EllipsoidGeometry({ radii: new Cesium.Cartesian3(rx, ry, rz), vertexFormat: vf }), modelMatrix: at(0, 0, z), id: 'obj:' + o.id, attributes: { color: col(c) } }));
    switch (o.type) {
      case 'tree': cyl(0.42, 0.035, 0.05, 0.21, '#6b4a2f'); ell(0.5, 0.5, 0.38, 0.62, '#3f6b2e'); break;
      case 'conifer': cyl(0.15, 0.04, 0.06, 0.075, '#5c4029'); cyl(0.88, 0, 0.5, 0.56, '#2a5134'); break;
      case 'pole': cyl(1, 0.5, 0.5, 0.5, '#7a5c3e'); break;
      case 'hedge': box(1, 1, 1, 0.5, '#3d6630'); break;
      case 'chimney': box(1, 1, 1, 0.5, '#8a4b3a'); break;
      case 'building': box(1, 1, 1, 0.5, '#c9c2b6'); break;
      default: box(1, 1, 1, 0.5, '#b9ad98');
    }
    return new Cesium.Primitive({ geometryInstances: I, appearance: new Cesium.PerInstanceColorAppearance({ closed: true }), modelMatrix: objMatrix(o), shadows: Cesium.ShadowMode.ENABLED });
  }
  async function buildObjectModel(o) {
    const old = objModels.get(o.id);
    if (old) { scene.primitives.remove(old); objModels.delete(o.id); }
    const url = await glbUrl(o.type);
    let prim;
    if (url) {
      try { prim = await Cesium.Model.fromGltfAsync({ url, modelMatrix: objMatrix(o), shadows: Cesium.ShadowMode.ENABLED, id: 'obj:' + o.id }); }
      catch (e) { console.warn('model load failed', e); prim = fallbackPrimitive(o); }
    } else prim = fallbackPrimitive(o);
    if (!state.objects.includes(o)) return; // removed while loading
    const prev = objModels.get(o.id); if (prev) scene.primitives.remove(prev);
    scene.primitives.add(prim); objModels.set(o.id, prim);
  }
  function updateObjectMatrix(o) { const m = objModels.get(o.id); if (m) m.modelMatrix = objMatrix(o); }

  function rebuildAll() {
    if (!scene) return;
    arrayPrims.forEach(v => scene.primitives.remove(v.prim)); arrayPrims.clear();
    objModels.forEach(m => scene.primitives.remove(m)); objModels.clear();
    state.arrays.forEach(buildArrayPrimitive);
    state.objects.forEach(o => buildObjectModel(o));
    state.shade.dirty = true;
    refreshLists();
  }

  // ------------------------------------------------------------------ input: select, place, drag, keys
  const drag = { item: null, kind: null, off: [0, 0], moved: false, startX: 0, startY: 0 };
  function pickItem(pos) {
    const p = scene.pick(pos);
    if (!p) return null;
    const id = typeof p.id === 'string' ? p.id : (p.primitive && typeof p.primitive.id === 'string' ? p.primitive.id : null);
    if (!id) return null;
    if (id.startsWith('arr:')) { const a = state.arrays.find(x => x.id === id.split(':')[1]); return a ? { kind: 'array', item: a } : null; }
    if (id.startsWith('obj:')) { const o = state.objects.find(x => x.id === id.slice(4)); return o ? { kind: 'object', item: o } : null; }
    return null;
  }
  function rayToPlane(pos, z) {
    const ray = viewer.camera.getPickRay(pos); if (!ray) return null;
    const o = ecef2enu(ray.origin), d = vecEcef2Enu(ray.direction);
    if (Math.abs(d[2]) < 1e-6) return null;
    const t = (z - o[2]) / d[2]; if (t <= 0) return null;
    return [o[0] + d[0] * t, o[1] + d[1] * t];
  }
  function surfacePoint(pos) {
    let c = scene.pickPositionSupported ? scene.pickPosition(pos) : undefined;
    if (!c || !Cesium.defined(c)) {
      const xy = rayToPlane(pos, state.site.groundZ); if (!xy) return null;
      return [xy[0], xy[1], state.site.groundZ];
    }
    return ecef2enu(c);
  }
  function setupInput() {
    handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e) => {
      if (state.placing) return;
      const hit = pickItem(e.position);
      if (hit && state.sel && hit.item.id === state.sel.id) {
        const xy = rayToPlane(e.position, hit.item.z);
        if (!xy) return;
        drag.item = hit.item; drag.kind = hit.kind; drag.off = [hit.item.x - xy[0], hit.item.y - xy[1]]; drag.moved = false;
        drag.ox = hit.item.x; drag.oy = hit.item.y;
        scene.screenSpaceCameraController.enableInputs = false;
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction((e) => {
      if (drag.item) {
        const xy = rayToPlane(e.endPosition, drag.item.z); if (!xy) return;
        drag.item.x = xy[0] + drag.off[0]; drag.item.y = xy[1] + drag.off[1]; drag.moved = true;
        if (drag.kind === 'object') updateObjectMatrix(drag.item);
        else {
          const rec = arrayPrims.get(drag.item.id);
          if (rec) {
            const d0 = enu2ecef(0, 0, 0), d1 = enu2ecef(drag.item.x - drag.ox, drag.item.y - drag.oy, 0);
            rec.prim.modelMatrix = Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.subtract(d1, d0, new Cesium.Cartesian3()));
          }
        }
        return;
      }
      const hit = !state.placing && pickItem(e.endPosition);
      scene.canvas.style.cursor = state.placing ? 'crosshair' : (hit ? (state.sel && hit.item.id === state.sel.id ? 'move' : 'pointer') : '');
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction(() => {
      if (!drag.item) return;
      const it = drag.item, kind = drag.kind; drag.item = null;
      scene.screenSpaceCameraController.enableInputs = true;
      if (drag.moved) { commitItem(kind, it); drag.justDragged = true; setTimeout(() => { drag.justDragged = false; }, 50); }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);
    handler.setInputAction((e) => {
      if (drag.justDragged) return;
      if (state.placing) { placeAt(e.position); return; }
      const hit = pickItem(e.position);
      if (hit) select(hit.kind, hit.item.id, true); else select(null);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }
  function commitItem(kind, it) {
    if (kind === 'array') buildArrayPrimitive(it); else updateObjectMatrix(it);
    state.shade.dirty = true; clearProfiles(it);
    fillEditors(); saveSoon(); simulateNow(true); drawSunPath();
  }
  function startPlacing(p) {
    state.placing = p;
    $('#modebar').hidden = false;
    $('#modebar-text').textContent = p.kind === 'array' ? 'Click a roof or the ground to place the array' : `Click to place: ${PH.OBJECT_TYPES[p.type].label}`;
    $$('#obj-lib button').forEach(b => b.setAttribute('aria-pressed', String(p.kind === 'object' && b.dataset.type === p.type)));
    if (scene) scene.canvas.style.cursor = 'crosshair';
  }
  function stopPlacing() {
    state.placing = null; $('#modebar').hidden = true;
    $$('#obj-lib button').forEach(b => b.setAttribute('aria-pressed', 'false'));
    if (scene) scene.canvas.style.cursor = '';
  }
  function placeAt(pos) {
    const p = surfacePoint(pos);
    if (!p) { toast('Click on the ground or a roof.', 'warn'); return; }
    const pl = state.placing; stopPlacing();
    if (pl.kind === 'array') {
      const a = defaultArray(p[0], p[1], p[2]); state.arrays.push(a); buildArrayPrimitive(a); select('array', a.id, true);
    } else {
      const o = defaultObject(pl.type, p[0], p[1], p[2]); state.objects.push(o); buildObjectModel(o); select('object', o.id, true);
    }
    state.shade.dirty = true; refreshLists(); saveSoon(); simulateNow(true); drawSunPath();
  }
  function select(kind, id, openPanel = false) {
    state.sel = kind ? { kind, id } : null;
    refreshLists(); fillEditors(); drawSunPath();
    if (openPanel && kind) openDrawer(kind === 'array' ? 'panels' : 'objects');
  }
  const selItem = () => !state.sel ? null : (state.sel.kind === 'array' ? state.arrays.find(a => a.id === state.sel.id) : state.objects.find(o => o.id === state.sel.id));
  function removeSelected() {
    const it = selItem(); if (!it) return;
    if (state.sel.kind === 'array') { const r = arrayPrims.get(it.id); if (r) scene.primitives.remove(r.prim); arrayPrims.delete(it.id); geoms.delete(it.id); state.arrays = state.arrays.filter(a => a !== it); delete state.shade.profiles[it.id]; }
    else { const m = objModels.get(it.id); if (m) scene.primitives.remove(m); objModels.delete(it.id); state.objects = state.objects.filter(o => o !== it); clearProfiles(); }
    toast(`Removed ${state.sel.kind === 'array' ? it.name : PH.OBJECT_TYPES[it.type].label}.`);
    select(null); state.shade.dirty = true; saveSoon(); simulateNow(true); state.run = null;
  }
  function duplicateSelected() {
    const it = selItem(); if (!it) return;
    const c = clone(it); c.id = newId(state.sel.kind === 'array' ? 'a' : 'o'); c.x += 2; c.y += 2;
    if (state.sel.kind === 'array') { c.name = it.name + ' copy'; state.arrays.push(c); buildArrayPrimitive(c); select('array', c.id); }
    else { state.objects.push(c); buildObjectModel(c); select('object', c.id); }
    state.shade.dirty = true; saveSoon(); simulateNow(true);
  }
  function nudgeSelected(dx, dy, dz, dh, ds) {
    const it = selItem(); if (!it) return;
    it.x += dx; it.y += dy; it.z += dz;
    if (dh) { if (state.sel.kind === 'array') it.azimuth = ((it.azimuth + dh) % 360 + 360) % 360; else it.heading = ((it.heading + dh) % 360 + 360) % 360; }
    if (ds && state.sel.kind === 'object') { it.dims.length *= ds; if (it.dims.width != null) it.dims.width *= ds; it.dims.height *= ds; }
    if (state.sel.kind === 'array') buildArrayPrimitive(it); else updateObjectMatrix(it);
    state.shade.dirty = true; clearProfiles(it); fillEditors(); saveSoon(); simulateNow(true); drawSunPath();
  }
  function onKey(e) {
    if (inputTarget(e)) { if (e.key === 'Escape') e.target.blur(); return; }
    if (!viewer || !$('#boot').classList.contains('gone')) return;
    const k = e.key;
    if (k === 'Escape') { if (state.placing) stopPlacing(); else if (!$('#drawer').hidden) closeDrawer(); else select(null); return; }
    if (k === ' ') { e.preventDefault(); togglePlay(); return; }
    if (k === 'd' || k === 'D') { toggleDash(); return; }
    if (k === 'v' || k === 'V') { toggleVisuals(); return; }
    const n = Number(k); if (n >= 1 && n <= 8 && !e.altKey && !e.ctrlKey && !e.metaKey) { const btn = $$('#rail button')[n - 1]; if (btn) btn.click(); return; }
    if (!state.sel) return;
    const step = e.shiftKey ? 1 : 0.1;
    const map = { ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, step, 0], ArrowDown: [0, -step, 0], PageUp: [0, 0, step], PageDown: [0, 0, -step] };
    if (map[k]) { e.preventDefault(); nudgeSelected(...map[k], 0, 0); return; }
    if (k === 'q' || k === 'Q') return nudgeSelected(0, 0, 0, e.shiftKey ? -15 : -5, 0);
    if (k === 'e' || k === 'E') return nudgeSelected(0, 0, 0, e.shiftKey ? 15 : 5, 0);
    if (k === '[') return nudgeSelected(0, 0, 0, 0, 0.95);
    if (k === ']') return nudgeSelected(0, 0, 0, 0, 1.05);
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeSelected(); }
  }

  // ------------------------------------------------------------------ simulation
  function computePower(modelKey, w, sunVec, trans, Tstate, dtSec) {
    const key = modelKey === 'seasonal' ? PH.seasonalModel(w.t, state.site.lat) : modelKey;
    const M = PH.MODELS[key];
    const ctx = { sun: w.sun, sunVec, N: w.N, api: w.api };
    const h = M.horizontal(ctx, state.params);
    let totalW = 0, poaArea = 0, area = 0, tArea = 0;
    state.arrays.forEach((a, ai) => {
      const g = geoms.get(a.id) || geomFor(a);
      const tp = M.transpose(h, ctx, g.n, g.tilt, state.params);
      const tr = trans[ai];
      const nCells = a.rows * a.cols * a.cellsX * a.cellsY;
      let lit = 0;
      if (tr && tp.beam > 0) for (let k = 0; k < nCells; k++) lit += tr[k];
      else if (!tr) lit = nCells;
      const gsum = tp.beam * lit + (tp.diffuse + tp.ground) * nCells;
      const Gavg = gsum / nCells;
      const gamma = a.gammaPct / 100;
      let T = Tstate[a.id];
      if (T == null || dtSec == null || dtSec < 0 || dtSec > 3 * 3600) T = PH.thermalEquilibrium(w.temp, Gavg, w.wind, a.eff, gamma);
      else T = PH.thermalStep(T, w.temp, Gavg, w.wind, PH.efficiency(a.eff, gamma, T), dtSec, state.thermalCa);
      Tstate[a.id] = T;
      const eta = PH.efficiency(a.eff, gamma, T);
      const cellArea = a.panelW * a.panelL / (a.cellsX * a.cellsY);
      totalW += gsum * cellArea * eta;
      const arA = cellArea * nCells; area += arA; poaArea += Gavg * arA; tArea += T * arA;
    });
    return { kw: totalW / 1000, poa: area ? poaArea / area : 0, tcell: area ? tArea / area : w.temp, key, horiz: h };
  }
  function updateShading(sun, sunVec, force) {
    const last = state.shade.lastSun;
    if (!force && !state.shade.dirty && last && Math.abs(last.alt - sun.alt) < 0.003 && Math.abs(last.az - sun.az) < 0.003) return;
    const gs = state.arrays.map(a => geoms.get(a.id) || geomFor(a));
    state.shade.trans = PH.shadeCells(gs, state.objects, sunVec, sun, horizonFn());
    state.shade.lastSun = { alt: sun.alt, az: sun.az }; state.shade.dirty = false;
    if (state.colourMode === 'map') paintCells();
  }
  function horizonFn() {
    if (!state.shade.useTiles) return null;
    const ids = state.arrays.map(a => a.id);
    return (gi, pi, az, alt) => {
      const rec = state.shade.profiles[ids[gi]]; if (!rec) return false;
      const pt = rec.points[rec.panelPoint[pi] ?? 0]; return pt ? PH.horizonBlocked(pt.profile, az, alt) : false;
    };
  }
  function clearProfiles(item) {
    if (!state.shade.useTiles) return;
    if (item && state.arrays.includes(item)) delete state.shade.profiles[item.id];
    const missing = state.arrays.filter(a => !state.shade.profiles[a.id]).length;
    if (missing) setStatus('#sh-status', `Skyline out of date for ${missing} array${missing > 1 ? 's' : ''}. Trace again to include the 3D tiles.`, 'err');
  }

  function onTick(clock) {
    if (!state.wx.series) return;
    const t = Cesium.JulianDate.toDate(clock.currentTime).getTime();
    if (t === state.sim.lastT && !state.sim.forceNext) return;
    state.sim.forceNext = false;
    simulateAt(t);
    if (clock.shouldAnimate && t >= state.wx.series.end - 1) setPlaying(false);
  }
  function simulateNow(force) { if (!viewer || !state.wx.series) return; state.sim.forceNext = true; if (force) state.shade.dirty = true; onTick(viewer.clock); }
  function simulateAt(t) {
    const s = state.wx.series;
    const w = WX.sample(s, t, state.site.lat, state.site.lon);
    const sunVec = PH.sunVectorENU(w.sun.alt, w.sun.az);
    state.sim.lastSunVec = sunVec;
    updateShading(w.sun, sunVec);
    const dt = state.sim.lastT == null ? null : (t - state.sim.lastT) / 1000;
    const res = computePower(state.live, w, sunVec, state.shade.trans, state.sim.T, dt);
    if (viewer.clock.shouldAnimate && dt != null && dt > 0 && dt < 6 * 3600) {
      const prev = state.sim.lastRes ? state.sim.lastRes.kw : res.kw;
      state.sim.energyWh += (prev + res.kw) / 2 * 1000 * dt / 3600;
    }
    state.sim.lastT = t; state.sim.lastW = w; state.sim.lastRes = res;
    renderHud(w, res); renderOverview(w);
    syncScrub(t);
    const nowMs = performance.now();
    if (chart && !$('#dash').hidden && nowMs - (state.sim.lastChart || 0) > 250) { state.sim.lastChart = nowMs; chart.update('none'); }
    if (!$('#drawer').hidden && $('[data-pane="shading"]').offsetParent) drawSunPath(true);
  }
  function resetSim() { state.sim.T = {}; state.sim.lastT = null; state.sim.energyWh = 0; state.sim.lastRes = null; }

  // ------------------------------------------------------------------ period run (fast-forward)
  let running = false;
  async function runPeriod(silent = false) {
    if (running) return;
    const s = state.wx.series;
    if (!s) { toast('Load weather first (Weather panel).', 'warn'); return; }
    if (!state.arrays.length) { toast('Place an array first (Arrays panel).', 'warn'); return; }
    running = true;
    const btn = $('#t-run'); btn.disabled = true;
    const step = 15 * 60000;
    const t0 = Math.ceil(s.start / step) * step, t1 = s.end;
    const keys = LIVE_KEYS.filter(k => state.compare[k] || k === state.live);
    const out = { times: [], keys, kw: {}, poa: {}, tcell: {}, cloud: [], temp: [], ghi: [], sunAlt: [] };
    keys.forEach(k => { out.kw[k] = []; out.poa[k] = []; out.tcell[k] = []; });
    const Ts = {}; keys.forEach(k => { Ts[k] = {}; });
    const gs = state.arrays.map(a => geoms.get(a.id) || geomFor(a));
    const hz = horizonFn();
    const nSteps = Math.floor((t1 - t0) / step) + 1;
    const started = performance.now();
    let i = 0, lastYield = started;
    for (let t = t0; t <= t1; t += step, i++) {
      const w = WX.sample(s, t, state.site.lat, state.site.lon);
      const sunVec = PH.sunVectorENU(w.sun.alt, w.sun.az);
      const trans = PH.shadeCells(gs, state.objects, sunVec, w.sun, hz);
      out.times.push(t); out.cloud.push(w.cloudPct); out.temp.push(w.temp); out.ghi.push(w.api.ghi); out.sunAlt.push(w.sun.alt);
      for (const k of keys) {
        const r = computePower(k, w, sunVec, trans, Ts[k], i === 0 ? null : step / 1000);
        out.kw[k].push(r.kw); out.poa[k].push(r.poa); out.tcell[k].push(r.tcell);
      }
      if (performance.now() - lastYield > 120) { btn.lastChild.textContent = ` ${Math.round(i / nSteps * 100)}%`; await sleep(0); lastYield = performance.now(); }
    }
    out.energy = {}; out.peak = {};
    keys.forEach(k => { out.energy[k] = out.kw[k].reduce((a, b) => a + b, 0) * 0.25; out.peak[k] = Math.max(...out.kw[k]); });
    out.ms = performance.now() - started;
    state.run = out;
    btn.disabled = false; btn.lastChild.textContent = ' Fast-forward period';
    running = false;
    renderDashboard();
    if (!silent) { toast(`Computed ${nSteps.toLocaleString()} steps × ${keys.length} models in ${(out.ms / 1000).toFixed(1)} s.`, 'ok'); if ($('#dash').hidden) toggleDash(true); }
  }

  // ------------------------------------------------------------------ weather loading
  async function loadWeather(auto = false) {
    const mode = state.wx.mode;
    const btn = $('#wx-load'); btn.disabled = true;
    setStatus('#wx-status', 'Loading weather…');
    try {
      let series;
      if (mode === 'csv') {
        const f = $('#wx-csv').files[0];
        if (!f) throw new Error('Choose a CSV file first.');
        const parsed = WX.parseCsv(await f.text(), state.site.lat, state.site.lon);
        if (!parsed.series) throw new Error('No weather columns found. Include at least temperature, cloud_cover or ghi.');
        series = parsed.series; if (parsed.measured) { state.wx.measured = parsed.measured; setStatus('#meas-status', `${parsed.measured.time.length} measured values from the weather CSV.`, 'ok'); }
      } else {
        const opts = { mode, lat: state.site.lat, lon: state.site.lon, apiKey: state.wx.apiKey || '' };
        if (mode === 'historical' || mode === 'previous') {
          if (mode === 'historical') opts.mode = $('#wx-hist-src').value;
          opts.start = $('#wx-start').value; opts.end = $('#wx-end').value;
          if (!opts.start || !opts.end) throw new Error('Pick a start and end date.');
          const span = (Date.parse(opts.end) - Date.parse(opts.start)) / 86400000;
          if (span < 0) throw new Error('The end date is before the start date.');
          if (span > 62) throw new Error('Choose 62 days or fewer, so the run stays quick.');
          if (mode === 'previous') { opts.leadDays = Number($('#wx-lead').value); if (opts.start < '2024-01-01') throw new Error('Past forecasts are archived from January 2024 onwards.'); }
          if (opts.mode === 'historical' && opts.start < '2022-01-01') throw new Error('Archived forecasts start in 2022. Use ERA5 for earlier dates.');
        }
        series = await WX.fetchSeries(opts);
      }
      state.wx.series = series; state.site.elevation = series.elevation ?? state.site.elevation;
      resetSim(); state.run = null;
      configureClock(mode === 'current' || mode === 'forecast');
      const hours = series.time.length;
      const warn = !series.hasRadiation ? ' No radiation columns: HDKR and Real-World GHI will read zero.' : '';
      setStatus('#wx-status', `${series.source}: ${hours} hours, ${fmtDay(series.start)} – ${fmtDay(series.end)} (${series.tz}).${warn}`, warn ? 'err' : 'ok');
      renderSiteFacts(); renderDays();
      simulateNow(true);
      if (!auto) toast('Weather loaded. Press play, or fast-forward the whole period.', 'ok');
      state.wx.connected = true;
      await runPeriod(true);
      return { ok: true, msg: `${series.source}: ${hours} hours loaded.` };
    } catch (e) {
      const raw = (e && e.message) || String(e);
      const net = /fetch|network|Failed|Load failed/i.test(raw);
      const msg = net ? 'Could not reach Open-Meteo. ' + await diagnoseBlocked(new URL(WX.buildUrl({ mode: mode === 'historical' ? $('#wx-hist-src').value : (mode === 'csv' ? 'forecast' : mode), lat: 0, lon: 0, start: '2025-01-01', end: '2025-01-02', leadDays: 1, apiKey: state.wx.apiKey })).hostname)
        : /apikey|api key|unauthor/i.test(raw) ? 'Open-Meteo rejected the API key: ' + raw : raw;
      setStatus('#wx-status', msg, 'err');
      if (!auto) toast(msg, 'err');
      return { ok: false, msg };
    } finally { btn.disabled = false; }
  }
  async function loadMeasured() {
    const f = $('#meas-csv').files[0]; if (!f) return;
    try {
      const p = WX.parseCsv(await f.text(), state.site.lat, state.site.lon);
      if (!p.measured) throw new Error('No measured_kw column found.');
      state.wx.measured = p.measured;
      setStatus('#meas-status', `${p.measured.time.length} measured values, ${fmtDay(p.measured.time[0])} – ${fmtDay(p.measured.time.at(-1))}.`, 'ok');
      renderDashboard();
    } catch (e) { setStatus('#meas-status', e.message, 'err'); }
  }
  function configureClock(startNow) {
    const s = state.wx.series; if (!s || !viewer) return;
    const c = viewer.clock;
    c.startTime = Cesium.JulianDate.fromDate(new Date(s.start));
    c.stopTime = Cesium.JulianDate.fromDate(new Date(s.end));
    let t = s.start;
    if (startNow) t = clamp(Date.now(), s.start, s.end);
    else {
      // start at the first local 06:00 so the first frame shows daylight
      const off = utcOffset(); const d = new Date(s.start + off);
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6) - off; if (t < s.start) t += 86400000; t = clamp(t, s.start, s.end);
    }
    c.currentTime = Cesium.JulianDate.fromDate(new Date(t));
    const sc = $('#t-scrub'); sc.min = s.start; sc.max = s.end; sc.value = t;
    setPlaying(false);
  }

  // ------------------------------------------------------------------ 3D-tile skyline tracing
  let tracing = false;
  async function traceSkyline() {
    if (tracing) return;
    if (state.world.src === 'none') { toast('Load a 3D world first (World panel), then trace the skyline.', 'warn'); openDrawer('world'); return; }
    if (!state.arrays.length) { toast('Place an array first.', 'warn'); return; }
    tracing = true; const btn = $('#sh-run'); btn.disabled = true;
    const bar = $('#sh-progress'); bar.hidden = false; bar.firstElementChild.style.width = '0%';
    try {
      setStatus('#sh-status', 'Loading tiles around the site…');
      const view = { d: viewer.camera.position.clone(), dir: viewer.camera.direction.clone(), up: viewer.camera.up.clone() };
      await flyToSite(1.2, true); await waitTiles(12000);
      const step = Number($('#sh-step').value), scope = $('#sh-scope').value;
      const nb = Math.round(360 / step);
      const ex = excludeList();
      const jobs = [];
      state.arrays.forEach(a => {
        const g = geoms.get(a.id) || geomFor(a);
        let pts, panelPoint;
        if (scope === 'panel' || g.panels.length <= 5) { pts = g.panels.map(p => p.c); panelPoint = g.panels.map((p, i) => i); }
        else {
          const ps = g.panels; const r0 = 0, r1 = a.rows - 1, c0 = 0, c1 = a.cols - 1;
          const pick = (r, c) => ps.find(p => p.row === r && p.col === c).c;
          pts = [g.panels[Math.floor(ps.length / 2)].c, pick(r0, c0), pick(r0, c1), pick(r1, c0), pick(r1, c1)];
          panelPoint = ps.map(p => { let best = 0, bd = Infinity; pts.forEach((q, i) => { const d = (p.c[0] - q[0]) ** 2 + (p.c[1] - q[1]) ** 2; if (d < bd) { bd = d; best = i; } }); return best; });
        }
        jobs.push({ a, g, pts, panelPoint });
      });
      const totalPts = jobs.reduce((s, j) => s + j.pts.length, 0);
      let done = 0, rays = 0; const tStart = performance.now(); let lastYield = tStart;
      for (const j of jobs) {
        const points = [];
        for (const c of j.pts) {
          const o = [c[0] + j.g.n[0] * 0.3, c[1] + j.g.n[1] * 0.3, c[2] + j.g.n[2] * 0.3 + 0.05];
          const origin = enu2ecef(...o);
          const blocked = (azDeg, elDeg) => {
            rays++;
            const dir = vecEnu2Ecef(PH.sunVectorENU(elDeg * D2R, azDeg * D2R));
            let r; try { r = scene.pickFromRay(new Cesium.Ray(origin, dir), ex, 0.1); } catch (e) { r = null; }
            return !!(r && r.position && Cesium.Cartesian3.distance(r.position, origin) < 3000);
          };
          const profile = new Float32Array(nb);
          for (let b = 0; b < nb; b++) {
            const az = b * step;
            if (!blocked(az, 0.5)) profile[b] = 0;
            else if (blocked(az, 75)) profile[b] = 75 * D2R;
            else { let lo = 0.5, hi = 75; for (let it = 0; it < 6; it++) { const m = (lo + hi) / 2; if (blocked(az, m)) lo = m; else hi = m; } profile[b] = (lo + hi) / 2 * D2R; }
            if (performance.now() - lastYield > 150) { bar.firstElementChild.style.width = `${((done + b / nb) / totalPts * 100).toFixed(1)}%`; await nextFrame(); lastYield = performance.now(); }
          }
          points.push({ x: c[0], y: c[1], z: c[2], profile }); done++;
        }
        state.shade.profiles[j.a.id] = { points, panelPoint: j.panelPoint, step };
      }
      state.shade.useTiles = true; $('#sh-tiles').checked = true; state.shade.dirty = true;
      bar.firstElementChild.style.width = '100%';
      setStatus('#sh-status', `Skyline traced: ${totalPts} point${totalPts > 1 ? 's' : ''}, ${rays.toLocaleString()} rays in ${((performance.now() - tStart) / 1000).toFixed(1)} s against ${worldLabel()}.`, 'ok');
      viewer.camera.flyTo({ destination: view.d, orientation: { direction: view.dir, up: view.up }, duration: 1.2 });
      simulateNow(true); drawSunPath(); state.run = null; runPeriod(true);
    } catch (e) {
      setStatus('#sh-status', 'Skyline tracing failed: ' + (e.message || e), 'err');
    } finally { tracing = false; btn.disabled = false; setTimeout(() => { bar.hidden = true; }, 800); }
  }

  // ------------------------------------------------------------------ weather visuals (post-process)
  const CLOUD_GLSL = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform mat4 u_eyeToEnu;
uniform vec3 u_sunDir;
uniform float u_cover;
uniform float u_base;
uniform float u_top;
uniform vec2 u_wind;
uniform float u_rain;
uniform float u_snow;
uniform float u_time;
uniform float u_flash;
uniform float u_steps;
uniform float u_day;
uniform float u_slant;
in vec2 v_textureCoordinates;

float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  float a = h13(i), b = h13(i + vec3(1.0, 0.0, 0.0)), c = h13(i + vec3(0.0, 1.0, 0.0)), d = h13(i + vec3(1.0, 1.0, 0.0));
  float e = h13(i + vec3(0.0, 0.0, 1.0)), g = h13(i + vec3(1.0, 0.0, 1.0)), k = h13(i + vec3(0.0, 1.0, 1.0)), l = h13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(k, l, f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { if (i >= oct) break; s += a * vnoise(p); p = p * 2.02 + vec3(5.1, 1.3, 7.7); a *= 0.5; }
  return s;
}
float cloudDensity(vec3 p, int oct) {
  float hgt = clamp((p.z - u_base) / max(u_top - u_base, 1.0), 0.0, 1.0);
  float profile = smoothstep(0.0, 0.16, hgt) * smoothstep(1.0, 0.5 - 0.3 * u_cover, hgt);
  vec3 q = vec3((p.xy + u_wind) * 0.00062, p.z * 0.0014);
  float n = fbm(q, oct);
  float thr = mix(0.72, 0.16, u_cover);
  return clamp((n - thr) * 4.6, 0.0, 1.0) * profile * (0.6 + u_cover);
}
void main() {
  vec4 color = texture(colorTexture, v_textureCoordinates);
  vec3 col = color.rgb;
  float depth = czm_readDepth(depthTexture, v_textureCoordinates);
  vec4 posEC = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
  bool sky = depth >= 0.99999;
  vec3 dirEC = normalize(posEC.xyz);
  float sceneDist = sky ? 1.0e7 : length(posEC.xyz);
  vec3 ro = (u_eyeToEnu * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 rd = normalize((u_eyeToEnu * vec4(dirEC, 0.0)).xyz);
  if (sky) col = mix(col, vec3(0.50, 0.54, 0.58) * (0.2 + 0.8 * u_day), 0.7 * u_cover * u_cover);
  else col *= 1.0 - 0.3 * u_cover * u_cover; // overcast: diffuse light only, flatter and darker ground
  if (u_cover > 0.02 && u_steps > 0.5) {
    float t0; float t1;
    if (abs(rd.z) < 1e-4) { t0 = 0.0; t1 = (ro.z > u_base && ro.z < u_top) ? 30000.0 : -1.0; }
    else { float ta = (u_base - ro.z) / rd.z; float tb = (u_top - ro.z) / rd.z; t0 = max(min(ta, tb), 0.0); t1 = max(ta, tb); }
    t1 = min(t1, min(sceneDist, 40000.0));
    if (t1 > t0) {
      int N = int(u_steps);
      float dt = (t1 - t0) / float(N);
      float jit = h13(vec3(gl_FragCoord.xy, 3.7));
      float T = 1.0; vec3 L = vec3(0.0);
      vec3 sunCol = vec3(1.0, 0.95, 0.86) * u_day;
      vec3 amb = mix(vec3(0.06, 0.07, 0.10), vec3(0.60, 0.66, 0.74), u_day) * (1.0 - 0.42 * u_cover);
      int oct = u_steps > 24.0 ? 4 : 3;
      for (int i = 0; i < 64; i++) {
        if (i >= N || T < 0.03) break;
        vec3 p = ro + rd * (t0 + (float(i) + jit) * dt);
        float d = cloudDensity(p, oct);
        if (d > 0.003) {
          float ld = 0.0;
          for (int j = 1; j <= 3; j++) ld += cloudDensity(p + u_sunDir * (float(j) * 150.0), 2);
          float sunT = exp(-ld * 1.7);
          float powder = 1.0 - exp(-d * 3.0);
          float hgt = clamp((p.z - u_base) / max(u_top - u_base, 1.0), 0.0, 1.0);
          vec3 c = amb * (0.45 + 0.45 * hgt) + sunCol * sunT * (0.3 + 0.7 * powder) * 0.95;
          float a = 1.0 - exp(-d * dt * 0.006);
          L += T * a * c; T *= 1.0 - a;
        }
      }
      float fade = exp(-t0 / 28000.0);
      L = L / (1.0 + 0.35 * L); // soft highlight roll-off
      col = mix(col, col * T + L, fade);
    }
  }
  float wet = max(u_rain, u_snow);
  if (wet > 0.0) {
    float fogAmt = 1.0 - exp(-min(sceneDist, 5000.0) * 0.00032 * wet);
    col = mix(col, vec3(0.55, 0.58, 0.62) * (0.25 + 0.75 * u_day), fogAmt * 0.75);
  }
  if (u_rain > 0.0) {
    vec2 res = czm_viewport.zw;
    vec2 uv = (gl_FragCoord.xy * 2.0 - res) / min(res.x, res.y);
    uv.x += uv.y * u_slant;
    float colN = floor(uv.x * 140.0);
    float v = 0.6 + 0.4 * h13(vec3(colN, 1.0, 2.0));
    float y = uv.y * (2.5 + 2.0 * h13(vec3(colN, 3.0, 1.0))) + u_time * 7.0 * v + h13(vec3(colN, 5.0, 9.0)) * 10.0;
    float streak = smoothstep(0.93, 1.0, fract(y)) * smoothstep(0.38, 0.0, abs(fract(uv.x * 140.0) - 0.5));
    streak *= step(1.0 - u_rain * 0.9, h13(vec3(colN, 8.0, floor(y))));
    col += vec3(0.75, 0.80, 0.88) * streak * 0.32 * (0.35 + 0.65 * u_day);
    col *= 1.0 - 0.12 * u_rain;
  }
  if (u_snow > 0.0) {
    vec2 res = czm_viewport.zw;
    vec2 uv = gl_FragCoord.xy / min(res.x, res.y);
    float acc = 0.0;
    for (int l = 0; l < 3; l++) {
      float sc = 16.0 + float(l) * 14.0;
      vec2 p = uv * sc + vec2(u_time * (0.25 + 0.15 * float(l)) * u_slant, u_time * (1.1 + 0.45 * float(l)));
      vec2 cell = floor(p); vec2 f = fract(p) - 0.5;
      vec2 o = vec2(h13(vec3(cell, float(l))), h13(vec3(cell.yx, 7.0 + float(l)))) - 0.5;
      float dd = length(f - o * 0.7);
      acc += smoothstep(0.09, 0.0, dd) * step(1.0 - 0.6 * u_snow, h13(vec3(cell, 11.0 + float(l))));
    }
    col = mix(col, vec3(0.96), clamp(acc, 0.0, 1.0) * 0.8);
  }
  col += vec3(0.8, 0.85, 1.0) * u_flash * 0.45;
  out_FragColor = vec4(col, color.a);
}`;
  let visU = null;
  function setupCloudStage() {
    if (!visU) visU = { eyeToEnu: new Cesium.Matrix4(), sunDir: new Cesium.Cartesian3(0, 0, 1), cover: 0, base: 1500, top: 2500, wind: new Cesium.Cartesian2(0, 0), rain: 0, snow: 0, flash: 0, steps: 32, day: 1, slant: 0.2 };
    cloudStage = new Cesium.PostProcessStage({
      name: 'arien_weather', fragmentShader: CLOUD_GLSL,
      uniforms: {
        u_eyeToEnu: () => visU.eyeToEnu, u_sunDir: () => visU.sunDir, u_cover: () => visU.cover, u_base: () => visU.base, u_top: () => visU.top,
        u_wind: () => visU.wind, u_rain: () => visU.rain, u_snow: () => visU.snow, u_time: () => performance.now() / 1000 % 3600,
        u_flash: () => visU.flash, u_steps: () => visU.steps, u_day: () => visU.day, u_slant: () => visU.slant
      }
    });
    scene.postProcessStages.add(cloudStage);
    cloudStage.enabled = state.visuals !== 'off';
  }
  function onPreRender() {
    if (!cloudStage || !siteMinv) return;
    const on = state.visuals !== 'off';
    cloudStage.enabled = on;
    const w = state.sim.lastW;
    const N = w ? w.N : 0;
    if (on && w) {
      Cesium.Matrix4.multiply(siteMinv, viewer.camera.inverseViewMatrix, visU.eyeToEnu);
      const sv = state.sim.lastSunVec || [0, 0, 1];
      visU.sunDir.x = sv[0]; visU.sunDir.y = sv[1]; visU.sunDir.z = Math.max(0.05, sv[2]);
      visU.cover = N;
      visU.base = state.site.groundZ + 1700 - 1000 * N; visU.top = visU.base + 450 + 1300 * N;
      visU.day = clamp((Math.sin(w.sun.alt) + 0.06) / 0.36, 0, 1);
      visU.steps = state.visuals === 'high' ? 40 : 18;
      const cold = w.temp < 1;
      const precip = clamp(w.precip / 3, 0, 1);
      visU.rain = cold ? 0 : precip; visU.snow = (cold || w.snow > 0.05) ? Math.max(precip, clamp(w.snow / 1.5, 0, 1)) : 0;
      // drift clouds with the wind (cloud level ≈ 2.5× surface wind), capped so fast playback stays readable
      const now = performance.now(), realDt = (now - vis.lastReal) / 1000; vis.lastReal = now;
      const simDt = vis.lastSimT != null && state.sim.lastT != null ? (state.sim.lastT - vis.lastSimT) / 1000 : 0; vis.lastSimT = state.sim.lastT;
      const dtEff = clamp(Math.abs(simDt), 0, realDt * 300);
      const toward = (w.windDir + 180) * D2R, sp = w.wind * 2.5;
      visU.wind.x -= Math.sin(toward) * sp * dtEff; visU.wind.y -= Math.cos(toward) * sp * dtEff;
      visU.wind.x = visU.wind.x % 1e6; visU.wind.y = visU.wind.y % 1e6;
      const right = vecEcef2Enu(viewer.camera.right);
      visU.slant = clamp(-(Math.sin(toward) * right[0] + Math.cos(toward) * right[1]) * w.wind / 12, -0.7, 0.7);
      if (w.code >= 95 && Math.random() < 0.006) vis.flash = 1; vis.flash *= 0.86; visU.flash = vis.flash;
    }
    // overcast light: weaker sun, softer shadows
    const beamShare = 1 - 0.75 * Math.pow(N, 3.4);
    if (scene.light) scene.light.intensity = on ? 2.0 * (0.45 + 0.55 * beamShare) : 2.0;
    viewer.shadowMap.darkness = on ? 0.3 + 0.55 * N * N : 0.35;
    if (scene.skyAtmosphere) { scene.skyAtmosphere.brightnessShift = on ? -0.3 * N : 0; scene.skyAtmosphere.saturationShift = on ? -0.5 * N : 0; }
    if (scene.atmosphere) { scene.atmosphere.brightnessShift = on ? -0.25 * N : 0; scene.atmosphere.saturationShift = on ? -0.4 * N : 0; }
  }

  // ------------------------------------------------------------------ rendering: HUD, overview, dashboard
  function renderHud(w, res) {
    $('#hud-kw').textContent = res.kw >= 100 ? res.kw.toFixed(0) : res.kw.toFixed(2);
    const label = state.live === 'seasonal' ? `Seasonal→${modelShort(res.key)}` : modelShort(res.key);
    $('#hud-sub').textContent = `${label} · ${fmt(res.poa, 0)} W/m² · cell ${fmt(res.tcell, 1)} °C · ${fmt(state.sim.energyWh / 1000, 2)} kWh`;
    const desc = WX.describe(w.code, w.cloudPct);
    $('#hud-wx').innerHTML = `<b>${desc}</b> · ${fmt(w.temp, 1)} °C · ${fmt(w.wind, 1)} m/s ${compass(w.windDir)} · ${fmt(w.cloudPct, 0)}% cloud`;
    $('#t-clock').textContent = `${fmtTime(w.t)} ${tzLabel()}`;
  }
  function renderOverview(w) {
    if ($('#dash').hidden) return;
    const rows = [
      ['Weather', WX.describe(w.code, w.cloudPct)], ['Date / time', `${fmtTime(w.t)} ${tzLabel()}`],
      ['Temperature', `${fmt(w.temp + 273.15, 1)} K (${fmt(w.temp, 1)} °C)`], ['Wind speed', `${fmt(w.wind, 1)} m/s`],
      ['Wind direction', `${fmt(w.windDir, 0)}° ${compass(w.windDir)}`], ['Cloud cover', `${fmt(w.cloudPct, 0)} %`],
      ['Precipitation', `${fmt(w.precip, 1)} mm/h`], ['Sun elevation', `${fmt(w.sun.alt * R2D, 1)}°`],
      ['GHI (weather API)', `${fmt(w.api.ghi, 0)} W/m²`]
    ];
    $('#overview').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }
  function measuredAligned(times) {
    const m = state.wx.measured; if (!m) return null;
    const out = new Array(times.length).fill(NaN); let j = 0;
    for (let i = 0; i < times.length; i++) {
      while (j < m.time.length - 1 && Math.abs(m.time[j + 1] - times[i]) <= Math.abs(m.time[j] - times[i])) j++;
      if (Math.abs(m.time[j] - times[i]) <= 20 * 60000 && m.kw[j] != null) out[i] = m.kw[j];
    }
    return out.some(isFinite) ? out : null;
  }
  function renderDashboard() {
    const r = state.run;
    const note = $('#dash-note');
    if (!r) { $('#reco').innerHTML = 'Fast-forward the period to get a recommendation.'; $('#results-table').innerHTML = ''; if (chart) { chart.data.datasets = []; chart.update(); } return; }
    // recommendation: best 3-hour window of the live model, from now on for live/forecast modes
    const k = state.live, kw = r.kw[k], win = 12;
    const fromT = (state.wx.mode === 'current' || state.wx.mode === 'forecast') ? Date.now() - 900000 : -Infinity;
    let best = -1, bestI = -1, s = 0;
    for (let i = 0; i < kw.length; i++) {
      s += kw[i]; if (i >= win) s -= kw[i - win];
      if (i >= win - 1 && r.times[i - win + 1] >= fromT && s / win > best) { best = s / win; bestI = i - win + 1; }
    }
    if (bestI < 0 || best < 0.05) $('#reco').innerHTML = 'Little generation expected in this period. Shift flexible loads to another day.';
    else {
      const t0 = r.times[bestI], t1 = t0 + 3 * 3600000;
      $('#reco').innerHTML = `Run heavy loads (EV charging, washing) on <b>${fmtDay(t0)}, ${fmtTime(t0, false)}–${fmtTime(t1, false)}</b>. ${modelShort(k)} expects about <b>${best.toFixed(2)} kW</b> on average then.`;
    }
    // table
    const meas = measuredAligned(r.times);
    // score at the measured timestamps (model interpolated), so U2 uses the measurement's own time step
    const met = {}; let measEnergy = NaN, measPeak = NaN;
    const M = state.wx.measured;
    if (meas && M) {
      const idx = M.time.map((t, j) => j).filter(j => M.time[j] >= r.times[0] && M.time[j] <= r.times.at(-1) && M.kw[j] != null && isFinite(M.kw[j]));
      const mt = idx.map(j => M.time[j]), obs = idx.map(j => M.kw[j]);
      r.keys.forEach(key => { met[key] = PH.metrics(mt.map(t => WX.lerpAt(r.times, r.kw[key], t)), obs); });
      const gaps = mt.slice(1).map((t, i) => t - mt[i]).sort((x, y) => x - y); const dtH = gaps.length ? gaps[gaps.length >> 1] / 3600000 : 1;
      measEnergy = obs.reduce((x, y) => x + y, 0) * dtH; measPeak = Math.max(...obs);
    }
    const bestKey = meas ? r.keys.reduce((b, key) => (met[key] && (!b || met[key].rmse < met[b].rmse)) ? key : b, null) : null;
    let html = `<thead><tr><th>Model</th><th>Energy kWh</th><th>Peak kW</th>${meas ? '<th>RMSE</th><th>MAE</th><th>R²</th><th>U2</th>' : ''}</tr></thead><tbody>`;
    r.keys.forEach(key => {
      const m = met[key];
      html += `<tr><td><span class="swatch" style="display:inline-block;margin-right:6px;background:${MODEL_COLORS[key]}"></span>${modelShort(key)}${key === state.live ? ' ·live' : ''}</td><td>${fmt(r.energy[key], 1)}</td><td>${fmt(r.peak[key], 2)}</td>`;
      if (meas) html += `<td class="${key === bestKey ? 'best' : ''}">${fmt(m && m.rmse, 3)}</td><td>${fmt(m && m.mae, 3)}</td><td>${fmt(m && m.r2, 3)}</td><td>${fmt(m && m.u2, 3)}</td>`;
      html += '</tr>';
    });
    if (meas) html += `<tr><td>Measured</td><td>${fmt(measEnergy, 1)}</td><td>${fmt(measPeak, 2)}</td><td colspan="4"></td></tr>`;
    $('#results-table').innerHTML = html + '</tbody>';
    note.textContent = `${r.times.length.toLocaleString()} steps of 15 minutes · ${state.wx.series.source}${state.shade.useTiles ? ' · 3D-tile skyline on' : ''}.${meas ? ' Lowest RMSE in green.' : ''}`;
    drawChart(meas);
  }
  const nowLine = {
    id: 'nowLine',
    afterDatasetsDraw(c) {
      const t = state.sim.lastT; if (t == null) return;
      const x = c.scales.x.getPixelForValue(t); if (x < c.chartArea.left || x > c.chartArea.right) return;
      const ctx = c.ctx; ctx.save(); ctx.strokeStyle = 'rgba(227,235,240,0.55)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, c.chartArea.top); ctx.lineTo(x, c.chartArea.bottom); ctx.stroke(); ctx.restore();
    }
  };
  function drawChart(meas) {
    if (!window.Chart) { $('#dash-note').textContent += ' Chart library unavailable.'; return; }
    const r = state.run;
    const muted = cssVar('--muted') || '#8ea3b1', line = 'rgba(150,186,206,0.14)';
    const ds = r.keys.map(k => ({ label: modelShort(k), data: r.times.map((t, i) => ({ x: t, y: r.kw[k][i] })), borderColor: MODEL_COLORS[k], backgroundColor: MODEL_COLORS[k], borderWidth: k === state.live ? 2.2 : 1.3, pointRadius: 0, tension: 0.2, yAxisID: 'y' }));
    if (meas) ds.push({ label: 'Measured', data: r.times.map((t, i) => ({ x: t, y: isFinite(meas[i]) ? meas[i] : null })), borderColor: '#ffffff', borderDash: [4, 3], borderWidth: 1.4, pointRadius: 0, spanGaps: false, yAxisID: 'y' });
    ds.push({ label: 'Cloud %', data: r.times.map((t, i) => ({ x: t, y: r.cloud[i] })), borderColor: 'rgba(108,195,232,0.0)', backgroundColor: 'rgba(108,195,232,0.12)', fill: 'origin', pointRadius: 0, yAxisID: 'y1', order: 10 });
    const cfg = {
      type: 'line', data: { datasets: ds },
      options: {
        animation: false, maintainAspectRatio: false, parsing: false, normalized: true, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: muted, boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
          tooltip: { callbacks: { title: (it) => it.length ? fmtTime(it[0].parsed.x) : '', label: (it) => `${it.dataset.label}: ${it.parsed.y == null ? '—' : it.parsed.y.toFixed(it.dataset.yAxisID === 'y1' ? 0 : 2)}${it.dataset.yAxisID === 'y1' ? ' %' : ' kW'}` } }
        },
        scales: {
          x: { type: 'linear', min: r.times[0], max: r.times.at(-1), grid: { color: line }, ticks: { color: muted, maxTicksLimit: 7, callback: (v) => fmtDay(v) } },
          y: { position: 'left', beginAtZero: true, grid: { color: line }, ticks: { color: muted }, title: { display: true, text: 'kW', color: muted } },
          y1: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { color: muted, callback: (v) => v + '%' } }
        }
      },
      plugins: [nowLine]
    };
    if (chart) chart.destroy();
    chart = new Chart($('#chart'), cfg);
  }
  function exportCsv() {
    const r = state.run; if (!r) { toast('Fast-forward the period first.', 'warn'); return; }
    const meas = measuredAligned(r.times);
    const head = ['time_utc', 'time_local', 'cloud_pct', 'temp_c', 'ghi_api_wm2', 'sun_elev_deg', ...r.keys.map(k => `kw_${k}`), ...r.keys.map(k => `poa_${k}_wm2`), ...(meas ? ['measured_kw'] : [])];
    const lines = [head.join(',')];
    r.times.forEach((t, i) => {
      lines.push([new Date(t).toISOString(), fmtTime(t).replace(',', ''), fmt(r.cloud[i], 0), fmt(r.temp[i], 2), fmt(r.ghi[i], 1), fmt(r.sunAlt[i] * R2D, 2),
        ...r.keys.map(k => r.kw[k][i].toFixed(4)), ...r.keys.map(k => r.poa[k][i].toFixed(1)), ...(meas ? [isFinite(meas[i]) ? meas[i] : ''] : [])].join(','));
    });
    download(`arien-twin-${isoDate(r.times[0])}_${isoDate(r.times.at(-1))}.csv`, lines.join('\n'));
  }

  // ------------------------------------------------------------------ sun path / skyline diagram
  function drawSunPath(quick) {
    const cv = $('#sunpath'); if (!cv || !cv.offsetParent) return;
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = W / 2 - 34;
    const muted = cssVar('--muted') || '#8ea3b1', sun = cssVar('--sun') || '#f3b23c', good = cssVar('--good') || '#69c38a', fg = cssVar('--fg') || '#e3ebf0';
    const pt = (az, el) => { const r = R * (1 - el / (Math.PI / 2)); return [cx + r * Math.sin(az), cy - r * Math.cos(az)]; };
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(150,186,206,0.22)'; ctx.fillStyle = muted; ctx.font = '18px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [0, 30, 60].forEach(e => { ctx.beginPath(); ctx.arc(cx, cy, R * (1 - e / 90), 0, Math.PI * 2); ctx.stroke(); if (e) ctx.fillText(e + '°', cx + 4, cy - R * (1 - e / 90) + 12); });
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([l, a]) => { const [x, y] = pt(a * D2R, -0.2); ctx.fillText(l, x, y); });
    const a = state.sel && state.sel.kind === 'array' ? state.arrays.find(x => x.id === state.sel.id) : state.arrays[0];
    if (a) {
      const g = geoms.get(a.id) || geomFor(a);
      const c = g.panels[Math.floor(g.panels.length / 2)].c;
      const prof = state.shade.profiles[a.id];
      if (prof && state.shade.useTiles) {
        const p = prof.points[0].profile, nb = p.length;
        ctx.beginPath(); for (let b = 0; b <= nb; b++) { const [x, y] = pt(b / nb * 2 * Math.PI, p[b % nb]); b ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        for (let b = nb; b >= 0; b--) { const [x, y] = pt(b / nb * 2 * Math.PI, 0); ctx.lineTo(x, y); }
        ctx.fillStyle = 'rgba(107,126,139,0.55)'; ctx.fill();
      }
      if (state.objects.length && !quick) drawSunPath.objProfile = objectSkyline(c, g.n);
      const op = drawSunPath.objProfile;
      if (op && state.objects.length) {
        ctx.beginPath(); for (let b = 0; b <= op.length; b++) { const [x, y] = pt(b / op.length * 2 * Math.PI, op[b % op.length]); b ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        for (let b = op.length; b >= 0; b--) { const [x, y] = pt(b / op.length * 2 * Math.PI, 0); ctx.lineTo(x, y); }
        ctx.fillStyle = 'rgba(105,195,138,0.45)'; ctx.fill();
      }
    }
    // sun paths: solstices faint, selected day bold
    const t = state.sim.lastT ?? Date.now();
    const off = utcOffset();
    const dayPath = (dayStart, style, width) => {
      ctx.beginPath(); let started = false;
      for (let m = 0; m <= 1440; m += 10) {
        const sp = PH.solarPosition(dayStart + m * 60000, state.site.lat, state.site.lon);
        if (sp.alt <= 0) { started = false; continue; }
        const [x, y] = pt(sp.az, sp.alt); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke();
    };
    const d = new Date(t + off); const y0 = d.getUTCFullYear();
    dayPath(Date.UTC(y0, 5, 21) - off, 'rgba(243,178,60,0.25)', 1.5);
    dayPath(Date.UTC(y0, 11, 21) - off, 'rgba(243,178,60,0.25)', 1.5);
    dayPath(Date.UTC(y0, d.getUTCMonth(), d.getUTCDate()) - off, sun, 3);
    const sp = PH.solarPosition(t, state.site.lat, state.site.lon);
    if (sp.alt > 0) { const [x, y] = pt(sp.az, sp.alt); ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fillStyle = sun; ctx.fill(); ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.stroke(); }
    void good;
  }
  function objectSkyline(c, n) {
    const nb = 72, out = new Float32Array(nb);
    const o = [c[0] + n[0] * 0.05, c[1] + n[1] * 0.05, c[2] + n[2] * 0.05];
    for (let b = 0; b < nb; b++) {
      const az = b / nb * 2 * Math.PI;
      const blocked = (el) => state.objects.some(ob => PH.objectTransmission(ob, o, PH.sunVectorENU(el, az)) < 1);
      if (!blocked(0.3 * D2R)) { out[b] = 0; continue; }
      let lo = 0.3 * D2R, hi = 80 * D2R; if (blocked(hi)) { out[b] = hi; continue; }
      for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; if (blocked(m)) lo = m; else hi = m; }
      out[b] = (lo + hi) / 2;
    }
    return out;
  }

  // ------------------------------------------------------------------ UI: drawers and panes
  const PANE_TITLES = { site: 'Site', time: 'Weather period', panels: 'Solar arrays', objects: 'Obstacles', models: 'Irradiance models', shading: 'Shading', meta: 'Meta-learning', world: '3D world', admin: 'Site settings' };
  function openDrawer(name) {
    $('#drawer').hidden = false;
    $('#drawer-title').textContent = PANE_TITLES[name];
    $$('[data-pane]').forEach(s => { s.hidden = s.dataset.pane !== name; });
    $$('#rail button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.panel === name)));
    state.openPane = name;
    if (name === 'shading') requestAnimationFrame(() => drawSunPath());
    if (name === 'panels' || name === 'objects') fillEditors();
  }
  function closeDrawer() { $('#drawer').hidden = true; $$('#rail button').forEach(b => b.setAttribute('aria-pressed', 'false')); state.openPane = null; }
  function toggleDash(force) {
    const open = force ?? $('#dash').hidden;
    $('#dash').hidden = !open; $('#btn-dash').setAttribute('aria-pressed', String(open));
    $('#app').classList.toggle('dash-open', open);
    if (open) { if (state.sim.lastW) renderOverview(state.sim.lastW); if (state.run && !chart) renderDashboard(); else if (chart) chart.resize(); }
  }
  function toggleVisuals() {
    state.visuals = state.visuals === 'off' ? 'high' : 'off';
    $('#w-vis').value = state.visuals; $('#btn-visuals').setAttribute('aria-pressed', String(state.visuals !== 'off')); saveSoon();
  }

  function refreshLists() {
    $('#arr-list').innerHTML = state.arrays.map(a => {
      const kwp = a.rows * a.cols * a.panelW * a.panelL * a.eff;
      return `<li data-id="${a.id}" aria-selected="${state.sel && state.sel.id === a.id}"><span class="dot"></span>${escapeHtml(a.name)}<span class="meta">${a.rows * a.cols} × · ${kwp.toFixed(2)} kWp</span></li>`;
    }).join('') || '<li class="hint" style="cursor:default">No arrays yet.</li>';
    $('#obj-list').innerHTML = state.objects.map(o => `<li data-id="${o.id}" aria-selected="${state.sel && state.sel.id === o.id}"><span class="dot obj"></span>${PH.OBJECT_TYPES[o.type].label}<span class="meta">${o.dims.height.toFixed(1)} m</span></li>`).join('');
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function fillEditors() {
    const it = selItem();
    const isA = state.sel && state.sel.kind === 'array', isO = state.sel && state.sel.kind === 'object';
    $('#arr-editor').hidden = !isA; $('#obj-editor').hidden = !isO;
    if (isA && it) {
      const a = it;
      $('#arr-name').value = a.name;
      const set = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
      set('#arr-rows', a.rows); set('#arr-cols', a.cols); set('#arr-pitch', a.rowPitch.toFixed(2)); set('#arr-tilt', a.tilt); set('#arr-az', a.azimuth);
      set('#arr-mount', a.mountHeight); set('#arr-gap', a.colGap); set('#arr-pw', a.panelW); set('#arr-pl', a.panelL); set('#arr-eff', a.eff);
      set('#arr-gamma', a.gammaPct); set('#arr-cx', a.cellsX); set('#arr-cy', a.cellsY);
      set('#arr-x', a.x.toFixed(2)); set('#arr-y', a.y.toFixed(2)); set('#arr-z', a.z.toFixed(2));
      $('#arr-tilt-out').textContent = a.tilt + '°';
      $('#arr-az-out').textContent = `${a.azimuth}° ${compass(a.azimuth)}`;
      const n = a.rows * a.cols, area = n * a.panelW * a.panelL;
      $('#arr-capacity').innerHTML = `${n} panels · ${area.toFixed(1)} m² · <b>${(area * a.eff).toFixed(2)} kWp</b> · ${(n * a.cellsX * a.cellsY).toLocaleString()} cells`;
    }
    if (isO && it) {
      const o = it, T = PH.OBJECT_TYPES[o.type];
      $('#obj-title').textContent = T.label;
      const labels = T.dimLabels;
      $('#obj-dims').innerHTML = [['length', labels[0]], ['width', labels[1]], ['height', labels[2]]].filter(x => x[1]).map(([k, l]) =>
        `<div class="field"><label for="obj-d-${k}">${l} (m)</label><input id="obj-d-${k}" data-dim="${k}" type="number" min="0.05" step="0.1" value="${(o.dims[k] ?? o.dims.length).toFixed(2)}"></div>`).join('');
      $('#obj-heading').value = o.heading; $('#obj-heading-out').textContent = o.heading + '°';
      $('#obj-por-wrap').hidden = !T.porous; $('#obj-por').value = o.porosity || 0; $('#obj-por-out').textContent = Math.round((o.porosity || 0) * 100) + '%';
      $('#obj-x').value = o.x.toFixed(2); $('#obj-y').value = o.y.toFixed(2); $('#obj-z').value = o.z.toFixed(2);
    }
  }
  function bindArrayInputs() {
    const num = (id, key, opts = {}) => $(id).addEventListener(opts.live ? 'input' : 'change', (e) => {
      const a = selItem(); if (!a || state.sel.kind !== 'array') return;
      let v = Number(e.target.value); if (!isFinite(v)) return;
      if (opts.int) v = Math.round(v);
      if (opts.min != null) v = Math.max(opts.min, v); if (opts.max != null) v = Math.min(opts.max, v);
      a[key] = v;
      if (opts.live) { const o = $(id + '-out'); if (o) o.textContent = key === 'azimuth' ? `${v}° ${compass(v)}` : v + '°'; }
      scheduleArrayRebuild(a, opts.live);
    });
    num('#arr-rows', 'rows', { int: true, min: 1, max: 40 }); num('#arr-cols', 'cols', { int: true, min: 1, max: 60 });
    num('#arr-pitch', 'rowPitch', { min: 0.3 }); num('#arr-tilt', 'tilt', { live: true, min: 0, max: 90 }); num('#arr-az', 'azimuth', { live: true, min: 0, max: 359 });
    num('#arr-mount', 'mountHeight', { min: 0 }); num('#arr-gap', 'colGap', { min: 0 }); num('#arr-pw', 'panelW', { min: 0.2 }); num('#arr-pl', 'panelL', { min: 0.2 });
    num('#arr-eff', 'eff', { min: 0.01, max: 0.5 }); num('#arr-gamma', 'gammaPct', { min: -1, max: 0 });
    num('#arr-cx', 'cellsX', { int: true, min: 1, max: 24 }); num('#arr-cy', 'cellsY', { int: true, min: 1, max: 24 });
    num('#arr-x', 'x'); num('#arr-y', 'y'); num('#arr-z', 'z');
    $('#arr-name').addEventListener('change', (e) => { const a = selItem(); if (a) { a.name = e.target.value.trim() || a.name; refreshLists(); saveSoon(); } });
  }
  let rebuildTimer = null;
  function scheduleArrayRebuild(a, live) {
    clearTimeout(rebuildTimer);
    const go = () => { buildArrayPrimitive(a); state.shade.dirty = true; clearProfiles(a); state.run = null; fillEditors(); refreshLists(); saveSoon(); simulateNow(true); drawSunPath(); };
    if (live) rebuildTimer = setTimeout(go, 120); else go();
  }
  function bindObjectInputs() {
    $('#obj-dims').addEventListener('change', (e) => {
      const o = selItem(); if (!o || state.sel.kind !== 'object') return;
      const k = e.target.dataset.dim; const v = Math.max(0.05, Number(e.target.value)); if (!isFinite(v)) return;
      o.dims[k] = v; if (k === 'length' && !PH.OBJECT_TYPES[o.type].dimLabels[1]) o.dims.width = v;
      updateObjectMatrix(o); afterObjectEdit(o);
    });
    $('#obj-heading').addEventListener('input', (e) => { const o = selItem(); if (!o) return; o.heading = Number(e.target.value); $('#obj-heading-out').textContent = o.heading + '°'; updateObjectMatrix(o); afterObjectEdit(o, true); });
    $('#obj-por').addEventListener('input', (e) => { const o = selItem(); if (!o) return; o.porosity = Number(e.target.value); $('#obj-por-out').textContent = Math.round(o.porosity * 100) + '%'; afterObjectEdit(o, true); });
    ['x', 'y', 'z'].forEach(k => $('#obj-' + k).addEventListener('change', (e) => { const o = selItem(); if (!o) return; const v = Number(e.target.value); if (!isFinite(v)) return; o[k] = v; updateObjectMatrix(o); afterObjectEdit(o); }));
  }
  let objTimer = null;
  function afterObjectEdit(o, live) {
    clearTimeout(objTimer);
    const go = () => { state.shade.dirty = true; state.run = null; refreshLists(); saveSoon(); simulateNow(true); drawSunPath(); };
    if (live) objTimer = setTimeout(go, 100); else go();
  }

  const OBJ_ICONS = {
    tree: '<path d="M12 3c3.6 0 6.5 2.8 6.5 6.2 0 3.2-2.5 5.8-5.5 6.1V21h-2v-5.7c-3-.3-5.5-2.9-5.5-6.1C5.5 5.8 8.4 3 12 3z"/>',
    conifer: '<path d="M12 2l5 7h-2.5l4 6H13v6h-2v-6H5.5l4-6H7z"/>',
    hedge: '<path d="M3 19v-7c0-2 1.5-3 3-3 .5-1.5 2-2 3-1.5.8-1.5 3.2-1.5 4 0 1-.5 2.5 0 3 1.5 1.5 0 3 1 3 3v7z"/><path d="M3 19h18"/>',
    wall: '<path d="M3 9h18v10H3z"/><path d="M3 14h18M9 9v5M15 9v5M6 14v5M12 14v5M18 14v5"/>',
    chimney: '<path d="M4 21V12l8-6 8 6v9z"/><path d="M15 8V4h3v6.2"/>',
    building: '<path d="M4 21V6h10v15M14 10h6v11"/><path d="M7 9h2M7 13h2M7 17h2M17 14h1M17 18h1"/>',
    pole: '<path d="M12 3v18M7 6h10M8 9h8"/>'
  };
  function buildLibrary() {
    $('#obj-lib').innerHTML = Object.entries(PH.OBJECT_TYPES).map(([k, t]) => `<button data-type="${k}" aria-pressed="false"><svg viewBox="0 0 24 24">${OBJ_ICONS[k]}</svg>${t.label}</button>`).join('');
    $('#obj-lib').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (state.placing && state.placing.type === b.dataset.type) { stopPlacing(); return; }
      startPlacing({ kind: 'object', type: b.dataset.type });
    });
  }

  function buildModelPane() {
    $('#model-live').innerHTML = LIVE_KEYS.map(k => `<label><input type="radio" name="live" value="${k}" ${k === state.live ? 'checked' : ''}><span class="swatch" style="background:${MODEL_COLORS[k]}"></span>${modelLabel(k)}${(PH.MODELS[k] && PH.MODELS[k].placeholder) ? ' <span class="badge warn">check</span>' : ''}<small>${MODEL_NOTE[k]}</small></label>`).join('');
    $('#model-compare').innerHTML = LIVE_KEYS.map(k => `<label><input type="checkbox" value="${k}" ${state.compare[k] ? 'checked' : ''}><span class="swatch" style="background:${MODEL_COLORS[k]}"></span>${modelLabel(k)}</label>`).join('');
    $('#model-live').addEventListener('change', (e) => { state.live = e.target.value; state.sim.T = {}; saveSoon(); simulateNow(); if (state.run) { if (!state.run.keys.includes(state.live)) runPeriod(true); else renderDashboard(); } });
    $('#model-compare').addEventListener('change', (e) => { state.compare[e.target.value] = e.target.checked; saveSoon(); });
    $('#model-all').addEventListener('click', () => { ['rwghi', 'hdkr', 'karamov', 'kasten', 'balint'].forEach(k => { state.compare[k] = true; }); $$('#model-compare input').forEach(i => { if (i.value !== 'seasonal') i.checked = true; }); saveSoon(); runPeriod(); });
    buildParamGrid();
    $('#param-reset').addEventListener('click', () => { state.params = clone(PH.DEFAULT_PARAMS); state.thermalCa = 9600; buildParamGrid(); onParamChange(); });
  }
  const PARAM_META = {
    kasten: { title: 'Kasten (German)', keys: { Ad: 'A_d', Bd: 'B_d', ad: 'a_d', bd: 'b_d', q: 'q', Tm: 'Linke T_m' } },
    balint: { title: 'Bálint (Hungarian)', badge: 'placeholder', keys: { a: 'a (W/m²)', b1: 'b₁', b2: 'b₂' } },
    karamov: { title: 'Karamov–Naumov', badge: 'simplified clear sky', keys: { c1: 'c₁', c2: 'c₂', k1: 'k₁', k2: 'k₂', d0: 'd₀', d1: 'd₁' } },
    common: { title: 'All models', keys: { albedo: 'Ground albedo', minAltDeg: 'Min sun alt (°)' } }
  };
  function buildParamGrid() {
    let html = '';
    for (const [grp, meta] of Object.entries(PARAM_META)) {
      html += `<h4>${meta.title}${meta.badge ? ` <span class="badge warn">${meta.badge}</span>` : ''}</h4><div class="pg">`;
      for (const [k, l] of Object.entries(meta.keys)) html += `<div class="field"><label for="p-${grp}-${k}">${l}</label><input id="p-${grp}-${k}" data-grp="${grp}" data-key="${k}" type="number" step="any" value="${state.params[grp][k]}"></div>`;
      html += '</div>';
    }
    html += `<h4>Thermal model</h4><div class="pg"><div class="field"><label for="p-ca">Heat capacity (J/m²K)</label><input id="p-ca" data-ca="1" type="number" step="100" value="${state.thermalCa}"></div></div>`;
    $('#param-grid').innerHTML = html;
  }
  function onParamChange() { state.sim.T = {}; state.run = null; saveSoon(); simulateNow(); runPeriod(true); }

  // ------------------------------------------------------------------ site
  async function goToSite(lat, lon, name) {
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { toast('Enter a latitude between −90 and 90 and a longitude between −180 and 180.', 'err'); return; }
    const moved = Math.abs(lat - state.site.lat) > 1e-6 || Math.abs(lon - state.site.lon) > 1e-6;
    state.site.lat = lat; state.site.lon = lon; state.site.name = name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    if (moved) {
      if (state.arrays.length || state.objects.length) toast('Moved site: cleared the previous arrays and obstacles.', 'info');
      state.arrays = []; state.objects = []; state.sel = null; state.shade.profiles = {}; state.shade.useTiles = false; $('#sh-tiles').checked = false;
      geoms.clear();
    }
    $('#site-lat').value = lat.toFixed(6); $('#site-lon').value = lon.toFixed(6);
    setSiteFrame(); rebuildAll(); fillEditors();
    state.site.groundZ = 0;
    await flyToSite(1.6);
    if (state.world.src !== 'none') { await waitTiles(8000); state.site.groundZ = await sampleGround(); }
    renderSiteFacts(); saveSoon();
    if (state.wx.mode !== 'csv' && state.wx.connected) loadWeather(true); else if (state.wx.mode === 'csv') { state.wx.series = null; }
  }
  function renderSiteFacts() {
    const s = state.wx.series;
    const rows = [['Site', state.site.name], ['Latitude', state.site.lat.toFixed(5)], ['Longitude', state.site.lon.toFixed(5)],
      ['Ground (ellipsoid)', `${state.site.groundZ.toFixed(1)} m`], ['Elevation (Open-Meteo)', state.site.elevation != null ? `${state.site.elevation} m` : '—'],
      ['Time zone', s ? s.tz : '—'], ['3D world', worldLabel()]];
    $('#site-facts').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('');
  }
  function updateSiteSearchAvailability() {
    const g = state.world.src.startsWith('google');
    $('#site-search').disabled = g; $('#site-search-go').disabled = g;
    $('#site-search-note').textContent = g ? 'Place search is off while Google 3D tiles are shown (Google’s terms). Enter coordinates.' : '';
  }
  async function searchPlace() {
    const q = $('#site-search').value.trim(); if (!q) return;
    $('#site-results').innerHTML = '<li class="hint">Searching…</li>';
    try {
      const res = await WX.geocode(q);
      if (!res.length) { $('#site-results').innerHTML = '<li class="hint">No places found. Try a town name or postcode area.</li>'; return; }
      $('#site-results').innerHTML = res.map((r, i) => `<li><button data-i="${i}">${escapeHtml(r.name)}<small>${escapeHtml(r.admin)} · ${r.lat.toFixed(3)}, ${r.lon.toFixed(3)}</small></button></li>`).join('');
      $('#site-results').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const r = res[+b.dataset.i]; $('#site-results').innerHTML = ''; goToSite(r.lat, r.lon, `${r.name}, ${r.admin}`); };
    } catch (e) { $('#site-results').innerHTML = '<li class="hint">Could not reach the place search. Check your connection.</li>'; }
  }

  // ------------------------------------------------------------------ time controls
  function setPlaying(p) {
    if (!viewer) return;
    if (p && !state.wx.series) { toast('Load weather first.', 'warn'); return; }
    if (p && state.wx.series && Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime() >= state.wx.series.end - 1) viewer.clock.currentTime = viewer.clock.startTime.clone();
    viewer.clock.shouldAnimate = p; state.sim.playing = p;
    $('#t-play').innerHTML = `<svg><use href="#i-${p ? 'pause' : 'play'}"/></svg>`;
  }
  const togglePlay = () => setPlaying(!viewer.clock.shouldAnimate);
  function jumpTo(t) {
    const s = state.wx.series; if (!s) return;
    t = clamp(t, s.start, s.end);
    if (state.sim.lastT != null && Math.abs(t - state.sim.lastT) > 3 * 3600000) state.sim.T = {};
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(t));
    simulateNow();
  }
  function syncScrub(t) { const sc = $('#t-scrub'); if (document.activeElement !== sc) sc.value = t; }
  function renderDays() {
    const s = state.wx.series, el = $('#t-days'); if (!s) { el.innerHTML = ''; return; }
    const off = utcOffset(), span = s.end - s.start; let html = '';
    const d0 = new Date(s.start + off); let t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) - off + 86400000;
    const every = span > 20 * 86400000 ? 7 : span > 10 * 86400000 ? 2 : 1; let i = 0;
    for (; t < s.end; t += 86400000, i++) { if (i % every) continue; const pct = (t - s.start) / span * 100; html += `<span style="left:${pct}%">${fmtDay(t).split(' ').slice(0, 2).join(' ')}</span>`; }
    el.innerHTML = html;
  }

  // ------------------------------------------------------------------ wiring
  let wxSetMode = () => {};
  function wire() {
    $('#rail').addEventListener('click', (e) => { const b = e.target.closest('button[data-panel]'); if (!b) return; if (state.openPane === b.dataset.panel && !$('#drawer').hidden) closeDrawer(); else openDrawer(b.dataset.panel); });
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#dash-close').addEventListener('click', () => toggleDash(false));
    $('#btn-dash').addEventListener('click', () => toggleDash());
    $('#btn-visuals').addEventListener('click', toggleVisuals);
    document.addEventListener('keydown', onKey);

    // site
    $('#site-search-go').addEventListener('click', searchPlace);
    $('#site-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchPlace(); });
    $('#site-go').addEventListener('click', () => goToSite(Number($('#site-lat').value), Number($('#site-lon').value)));
    $('#site-reset').addEventListener('click', () => goToSite(DEFAULT_SITE.lat, DEFAULT_SITE.lon, DEFAULT_SITE.name));

    // weather
    const hints = {
      current: 'Live: yesterday, today and tomorrow. The clock starts at the current time.',
      forecast: 'The next 7 days of hourly forecasts from Open-Meteo (best-match model for the site).',
      historical: 'Past weather. Archived forecast model runs track actual conditions most closely; ERA5 goes back to 1940.',
      previous: 'What the forecast said N days before each hour: the thesis validated N−1 to N−4. Archived from January 2024.',
      csv: 'Your own weather file, for example from a site weather station.'
    };
    const setMode = (m) => {
      state.wx.mode = m;
      $$('#wx-mode button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
      $$('.wx-opts').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(m); });
      $('#wx-mode-hint').textContent = hints[m];
    };
    $('#wx-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
    wxSetMode = setMode;
    setMode(state.wx.mode);
    const today = Date.now();
    $('#wx-end').value = isoDate(today - 2 * 86400000); $('#wx-start').value = isoDate(today - 8 * 86400000);
    $('#wx-lead').addEventListener('input', (e) => { $('#wx-lead-out').textContent = `${e.target.value} day${e.target.value > 1 ? 's' : ''}`; });
    $('#wx-load').addEventListener('click', () => loadWeather(false));
    $('#meas-csv').addEventListener('change', loadMeasured);

    // arrays
    $('#arr-place').addEventListener('click', () => { if (state.placing && state.placing.kind === 'array') stopPlacing(); else startPlacing({ kind: 'array' }); });
    $('#arr-list').addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li) { select('array', li.dataset.id); flyToItem(selItem()); } });
    $('#obj-list').addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li) { select('object', li.dataset.id); flyToItem(selItem()); } });
    $('#arr-del').addEventListener('click', removeSelected); $('#obj-del').addEventListener('click', removeSelected);
    $('#arr-dup').addEventListener('click', duplicateSelected); $('#obj-dup').addEventListener('click', duplicateSelected);
    $('#arr-drop').addEventListener('click', () => { const it = selItem(); if (it) dropItems([it]).then(fillEditors); });
    $('#obj-drop').addEventListener('click', () => { const it = selItem(); if (it) dropItems([it]).then(fillEditors); });
    $('#arr-suggest').addEventListener('click', () => {
      const a = selItem(); if (!a) return;
      // winter-solstice solar noon elevation at the site
      const alt = (90 - Math.abs(state.site.lat) - 23.44) * D2R;
      if (alt <= 2 * D2R) { toast('The sun barely rises at winter noon here; pitch would be impractical.', 'warn'); return; }
      const h = a.panelL * Math.sin(a.tilt * D2R), az = a.azimuth * D2R;
      const southness = Math.max(0.2, Math.abs(Math.cos(az)));
      a.rowPitch = +(a.panelL * Math.cos(a.tilt * D2R) + h / Math.tan(alt) * southness).toFixed(2);
      scheduleArrayRebuild(a); toast(`Row pitch set to ${a.rowPitch} m (no shading at winter-solstice noon).`, 'ok');
    });
    $('#arr-fill').addEventListener('click', () => {
      const a = selItem(); if (!a) return;
      const L = Number($('#arr-fill-l').value), Dp = Number($('#arr-fill-w').value);
      a.cols = Math.max(1, Math.floor((L + a.colGap) / (a.panelW + a.colGap)));
      const depth1 = a.panelL * Math.cos(a.tilt * D2R);
      a.rows = Math.max(1, Math.floor((Dp - depth1) / a.rowPitch) + 1);
      scheduleArrayRebuild(a); toast(`${a.rows} rows × ${a.cols} panels fit ${L} × ${Dp} m.`, 'ok');
    });
    bindArrayInputs(); bindObjectInputs(); buildLibrary(); buildModelPane();
    $('#param-grid').addEventListener('change', (e) => {
      const el = e.target; const v = Number(el.value); if (!isFinite(v)) return;
      if (el.dataset.ca) state.thermalCa = Math.max(500, v); else state.params[el.dataset.grp][el.dataset.key] = v;
      onParamChange();
    });

    // shading
    $('#sh-tiles').addEventListener('change', (e) => {
      if (e.target.checked && !state.arrays.some(a => state.shade.profiles[a.id])) { e.target.checked = false; traceSkyline(); return; }
      state.shade.useTiles = e.target.checked; state.shade.dirty = true; state.run = null; simulateNow(); drawSunPath(); runPeriod(true);
    });
    $('#sh-run').addEventListener('click', traceSkyline);
    $('#sh-colour').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; state.colourMode = b.dataset.v;
      $$('#sh-colour button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); paintCells(); saveSoon();
    });
    $$('#sh-colour button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === state.colourMode)));

    // world
    const syncWorldInputs = () => {
      const s = $('#w-src').value;
      $('#w-ion-wrap').hidden = !(s === 'ion' || s === 'google-ion'); $('#w-g-wrap').hidden = s !== 'google';
    };
    $('#w-src').value = state.world.src; $('#w-ion').value = state.world.ion; $('#w-google').value = state.world.google; $('#w-remember').checked = state.world.remember;
    syncWorldInputs();
    $('#w-src').addEventListener('change', syncWorldInputs);
    $('#w-load').addEventListener('click', async () => {
      const s = $('#w-src').value, ion = $('#w-ion').value.trim(), g = $('#w-google').value.trim();
      if ((s === 'ion' || s === 'google-ion') && !ion) { setStatus('#w-status', 'Paste a Cesium ion access token (cesium.com → Access Tokens).', 'err'); return; }
      if (s === 'google' && !g) { setStatus('#w-status', 'Paste a Google Maps Platform key with the Map Tiles API enabled.', 'err'); return; }
      state.world.src = s; state.world.ion = ion; state.world.google = g; state.world.remember = $('#w-remember').checked;
      state.shade.profiles = {}; state.shade.useTiles = false; $('#sh-tiles').checked = false;
      $('#w-load').disabled = true; setStatus('#w-status', 'Loading ' + worldLabel() + '…');
      try { const res = await loadWorld(); setStatus('#w-status', res.msg, res.ok ? 'ok' : 'err'); if (res.ok) saveScene(); }
      catch (e) { setStatus('#w-status', 'The 3D world failed to start: ' + (e.message || e), 'err'); }
      finally { $('#w-load').disabled = false; }
    });
    $('#w-remember').addEventListener('change', (e) => { state.world.remember = e.target.checked; state.world.ion = $('#w-ion').value.trim(); state.world.google = $('#w-google').value.trim(); state.wx.apiKey = $('#w-om').value.trim(); saveScene(); });
    $('#w-om').value = state.wx.apiKey || '';
    $('#w-om').addEventListener('change', (e) => { state.wx.apiKey = e.target.value.trim(); saveScene(); setStatus('#w-status', state.wx.apiKey ? 'Open-Meteo key set. Weather requests now go to the customer servers.' : 'Using the free Open-Meteo API.', 'ok'); });
    $('#w-vis').value = state.visuals;
    $('#w-vis').addEventListener('change', (e) => { state.visuals = e.target.value; $('#btn-visuals').setAttribute('aria-pressed', String(state.visuals !== 'off')); saveSoon(); });
    $('#btn-visuals').setAttribute('aria-pressed', String(state.visuals !== 'off'));
    $('#w-shadows').checked = state.shadowsOn;
    $('#w-shadows').addEventListener('change', (e) => { state.shadowsOn = e.target.checked; viewer.shadows = state.shadowsOn; saveSoon(); });
    $('#scene-save').addEventListener('click', () => download(`arien-scene-${(state.site.name || 'site').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`, JSON.stringify(sceneSnapshot(), null, 2), 'application/json'));
    $('#scene-open').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const snap = JSON.parse(await f.text());
        const src = state.world.src;
        if (!applySnapshot(snap)) throw new Error('Not an ARIEN scene file.');
        state.world.src = src; // keep the loaded world; items re-settle onto it
        state.arrays.forEach(a => { a.worldSrc = a.worldSrc || 'none'; }); state.objects.forEach(o => { o.worldSrc = o.worldSrc || 'none'; });
        setSiteFrame(); geoms.clear(); state.shade.profiles = {}; state.shade.useTiles = false;
        buildModelPane2(); rebuildAll(); await flyToSite(1.2);
        const stale = [...state.arrays, ...state.objects].filter(i => i.worldSrc !== state.world.src); if (stale.length) { await waitTiles(8000); await dropItems(stale); }
        $('#site-lat').value = state.site.lat.toFixed(6); $('#site-lon').value = state.site.lon.toFixed(6);
        toast('Scene opened.', 'ok'); saveScene(); loadWeather(true);
      } catch (err) { toast('Could not open the scene: ' + err.message, 'err'); }
      e.target.value = '';
    });

    // time bar
    $('#t-play').addEventListener('click', togglePlay);
    $('#t-start').addEventListener('click', () => { if (state.wx.series) { state.sim.energyWh = 0; jumpTo(state.wx.series.start); } });
    $('#t-back').addEventListener('click', () => state.sim.lastT != null && jumpTo(state.sim.lastT - 3600000));
    $('#t-fwd').addEventListener('click', () => state.sim.lastT != null && jumpTo(state.sim.lastT + 3600000));
    $('#t-speed').addEventListener('change', (e) => { if (viewer) viewer.clock.multiplier = Number(e.target.value); });
    $('#t-scrub').addEventListener('input', (e) => jumpTo(Number(e.target.value)));
    $('#t-run').addEventListener('click', () => runPeriod(false));
    $('#export-csv').addEventListener('click', exportCsv);
    window.addEventListener('resize', () => { if (chart) chart.resize(); });
  }
  function buildModelPane2() {
    $$('#model-live input').forEach(i => { i.checked = i.value === state.live; });
    $$('#model-compare input').forEach(i => { i.checked = !!state.compare[i.value]; });
    buildParamGrid();
  }
  function flyToItem(it) {
    if (!it || !viewer) return;
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(enu2ecef(it.x, it.y, it.z), 6), { offset: new Cesium.HeadingPitchRange(viewer.camera.heading, -0.6, 40), duration: 1 });
  }

  // ------------------------------------------------------------------ connect screen (keys first, then world, then weather)
  const PREVIEW_HINT = 'This page is open inside Claude’s file preview, which may block map and weather requests. If loading fails, download the file and open it in Chrome or Edge.';
  // A preview may load the page as srcdoc or a blob inside a frame, so look beyond location.hostname
  function embeddedIn() {
    const hints = [location.href, document.referrer, window.origin || '', ...(location.ancestorOrigins ? Array.from(location.ancestorOrigins) : [])].join(' ');
    if (/claudeusercontent\.com|claude\.ai|claude\.com/i.test(hints)) return 'claude';
    let framed = false; try { framed = window.self !== window.top; } catch (e) { framed = true; }
    return framed || /^(about|blob):/.test(location.protocol) ? 'frame' : null;
  }
  const inClaudePreview = () => embeddedIn() === 'claude';
  const cspBlocked = new Set();
  document.addEventListener('securitypolicyviolation', (e) => { try { cspBlocked.add(new URL(e.blockedURI).hostname); } catch (x) { cspBlocked.add(String(e.blockedURI)); } });
  function showSetupNote(msg, kind) { const n = $('#setup-note'); if (n) { n.textContent = msg; n.hidden = false; n.classList.toggle('info', kind === 'info'); } }
  function workersUsable() {
    return new Promise((resolve) => {
      let w = null, settled = false;
      const done = (v) => { if (settled) return; settled = true; try { if (w) w.terminate(); } catch (e) { /* ignore */ } resolve(v); };
      try {
        const url = URL.createObjectURL(new Blob(['postMessage(1);'], { type: 'text/javascript' }));
        w = new Worker(url, { type: 'module' });
        w.onmessage = () => done(true); w.onerror = () => done(false);
        setTimeout(() => done(false), 3000);
      } catch (e) { done(false); }
    });
  }
  const setStep = (id, st) => { $(id).dataset.state = st; };
  function syncSetupInputs() {
    const v = $('#s-src').value;
    $('#s-ion-wrap').hidden = !(v === 'ion' || v === 'google-ion'); $('#s-g-wrap').hidden = v !== 'google';
  }
  function syncWorldPane() {
    $('#w-src').value = state.world.src; $('#w-ion').value = state.world.ion; $('#w-google').value = state.world.google;
    $('#w-om').value = state.wx.apiKey || ''; $('#w-remember').checked = state.world.remember;
    $('#w-ion-wrap').hidden = !(state.world.src === 'ion' || state.world.src === 'google-ion'); $('#w-g-wrap').hidden = state.world.src !== 'google';
  }
  function openSetup() {
    const b = $('#boot'); b.hidden = false; b.classList.remove('gone');
    $('#s-src').value = state.world.src; $('#s-ion').value = state.world.ion; $('#s-google').value = state.world.google;
    $('#s-om').value = state.wx.apiKey || ''; $('#s-remember').checked = state.world.remember; syncSetupInputs();
  }
  function finishSetup(withWeather) {
    const b = $('#boot'); b.classList.add('gone'); setTimeout(() => { b.hidden = true; }, 450);
    if (!window.THREE) toast('three.js did not load, so obstacles use simple shapes.', 'warn');
    if (!withWeather) toast('Load weather any time from the Weather panel.', 'info', 6000);
    if (state.firstRun) { state.firstRun = false; toast('Demo scene: a 12-panel array with a tree and a low wall. Click an item to edit it.', 'info', 7000); }
  }
  function initSetup() {
    $('#s-src').value = ((state.world.remember || siteConfig) && state.world.src) ? state.world.src : 'ion';
    $('#s-ion').value = state.world.ion; $('#s-google').value = state.world.google; $('#s-om').value = state.wx.apiKey || '';
    $('#s-remember').checked = state.world.remember; syncSetupInputs();
    $('#s-src').addEventListener('change', syncSetupInputs);
    $('#s-world').addEventListener('click', () => setupWorld());
    $('#sw-done').addEventListener('click', () => { setStep('#step-world', 'active'); $('#sw-done').hidden = true; });
    $('#s-wx').addEventListener('click', () => setupWeather());
    $('#s-skip').addEventListener('click', () => finishSetup(false));
    $('#w-connect').addEventListener('click', openSetup);
    $('#setup').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('input')) return;
      if ($('#step-world').dataset.state === 'active') $('#s-world').click(); else if ($('#step-wx').dataset.state === 'active') $('#s-wx').click();
    });
  }
  async function setupWorld() {
      const src = $('#s-src').value, ion = $('#s-ion').value.trim(), g = $('#s-google').value.trim();
      if ((src === 'ion' || src === 'google-ion') && !ion) { setStatus('#s-world-msg', 'Paste your Cesium ion access token first.', 'err'); $('#s-ion').focus(); return false; }
      if (src === 'google' && !g) { setStatus('#s-world-msg', 'Paste your Google Maps Platform key first.', 'err'); $('#s-google').focus(); return false; }
      Object.assign(state.world, { src, ion, google: g, remember: $('#s-remember').checked });
      const btn = $('#s-world'); btn.disabled = true;
      setStatus('#s-world-msg', `Loading ${worldLabel()}…`);
      let res;
      try { res = await loadWorld(); } catch (e) { console.error(e); res = { ok: false, msg: 'The 3D world failed to start: ' + (e.message || e) }; }
      btn.disabled = false; syncWorldPane();
      if (!res.ok) { setStatus('#s-world-msg', res.msg, 'err'); return false; }
      saveScene();
      setStatus('#s-world-msg', res.msg, 'ok');
      setStep('#step-world', 'done'); $('#sw-done').hidden = false; $('#sw-done').textContent = `${worldLabel()} · change`;
      if ($('#step-wx').dataset.state !== 'done') { setStep('#step-wx', 'active'); $('#s-wx').disabled = false; $('#s-skip').disabled = false; }
      $('#boot').classList.add('over-world');
      $('#s-wx').focus();
      return true;
  }
  async function setupWeather() {
      state.wx.apiKey = $('#s-om').value.trim(); syncWorldPane();
      state.wx.mode = $('#s-wx-mode').value; wxSetMode(state.wx.mode);
      $('#s-wx').disabled = true; $('#s-skip').disabled = true;
      setStatus('#s-wx-msg', `Loading weather from Open-Meteo${state.wx.apiKey ? ' (customer servers)' : ''}…`);
      const res = await loadWeather(true);
      $('#s-wx').disabled = false; $('#s-skip').disabled = false;
      if (!res.ok) { setStatus('#s-wx-msg', res.msg, 'err'); return false; }
      saveScene();
      setStatus('#s-wx-msg', res.msg, 'ok'); setStep('#step-wx', 'done'); $('#sx-done').hidden = false;
      finishSetup(true);
      return true;
  }

  // ------------------------------------------------------------------ site config (published by the admin, read by every visitor)
  const STORE_ADMIN = 'arien-twin-admin-v1';
  let siteConfig = null;
  async function fetchSiteConfig() {
    if (!/^https?:$/.test(location.protocol)) return null;
    try { const r = await fetch('config.json', { cache: 'no-store' }); if (!r.ok) return null; const j = await r.json(); return j && j.version === 1 ? j : null; }
    catch (e) { return null; }
  }
  /** Apply the published config on top of anything stored locally */
  function applySiteConfig(c) {
    if (c.scene) applySnapshot({ v: 1, site: c.site, ...c.scene });
    else if (c.site) Object.assign(state.site, c.site);
    if (c.world) {
      if (c.world.src) state.world.src = c.world.src;
      if (c.world.ionToken) state.world.ion = c.world.ionToken;
      if (c.world.googleKey) state.world.google = c.world.googleKey;
    }
    if (c.weather) { if (c.weather.mode) state.wx.mode = c.weather.mode; if (c.weather.openMeteoKey) state.wx.apiKey = c.weather.openMeteoKey; }
  }
  function adminRepoGuess() {
    const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
    if (!m) return '';
    const first = location.pathname.split('/').filter(Boolean)[0];
    return first && !first.includes('.') ? `${m[1]}/${first}` : `${m[1]}/${m[1]}.github.io`;
  }
  function buildSiteConfig() {
    const c = { version: 1, updated: new Date().toISOString(), autoConnect: $('#ad-auto').checked,
      site: { name: state.site.name, lat: state.site.lat, lon: state.site.lon },
      world: { src: state.world.src }, weather: { mode: $('#ad-wx').value } };
    if ($('#ad-keys').checked) { if (state.world.ion) c.world.ionToken = state.world.ion; if (state.world.google) c.world.googleKey = state.world.google; }
    if ($('#ad-om').checked && state.wx.apiKey) c.weather.openMeteoKey = state.wx.apiKey;
    if ($('#ad-scene').checked) { const snap = sceneSnapshot(); delete snap.v; delete snap.site; delete snap.worldSrc; c.scene = snap; }
    return c;
  }
  const b64utf8 = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin); };
  async function publishSiteConfig() {
    const repo = $('#ad-repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    const branch = $('#ad-branch').value.trim() || 'main', token = $('#ad-token').value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { setStatus('#ad-status', 'Enter the repository as owner/name, for example madara/arien-twin.', 'err'); return; }
    if (!token) { setStatus('#ad-status', 'Paste a fine-grained GitHub token with Contents: Read and write on this repository.', 'err'); $('#ad-token').focus(); return; }
    saveAdminPrefs();
    const btn = $('#ad-publish'); btn.disabled = true; setStatus('#ad-status', 'Saving config.json to GitHub…');
    const api = `https://api.github.com/repos/${repo}/contents/config.json`;
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const fail = (msg) => { setStatus('#ad-status', msg, 'err'); btn.disabled = false; };
    try {
      let sha;
      const g = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers, cache: 'no-store' });
      if (g.status === 401) return fail('GitHub rejected the token. Check it was copied in full and has not expired.');
      if (g.status === 403) return fail('This token is not allowed to read the repository. Give it access to this repository with Contents: Read and write.');
      if (g.ok) sha = (await g.json()).sha;
      const body = JSON.stringify(buildSiteConfig(), null, 2) + '\n';
      const put = await fetch(api, { method: 'PUT', headers, body: JSON.stringify({ message: 'Update ARIEN twin site settings', content: b64utf8(body), branch, ...(sha ? { sha } : {}) }) });
      const j = await put.json().catch(() => ({}));
      if (put.status === 404) return fail(`Repository ${repo} (branch ${branch}) was not found, or the token cannot see it.`);
      if (put.status === 403 || put.status === 401) return fail('The token cannot write to this repository. It needs Contents: Read and write.');
      if (put.status === 409) return fail('The settings changed on GitHub while you were editing. Publish again.');
      if (!put.ok) return fail(`GitHub answered HTTP ${put.status}: ${j.message || 'unknown error'}.`);
      const link = j.commit && j.commit.html_url;
      $('#ad-status').className = 'status ok';
      $('#ad-status').innerHTML = `Published. Visitors get these settings within a few minutes (GitHub Pages caches pages for up to 10). ${link ? `<a href="${link}" target="_blank" rel="noopener">View the change on GitHub</a>.` : ''}`;
      renderAdminCurrent(buildSiteConfig());
    } catch (e) {
      fail('Could not reach api.github.com. ' + await diagnoseBlocked('api.github.com'));
    } finally { btn.disabled = false; }
  }
  function saveAdminPrefs() {
    try {
      const keep = { repo: $('#ad-repo').value.trim(), branch: $('#ad-branch').value.trim(), remember: $('#ad-remember').checked };
      if (keep.remember) keep.token = $('#ad-token').value.trim();
      localStorage.setItem(STORE_ADMIN, JSON.stringify(keep));
    } catch (e) { /* storage unavailable */ }
  }
  function renderAdminCurrent(c) {
    if (!c) { $('#ad-current').textContent = 'No settings have been published for this site yet.'; return; }
    const parts = [`${c.site ? c.site.name : 'site'}`, c.world ? worldLabelFor(c.world.src) : '', c.world && (c.world.ionToken || c.world.googleKey) ? 'key included' : 'no key',
      c.scene ? `${(c.scene.arrays || []).length} array(s), ${(c.scene.objects || []).length} obstacle(s)` : '', c.autoConnect ? 'connects automatically' : 'visitors connect themselves'];
    $('#ad-current').textContent = `Published settings: ${parts.filter(Boolean).join(' · ')}${c.updated ? ` · ${new Date(c.updated).toLocaleString()}` : ''}.`;
  }
  const worldLabelFor = (src) => ({ none: 'Map only', ion: 'Cesium ion terrain + OSM Buildings', google: 'Google Photorealistic 3D Tiles', 'google-ion': 'Google Photorealistic (via ion)' })[src] || '';
  function initAdmin() {
    let prefs = {}; try { prefs = JSON.parse(localStorage.getItem(STORE_ADMIN) || '{}') || {}; } catch (e) { /* ignore */ }
    $('#ad-repo').value = prefs.repo || adminRepoGuess(); $('#ad-branch').value = prefs.branch || 'main';
    $('#ad-token').value = prefs.token || ''; $('#ad-remember').checked = !!prefs.remember;
    if (siteConfig) { $('#ad-auto').checked = siteConfig.autoConnect !== false; if (siteConfig.weather && siteConfig.weather.mode) $('#ad-wx').value = siteConfig.weather.mode; }
    renderAdminCurrent(siteConfig);
    $('#ad-publish').addEventListener('click', publishSiteConfig);
    $('#ad-download').addEventListener('click', () => download('config.json', JSON.stringify(buildSiteConfig(), null, 2) + '\n', 'application/json'));
    $('#ad-remember').addEventListener('change', saveAdminPrefs);
    $('#w-admin').addEventListener('click', () => openDrawer('admin'));
    if (!/github\.io$/.test(location.hostname) && !siteConfig) $('#ad-current').textContent += ' Publishing works once the page is served from your GitHub Pages site; until then, use Download config.json.';
  }
  /** Visitors with a published config: run both connect steps on their own */
  async function autoConnect() {
    $('#s-src').value = state.world.src; $('#s-ion').value = state.world.ion; $('#s-google').value = state.world.google; $('#s-om').value = state.wx.apiKey || '';
    $('#s-wx-mode').value = state.wx.mode === 'current' ? 'current' : 'forecast'; syncSetupInputs();
    showSetupNote(`Opening ${state.site.name || 'the site'} with the settings your administrator published…`, 'info');
    if (!(await setupWorld())) { $('#setup-note').hidden = true; return; }
    if (!(await setupWeather())) return;
    $('#setup-note').hidden = true;
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    if (!window.Cesium) {
      await sleep(60);
      const emb = embeddedIn();
      const why = emb === 'claude' ? 'Claude’s file preview does not allow it to run. Download the file and open it in Chrome or Edge.'
        : cspBlocked.size || emb === 'frame' ? 'This viewer’s security policy does not allow it to run. Open the file directly in Chrome or Edge.'
        : 'It could not be downloaded from cdn.jsdelivr.net. Check your internet connection and reload.';
      showSetupNote('The 3D engine (CesiumJS) did not start. ' + why);
      $('#s-world').disabled = true; return;
    }
    const had = loadStored();
    siteConfig = await fetchSiteConfig();
    if (siteConfig) applySiteConfig(siteConfig);
    state.firstRun = !had && !(siteConfig && siteConfig.scene);
    if (!had && !(siteConfig && siteConfig.scene)) demoScene();
    $('#site-lat').value = state.site.lat.toFixed(6); $('#site-lon').value = state.site.lon.toFixed(6);
    wire(); initSetup(); initAdmin(); buildModelPane2(); renderSiteFacts();
    if (location.hash === '#admin') { const go = () => openDrawer('admin'); const iv = setInterval(() => { if ($('#boot').classList.contains('gone')) { clearInterval(iv); go(); } }, 400); }
    window.__arien = { state, viewer: () => viewer, runPeriod, simulateNow, traceSkyline, measuredAligned };
    const emb = embeddedIn();
    if (emb === 'claude') showSetupNote(PREVIEW_HINT);
    else if (emb === 'frame') showSetupNote('This page is running inside another page, which may block map and weather requests. If loading fails, open the file directly in Chrome or Edge.');
    const okWorkers = await workersUsable();
    if (!okWorkers) { showSetupNote('This viewer blocks the background threads the 3D engine needs, so the map cannot load here. Download the file and open it in Chrome or Edge.'); return; }
    if (siteConfig && siteConfig.autoConnect && location.hash !== '#setup') { autoConnect(); return; }
    $('#s-src').focus();
  }
  boot();
})();
