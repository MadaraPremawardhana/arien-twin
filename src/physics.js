/* ARIEN physics core — solar geometry, five irradiance pathways, thermal model,
 * cell-level shading geometry. Pure functions, no DOM. Works in browser (window.ArienPhysics)
 * and Node (module.exports) so it can be unit-tested.
 *
 * Sources (implemented from published literature, pending check against the thesis):
 *  - Solar geometry, E0, declination, equation of time: Spencer/Iqbal (1983) as listed in
 *    Bálint et al. (2019) HJIC 47(1) 57-63, eqs. 1, 4, 8, 14-17.
 *  - "Kasten German model": Bálint et al. (2019) eqs. 22-23 (after Kasten 1989), with
 *    slope transposition eqs. 25-28.
 *  - "Bálint Hungarian model": Bálint et al. (2019) eq. 21. Local constants a, b1, b2 are NOT
 *    published in the paper: defaults here are placeholders.
 *  - "Karamov–Naumov": Karamov (2017) uses Iqbal geometry + Kasten–Czeplak (1980) cloud model.
 *    Clear-sky term here is Kasten–Czeplak's 910·sinα − 30 (Karamov uses Iqbal's clear-sky model).
 *  - HDKR: Duffie & Beckman, Solar Engineering of Thermal Processes, eq. 2.16.7.
 *  - Real-World-GHI: API GHI/DNI/DHI with isotropic (Liu–Jordan) transposition.
 *  - Thermal: Bálint, Fodor, Magyar (2019) Acta Polytechnica Hungarica 16(7) eq. 9, solved exactly
 *    per step; convective coefficient h = 5.7 + 3.8·v (McAdams) is an assumption.
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const I0 = 1367; // W/m², solar constant (Bálint et al. 2019)

  // ---------- Solar geometry ----------
  function dayOfYearUTC(tMs) {
    const d = new Date(tMs);
    const start = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.floor((tMs - start) / 86400000) + 1;
  }
  function dayAngle(dn) { return 2 * Math.PI * (dn - 1) / 365; }
  function E0(dn) { // eq. 1
    const g = dayAngle(dn);
    return 1.000110 + 0.034221 * Math.cos(g) + 0.001280 * Math.sin(g) + 0.000719 * Math.cos(2 * g) + 0.000077 * Math.sin(2 * g);
  }
  function declination(dn) { // eq. 4, radians
    const g = dayAngle(dn);
    return 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
      + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  }
  function equationOfTime(dn) { // eq. 8, minutes
    const g = dayAngle(dn);
    return (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.04089 * Math.sin(2 * g)) * 229.18;
  }
  /** Sun position. az: radians clockwise from north; alt: radians above horizon. */
  function solarPosition(tMs, latDeg, lonDeg) {
    const dn = dayOfYearUTC(tMs);
    const d = new Date(tMs);
    const hUTC = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600 + d.getUTCMilliseconds() / 3.6e6;
    const decl = declination(dn), et = equationOfTime(dn);
    const solarTime = hUTC + lonDeg / 15 + et / 60;
    const omega = 15 * (solarTime - 12) * D2R; // hour angle, + afternoon
    const phi = latDeg * D2R;
    const sinAlt = Math.sin(decl) * Math.sin(phi) + Math.cos(decl) * Math.cos(phi) * Math.cos(omega); // eq. 14
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const psi = Math.atan2(Math.sin(omega), Math.cos(omega) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)); // from south, + west
    let az = psi + Math.PI; if (az >= 2 * Math.PI) az -= 2 * Math.PI;
    const e0 = E0(dn);
    return { alt, az, zen: Math.PI / 2 - alt, decl, eqTime: et, E0: e0, In: I0 * e0, omega };
  }
  /** Relative path length through atmosphere, Bálint et al. eqs. 19-20 */
  function airPathZ(alt) {
    const r = 6370, R = 6470;
    const s = Math.sin(alt);
    const l = -r * s + Math.sqrt(r * r * s * s + R * R - r * r);
    return l / (R - r);
  }
  /** Sun direction vector in local East-North-Up */
  function sunVectorENU(alt, az) {
    const c = Math.cos(alt);
    return [c * Math.sin(az), c * Math.cos(az), Math.sin(alt)];
  }
  /** Mean extraterrestrial horizontal irradiance over (t-1h, t], sampled */
  function meanExtraterrestrialHorizontal(tEndMs, lat, lon, minutes = 60, samples = 12) {
    let s = 0;
    for (let i = 0; i < samples; i++) {
      const t = tEndMs - (i + 0.5) * minutes * 60000 / samples;
      const sp = solarPosition(t, lat, lon);
      s += Math.max(0, sp.In * Math.sin(sp.alt));
    }
    return s / samples;
  }

  // ---------- Panel geometry helpers ----------
  /** Panel normal in ENU. tilt from horizontal, azimuth = direction panel faces (clockwise from N). */
  function panelNormal(tiltRad, azRad) {
    return [Math.sin(tiltRad) * Math.sin(azRad), Math.sin(tiltRad) * Math.cos(azRad), Math.cos(tiltRad)];
  }
  function cosIncidence(sunVec, normal) { return sunVec[0] * normal[0] + sunVec[1] * normal[1] + sunVec[2] * normal[2]; }

  // ---------- Irradiance models ----------
  const DEFAULT_PARAMS = {
    kasten: { Ad: 0.7, Bd: 0.027, ad: 0.72, bd: 3.2, q: 0.93, Tm: 3.0 },
    balint: { a: -30, b1: -0.75, b2: 3.4 },
    karamov: { c1: 910, c2: 30, k1: 0.75, k2: 3.4, d0: 0.3, d1: 0.7 },
    common: { albedo: 0.2, minAltDeg: 1 }
  };

  function kastenHorizontal(sun, N, p) {
    const s = Math.sin(sun.alt);
    if (s <= 0) return { ghi: 0, bh: 0, dh: 0 };
    const z = airPathZ(sun.alt);
    const G = sun.In * s * p.Ad * Math.exp(-p.Bd * p.Tm * z) * (1 - p.ad * Math.pow(N, p.bd));
    const S = sun.In * s * p.Ad * Math.pow(p.q, p.Tm * z) * (1 - Math.pow(N, p.bd));
    const g = Math.max(0, G), b = Math.max(0, Math.min(S, g));
    return { ghi: g, bh: b, dh: g - b };
  }

  /** Bálint-style slope transposition (eqs. 25-28): beam scaled by sin(α_surf)/sin(α), isotropic diffuse, no ground term */
  function transposeBalint(h, sun, sunVec, normal, tilt, minAlt) {
    const ci = cosIncidence(sunVec, normal);
    const s = Math.sin(sun.alt);
    const beam = (sun.alt > minAlt && ci > 0 && s > 0) ? h.bh * ci / s : 0;
    return { beam, diffuse: h.dh * (1 + Math.cos(tilt)) / 2, ground: 0, cosInc: ci };
  }
  function transposeIsotropic(h, sun, sunVec, normal, tilt, minAlt, albedo) {
    const ci = cosIncidence(sunVec, normal);
    const s = Math.sin(sun.alt);
    const beam = (sun.alt > minAlt && ci > 0 && s > 0) ? h.bh * ci / s : 0;
    return { beam, diffuse: h.dh * (1 + Math.cos(tilt)) / 2, ground: h.ghi * albedo * (1 - Math.cos(tilt)) / 2, cosInc: ci };
  }
  function transposeHDKR(h, sun, sunVec, normal, tilt, minAlt, albedo) {
    const ci = cosIncidence(sunVec, normal);
    const s = Math.sin(sun.alt);
    if (h.ghi <= 0) return { beam: 0, diffuse: 0, ground: 0, cosInc: ci };
    const Gon = sun.In * Math.max(s, 0);
    const Ai = (Gon > 0) ? Math.min(1, h.bh / Gon) : 0;
    const f = Math.sqrt(Math.max(0, h.bh / h.ghi));
    const Rb = (sun.alt > minAlt && s > 0) ? Math.max(0, ci) / s : 0;
    const beam = (h.bh + h.dh * Ai) * Rb;                       // beam + circumsolar
    const diffuse = h.dh * (1 - Ai) * ((1 + Math.cos(tilt)) / 2) * (1 + f * Math.pow(Math.sin(tilt / 2), 3)); // isotropic + horizon brightening
    return { beam, diffuse, ground: h.ghi * albedo * (1 - Math.cos(tilt)) / 2, cosInc: ci };
  }

  /**
   * MODELS[key].horizontal(ctx, params) -> {ghi, bh, dh} on a horizontal plane
   * MODELS[key].transpose(...) -> {beam, diffuse, ground}; 'beam' is what cell shading blocks.
   * ctx: { sun, N (cloud 0-1), api: {ghi, dhi, dni} instantaneous estimates }
   */
  const MODELS = {
    kasten: {
      label: 'Kasten (German)', short: 'Kasten', input: 'cloud cover',
      horizontal(ctx, P) { return kastenHorizontal(ctx.sun, ctx.N, P.kasten); },
      transpose(h, ctx, n, tilt, P) { return transposeBalint(h, ctx.sun, ctx.sunVec, n, tilt, P.common.minAltDeg * D2R); }
    },
    balint: {
      label: 'Bálint et al. (Hungarian)', short: 'Bálint', input: 'cloud cover', placeholder: true,
      horizontal(ctx, P) {
        const s = Math.sin(ctx.sun.alt);
        if (s <= 0) return { ghi: 0, bh: 0, dh: 0 };
        const p = P.balint;
        const G = Math.max(0, (ctx.sun.In * s + p.a) * (1 + p.b1 * Math.pow(ctx.N, p.b2)));
        // Paper gives G only; split with the shared Kasten direct formula (eq. 23) ratio.
        const k = kastenHorizontal(ctx.sun, ctx.N, P.kasten);
        const ratio = k.ghi > 0 ? k.bh / k.ghi : 0;
        return { ghi: G, bh: G * ratio, dh: G * (1 - ratio) };
      },
      transpose(h, ctx, n, tilt, P) { return transposeBalint(h, ctx.sun, ctx.sunVec, n, tilt, P.common.minAltDeg * D2R); }
    },
    karamov: {
      label: 'Karamov–Naumov', short: 'K–N', input: 'cloud cover', placeholder: true,
      horizontal(ctx, P) {
        const s = Math.sin(ctx.sun.alt);
        if (s <= 0) return { ghi: 0, bh: 0, dh: 0 };
        const p = P.karamov;
        const Gcs = Math.max(0, p.c1 * s - p.c2);
        const G = Gcs * (1 - p.k1 * Math.pow(ctx.N, p.k2));
        const D = G * Math.min(1, p.d0 + p.d1 * ctx.N * ctx.N);
        return { ghi: G, bh: G - D, dh: D };
      },
      transpose(h, ctx, n, tilt, P) { return transposeIsotropic(h, ctx.sun, ctx.sunVec, n, tilt, P.common.minAltDeg * D2R, P.common.albedo); }
    },
    hdkr: {
      label: 'Hay–Davies–Klucher–Reindl', short: 'HDKR', input: 'API GHI + DHI',
      horizontal(ctx) {
        const g = Math.max(0, ctx.api.ghi), d = Math.max(0, Math.min(ctx.api.dhi, g));
        return { ghi: g, bh: g - d, dh: d };
      },
      transpose(h, ctx, n, tilt, P) { return transposeHDKR(h, ctx.sun, ctx.sunVec, n, tilt, P.common.minAltDeg * D2R, P.common.albedo); }
    },
    rwghi: {
      label: 'Real-World GHI', short: 'RW-GHI', input: 'API GHI + DNI + DHI',
      horizontal(ctx) {
        const g = Math.max(0, ctx.api.ghi), d = Math.max(0, Math.min(ctx.api.dhi, g));
        return { ghi: g, bh: g - d, dh: d };
      },
      transpose(h, ctx, n, tilt, P) { return transposeIsotropic(h, ctx.sun, ctx.sunVec, n, tilt, P.common.minAltDeg * D2R, P.common.albedo); }
    }
  };
  const MODEL_KEYS = ['kasten', 'balint', 'rwghi', 'karamov', 'hdkr'];

  /** Seasonal selection rule (thesis): summer → RW-GHI, autumn/winter → K–N, spring → HDKR */
  function seasonalModel(tMs, latDeg) {
    let m = new Date(tMs).getUTCMonth(); // 0-11
    if (latDeg < 0) m = (m + 6) % 12;
    if (m >= 5 && m <= 7) return 'rwghi';
    if (m >= 2 && m <= 4) return 'hdkr';
    return 'karamov';
  }

  // ---------- Thermal model (Bálint, Fodor, Magyar 2019, eq. 9) ----------
  function convectiveCoeff(wind) { return 5.7 + 3.8 * Math.max(0, wind); } // W/m²K, assumption
  function efficiency(etaRef, gammaPerC, T) { return Math.max(0, etaRef * (1 + gammaPerC * (T - 25))); }
  /** One exact step of dT/dt = [(1-η)G - 2h(T-Ta)]/Ca with η, h frozen over the step */
  function thermalStep(Tprev, Tair, G, wind, eta, dtSec, Ca) {
    const h = convectiveCoeff(wind);
    const Teq = Tair + (1 - eta) * G / (2 * h);
    if (!isFinite(Tprev)) return Teq;
    const k = Math.exp(-2 * h * Math.max(0, dtSec) / Ca);
    return Teq + (Tprev - Teq) * k;
  }
  function thermalEquilibrium(Tair, G, wind, etaRef, gamma) {
    let T = Tair;
    for (let i = 0; i < 6; i++) { const eta = efficiency(etaRef, gamma, T); T = Tair + (1 - eta) * G / (2 * convectiveCoeff(wind)); }
    return T;
  }

  // ---------- Ray casting primitives (all in site ENU metres) ----------
  /** Ray vs axis-aligned unit shapes, ray already transformed to object unit space. Returns t>eps or Infinity */
  function rayBox(o, d, min, max) {
    let t0 = -Infinity, t1 = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-12) { if (o[i] < min[i] || o[i] > max[i]) return Infinity; continue; }
      let a = (min[i] - o[i]) / d[i], b = (max[i] - o[i]) / d[i];
      if (a > b) { const tmp = a; a = b; b = tmp; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) return Infinity;
    }
    if (t1 < 1e-6) return Infinity;
    return t0 > 1e-6 ? t0 : t1;
  }
  function raySphere(o, d, c, r) { // ellipsoid handled by caller scaling into sphere space
    const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
    const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const B = 2 * (ox * d[0] + oy * d[1] + oz * d[2]);
    const C = ox * ox + oy * oy + oz * oz - r * r;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return Infinity;
    const sq = Math.sqrt(disc);
    const ta = (-B - sq) / (2 * A), tb = (-B + sq) / (2 * A);
    if (ta > 1e-6) return ta; if (tb > 1e-6) return tb; return Infinity;
  }
  function rayEllipsoid(o, d, c, rad) {
    const so = [(o[0] - c[0]) / rad[0], (o[1] - c[1]) / rad[1], (o[2] - c[2]) / rad[2]];
    const sd = [d[0] / rad[0], d[1] / rad[1], d[2] / rad[2]];
    return raySphere(so, sd, [0, 0, 0], 1);
  }
  /** Vertical finite cylinder, axis through (cx,cy), z in [z0,z1] */
  function rayCylinder(o, d, cx, cy, r, z0, z1) {
    const ox = o[0] - cx, oy = o[1] - cy;
    const A = d[0] * d[0] + d[1] * d[1];
    let best = Infinity;
    if (A > 1e-12) {
      const B = 2 * (ox * d[0] + oy * d[1]);
      const C = ox * ox + oy * oy - r * r;
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
          if (t > 1e-6) { const z = o[2] + t * d[2]; if (z >= z0 && z <= z1 && t < best) best = t; }
        }
      }
    }
    if (Math.abs(d[2]) > 1e-12) { // caps
      for (const zc of [z0, z1]) {
        const t = (zc - o[2]) / d[2];
        if (t > 1e-6 && t < best) { const x = ox + t * d[0], y = oy + t * d[1]; if (x * x + y * y <= r * r) best = t; }
      }
    }
    return best;
  }
  /** Vertical cone: base radius rb at z=zb, apex at z=za (za>zb), axis (cx,cy) */
  function rayCone(o, d, cx, cy, rb, zb, za) {
    const H = za - zb, k = rb / H; // radius at height z: k*(za - z)
    const ox = o[0] - cx, oy = o[1] - cy, oz = za - o[2];
    // x²+y² = k²(za - z)² ; z = o.z + t d.z => (za - z) = oz - t d.z
    const A = d[0] * d[0] + d[1] * d[1] - k * k * d[2] * d[2];
    const B = 2 * (ox * d[0] + oy * d[1] + k * k * oz * d[2]);
    const C = ox * ox + oy * oy - k * k * oz * oz;
    let best = Infinity;
    const test = (t) => { if (t > 1e-6 && t < best) { const z = o[2] + t * d[2]; if (z >= zb && z <= za) best = t; } };
    if (Math.abs(A) > 1e-12) {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) { const sq = Math.sqrt(disc); test((-B - sq) / (2 * A)); test((-B + sq) / (2 * A)); }
    } else if (Math.abs(B) > 1e-12) test(-C / B);
    if (Math.abs(d[2]) > 1e-12) { const t = (zb - o[2]) / d[2]; if (t > 1e-6 && t < best) { const x = ox + t * d[0], y = oy + t * d[1]; if (x * x + y * y <= rb * rb) best = t; } }
    return best;
  }
  /** Ray vs rectangle given centre, unit axes u,v and half sizes */
  function rayRect(o, d, c, u, v, n, hu, hv) {
    const denom = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    if (Math.abs(denom) < 1e-9) return Infinity;
    const t = ((c[0] - o[0]) * n[0] + (c[1] - o[1]) * n[1] + (c[2] - o[2]) * n[2]) / denom;
    if (t <= 1e-4) return Infinity;
    const px = o[0] + t * d[0] - c[0], py = o[1] + t * d[1] - c[1], pz = o[2] + t * d[2] - c[2];
    const a = px * u[0] + py * u[1] + pz * u[2], b = px * v[0] + py * v[1] + pz * v[2];
    return (Math.abs(a) <= hu && Math.abs(b) <= hv) ? t : Infinity;
  }

  // ---------- Object library (unit-space proxies) ----------
  /** Each type: unit shapes in a 1×1×1 box (x,y in [-0.5,0.5], z in [0,1]); scaled by dims [sx, sy, sz] */
  const OBJECT_TYPES = {
    tree: { label: 'Broadleaf tree', category: 'foliage', dims: { length: 6, width: 6, height: 9 }, dimLabels: ['Canopy diameter', null, 'Height'], porous: true,
      parts: [{ kind: 'cyl', r: 0.05, z0: 0, z1: 0.42, porous: false }, { kind: 'ell', c: [0, 0, 0.62], r: [0.5, 0.5, 0.38], porous: true }] },
    conifer: { label: 'Conifer', category: 'foliage', dims: { length: 4.5, width: 4.5, height: 12 }, dimLabels: ['Canopy diameter', null, 'Height'], porous: true,
      parts: [{ kind: 'cyl', r: 0.06, z0: 0, z1: 0.15, porous: false }, { kind: 'cone', rb: 0.5, zb: 0.12, za: 1, porous: true }] },
    hedge: { label: 'Hedge', category: 'foliage', dims: { length: 6, width: 1.2, height: 2 }, dimLabels: ['Length', 'Width', 'Height'], porous: true,
      parts: [{ kind: 'box', porous: true }] },
    wall: { label: 'Wall / parapet', category: 'obstacle', dims: { length: 8, width: 0.3, height: 1.2 }, dimLabels: ['Length', 'Thickness', 'Height'],
      parts: [{ kind: 'box' }] },
    chimney: { label: 'Chimney / vent', category: 'obstacle', dims: { length: 0.7, width: 0.7, height: 1.5 }, dimLabels: ['Length', 'Width', 'Height'],
      parts: [{ kind: 'box' }] },
    building: { label: 'Building block', category: 'building', dims: { length: 12, width: 8, height: 7 }, dimLabels: ['Length', 'Width', 'Height'],
      parts: [{ kind: 'box' }] },
    pole: { label: 'Pole / mast', category: 'obstacle', dims: { length: 0.3, width: 0.3, height: 9 }, dimLabels: ['Diameter', null, 'Height'],
      parts: [{ kind: 'cyl', r: 0.5, z0: 0, z1: 1 }] },
    // drawn on the ground with floors and a roof (see buildingShape); `custom` = traced against its own triangles
    house: { label: 'Building', category: 'building', dims: { length: 10, width: 8, height: 8 }, dimLabels: ['Length', 'Width', null], custom: true, parts: [] }
  };
  /** Object groups, in the order the library shows them */
  const CATEGORIES = [{ key: 'obstacle', label: 'Obstacles' }, { key: 'foliage', label: 'Foliage' }, { key: 'building', label: 'Buildings' }];

  /** Transform world ray into object unit space. obj: {x,y,z,heading(deg), dims:{length,width,height}} */
  function toUnitSpace(obj, o, d) {
    const h = -obj.heading * D2R; // ENU rotation is clockwise heading → inverse rotation
    const c = Math.cos(-h), s = Math.sin(-h);
    const ox = o[0] - obj.x, oy = o[1] - obj.y, oz = o[2] - obj.z;
    const sx = obj.dims.length, sy = obj.dims.width ?? obj.dims.length, sz = obj.dims.height;
    return {
      o: [(c * ox - s * oy) / sx, (s * ox + c * oy) / sy, oz / sz],
      d: [(c * d[0] - s * d[1]) / sx, (s * d[0] + c * d[1]) / sy, d[2] / sz]
    };
  }
  /**
   * Line trace from point o along unit direction d against one obstacle (like a trace by channel against
   * its collision shapes). Returns null if nothing is hit, else {t: distance to the first hit (m),
   * trans: light passing the object, 0 = opaque, the object's transparency where only its canopy is hit}.
   */
  function objectTrace(obj, o, d) {
    const type = OBJECT_TYPES[obj.type]; if (!type) return null;
    if (type.custom) {
      const hx = obj.dims.length / 2, hy = obj.dims.width / 2, hz = obj.dims.height / 2;
      if (raySphere(o, d, [obj.x, obj.y, obj.z + hz], Math.sqrt(hx * hx + hy * hy + hz * hz) + 0.01) === Infinity) return null;
      return buildingTrace(obj, o, d);
    }
    // quick bounding-sphere reject in world space
    const hx = obj.dims.length / 2, hy = (obj.dims.width ?? obj.dims.length) / 2, hz = obj.dims.height / 2;
    const br = Math.sqrt(hx * hx + hy * hy + hz * hz);
    if (raySphere(o, d, [obj.x, obj.y, obj.z + hz], br) === Infinity) return null;
    const u = toUnitSpace(obj, o, d);
    let trans = 1, tMin = Infinity;
    for (const p of type.parts) {
      let t = Infinity;
      if (p.kind === 'box') t = rayBox(u.o, u.d, [-0.5, -0.5, 0], [0.5, 0.5, 1]);
      else if (p.kind === 'ell') t = rayEllipsoid(u.o, u.d, p.c, p.r);
      else if (p.kind === 'cyl') t = rayCylinder(u.o, u.d, 0, 0, p.r, p.z0, p.z1);
      else if (p.kind === 'cone') t = rayCone(u.o, u.d, 0, 0, p.rb, p.zb, p.za);
      if (t !== Infinity) {
        // the unit-space transform is linear, so t is also the world distance along d
        const por = (p.porous && type.porous) ? Math.max(0, Math.min(1, obj.porosity || 0)) : 0;
        trans = Math.min(trans, por); tMin = Math.min(tMin, t);
      }
    }
    return tMin === Infinity ? null : { t: tMin, trans };
  }
  /** Transmission along a ray through one obstacle: 1 = clear, its transparency through a canopy, 0 opaque */
  function objectTransmission(obj, o, d) { const r = objectTrace(obj, o, d); return r ? r.trans : 1; }

  // ---------- Drawn buildings: footprint + floors + roof ----------
  // A 'house' object carries a footprint polygon `poly` ([[x, y], …], metres, counter-clockwise) in the object's own
  // frame (x along `heading`, centred on the object), plus floors, floorHeight, roof, pitch and ridge. The walls rise to
  // the eaves (floors × floorHeight) and the roof is the lowest of a few planes over the footprint's bounding box, so
  // the same exact triangles drive both the shading traces and the 3D model.
  const ROOF_TYPES = { flat: 'Flat', gable: 'Gable', hip: 'Hip', shed: 'Mono-pitch' };
  const ROOF_PITCH = { flat: 0, gable: 35, hip: 30, shed: 15 };
  const BUILDING_DEFAULTS = { floors: 2, floorHeight: 2.8, roof: 'gable', ridge: 'long' };
  const clampN = (v, lo, hi, def) => { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; };
  function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return a / 2; }
  function segCross(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
  }
  /** True when two edges of a closed polygon cross */
  function selfIntersects(p) {
    const n = p.length;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
    }
    return false;
  }
  /** Drop repeated, closing and straight-through points */
  function cleanPoly(pts, tol = 0.05) {
    let p = pts.map(q => [q[0], q[1]]).filter((q, i, a) => i === 0 || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > tol);
    while (p.length > 1 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) <= tol) p.pop();
    let changed = true;
    while (changed && p.length > 3) {
      changed = false;
      for (let i = 0; i < p.length; i++) {
        const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
        const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (Math.abs(cr) < 1e-3 * Math.max(1, Math.hypot(c[0] - a[0], c[1] - a[1]))) { p.splice(i, 1); changed = true; break; }
      }
    }
    return p;
  }
  /** Ear clipping for a simple counter-clockwise polygon → index triples */
  function triangulate(p) {
    const idx = p.map((_, i) => i), out = [];
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (q, a, b, c) => cross(a, b, q) >= -1e-12 && cross(b, c, q) >= -1e-12 && cross(c, a, q) >= -1e-12;
    let guard = 0;
    while (idx.length > 3 && guard++ < 10000) {
      let cut = false;
      for (let k = 0; k < idx.length; k++) {
        const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
        const a = p[i0], b = p[i1], c = p[i2];
        if (cross(a, b, c) <= 1e-12) continue;
        let ok = true;
        for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; if (inside(p[j], a, b, c)) { ok = false; break; } }
        if (!ok) continue;
        out.push([i0, i1, i2]); idx.splice(k, 1); cut = true; break;
      }
      if (!cut) break; // degenerate input: stop rather than loop
    }
    if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
    return out;
  }
  /** Building settings with defaults and limits applied */
  function buildingSpec(o) {
    const roof = ROOF_TYPES[o.roof] ? o.roof : BUILDING_DEFAULTS.roof;
    return {
      floors: Math.round(clampN(o.floors, 1, 60, BUILDING_DEFAULTS.floors)),
      floorHeight: clampN(o.floorHeight, 2, 6, BUILDING_DEFAULTS.floorHeight),
      roof, pitch: roof === 'flat' ? 0 : clampN(o.pitch, 5, 60, ROOF_PITCH[roof]),
      ridge: o.ridge === 'short' ? 'short' : 'long'
    };
  }
  /** The roof's planes (height above the eaves = a·x + b·y + c, the roof is their minimum) for a footprint */
  function roofPlanes(poly, spec) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const k = Math.tan(spec.pitch * D2R), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hxL = (x1 - x0) / 2, hyL = (y1 - y0) / 2;
    // the ridge runs along x when x is the long side (and the ridge is "along the long side"), else along y
    const alongX = (hxL >= hyL) === (spec.ridge === 'long');
    // plane rising towards the line w = centre: k·(H − |w − cw|) split into two planes
    const across = alongX ? [[0, -k, k * (hyL + cy)], [0, k, k * (hyL - cy)]] : [[-k, 0, k * (hxL + cx)], [k, 0, k * (hxL - cx)]];
    const along = alongX ? [[-k, 0, k * (hxL + cx)], [k, 0, k * (hxL - cx)]] : [[0, -k, k * (hyL + cy)], [0, k, k * (hyL - cy)]];
    if (spec.roof === 'flat' || k === 0) return [[0, 0, 0]];
    if (spec.roof === 'gable') return across;
    if (spec.roof === 'hip') return across.concat(along);
    // mono-pitch: low along one long edge, rising across the building
    return alongX ? [[0, k, k * (hyL - cy)]] : [[k, 0, k * (hxL - cx)]];
  }
  const planeAt = (P, x, y) => P[0] * x + P[1] * y + P[2];
  /** Clip a convex polygon to the side where the linear function g(x, y) = a·x + b·y + c ≥ 0 */
  function clipHalf(poly, a, b, c) {
    const out = [], g = (q) => a * q[0] + b * q[1] + c;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], gp = g(p), gq = g(q);
      if (gp >= 0) out.push(p);
      if ((gp >= 0) !== (gq >= 0)) { const t = gp / (gp - gq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
    }
    return out;
  }
  const shapeCache = new WeakMap();
  /**
   * Walls and roof of a drawn building, in its own frame (z = 0 at its base): {eaves, top, spec,
   * walls: [{a, b, tops: [[x, y, z]…]}], tris: [[ax, ay, az, bx, …, cz]] (walls + roof, for traces),
   * roof: triangles of the roof, gables: triangles of the walls above the eaves, footTris (ground plan)}.
   */
  function buildingShape(o) {
    const spec = buildingSpec(o), poly = o.poly || [];
    const sig = JSON.stringify([poly, spec]);
    const hit = shapeCache.get(o); if (hit && hit.sig === sig) return hit.shape;
    const eaves = spec.floors * spec.floorHeight, P = roofPlanes(poly, spec);
    const roofH = (x, y) => { let m = Infinity; for (const q of P) m = Math.min(m, planeAt(q, x, y)); return Math.max(0, m); };
    const foot = triangulate(poly), roof = [], gables = [], walls = [], tris = [];
    let top = eaves;
    // roof: each ground triangle cut into the parts where each plane is the lowest
    for (const [i, j, k] of foot) {
      for (let a = 0; a < P.length; a++) {
        let piece = [poly[i], poly[j], poly[k]];
        for (let b = 0; b < P.length && piece.length >= 3; b++) if (b !== a) piece = clipHalf(piece, P[b][0] - P[a][0], P[b][1] - P[a][1], P[b][2] - P[a][2]);
        if (piece.length < 3) continue;
        const lift = piece.map(([x, y]) => { const z = eaves + Math.max(0, planeAt(P[a], x, y)); top = Math.max(top, z); return [x, y, z]; });
        for (let m = 1; m + 1 < lift.length; m++) {
          const A = lift[0], B = lift[m], C = lift[m + 1];
          if (Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])) < 1e-9) continue;
          roof.push([A, B, C]);
        }
      }
    }
    // walls: each edge rises to the roof line above it, broken where the lowest plane changes
    for (let e = 0; e < poly.length; e++) {
      const a = poly[e], b = poly[(e + 1) % poly.length], ts = [0, 1];
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const fa = planeAt(P[i], ...a) - planeAt(P[j], ...a), fb = planeAt(P[i], ...b) - planeAt(P[j], ...b);
        if ((fa > 0) !== (fb > 0) && Math.abs(fa - fb) > 1e-12) ts.push(fa / (fa - fb));
      }
      // where a plane drops to the eaves (mono-pitch low side is exactly 0) nothing more is needed
      ts.sort((p, q) => p - q);
      const tops = [];
      for (const t of ts) { if (tops.length && t - tops[tops.length - 1].t < 1e-6) continue; const x = a[0] + t * (b[0] - a[0]), y = a[1] + t * (b[1] - a[1]); tops.push({ t, p: [x, y, eaves + roofH(x, y)] }); }
      walls.push({ a, b, tops: tops.map(q => q.p) });
      for (let m = 0; m + 1 < tops.length; m++) {
        const p = tops[m].p, q = tops[m + 1].p, A0 = [p[0], p[1], 0], B0 = [q[0], q[1], 0];
        tris.push([A0, B0, q], [A0, q, p]);
        // the part above the eaves (gable ends, mono-pitch side walls)
        const pe = [p[0], p[1], eaves], qe = [q[0], q[1], eaves];
        if (q[2] - eaves > 1e-6 || p[2] - eaves > 1e-6) { gables.push([pe, qe, q]); if (p[2] - eaves > 1e-6) gables.push([pe, q, p]); }
      }
    }
    for (const t of roof) tris.push(t);
    const shape = { eaves, top, spec, planes: P, walls, roof, gables, footTris: foot.map(([i, j, k]) => [poly[i], poly[j], poly[k]]), tris: tris.map(t => [].concat(...t)) };
    shapeCache.set(o, { sig, shape });
    return shape;
  }
  /** Möller–Trumbore against a flat triangle list; returns the nearest positive distance */
  function rayTris(o, d, tris) {
    let best = Infinity;
    for (const T of tris) {
      const e1x = T[3] - T[0], e1y = T[4] - T[1], e1z = T[5] - T[2], e2x = T[6] - T[0], e2y = T[7] - T[1], e2z = T[8] - T[2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, sx = o[0] - T[0], sy = o[1] - T[1], sz = o[2] - T[2];
      const u = (sx * px + sy * py + sz * pz) * inv; if (u < -1e-9 || u > 1 + 1e-9) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t > 1e-6 && t < best) best = t;
    }
    return best;
  }
  function buildingTrace(obj, o, d) {
    if (!obj.poly || obj.poly.length < 3) return null;
    const sh = buildingShape(obj);
    const c = Math.cos(obj.heading * D2R), s = Math.sin(obj.heading * D2R);
    const ox = o[0] - obj.x, oy = o[1] - obj.y;
    const lo = [c * ox - s * oy, s * ox + c * oy, o[2] - obj.z], ld = [c * d[0] - s * d[1], s * d[0] + c * d[1], d[2]];
    const t = rayTris(lo, ld, sh.tris);
    return t === Infinity ? null : { t, trans: 0 };
  }
  /** Re-centre the footprint on its bounding box and set dims (length, width, height to the top of the roof) */
  function syncBuilding(o) {
    const spec = buildingSpec(o); Object.assign(o, spec);
    let p = o.poly || [];
    if (p.length >= 3 && polyArea(p) < 0) p = p.slice().reverse();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (p.length >= 3) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (Math.abs(cx) > 1e-6 || Math.abs(cy) > 1e-6) {
        const c = Math.cos(o.heading * D2R), s = Math.sin(o.heading * D2R);
        o.x += c * cx + s * cy; o.y += -s * cx + c * cy;
        p = p.map(([x, y]) => [x - cx, y - cy]);
      }
    }
    o.poly = p.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
    const sh = buildingShape(o);
    o.dims = { length: x1 - x0, width: y1 - y0, height: sh.top };
    o.porosity = 0;
    return o;
  }
  /** Stretch a drawn building's footprint to a new length and width (metres) */
  function scaleBuilding(o, length, width) {
    const sx = length / (o.dims.length || 1), sy = width / (o.dims.width || 1);
    o.poly = o.poly.map(([x, y]) => [x * sx, y * sy]);
    return syncBuilding(o);
  }
  /**
   * A building from an outline drawn on the ground: world points [[x, y], …] (ENU metres, either winding).
   * Its heading follows the smallest rectangle around the outline, with the long side as its length.
   * Returns the building's fields {x, y, heading, poly, …settings}, or {error} when the outline is unusable.
   */
  function buildingFromOutline(pts, opts = {}) {
    const p = cleanPoly(pts);
    if (p.length < 3) return { error: 'Draw at least three corners.' };
    if (selfIntersects(p)) return { error: 'The outline crosses itself. Draw the corners in order around the building.' };
    const area = Math.abs(polyArea(p));
    if (area < 4) return { error: 'The floor area is too small (under 4 m²).' };
    // convex hull → the smallest bounding rectangle has one side on a hull edge
    const s = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of s) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = s.length - 1; i >= 0; i--) { const q = s[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
    let best = null;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 1e-6) continue;
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const q of hull) { const u = q[0] * ux + q[1] * uy, v = -q[0] * uy + q[1] * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const A = (u1 - u0) * (v1 - v0);
      if (!best || A < best.A - 1e-6) best = { A, ux, uy, u0, u1, v0, v1 };
    }
    let { ux, uy } = best; const cu = (best.u0 + best.u1) / 2, cv = (best.v0 + best.v1) / 2;
    const cx = cu * ux - cv * uy, cy = cu * uy + cv * ux;
    if (best.u1 - best.u0 < best.v1 - best.v0) { const t = ux; ux = -uy; uy = t; } // long side along x
    // local x in world is (cos h, −sin h): h = atan2(−uy, ux); keep it in [0, 180) as a rectangle reads the same both ways
    let heading = Math.atan2(-uy, ux) * R2D; heading = ((heading % 180) + 180) % 180;
    const c = Math.cos(heading * D2R), sn = Math.sin(heading * D2R);
    let poly = p.map(([x, y]) => { const dx = x - cx, dy = y - cy; return [c * dx - sn * dy, sn * dx + c * dy]; });
    if (polyArea(poly) < 0) poly.reverse();
    const o = Object.assign({ x: cx, y: cy, heading: Math.round(heading * 100) / 100, poly }, BUILDING_DEFAULTS, opts);
    if (o.pitch == null) o.pitch = ROOF_PITCH[ROOF_TYPES[o.roof] ? o.roof : 'gable'];
    syncBuilding(o);
    return o;
  }
  /** World outline ([[x, y], …] ENU metres) of a drawn building, or null for other objects */
  function footprintWorld(o) {
    if (!o || !o.poly || o.poly.length < 3) return null;
    const c = Math.cos(o.heading * D2R), s = Math.sin(o.heading * D2R);
    return o.poly.map(([x, y]) => [o.x + c * x + s * y, o.y - s * x + c * y]);
  }
  /** Short name of an object for lists and labels */
  function objectLabel(o) {
    const T = OBJECT_TYPES[o && o.type]; if (!T) return 'Object';
    if (o.type !== 'house') return T.label;
    const sp = buildingSpec(o);
    return `Building · ${sp.floors} floor${sp.floors === 1 ? '' : 's'}, ${ROOF_TYPES[sp.roof].toLowerCase()} roof`;
  }

  // ---------- Panel arrays → cells ----------
  /**
   * array: { x,y,z (anchor at mount base, ENU m), azimuth (deg, facing), tilt (deg), rows, cols,
   *          panelW, panelL, colGap, rowPitch, mountHeight, cellsX, cellsY }
   * returns panels: [{ c, u, v, n, hu, hv, cells:[{p}], area }]
   */
  function buildArrayGeometry(a) {
    const az = a.azimuth * D2R, tilt = a.tilt * D2R;
    const f = [Math.sin(az), Math.cos(az), 0];           // facing (horizontal)
    const u = [Math.cos(az), -Math.sin(az), 0];          // along row (panel width)
    const v = [-f[0] * Math.cos(tilt), -f[1] * Math.cos(tilt), Math.sin(tilt)]; // up-slope (panel length)
    const n = panelNormal(tilt, az);
    const panels = [];
    const pitchU = a.panelW + a.colGap;
    for (let r = 0; r < a.rows; r++) {
      for (let c = 0; c < a.cols; c++) {
        const du = (c - (a.cols - 1) / 2) * pitchU;
        const dr = (r - (a.rows - 1) / 2) * a.rowPitch;
        const cz = a.z + a.mountHeight + (a.panelL / 2) * Math.sin(tilt);
        const center = [a.x + u[0] * du - f[0] * dr, a.y + u[1] * du - f[1] * dr, cz];
        const cells = [];
        for (let j = 0; j < a.cellsY; j++) for (let i = 0; i < a.cellsX; i++) {
          const su = ((i + 0.5) / a.cellsX - 0.5) * a.panelW, sv = ((j + 0.5) / a.cellsY - 0.5) * a.panelL;
          cells.push({ p: [center[0] + u[0] * su + v[0] * sv, center[1] + u[1] * su + v[1] * sv, center[2] + u[2] * su + v[2] * sv], i, j });
        }
        panels.push({ c: center, u, v, n, hu: a.panelW / 2, hv: a.panelL / 2, cw: a.panelW / a.cellsX, ch: a.panelL / a.cellsY, cells, area: a.panelW * a.panelL, row: r, col: c });
      }
    }
    return { panels, u, v, n, f, tilt, az };
  }

  // Hit codes from a cell's line trace
  const HIT = { CLEAR: -1, PANEL: -2, TILES: -3, AWAY: -4 };
  /**
   * Line trace from every cell toward the sun, by channel (the browser version of the thesis's per-cell
   * LineTraceByChannel). Channels: other panels (opaque), placed obstacles (opaque, or their transparency
   * where only a canopy is crossed; several canopies multiply), 3D tiles (traced skyline per panel).
   * opts: {channels: {panels, objects, tiles} (all on), samples: 1 = cell centre as in the thesis, 2 = 2×2
   * rays per cell so a cell can be partly covered, detail: also return what each ray hit, offset (m)}.
   * Returns per array {trans: Float32Array 0..1, hit: Int16Array (object index ≥ 0 or a HIT code),
   * dist: Float32Array (m to the first hit, Infinity if clear)}; trans/hit/dist follow panels[].cells order.
   */
  function traceCells(geoms, objects, sunVec, sun, horizonFn, opts = {}) {
    const offset = opts.offset ?? 0.02, ch = { panels: true, objects: true, tiles: true, ...(opts.channels || {}) };
    const ns = Math.max(1, Math.min(3, opts.samples | 0 || 1)), detail = !!opts.detail;
    const allPanels = [];
    geoms.forEach((g, gi) => g.panels.forEach((p, pi) => allPanels.push({ p, gi, pi })));
    const out = geoms.map(g => {
      const n = g.panels.reduce((s, p) => s + p.cells.length, 0);
      return { trans: new Float32Array(n), hit: detail ? new Int16Array(n).fill(HIT.AWAY) : null, dist: detail ? new Float32Array(n).fill(Infinity) : null };
    });
    if (sun.alt <= 0) return out;
    const subs = [];
    for (let a = 0; a < ns; a++) for (let b = 0; b < ns; b++) subs.push([(a + 0.5) / ns - 0.5, (b + 0.5) / ns - 0.5]);
    geoms.forEach((g, gi) => {
      let k = 0;
      const R = out[gi];
      g.panels.forEach((panel, pi) => {
        const ci = cosIncidence(sunVec, panel.n);
        if (ci <= 0) { k += panel.cells.length; return; }
        const tilesBlocked = ch.tiles && horizonFn ? horizonFn(gi, pi, sun.az, sun.alt) : false;
        // candidates within the corridor toward the sun
        const cand = [];
        if (ch.panels) for (const q of allPanels) {
          if (q.p === panel) continue;
          const dx = q.p.c[0] - panel.c[0], dy = q.p.c[1] - panel.c[1], dz = q.p.c[2] - panel.c[2];
          const along = dx * sunVec[0] + dy * sunVec[1] + dz * sunVec[2];
          if (along <= -1) continue;
          const px = dx - along * sunVec[0], py = dy - along * sunVec[1], pz = dz - along * sunVec[2];
          if (Math.sqrt(px * px + py * py + pz * pz) <= Math.hypot(panel.hu, panel.hv) + Math.hypot(q.p.hu, q.p.hv) + 0.05) cand.push(q.p);
        }
        const candObj = [];
        if (ch.objects) objects.forEach((o, oi) => {
          const hz = o.dims.height / 2;
          const dx = o.x - panel.c[0], dy = o.y - panel.c[1], dz = o.z + hz - panel.c[2];
          const along = dx * sunVec[0] + dy * sunVec[1] + dz * sunVec[2];
          const br = Math.hypot(o.dims.length / 2, (o.dims.width ?? o.dims.length) / 2, hz) + Math.hypot(panel.hu, panel.hv);
          if (along < -br) return;
          const px = dx - along * sunVec[0], py = dy - along * sunVec[1], pz = dz - along * sunVec[2];
          if (Math.hypot(px, py, pz) <= br) candObj.push(oi);
        });
        const cu = panel.cw || panel.hu * 2, cv = panel.ch || panel.hv * 2; // cell size for the sub-rays
        for (const cell of panel.cells) {
          if (tilesBlocked) { R.trans[k] = 0; if (detail) { R.hit[k] = HIT.TILES; R.dist[k] = Infinity; } k++; continue; }
          let sumT = 0, bestHit = HIT.CLEAR, bestD = Infinity, bestLoss = 0;
          for (const [su, sv] of subs) {
            const ox = cell.p[0] + panel.n[0] * offset + (ns > 1 ? panel.u[0] * su * cu + panel.v[0] * sv * cv : 0);
            const oy = cell.p[1] + panel.n[1] * offset + (ns > 1 ? panel.u[1] * su * cu + panel.v[1] * sv * cv : 0);
            const oz = cell.p[2] + panel.n[2] * offset + (ns > 1 ? panel.u[2] * su * cu + panel.v[2] * sv * cv : 0);
            const o = [ox, oy, oz];
            let tr = 1, hit = HIT.CLEAR, dist = Infinity;
            for (const q of cand) { const t = rayRect(o, sunVec, q.c, q.u, q.v, q.n, q.hu, q.hv); if (t !== Infinity) { tr = 0; hit = HIT.PANEL; dist = Math.min(dist, t); if (!detail) break; } }
            if (tr > 0 || detail) {
              let nearest = Infinity, nearestObj = -1;
              for (const oi of candObj) {
                const r = objectTrace(objects[oi], o, sunVec); if (!r) continue;
                if (hit !== HIT.PANEL) tr *= r.trans;
                if (r.t < nearest) { nearest = r.t; nearestObj = oi; }
                if (tr === 0 && !detail) break;
              }
              if (hit !== HIT.PANEL && nearestObj >= 0) { hit = nearestObj; dist = nearest; }
            }
            sumT += tr;
            if (detail && 1 - tr > bestLoss) { bestLoss = 1 - tr; bestHit = hit; bestD = dist; }
          }
          R.trans[k] = sumT / subs.length;
          if (detail) { R.hit[k] = bestLoss > 0 ? bestHit : HIT.CLEAR; R.dist[k] = bestLoss > 0 ? bestD : Infinity; }
          k++;
        }
      });
    });
    return out;
  }
  /** Beam transmission per cell (0..1) for each array: the trace without hit details */
  function shadeCells(geoms, objects, sunVec, sun, horizonFn, opts = {}) {
    return traceCells(geoms, objects, sunVec, sun, horizonFn, { ...opts, detail: false }).map(r => r.trans);
  }
  /**
   * Who takes the beam: weights per cause from detailed traces. Each cell counts its lost fraction × cell area
   * × cos(incidence), so the weights split a power loss in proportion to blocked beam. Returns Map(code → weight)
   * where code is an object index (≥ 0), HIT.PANEL or HIT.TILES; plus the total.
   */
  function shadeAttribution(geoms, traces, sunVec) {
    const by = new Map(); let total = 0;
    geoms.forEach((g, gi) => {
      const R = traces[gi]; if (!R || !R.hit) return; let k = 0;
      g.panels.forEach(p => {
        const w0 = Math.max(0, cosIncidence(sunVec, p.n)) * p.area / p.cells.length;
        for (let c = 0; c < p.cells.length; c++, k++) {
          const lost = 1 - R.trans[k], h = R.hit[k];
          if (lost <= 0 || h === HIT.CLEAR || h === HIT.AWAY || w0 <= 0) continue;
          const w = lost * w0; by.set(h, (by.get(h) || 0) + w); total += w;
        }
      });
    });
    return { by, total };
  }

  /** Horizon profile lookup: profile = Float32Array of obstruction elevation (rad) per azimuth bin */
  function horizonBlocked(profile, azRad, altRad) {
    if (!profile) return false;
    const nb = profile.length, step = 2 * Math.PI / nb;
    const x = azRad / step, i0 = Math.floor(x) % nb, i1 = (i0 + 1) % nb, fr = x - Math.floor(x);
    const h = profile[i0] * (1 - fr) + profile[i1] * fr;
    return altRad < h;
  }

  // ---------- Evaluation metrics (thesis uses RMSE, MAE, R², Theil's U2) ----------
  function metrics(pred, obs, minObs = 1e-3) {
    let n = 0, se = 0, ae = 0, so = 0, sp = 0;
    for (let i = 0; i < obs.length; i++) { if (!isFinite(pred[i]) || !isFinite(obs[i])) continue; n++; const e = pred[i] - obs[i]; se += e * e; ae += Math.abs(e); so += obs[i]; sp += pred[i]; }
    if (!n) return null;
    const mean = so / n; let st = 0;
    for (let i = 0; i < obs.length; i++) { if (!isFinite(pred[i]) || !isFinite(obs[i])) continue; st += (obs[i] - mean) ** 2; }
    let un = 0, ud = 0;
    for (let i = 0; i < obs.length - 1; i++) {
      const a0 = obs[i], a1 = obs[i + 1], f1 = pred[i + 1];
      if (!(a0 > minObs) || !isFinite(a1) || !isFinite(f1)) continue;
      un += ((f1 - a1) / a0) ** 2; ud += ((a1 - a0) / a0) ** 2;
    }
    return { n, rmse: Math.sqrt(se / n), mae: ae / n, r2: st > 0 ? 1 - se / st : NaN, u2: ud > 0 ? Math.sqrt(un) / Math.sqrt(ud) : NaN, bias: (sp - so) / n };
  }

  const api = {
    D2R, R2D, I0, dayOfYearUTC, E0, declination, equationOfTime, solarPosition, airPathZ, sunVectorENU,
    meanExtraterrestrialHorizontal, panelNormal, cosIncidence, DEFAULT_PARAMS, MODELS, MODEL_KEYS, seasonalModel,
    kastenHorizontal, transposeHDKR, transposeIsotropic, transposeBalint,
    convectiveCoeff, efficiency, thermalStep, thermalEquilibrium,
    rayBox, raySphere, rayEllipsoid, rayCylinder, rayCone, rayRect, OBJECT_TYPES, objectTransmission, objectTrace,
    CATEGORIES, ROOF_TYPES, ROOF_PITCH, BUILDING_DEFAULTS, buildingSpec, buildingShape, syncBuilding, scaleBuilding, buildingFromOutline, footprintWorld, objectLabel, triangulate, polyArea,
    buildArrayGeometry, shadeCells, traceCells, shadeAttribution, HIT, horizonBlocked, metrics
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArienPhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);
