// The landing page's 48-hour preview for a standard 4 kWp system (35° tilt, south-facing).
// A port of the preview on arien.base44.app: Open-Meteo forecast irradiance on the tilted plane (isotropic sky,
// ground reflection), NOCT cell temperature, a linear temperature coefficient and 14% system losses.
// The physics constants are unchanged; hours are handled in the site's own time zone.
import SunCalc from 'suncalc';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const PREVIEW_SYSTEM = { panel_watt: 4000, panel_count: 1, capacity_kwp: 4, tilt_deg: 35, azimuth_deg: 180 };
const ALBEDO = 0.2, NOCT = 45, GAMMA = -0.004, G_MAX = 1400, LOSSES_PCT = 14;
const rad = (d) => d * Math.PI / 180;

/** Unit vector to the sun (east, north, up) at a UTC instant */
function sunVector(lat, lng, date) {
  const doy = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5), h = date.getUTCHours() + date.getUTCMinutes() / 60;
  const B = 2 * Math.PI / 365 * (doy - 1), decl = rad(23.45) * Math.sin(2 * Math.PI / 365 * (284 + doy));
  const eot = (9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B)) / 60;
  const H = rad(15 * (h + lng / 15 + eot - 12)), phi = rad(lat);
  return {
    sE: -Math.cos(decl) * Math.sin(H),
    sN: Math.cos(phi) * Math.sin(decl) - Math.sin(phi) * Math.cos(decl) * Math.cos(H),
    sU: Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H)
  };
}
const panelNormal = (tilt, az) => ({ nE: Math.sin(rad(az)) * Math.sin(rad(tilt)), nN: Math.cos(rad(az)) * Math.sin(rad(tilt)), nU: Math.cos(rad(tilt)) });
/** Irradiance on the panel plane, W/m² */
function planeIrradiance(dni, dhi, ghi, cosInc, tiltRad) {
  const beam = cosInc > 0 ? dni * cosInc : 0, sky = dhi * (1 + Math.cos(tiltRad)) / 2, ground = ghi * ALBEDO * (1 - Math.cos(tiltRad)) / 2;
  return Math.min(G_MAX, Math.max(0, beam + sky + ground));
}

/**
 * Hourly kW for the next `hours` hours at a place. Each entry: {time: Date (the true instant), hour, day (site-local), kw}.
 * `fetchImpl` is injectable for tests.
 */
export async function previewForecast(lat, lng, hours = 48, fetchImpl = fetch) {
  const days = Math.max(1, Math.ceil(hours / 24));
  const res = await fetchImpl(`${FORECAST_URL}?latitude=${lat}&longitude=${lng}&hourly=shortwave_radiation,direct_normal_irradiance,diffuse_radiation,temperature_2m&forecast_days=${days}&timezone=auto`);
  if (!res.ok) throw new Error(`Open-Meteo forecast failed: ${res.status}`);
  const j = await res.json(), h = j.hourly || {}, off = (j.utc_offset_seconds || 0) * 1000;
  const sys = PREVIEW_SYSTEM, n = panelNormal(sys.tilt_deg, sys.azimuth_deg), tiltRad = rad(sys.tilt_deg), derate = 1 - LOSSES_PCT / 100;
  const out = [];
  (h.time || []).slice(0, hours).forEach((stamp, i) => {
    const local = new Date(stamp + 'Z'), time = new Date(local.getTime() - off);   // the stamp is site-local wall time
    const row = { time, hour: local.getUTCHours(), day: stamp.slice(0, 10), kw: 0 };
    out.push(row);
    if (SunCalc.getPosition(time, lat, lng).altitude <= 0) return;
    const s = sunVector(lat, lng, time), cosInc = s.sE * n.nE + s.sN * n.nN + s.sU * n.nU;
    const G = planeIrradiance(h.direct_normal_irradiance?.[i] ?? 0, h.diffuse_radiation?.[i] ?? 0, h.shortwave_radiation?.[i] ?? 0, cosInc, tiltRad);
    if (G <= 0) return;
    const cell = (h.temperature_2m?.[i] ?? 12) + (NOCT - 20) / 800 * G;
    const factor = Math.min(1.1, Math.max(0.5, 1 + GAMMA * (cell - 25)));
    row.kw = Math.max(0, G * sys.panel_watt / 1000 * factor * sys.panel_count / 1000 * derate);
  });
  return out;
}

/** The best three consecutive hours */
export function bestWindow(rows) {
  if (!rows || rows.length < 3) return null;
  let best = null;
  for (let i = 0; i < Math.min(48, rows.length - 2); i++) {
    const sum = rows[i].kw + rows[i + 1].kw + rows[i + 2].kw;
    if (!best || sum > best.sum) best = { start: rows[i], end: rows[i + 2], sum };
  }
  return best;
}
export function summarise(rows) {
  const today = rows[0] ? rows[0].day : '', tomorrowDay = (rows.find(r => r.day !== today) || {}).day;
  return {
    today, tomorrowDay,
    tomorrowKwh: rows.filter(r => r.day === tomorrowDay).reduce((t, r) => t + r.kw, 0),
    peakKw: rows.reduce((m, r) => Math.max(m, r.kw), 0),
    best: bestWindow(rows)
  };
}

const hh = (n) => String(n).padStart(2, '0') + ':00';
/** The bar chart (SVG markup), today's bars in the accent colour and tomorrow's in the sky colour */
export function chartSvg(rows) {
  if (!rows || !rows.length) return '';
  const W = 520, H = 132, top = 12, bottom = 18, max = Math.max(0.2, ...rows.map(r => r.kw)), step = W / rows.length, bar = Math.max(2, step * 0.6);
  const y = (kw) => H - bottom - kw / max * (H - top - bottom), split = rows.findIndex(r => r.day !== rows[0].day);
  let s = `<svg viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto" role="img" aria-label="Hourly solar generation forecast for the next 48 hours">`;
  [0.25, 0.5, 0.75].forEach(f => { const yy = top + f * (H - top - bottom); s += `<line x1="0" y1="${yy}" x2="${W}" y2="${yy}" stroke="var(--line-2)"></line>`; });
  if (split > 0) s += `<line x1="${split * step}" y1="${top}" x2="${split * step}" y2="${H - bottom}" stroke="var(--line)" stroke-dasharray="3 3"></line><text x="${split * step + 4}" y="${top + 1}" font-family="var(--fm)" font-size="9" fill="var(--ink-3)">TOMORROW</text>`;
  rows.forEach((r, i) => { const yy = y(r.kw); s += `<rect x="${(i * step + (step - bar) / 2).toFixed(2)}" y="${yy.toFixed(2)}" width="${bar.toFixed(2)}" height="${Math.max(1, H - bottom - yy).toFixed(2)}" rx="${Math.min(2, bar / 2)}" fill="${split === -1 || i >= split ? 'var(--sky-2)' : 'var(--accent)'}" opacity="${r.kw > 0 ? 0.92 : 0.2}"></rect>`; });
  [0, 12, 24, 36].filter(i => i < rows.length).forEach(i => { s += `<text x="${Math.min(W - 16, Math.max(16, i * step + step / 2))}" y="${H - 5}" font-family="var(--fm)" font-size="10" fill="var(--ink-3)" text-anchor="middle">${hh(rows[i].hour)}</text>`; });
  return s + '</svg>';
}
export const hourLabel = (row) => hh(row.hour);
