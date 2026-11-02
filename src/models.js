/* ARIEN obstacle models — procedural three.js geometry exported as glTF, three levels of detail.
 *
 * Every model is built at its real size in metres (the same length/width/height the shading
 * physics uses), so it matches the 3D tiles one-to-one. Geometry is authored in local
 * East-North-Up (x east, y north, z up) and converted to glTF's Y-up axes on export; Cesium's
 * own axis correction maps it back so local x points east at heading 0, like the physics proxy.
 *
 * LOD 0: close-up (bark, branches, leaf and needle cards, brick and facade textures)
 * LOD 1: mid distance (simpler shapes, same textures)
 * LOD 2: far (a few dozen triangles, flat colours)
 */
(function (root) {
  'use strict';
  const T = () => root.THREE;

  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // ------------------------------------------------------------------ canvas textures
  const texCache = {};
  function canvasTex(key, w, h, draw, alpha) {
    if (texCache[key]) return texCache[key];
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); draw(g, w, h, rng(key.length * 7919 + w));
    const t = new (T().CanvasTexture)(c);
    t.wrapS = t.wrapT = T().RepeatWrapping; t.encoding = T().sRGBEncoding; t.name = key;
    if (alpha) t.premultiplyAlpha = false;
    texCache[key] = t; return t;
  }
  function speckle(g, w, h, r, n, cols, a = 0.35) {
    for (let i = 0; i < n; i++) { g.globalAlpha = a * r(); g.fillStyle = cols[Math.floor(r() * cols.length)]; const s = 1 + r() * 2.5; g.fillRect(r() * w, r() * h, s, s); }
    g.globalAlpha = 1;
  }
  const TEX = {
    bark: () => canvasTex('bark', 256, 512, (g, w, h, r) => {
      g.fillStyle = '#5a4433'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) { g.strokeStyle = ['#4a3727', '#6e5640', '#3d2e22', '#7a634c'][i % 4]; g.globalAlpha = 0.35 + r() * 0.5; g.lineWidth = 1 + r() * 3; const x = r() * w; g.beginPath(); g.moveTo(x, r() * h); g.lineTo(x + (r() - 0.5) * 8, r() * h); g.stroke(); }
      g.globalAlpha = 0.8; g.strokeStyle = '#241a12';
      for (let i = 0; i < 26; i++) { let x = r() * w, y = 0; g.lineWidth = 1 + r() * 2.5; g.beginPath(); g.moveTo(x, y); while (y < h) { y += 12 + r() * 30; x += (r() - 0.5) * 10; g.lineTo(x, y); } g.stroke(); }
      g.globalAlpha = 1; speckle(g, w, h, r, 900, ['#2b2018', '#8a735b'], 0.4);
    }),
    leaves: () => canvasTex('leaves', 256, 256, (g, w, h, r) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(70,52,30,0.9)'; g.lineWidth = 2;
      for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + (r() - 0.5) * w * 0.8, h / 2 + (r() - 0.5) * h * 0.8); g.stroke(); }
      for (let i = 0; i < 70; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * w * 0.42, x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d;
        const L = 9 + r() * 12, W = L * (0.45 + r() * 0.15);
        g.save(); g.translate(x, y); g.rotate(r() * Math.PI * 2);
        const hue = 88 + r() * 32, sat = 32 + r() * 22, lig = 22 + r() * 20;
        g.fillStyle = `hsl(${hue},${sat}%,${lig}%)`;
        g.beginPath(); g.ellipse(0, 0, L, W, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = `hsla(${hue},${sat}%,${lig + 14}%,0.7)`; g.lineWidth = 1; g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
        g.restore();
      }
    }, true),
    needles: () => canvasTex('needles', 256, 128, (g, w, h, r) => {
      g.clearRect(0, 0, w, h);
      for (let b = 0; b < 3; b++) {
        const y0 = h * (0.3 + b * 0.2); g.strokeStyle = '#4b3a28'; g.lineWidth = 2.5;
        g.beginPath(); g.moveTo(0, y0); g.lineTo(w, y0 + (r() - 0.5) * 10); g.stroke();
        for (let x = 4; x < w; x += 3) {
          for (const s of [-1, 1]) {
            g.strokeStyle = `hsl(${120 + r() * 25},${30 + r() * 20}%,${16 + r() * 14}%)`; g.lineWidth = 1.4;
            g.beginPath(); g.moveTo(x, y0); g.lineTo(x + 6 + r() * 6, y0 + s * (10 + r() * 14)); g.stroke();
          }
        }
      }
    }, true),
    brick: () => canvasTex('brick', 512, 340, (g, w, h, r) => { // tile = 0.9 m × 0.6 m: 4 bricks × 8 courses
      g.fillStyle = '#b9b0a2'; g.fillRect(0, 0, w, h);
      const bw = w / 4, bh = h / 8, m = 4;
      for (let row = 0; row < 8; row++) for (let i = -1; i < 5; i++) {
        const x = i * bw + (row % 2 ? bw / 2 : 0), y = row * bh;
        const l = 26 + r() * 12, s = 45 + r() * 15, hue = 8 + r() * 12;
        g.fillStyle = `hsl(${hue},${s}%,${l}%)`; g.fillRect(x + m / 2, y + m / 2, bw - m, bh - m);
      }
      speckle(g, w, h, r, 2500, ['#3a1f17', '#c98a6a', '#6b3424'], 0.35);
    }),
    stone: () => canvasTex('stone', 256, 128, (g, w, h, r) => { g.fillStyle = '#a19c92'; g.fillRect(0, 0, w, h); speckle(g, w, h, r, 2200, ['#6f6a62', '#c9c4ba', '#8a857c'], 0.5); g.fillStyle = '#7f7a71'; g.fillRect(w / 2 - 1, 0, 2, h); }),
    concrete: () => canvasTex('concrete', 256, 256, (g, w, h, r) => { g.fillStyle = '#b8b5ae'; g.fillRect(0, 0, w, h); speckle(g, w, h, r, 3000, ['#8e8b84', '#d4d1ca', '#a29f98'], 0.45); }),
    roof: () => canvasTex('roof', 256, 256, (g, w, h, r) => { g.fillStyle = '#3c3f43'; g.fillRect(0, 0, w, h); speckle(g, w, h, r, 4000, ['#25272a', '#585c61', '#4a4d52'], 0.6); }),
    facade: () => canvasTex('facade', 512, 512, (g, w, h, r) => { // tile = 3 m × 3 m: one window per storey bay
      const px = w / 3; g.fillStyle = '#cdc6b8'; g.fillRect(0, 0, w, h); speckle(g, w, h, r, 3500, ['#a9a294', '#e2dccf'], 0.4);
      const ww = 1.4 * px, wh = 1.6 * px, x0 = (w - ww) / 2, y0 = h - (0.9 * px + wh);
      g.fillStyle = '#e9e7e2'; g.fillRect(x0 - 8, y0 - 8, ww + 16, wh + 16);
      const grad = g.createLinearGradient(x0, y0, x0 + ww, y0 + wh); grad.addColorStop(0, '#6d8597'); grad.addColorStop(0.55, '#2f4252'); grad.addColorStop(1, '#4b6273');
      g.fillStyle = grad; g.fillRect(x0, y0, ww, wh);
      g.fillStyle = '#e9e7e2'; g.fillRect(x0 + ww / 2 - 3, y0, 6, wh); g.fillRect(x0, y0 + wh * 0.38, ww, 6);
      g.fillStyle = '#9c968a'; g.fillRect(x0 - 14, y0 + wh + 8, ww + 28, 10);
    }),
    wood: () => canvasTex('wood', 128, 512, (g, w, h, r) => {
      g.fillStyle = '#6f5238'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) { g.strokeStyle = r() > 0.5 ? '#5a412b' : '#86654a'; g.globalAlpha = 0.5; g.lineWidth = 1 + r() * 2; const x = r() * w; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 5, h / 3, x - 5, 2 * h / 3, x + (r() - 0.5) * 6, h); g.stroke(); }
      g.globalAlpha = 1;
    }),
    terracotta: () => canvasTex('terracotta', 128, 128, (g, w, h, r) => { g.fillStyle = '#a5573a'; g.fillRect(0, 0, w, h); speckle(g, w, h, r, 800, ['#7d3d26', '#c47a5a'], 0.5); }),
    lead: () => canvasTex('lead', 128, 128, (g, w, h, r) => { g.fillStyle = '#717a83'; g.fillRect(0, 0, w, h); speckle(g, w, h, r, 900, ['#596169', '#8d969e'], 0.5); })
  };

  // ------------------------------------------------------------------ materials
  const matCache = {};
  function material(key) {
    if (matCache[key]) return matCache[key];
    const M = T().MeshStandardMaterial, S = T().DoubleSide;
    const defs = {
      bark: () => new M({ map: TEX.bark(), roughness: 0.95, vertexColors: true }),
      leaf: () => new M({ map: TEX.leaves(), roughness: 0.8, alphaTest: 0.45, transparent: false, side: S, vertexColors: true }),
      needle: () => new M({ map: TEX.needles(), roughness: 0.85, alphaTest: 0.4, side: S, vertexColors: true }),
      foliage: () => new M({ color: 0xffffff, roughness: 0.9, vertexColors: true, flatShading: true }),
      brick: () => new M({ map: TEX.brick(), roughness: 0.92, vertexColors: true }),
      stone: () => new M({ map: TEX.stone(), roughness: 0.9, vertexColors: true }),
      concrete: () => new M({ map: TEX.concrete(), roughness: 0.92, vertexColors: true }),
      roof: () => new M({ map: TEX.roof(), roughness: 0.95, vertexColors: true }),
      facade: () => new M({ map: TEX.facade(), roughness: 0.75, vertexColors: true }),
      wood: () => new M({ map: TEX.wood(), roughness: 0.9, vertexColors: true }),
      terracotta: () => new M({ map: TEX.terracotta(), roughness: 0.85, vertexColors: true }),
      lead: () => new M({ map: TEX.lead(), roughness: 0.6, metalness: 0.2, vertexColors: true }),
      ceramic: () => new M({ color: 0xf2efe6, roughness: 0.35, vertexColors: true }),
      flat: () => new M({ color: 0xffffff, roughness: 0.9, vertexColors: true })
    };
    matCache[key] = defs[key](); matCache[key].name = key; return matCache[key];
  }

  // ------------------------------------------------------------------ geometry builder (ENU, merged per material)
  class Builder {
    constructor() { this.parts = {}; }
    part(key) { return this.parts[key] || (this.parts[key] = { p: [], n: [], uv: [], c: [] }); }
    tri(key, a, b, c, na, nb, nc, ua, ub, uc, col) {
      const P = this.part(key);
      P.p.push(...a, ...b, ...c); P.n.push(...na, ...nb, ...nc); P.uv.push(...ua, ...ub, ...uc);
      for (let i = 0; i < 3; i++) P.c.push(col[0], col[1], col[2]);
    }
    quad(key, a, b, c, d, n, uvs, col) { // a-b-c-d counter-clockwise seen from the normal side
      this.tri(key, a, b, c, n, n, n, uvs[0], uvs[1], uvs[2], col); this.tri(key, a, c, d, n, n, n, uvs[0], uvs[2], uvs[3], col);
    }
    /** Axis-aligned box with texture tiled in metres (tu × tv per tile) */
    box(key, min, max, col, tu = 1, tv = 1) {
      const [x0, y0, z0] = min, [x1, y1, z1] = max;
      const U = (a, b) => [a / tu, b / tv];
      this.quad(key, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [U(x0, z0), U(x1, z0), U(x1, z1), U(x0, z1)], col); // south
      this.quad(key, [x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0], [U(-x1, z0), U(-x0, z0), U(-x0, z1), U(-x1, z1)], col); // north
      this.quad(key, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], [U(y0, z0), U(y1, z0), U(y1, z1), U(y0, z1)], col); // east
      this.quad(key, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0], [U(-y1, z0), U(-y0, z0), U(-y0, z1), U(-y1, z1)], col); // west
      this.quad(key, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [U(x0, y0), U(x1, y0), U(x1, y1), U(x0, y1)], col); // top
      this.quad(key, [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1], [U(x0, y1), U(x1, y1), U(x1, y0), U(x0, y0)], col); // bottom
    }
    /** Frustum (cylinder/cone) along an arbitrary axis from p0 to p1 */
    tube(key, p0, p1, r0, r1, seg, col, tu = 1, tv = 1, cap = true) {
      const V = T().Vector3, d = new V(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]); const len = d.length(); d.normalize();
      const q = new (T().Quaternion)().setFromUnitVectors(new V(0, 0, 1), d);
      const tr = (x, y, z) => { const v = new V(x, y, z).applyQuaternion(q); return [v.x + p0[0], v.y + p0[1], v.z + p0[2]]; };
      const rn = (x, y, z) => { const v = new V(x, y, z).applyQuaternion(q).normalize(); return [v.x, v.y, v.z]; };
      const slope = (r0 - r1) / len;
      for (let i = 0; i < seg; i++) {
        const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        const A = tr(c0 * r0, s0 * r0, 0), B = tr(c1 * r0, s1 * r0, 0), C = tr(c1 * r1, s1 * r1, len), D = tr(c0 * r1, s0 * r1, len);
        const nA = rn(c0, s0, slope), nB = rn(c1, s1, slope);
        const u0 = a0 * Math.max(r0, 0.02) / tu, u1 = a1 * Math.max(r0, 0.02) / tu;
        this.tri(key, A, B, C, nA, nB, nB, [u0, 0], [u1, 0], [u1, len / tv], col);
        if (r1 > 1e-4) this.tri(key, A, C, D, nA, nB, nA, [u0, 0], [u1, len / tv], [u0, len / tv], col);
        if (cap && r1 > 1e-4) { const top = tr(0, 0, len); this.tri(key, D, C, top, rn(0, 0, 1), rn(0, 0, 1), rn(0, 0, 1), [0, 0], [0.1, 0], [0.05, 0.1], col); }
      }
    }
    /** Lumpy foliage blob (icosahedron) — untextured, coloured per vertex */
    blob(key, c, rx, ry, rz, detail, col, r, jitter = 0.18) {
      let g = new (T().IcosahedronGeometry)(1, detail); if (g.index) g = g.toNonIndexed(); const p = g.attributes.position;
      const pts = []; const cache = new Map();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
        if (!cache.has(k)) cache.set(k, 1 + (r() - 0.5) * 2 * jitter);
        const f = cache.get(k); pts.push([c[0] + x * rx * f, c[1] + y * ry * f, c[2] + z * rz * f]);
      }
      for (let i = 0; i < pts.length; i += 3) {
        const a = pts[i], b = pts[i + 1], d = pts[i + 2];
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(...n) || 1; n = n.map(v => v / l);
        const shade = 0.82 + 0.18 * n[2]; const cc = [col[0] * shade, col[1] * shade, col[2] * shade];
        this.tri(key, a, b, d, n, n, n, [0, 0], [0, 0], [0, 0], cc);
      }
    }
    /** Square alpha card centred at c, spanning vectors ax, ay (half sizes included) */
    card(key, c, ax, ay, col) {
      const a = [c[0] - ax[0] - ay[0], c[1] - ax[1] - ay[1], c[2] - ax[2] - ay[2]], b = [c[0] + ax[0] - ay[0], c[1] + ax[1] - ay[1], c[2] + ax[2] - ay[2]];
      const d = [c[0] + ax[0] + ay[0], c[1] + ax[1] + ay[1], c[2] + ax[2] + ay[2]], e = [c[0] - ax[0] + ay[0], c[1] - ax[1] + ay[1], c[2] - ax[2] + ay[2]];
      let n = [ax[1] * ay[2] - ax[2] * ay[1], ax[2] * ay[0] - ax[0] * ay[2], ax[0] * ay[1] - ax[1] * ay[0]]; const l = Math.hypot(...n) || 1; n = n.map(v => v / l);
      if (n[2] < 0) n = n.map(v => -v);
      this.quad(key, a, b, d, e, n, [[0, 0], [1, 0], [1, 1], [0, 1]], col);
    }
    /** Scale the finished model so its outer bounds match the object's real dimensions
        (east-west length, north-south width, height above the ground) — what the shading uses */
    fit(L, Wd, H) {
      let ex = 0, ey = 0, ez = 0;
      for (const P of Object.values(this.parts)) for (let i = 0; i < P.p.length; i += 3) {
        ex = Math.max(ex, Math.abs(P.p[i])); ey = Math.max(ey, Math.abs(P.p[i + 1])); ez = Math.max(ez, P.p[i + 2]);
      }
      if (!(ex > 0 && ey > 0 && ez > 0)) return;
      const sx = L / 2 / ex, sy = Wd / 2 / ey, sz = H / ez;
      for (const P of Object.values(this.parts)) for (let i = 0; i < P.p.length; i += 3) {
        P.p[i] *= sx; P.p[i + 1] *= sy; P.p[i + 2] *= sz;
        const nx = P.n[i] / sx, ny = P.n[i + 1] / sy, nz = P.n[i + 2] / sz, l = Math.hypot(nx, ny, nz) || 1;
        P.n[i] = nx / l; P.n[i + 1] = ny / l; P.n[i + 2] = nz / l;
      }
    }
    /** Convert ENU → glTF (Y-up): three = (−north, up, −east) and build one mesh per material */
    toGroup() {
      const g = new (T().Group)();
      for (const [key, P] of Object.entries(this.parts)) {
        if (!P.p.length) continue;
        const pos = new Float32Array(P.p.length), nor = new Float32Array(P.n.length);
        for (let i = 0; i < P.p.length; i += 3) {
          pos[i] = -P.p[i + 1]; pos[i + 1] = P.p[i + 2]; pos[i + 2] = -P.p[i];
          nor[i] = -P.n[i + 1]; nor[i + 1] = P.n[i + 2]; nor[i + 2] = -P.n[i];
        }
        const geo = new (T().BufferGeometry)();
        geo.setAttribute('position', new (T().BufferAttribute)(pos, 3));
        geo.setAttribute('normal', new (T().BufferAttribute)(nor, 3));
        geo.setAttribute('uv', new (T().BufferAttribute)(new Float32Array(P.uv), 2));
        geo.setAttribute('color', new (T().BufferAttribute)(new Float32Array(P.c), 3));
        const mesh = new (T().Mesh)(geo, material(key)); mesh.name = key; g.add(mesh);
      }
      return g;
    }
  }

  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const W = [1, 1, 1];
  const vary = (r, base, amt = 0.12) => base.map(v => Math.max(0, Math.min(1, v * (1 + (r() - 0.5) * 2 * amt))));

  // ------------------------------------------------------------------ model recipes (metres)
  function tree(b, d, lod, r) {
    const H = d.height, Rx = d.length / 2, Ry = (d.width ?? d.length) / 2;
    const cz = 0.62 * H, rz = 0.38 * H, base = 0.42 * H;
    const tr0 = Math.min(0.5, Math.max(0.1, 0.028 * H)), tr1 = tr0 * 0.62;
    b.tube('bark', [0, 0, 0], [0, 0, base + 0.08 * H], tr0, tr1, lod === 0 ? 12 : 7, W, 0.6, 1.2);
    if (lod === 2) { b.blob('foliage', [0, 0, cz], Rx, Ry, rz, 1, hex('#3f6b2e'), r, 0.08); return; }
    if (lod === 1) {
      b.blob('foliage', [0, 0, cz], Rx * 0.86, Ry * 0.86, rz * 0.84, 1, hex('#3d672c'), r, 0.12);
      for (let i = 0; i < 12; i++) {
        const a = r() * Math.PI * 2, el = (r() - 0.35) * 1.2, rr = 0.62;
        const p = [Math.cos(a) * Math.cos(el) * Rx * rr, Math.sin(a) * Math.cos(el) * Ry * rr, cz + Math.sin(el) * rz * rr];
        b.blob('foliage', p, Rx * 0.36, Ry * 0.36, rz * 0.32, 1, vary(r, hex('#4b7a35'), 0.15), r, 0.2);
      }
      return;
    }
    // LOD 0: branches, leaf clusters and leaf cards
    b.tube('bark', [0, 0, base + 0.06 * H], [0, 0, cz + 0.55 * rz], tr1 * 0.8, 0.04, 8, W, 0.5, 1);
    const tips = [];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + r() * 0.5, z0 = base * (0.88 + r() * 0.12);
      const tip = [Math.cos(a) * Rx * 0.62, Math.sin(a) * Ry * 0.62, cz + (r() - 0.25) * rz * 0.6];
      b.tube('bark', [0, 0, z0], tip, tr1 * 0.55, 0.035, 7, W, 0.4, 1);
      for (let k = 0; k < 2; k++) {
        const f = 0.5 + r() * 0.2, s = [tip[0] * f, tip[1] * f, z0 + (tip[2] - z0) * f];
        const a2 = a + (k ? 0.7 : -0.7), t2 = [Math.cos(a2) * Rx * 0.82, Math.sin(a2) * Ry * 0.82, cz + (r() - 0.1) * rz * 0.7];
        b.tube('bark', s, t2, tr1 * 0.25, 0.02, 5, W, 0.3, 1); tips.push(t2);
      }
      tips.push(tip);
    }
    const mean = (Rx + Ry + rz) / 3;
    const N = Math.round(Math.min(110, 50 + mean * 6));
    for (let i = 0; i < N; i++) {
      const u = r() * 2 - 1, t = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const dir = [s * Math.cos(t), s * Math.sin(t), u];
      const rr = 0.55 + 0.42 * Math.sqrt(r());
      const p = i < tips.length ? tips[i] : [dir[0] * Rx * rr, dir[1] * Ry * rr, cz + dir[2] * rz * rr];
      const cr = mean * (0.15 + r() * 0.08);
      const light = 0.6 + 0.4 * (0.5 + 0.5 * dir[2]) * rr;
      const base = hex(['#3f6b2e', '#4b7a35', '#36602a', '#55843c'][i % 4]).map(v => v * light);
      b.blob('foliage', p, cr, cr, cr * 0.8, 1, base, r, 0.25);
      for (let k = 0; k < 3; k++) {
        const ang = r() * Math.PI, tilt = (r() - 0.5) * 1.6, sz = cr * 1.25;
        const ax = [Math.cos(ang) * sz, Math.sin(ang) * sz, 0], ay = [-Math.sin(ang) * Math.sin(tilt) * sz, Math.cos(ang) * Math.sin(tilt) * sz, Math.cos(tilt) * sz];
        const off = [dir[0] * cr * 0.6, dir[1] * cr * 0.6, dir[2] * cr * 0.6];
        b.card('leaf', [p[0] + off[0], p[1] + off[1], p[2] + off[2]], ax, ay, vary(r, [0.95, 1, 0.92], 0.12).map(v => v * (0.75 + 0.25 * light)));
      }
    }
  }
  function conifer(b, d, lod, r) {
    const H = d.height, R = d.length / 2;
    b.tube('bark', [0, 0, 0], [0, 0, H * (lod === 2 ? 0.15 : 0.96)], Math.max(0.08, 0.022 * H), 0.03, lod === 0 ? 9 : 6, W, 0.5, 1);
    if (lod === 2) { b.tube('foliage', [0, 0, 0.12 * H], [0, 0, H], R, 0, 10, hex('#2a5134'), 1, 1, false); return; }
    if (lod === 1) {
      const tiers = [[0.12, 0.54, 1], [0.42, 0.78, 0.76], [0.66, 1.0, 0.5]];
      tiers.forEach(([z0, z1, f], i) => b.tube('foliage', [0, 0, z0 * H], [0, 0, z1 * H], R * f, 0, 12, hex(['#2f5a3a', '#2a5134', '#24482e'][i]), 1, 1, false));
      return;
    }
    b.tube('foliage', [0, 0, 0.14 * H], [0, 0, H], R * 0.5, 0, 12, hex('#1f3d27'), 1, 1, false);
    const tiers = 15;
    for (let k = 0; k < tiers; k++) {
      const f = k / (tiers - 1), z = (0.13 + 0.84 * f) * H;
      const rad = R * Math.pow(1 - f, 0.9) + 0.12, m = Math.max(5, Math.round(10 - f * 4));
      for (let j = 0; j < m; j++) {
        const a = j / m * Math.PI * 2 + k * 0.45 + r() * 0.3, droop = 0.28 + r() * 0.15;
        const dir = [Math.cos(a), Math.sin(a)], L = rad * (0.85 + r() * 0.25);
        const c = [dir[0] * L / 2, dir[1] * L / 2, z - Math.tan(droop) * L / 2];
        const ax = [dir[0] * L / 2, dir[1] * L / 2, -Math.tan(droop) * L / 2];
        const wid = Math.max(0.25, L * 0.42);
        const col = vary(r, hex('#e8f2e4'), 0.1).map(v => v * (0.7 + 0.3 * f));
        b.card('needle', c, ax, [-dir[1] * wid / 2, dir[0] * wid / 2, 0], col);
        b.card('needle', c, ax, [0, 0, wid * 0.35], col);
      }
    }
  }
  function hedge(b, d, lod, r) {
    const L = d.length, Wd = d.width, H = d.height;
    if (lod === 2) { b.box('flat', [-L / 2, -Wd / 2, 0], [L / 2, Wd / 2, H], hex('#3d6630')); return; }
    b.box('flat', [-L / 2 * 0.96, -Wd / 2 * 0.9, 0], [L / 2 * 0.96, Wd / 2 * 0.9, H * 0.94], hex(lod === 0 ? '#2b4a23' : '#3d6630'));
    const n = Math.round(L / Math.max(0.4, Wd * 0.6));
    for (let i = 0; i < n; i++) b.blob('foliage', [-L / 2 + (i + 0.5) * L / n, (r() - 0.5) * Wd * 0.2, H * 0.86], L / n * 0.7, Wd * 0.55, H * 0.2, 1, vary(r, hex('#40692f'), 0.15), r, 0.2);
    if (lod === 1) return;
    const cards = Math.round(L * H * 5 + L * Wd * 4);
    for (let i = 0; i < cards; i++) {
      const side = r(); const sz = 0.28 + r() * 0.2; let c, ax, ay;
      if (side < 0.7) { const s = r() < 0.5 ? -1 : 1; c = [(r() - 0.5) * L * 0.98, s * Wd / 2 * (0.9 + r() * 0.15), sz + r() * (H * 0.95 - sz)]; ax = [sz, (r() - 0.5) * 0.2, 0]; ay = [0, (r() - 0.5) * 0.3, sz]; }
      else { c = [(r() - 0.5) * L * 0.98, (r() - 0.5) * Wd * 0.9, H * (0.92 + r() * 0.1)]; ax = [sz, 0, (r() - 0.5) * 0.2]; ay = [0, sz, (r() - 0.5) * 0.2]; }
      b.card('leaf', c, ax, ay, vary(r, [0.9, 1, 0.9], 0.12));
    }
  }
  function wall(b, d, lod) {
    const L = d.length, Wd = d.width, H = d.height;
    if (lod === 2) { b.box('flat', [-L / 2, -Wd / 2, 0], [L / 2, Wd / 2, H], hex('#a8836c')); return; }
    const cap = lod === 0 ? Math.min(0.08, H * 0.1) : 0;
    b.box('brick', [-L / 2, -Wd / 2, 0], [L / 2, Wd / 2, H - cap], W, 0.9, 0.6);
    if (cap) b.box('stone', [-L / 2 - 0.02, -Wd / 2 - 0.035, H - cap], [L / 2 + 0.02, Wd / 2 + 0.035, H], W, 0.6, 0.3);
  }
  function chimney(b, d, lod, r) {
    const L = d.length, Wd = d.width, H = d.height;
    if (lod === 2) { b.box('flat', [-L / 2, -Wd / 2, 0], [L / 2, Wd / 2, H], hex('#8a4b3a')); return; }
    const top = lod === 0 ? H - 0.32 : H - 0.1;
    b.box('brick', [-L / 2, -Wd / 2, 0], [L / 2, Wd / 2, top - 0.12], W, 0.9, 0.6);
    b.box('brick', [-L / 2 - 0.04, -Wd / 2 - 0.04, top - 0.12], [L / 2 + 0.04, Wd / 2 + 0.04, top - 0.04], W, 0.9, 0.6);
    b.box('concrete', [-L / 2 - 0.05, -Wd / 2 - 0.05, top - 0.04], [L / 2 + 0.05, Wd / 2 + 0.05, top], W, 0.5, 0.5);
    if (lod === 1) return;
    b.box('lead', [-L / 2 - 0.03, -Wd / 2 - 0.03, 0], [L / 2 + 0.03, Wd / 2 + 0.03, 0.14], W, 0.5, 0.5);
    const pots = L > 0.55 ? 2 : 1;
    for (let i = 0; i < pots; i++) {
      const x = pots === 1 ? 0 : (i ? L / 4 : -L / 4);
      b.tube('terracotta', [x, 0, top], [x, 0, H], 0.11, 0.085, 12, vary(r, W, 0.08), 0.4, 0.3);
    }
  }
  function building(b, d, lod) {
    const L = d.length, Wd = d.width, H = d.height;
    if (lod === 2) { b.box('flat', [-L / 2, -Wd / 2, 0], [L / 2, Wd / 2, H], hex('#c9c2b6')); return; }
    const par = lod === 0 ? Math.min(0.5, H * 0.08) : 0;
    b.box('facade', [-L / 2, -Wd / 2, 0], [L / 2, Wd / 2, H - par], W, 3, 3);
    b.box('roof', [-L / 2 + 0.01, -Wd / 2 + 0.01, H - par - 0.001], [L / 2 - 0.01, Wd / 2 - 0.01, H - par + 0.02], W, 2, 2);
    if (lod === 1) return;
    const t = 0.22;
    b.box('concrete', [-L / 2, -Wd / 2, H - par], [L / 2, -Wd / 2 + t, H], W, 1, 1);
    b.box('concrete', [-L / 2, Wd / 2 - t, H - par], [L / 2, Wd / 2, H], W, 1, 1);
    b.box('concrete', [-L / 2, -Wd / 2, H - par], [-L / 2 + t, Wd / 2, H], W, 1, 1);
    b.box('concrete', [L / 2 - t, -Wd / 2, H - par], [L / 2, Wd / 2, H], W, 1, 1);
    b.box('flat', [-0.55, -Wd / 2 - 0.04, 0], [0.55, -Wd / 2 + 0.02, 2.15], hex('#3b3430'));
  }
  function pole(b, d, lod) {
    const D = d.length, H = d.height;
    b.tube('wood', [0, 0, 0], [0, 0, H], D / 2, D / 2 * (lod === 2 ? 1 : 0.78), lod === 2 ? 6 : 12, W, 0.3, 1);
    if (lod === 2) return;
    const zc = H * 0.92;
    b.box('wood', [-0.8, -0.05, zc - 0.05], [0.8, 0.05, zc + 0.05], W, 0.3, 1);
    if (lod === 0) [-0.65, 0, 0.65].forEach(x => b.tube('ceramic', [x, 0, zc + 0.05], [x, 0, zc + 0.2], 0.035, 0.05, 10, W, 1, 1));
  }
  const RECIPES = { tree, conifer, hedge, wall, chimney, building, pole };
  const FIT = new Set(['tree', 'conifer', 'hedge']);

  function buildGroup(type, dims, lod) {
    const b = new Builder(); const r = rng(({ tree: 7, conifer: 11, hedge: 3, wall: 5, chimney: 9, building: 13, pole: 17 }[type] || 1) * 101 + lod);
    (RECIPES[type] || RECIPES.building)(b, dims, lod, r);
    // plants are irregular, so stretch each level to the exact size; built objects keep their real trims
    if (FIT.has(type)) b.fit(dims.length, dims.width ?? dims.length, dims.height);
    return b.toGroup();
  }
  function triangleCount(group) { let n = 0; group.traverse(o => { if (o.isMesh) n += o.geometry.attributes.position.count / 3; }); return n; }

  const glbCache = new Map();
  /** GLB blob URL for a type at real size and a level of detail (0 close, 2 far) */
  async function glbUrl(type, dims, lod) {
    const key = `${type}|${lod}|${dims.length.toFixed(2)}|${(dims.width ?? dims.length).toFixed(2)}|${dims.height.toFixed(2)}`;
    if (glbCache.has(key)) return glbCache.get(key);
    const p = (async () => {
      const group = buildGroup(type, dims, lod);
      const buf = await new Promise((res, rej) => new (T().GLTFExporter)().parse(group, res, rej, { binary: true, maxTextureSize: 1024 }));
      return URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
    })();
    glbCache.set(key, p);
    try { return await p; } catch (e) { glbCache.delete(key); throw e; }
  }
  const available = () => !!(root.THREE && root.THREE.GLTFExporter);

  root.ArienModels = { glbUrl, buildGroup, triangleCount, available, LODS: 3 };
})(typeof window !== 'undefined' ? window : globalThis);
