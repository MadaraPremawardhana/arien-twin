// The hero globe: day and night sides follow the real sun, a marker and rings show the chosen place.
// Loaded only on the landing page when WebGL is available (globe.gl + three.js are large).
import Globe from 'globe.gl';
import { ShaderMaterial, TextureLoader, Vector3, SRGBColorSpace } from 'three';

const VERTEX = `
  varying vec2 vUv; varying vec3 vNormal;
  void main() {
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * modelPosition;
    vUv = uv; vNormal = (modelMatrix * vec4(normal, 0.0)).xyz;
  }`;
const FRAGMENT = `
  uniform sampler2D uDayTexture; uniform sampler2D uNightTexture; uniform vec3 uSunDirection;
  varying vec2 vUv; varying vec3 vNormal;
  void main() {
    float dayMix = smoothstep(-0.25, 0.5, dot(uSunDirection, normalize(vNormal)));
    gl_FragColor = vec4(mix(texture2D(uNightTexture, vUv).rgb, texture2D(uDayTexture, vUv).rgb, dayMix), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const D2R = Math.PI / 180, ALTITUDE = 1.8, START = { lat: 24, lng: -8 }, SPIN = 0.35;

/** Where the sun is overhead right now */
export function subsolarPoint(date = new Date()) {
  const d = date.getTime() / 864e5 + 2440587.5 - 2451545, L = 280.46 + 0.9856474 * d, g = (357.528 + 0.9856003 * d) * D2R;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, eps = (23.439 - 4e-7 * d) * D2R;
  const lat = Math.asin(Math.sin(eps) * Math.sin(lambda)) / D2R, ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / D2R;
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  return { lat, lng: ((ra - gmst * 15 + 540) % 360 + 360) % 360 - 180 };
}
function sunDirection(date) {
  const { lat, lng } = subsolarPoint(date), phi = (90 - lat) * D2R, theta = (90 - lng) * D2R;
  const x = Math.sin(phi) * Math.cos(theta), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(theta);
  return new Vector3().setFromSphericalCoords(1, Math.acos(y), Math.atan2(x, z));
}
const cssVar = (name, fallback) => getComputedStyle(document.querySelector('.st') || document.documentElement).getPropertyValue(name).trim() || fallback;
const rgb = (hex) => { const h = hex.replace('#', ''), f = h.length === 3 ? h.split('').map(c => c + c).join('') : h, n = parseInt(f, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

export function heroGlobe(stage, { day, night, onReady } = {}) {
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const inner = document.createElement('div'); inner.className = 'globe-stage-inner'; stage.appendChild(inner);
  const material = new ShaderMaterial({ uniforms: { uDayTexture: { value: null }, uNightTexture: { value: null }, uSunDirection: { value: new Vector3(1, 0, 0) } }, vertexShader: VERTEX, fragmentShader: FRAGMENT });
  const loader = new TextureLoader(); let loaded = 0;
  const done = () => { if (++loaded === 2) { inner.classList.add('ready'); onReady && onReady(); } };
  for (const [key, src] of [['uDayTexture', day], ['uNightTexture', night]]) { const t = loader.load(src, done); t.colorSpace = SRGBColorSpace; t.anisotropy = 8; material.uniforms[key].value = t; }
  const sun = () => material.uniforms.uSunDirection.value.copy(sunDirection(new Date()));
  sun(); setInterval(sun, 60000);

  let accent = cssVar('--accent', '#FFC83D'), accentRgb = rgb(accent);
  const g = new Globe(inner, { animateIn: false })
    .backgroundColor('rgba(0,0,0,0)').globeMaterial(material).showAtmosphere(true).atmosphereColor(cssVar('--glow', '#9AD9FF')).atmosphereAltitude(0.18)
    .pointLat('lat').pointLng('lng').pointColor(() => accent).pointAltitude(0.012).pointRadius(0.45)
    .ringLat('lat').ringLng('lng').ringAltitude(0.011).ringMaxRadius(3.5).ringPropagationSpeed(1.1).ringRepeatPeriod(1400)
    .ringColor(() => (t) => `rgba(${accentRgb.join(',')},${(1 - t).toFixed(2)})`);
  g.pointOfView({ ...START, altitude: ALTITUDE });
  const controls = g.controls(); controls.autoRotate = !still; controls.autoRotateSpeed = SPIN; controls.enableZoom = false;
  controls.addEventListener('start', () => { controls.autoRotate = false; });
  g.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  // the canvas is larger than the stage so the globe's disc exactly fills it
  const fit = () => {
    const size = Math.round(stage.clientWidth); if (!size) return;
    const fov = g.camera().fov || 50, disc = 1 / Math.sqrt((1 + ALTITUDE) ** 2 - 1) / Math.tan(fov * Math.PI / 360);
    const px = Math.round(size / disc); g.width(px).height(px);
  };
  fit(); new ResizeObserver(fit).observe(stage);

  // pause when off screen or in a background tab
  if (!still) {
    let seen = true;
    const sync = () => (seen && !document.hidden ? g.resumeAnimation() : g.pauseAnimation());
    new IntersectionObserver(([e]) => { seen = e.isIntersecting; sync(); }, { threshold: 0.05 }).observe(inner);
    document.addEventListener('visibilitychange', sync);
  }
  return {
    setMarker(p) { const pts = p && typeof p.lat === 'number' ? [{ lat: p.lat, lng: p.lng }] : []; g.pointsData(pts).ringsData(still ? [] : pts); },
    flyTo(p) { controls.autoRotate = false; g.pointOfView({ lat: p.lat, lng: p.lng, altitude: ALTITUDE }, 1500); },
    refreshColours() { accent = cssVar('--accent', '#FFC83D'); accentRgb = rgb(accent); g.atmosphereColor(cssVar('--glow', '#9AD9FF')).pointColor(() => accent); }
  };
}
