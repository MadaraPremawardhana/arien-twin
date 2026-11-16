// The hero globe: ARIEN's three.js Earth (src/globe: day/night shader and textures), lit by the real sun, with a
// marker and rings at the chosen place. Loaded only on the landing page when WebGL is available.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import earthVertexShader from '../globe/shaders/earth/vertex.glsl';
import earthFragmentShader from '../globe/shaders/earth/fragment.glsl';

const D2R = Math.PI / 180, RADIUS = 2, FOV = 25, START = { lat: 24, lng: -8 }, SPIN = 0.35;
const MARGIN = 1.22;                       // the canvas is this much larger than the globe's disc, for the glow and rings
const MARKER_DEG = 0.8, RING_DEG = 4, RING_MS = 1400, FLY_MS = 1500;
// camera distance at which the globe's disc is 1/MARGIN of the canvas height
const DISTANCE = RADIUS / Math.sin(Math.atan(Math.tan(FOV * D2R / 2) / MARGIN));

/** Where the sun is overhead right now */
export function subsolarPoint(date = new Date()) {
  const d = date.getTime() / 864e5 + 2440587.5 - 2451545, L = 280.46 + 0.9856474 * d, g = (357.528 + 0.9856003 * d) * D2R;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, eps = (23.439 - 4e-7 * d) * D2R;
  const lat = Math.asin(Math.sin(eps) * Math.sin(lambda)) / D2R, ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / D2R;
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  return { lat, lng: ((ra - gmst * 15 + 540) % 360 + 360) % 360 - 180 };
}
/** Unit vector for a latitude and longitude on three.js's SphereGeometry with an equirectangular texture (0°E on +X, 90°E on -Z) */
export function direction(lat, lng, out = new THREE.Vector3()) {
  const p = lat * D2R, l = lng * D2R;
  return out.set(Math.cos(p) * Math.cos(l), Math.sin(p), -Math.cos(p) * Math.sin(l));
}
const cssVar = (name, fallback) => getComputedStyle(document.querySelector('.st') || document.documentElement).getPropertyValue(name).trim() || fallback;

const ATMOSPHERE_VERTEX = `
  varying vec3 vNormal;
  void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ATMOSPHERE_FRAGMENT = `
  uniform vec3 uColor; varying vec3 vNormal;
  void main() {   // brightest against the globe's edge, fading to nothing at the outer edge of the shell
    float rim = min(1.0, pow(max(0.0, -dot(vNormal, vec3(0.0, 0.0, 1.0))) / 0.5, 2.6));
    gl_FragColor = vec4(uColor, 1.0) * rim * 0.85;
  }`;

export function heroGlobe(stage, { day, night, onReady } = {}) {
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const inner = document.createElement('div'); inner.className = 'globe-stage-inner'; stage.appendChild(inner);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement; inner.appendChild(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  direction(START.lat, START.lng, camera.position).multiplyScalar(DISTANCE);

  // Earth: the supplied shader mixes the day and night textures by how much each point faces the sun
  const loader = new THREE.TextureLoader(); let loaded = 0;
  const done = () => { if (++loaded === 2) { inner.classList.add('ready'); onReady && onReady(); } };
  const tex = (src) => { const t = loader.load(src, done); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const sunDirection = new THREE.Vector3(1, 0, 0);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 64, 64), new THREE.ShaderMaterial({
    vertexShader: earthVertexShader, fragmentShader: earthFragmentShader,
    uniforms: { uDayTexture: new THREE.Uniform(tex(day)), uNightTexture: new THREE.Uniform(tex(night)), uSpecularCloudsTexture: new THREE.Uniform(null), uSunDirection: new THREE.Uniform(sunDirection) }
  }));
  scene.add(earth);
  const sun = () => { const s = subsolarPoint(new Date()); direction(s.lat, s.lng, sunDirection); };
  sun(); setInterval(sun, 60000);

  // a soft rim in the sky theme's glow colour
  const glow = new THREE.Color(cssVar('--glow', '#9AD9FF'));
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.16, 48, 48), new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX, fragmentShader: ATMOSPHERE_FRAGMENT, uniforms: { uColor: new THREE.Uniform(glow) },
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
  }));
  scene.add(atmosphere);

  // marker and rings at the chosen place
  const accent = new THREE.Color(cssVar('--accent', '#FFC83D'));
  const pin = new THREE.Group(); pin.visible = false; scene.add(pin);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(RADIUS * Math.sin(MARKER_DEG * D2R), 24), new THREE.MeshBasicMaterial({ color: accent }));
  pin.add(dot);
  const rings = [0, 0.5].map(phase => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: accent, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.userData.phase = phase; m.visible = !still; pin.add(m); return m;
  });
  const Z = new THREE.Vector3(0, 0, 1), n = new THREE.Vector3();

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.enableZoom = false; controls.enablePan = false; controls.rotateSpeed = 0.6;
  controls.autoRotate = !still; controls.autoRotateSpeed = SPIN;
  controls.addEventListener('start', () => { controls.autoRotate = false; fly = null; });
  canvas.style.touchAction = 'pan-y';   // on a phone, a vertical swipe over the globe still scrolls the page

  const fit = () => {
    const size = Math.round(stage.clientWidth); if (!size) return;
    const px = Math.round(size * MARGIN);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(px, px);
  };
  fit(); new ResizeObserver(fit).observe(stage);

  let fly = null, running = false, seen = true;
  const from = new THREE.Vector3(), to = new THREE.Vector3(), q = new THREE.Quaternion(), qStep = new THREE.Quaternion(), IDENT = new THREE.Quaternion();
  function frame(now) {
    if (!running) return;
    if (fly) {   // turn the camera around the globe toward the place, easing in and out
      const k = Math.min(1, (now - fly.t0) / FLY_MS), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      qStep.copy(IDENT).slerp(q, e); camera.position.copy(from).applyQuaternion(qStep).setLength(DISTANCE);
      if (k >= 1) fly = null;
    }
    if (pin.visible && !still) rings.forEach(r => {
      const t = ((now / RING_MS) + r.userData.phase) % 1, s = RADIUS * Math.sin((MARKER_DEG + t * (RING_DEG - MARKER_DEG)) * D2R);
      r.scale.setScalar(s); r.material.opacity = 1 - t;
    });
    controls.update(); renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  // draw only while on screen and in the front tab
  const sync = () => { const want = seen && !document.hidden; if (want && !running) { running = true; requestAnimationFrame(frame); } else if (!want) running = false; };
  new IntersectionObserver(([e]) => { seen = e.isIntersecting; sync(); }, { threshold: 0.05 }).observe(inner);
  document.addEventListener('visibilitychange', sync);
  sync();

  return {
    setMarker(p) {
      if (!p || typeof p.lat !== 'number') { pin.visible = false; return; }
      direction(p.lat, p.lng, n); pin.position.copy(n).multiplyScalar(RADIUS * 1.006); pin.quaternion.setFromUnitVectors(Z, n); pin.visible = true;
    },
    flyTo(p) {
      controls.autoRotate = false;
      from.copy(camera.position).normalize(); direction(p.lat, p.lng, to);
      q.setFromUnitVectors(from, to); from.multiplyScalar(DISTANCE); fly = { t0: performance.now() };
    },
    refreshColours() {
      accent.set(cssVar('--accent', '#FFC83D')); glow.set(cssVar('--glow', '#9AD9FF'));
      dot.material.color.copy(accent); rings.forEach(r => r.material.color.copy(accent));
    }
  };
}
