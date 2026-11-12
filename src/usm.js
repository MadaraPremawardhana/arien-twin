/* USM-1, the Unified Sky Model version 1: irradiance from routine weather variables with one fixed
 * coefficient set for every site. Pure functions, no DOM. Browser: window.ArienUSM; Node: module.exports.
 *
 * Chain: sun position (NOAA / Meeus) → Bird & Hulstrom (1981) clear sky from surface pressure, precipitable
 * water (Gueymard 1994, from 2 m temperature and humidity), aerosol optical depth at 550 nm and climatological
 * ozone (van Heuklon 1979) → three cloud layers (low, mid, high), each with a scaled optical depth and a
 * two-stream-type transmittance T = (a + μ)/(a + μ + τ); precipitation thickens low and mid cloud; total cloud
 * cover sets the overlap → multiple reflection between snow and sky → beam from the same optical depths.
 *
 * Units: W/m², degrees, hPa, °C, % relative humidity, cloud cover 0..1, precipitation mm in the preceding
 * hour, snow depth m, time in ms UTC. Coefficients were fitted once on 44 sites × 3 weather models for 2024
 * (R&D report, Nov 2026) and are not tuned per site. This file is a port of the Python reference arien_usm.py.
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180;
  const GSC = 1361.1; // W/m², solar constant (Gueymard 2018)
  const COEF = {
    kL: 0.5335,   // scaled optical depth of overcast low cloud
    kM: 0.6676,   // … mid cloud
    kH: 0.1541,   // … high cloud
    gH: 2.0,      // high-cloud thickness grows as cover^gH (fixed, not fitted)
    a: 0.409,     // two-stream closure constant
    aP: 2.3486,   // maximum fractional thickening by precipitation
    P0: 0.701,    // precipitation half-saturation, mm/h
    alphaSnow: 0.7098, // effective landscape albedo under full snow cover
    kappa: 1.3926 // beam extinction per unit scaled optical depth
  };
  const ALBEDO_REF = 0.20, SNOW_FULL_DEPTH = 0.05, RHO_CLEAR = 0.07, ANGSTROM_EXP = 1.3;
  /** Used when a weather source does not supply the value */
  const DEFAULTS = { aod550: 0.12, rh: 70, pressure: 1013.25 };
  const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  /** Sun position at tSec (POSIX seconds UTC): cos(zenith) without refraction, azimuth (deg from north, clockwise), distance (AU) */
  function solarGeometry(tSec, lat, lon) {
    const jd = tSec / 86400 + 2440587.5, T = (jd - 2451545) / 36525;
    const L0 = (((280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360) + 360) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const Mr = M * D2R;
    const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
    const trueLong = L0 + C, nu = M + C;
    const r = 1.000001018 * (1 - e * e) / (1 + e * Math.cos(nu * D2R));
    const om = 125.04 - 1934.136 * T;
    const lam = trueLong - 0.00569 - 0.00478 * Math.sin(om * D2R);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(om * D2R);
    const decl = Math.asin(Math.sin(eps * D2R) * Math.sin(lam * D2R));
    const y = Math.tan(eps * D2R / 2) ** 2, L0r = L0 * D2R;
    const eot = 4 / D2R * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
      - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr)); // minutes
    const dayMin = (((tSec % 86400) + 86400) % 86400) / 60;
    const tst = (((dayMin + eot + 4 * lon) % 1440) + 1440) % 1440;
    const H = (tst / 4 - 180) * D2R, latr = lat * D2R;
    const cosz = Math.sin(latr) * Math.sin(decl) + Math.cos(latr) * Math.cos(decl) * Math.cos(H);
    const az = ((Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(latr) - Math.tan(decl) * Math.cos(latr)) / D2R + 180) % 360 + 360) % 360;
    return { cosz, az, r };
  }
  /** Atmospheric refraction (deg) to add to the true elevation el (deg); NOAA */
  function refractionDeg(el) {
    if (el > 85) return 0;
    const te = Math.tan(clip(el, -89.9, 89.9) * D2R);
    let r;
    if (el > 5) r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (el > -0.575) r = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
    else r = -20.774 / te;
    return r / 3600;
  }
  /** Kasten & Young (1989) relative optical air mass; apparent zenith in degrees (< 90) */
  function relativeAirmass(zenApp) { return 1 / (Math.cos(zenApp * D2R) + 0.50572 * Math.pow(6.07995 + (90 - zenApp), -1.6364)); }
  /** Gueymard (1994) precipitable water (cm) from 2 m temperature (°C) and relative humidity (%) */
  function precipitableWaterCm(tempC, rhPct) {
    const T = tempC + 273.15, th = T / 273.15;
    const pw = 0.1 * (0.4976 + 1.5265 * th + Math.exp(13.6897 * th - 14.9188 * th ** 3))
      * (216.7 * rhPct / (100 * T) * Math.exp(22.330 - 49.140 * (100 / T) - 10.922 * (100 / T) ** 2 - 0.39015 * T / 100));
    return Math.max(pw, 0.1);
  }
  /** van Heuklon (1979) climatological total ozone (atm-cm) */
  function ozoneAtmCm(lat, lon, doy) {
    let A, C, F, Hh, I;
    if (lat >= 0) { A = 150; C = 40; F = -30; Hh = 3; I = lon > 0 ? 20 : 0; }
    else { A = 100; C = 30; F = 152.625; Hh = 2; I = -75; }
    const s2 = Math.sin(1.28 * lat * D2R) ** 2;
    return (235 + (A + C * Math.sin(0.9856 * (doy + F) * D2R) + 20 * Math.sin(Hh * (lon + I) * D2R)) * s2) / 1000;
  }
  /** Bird & Hulstrom (1981) broadband clear sky. Returns {ghi, dni}; apparent zenith in degrees (< 90), pressure in Pa */
  function birdClearSky(zenApp, pressurePa, pwCm, aod550, ozone, e0n, albedo = ALBEDO_REF, asym = 0.85) {
    const am = relativeAirmass(zenApp), amp = am * pressurePa / 101325;
    const aod380 = aod550 * Math.pow(550 / 380, ANGSTROM_EXP), aod500 = aod550 * Math.pow(550 / 500, ANGSTROM_EXP);
    const tR = Math.exp(-0.0903 * Math.pow(amp, 0.84) * (1 + amp - Math.pow(amp, 1.01)));
    const ozm = ozone * am;
    const tO = 1 - 0.1611 * ozm * Math.pow(1 + 139.48 * ozm, -0.3034) - 0.002715 * ozm / (1 + 0.044 * ozm + 0.0003 * ozm * ozm);
    const tG = Math.exp(-0.0127 * Math.pow(amp, 0.26));
    const wm = pwCm * am;
    const tW = 1 - 2.4959 * wm / (Math.pow(1 + 79.034 * wm, 0.6828) + 6.385 * wm);
    const tau = 0.2758 * aod380 + 0.35 * aod500;
    const tA = Math.exp(-Math.pow(tau, 0.873) * (1 + tau - Math.pow(tau, 0.7088)) * Math.pow(am, 0.9108));
    const tAA = 1 - 0.1 * (1 - am + Math.pow(am, 1.06)) * (1 - tA);
    const rs = 0.0685 + (1 - asym) * (1 - tA / tAA);
    const dni = 0.9662 * e0n * tA * tW * tG * tO * tR;
    const cz = Math.cos(zenApp * D2R);
    const ias = e0n * cz * 0.79 * tO * tG * tW * tAA * (0.5 * (1 - tR) + asym * (1 - tA / tAA)) / (1 - am + Math.pow(am, 1.02));
    return { ghi: (dni * cz + ias) / (1 - albedo * rs), dni };
  }
  /**
   * Cloud modification of global and beam irradiance. Covers are fractions 0..1, mu the cosine of the zenith
   * angle, precipitation in mm/h. cTotal null → random overlap of the three layers.
   * Returns {kc, kb, refl}: global factor, beam factor, reflectance of the cloud field for upwelling light.
   */
  function cloudFactors(cLow, cMid, cHigh, mu, precipMm = 0, cTotal = null, coef = COEF) {
    const cL = clip(cLow, 0, 1), cM = clip(cMid, 0, 1), cH = clip(cHigh, 0, 1);
    mu = Math.max(mu, 0.05);
    const C = cTotal == null ? 1 - (1 - cL) * (1 - cM) * (1 - cH) : Math.max(clip(cTotal, 0, 1), cL, cM, cH);
    if (C < 1e-4) return { kc: 1, kb: 1, refl: 0 };
    const pr = Math.max(precipMm, 0), fP = 1 + coef.aP * pr / (pr + coef.P0);
    const tL = coef.kL * fP, tM = coef.kM * fP, tH = coef.kH * Math.pow(cH, coef.gH);
    const am = coef.a + mu;
    const TL = am / (am + tL), TM = am / (am + tM), TH = am / (am + tH);
    const bL = Math.exp(-coef.kappa * tL / mu), bM = Math.exp(-coef.kappa * tM / mu), bH = Math.exp(-coef.kappa * tH / mu);
    const fL = cL / C, fM = cM / C, fH = cH / C;
    const Tbar = (1 - fL * (1 - TL)) * (1 - fM * (1 - TM)) * (1 - fH * (1 - TH));
    const Bbar = (1 - fL * (1 - bL)) * (1 - fM * (1 - bM)) * (1 - fH * (1 - bH));
    return { kc: 1 - C + C * Tbar, kb: 1 - C + C * Bbar, refl: C * (1 - Tbar) };
  }
  /** Multiple-reflection gain from snow on the ground (f = 1 without snow) and the ground albedo */
  function snowFactor(snowDepthM, refl, coef = COEF) {
    const fs = clip((snowDepthM || 0) / SNOW_FULL_DEPTH, 0, 1);
    const albedo = ALBEDO_REF + (coef.alphaSnow - ALBEDO_REF) * fs;
    const rho = RHO_CLEAR + (1 - RHO_CLEAR) * refl;
    return { f: (1 - ALBEDO_REF * rho) / (1 - albedo * rho), albedo };
  }
  function dayOfYear(tMs) { const d = new Date(tMs); return Math.floor((tMs - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1; }

  /**
   * Horizontal irradiance averaged over the `minutes` ending at tEndMs (nsub sun positions), or at the instant
   * tEndMs when minutes = 0.
   * wx: {pressure (hPa), temp (°C), rh (%), cLow, cMid, cHigh, cTotal (0..1, or null), precip (mm/h), snowDepth (m), aod550}
   * Returns {ghi, bh (beam on horizontal), dhi, dni, ghiCs, kc, mu, e0h, albedo, sunfrac}.
   */
  function irradiance(tEndMs, lat, lon, wx, minutes = 60, nsub = 6, coef = COEF) {
    if (!(minutes > 0)) { minutes = 0; nsub = 1; }
    const pPa = (wx.pressure ?? DEFAULTS.pressure) * 100;
    const pw = precipitableWaterCm(wx.temp ?? 10, wx.rh ?? DEFAULTS.rh);
    const aod = wx.aod550 ?? DEFAULTS.aod550;
    const oz = ozoneAtmCm(lat, lon, dayOfYear(tEndMs));
    const tEnd = tEndMs / 1000, step = minutes * 60 / nsub;
    let e0h = 0, mu = 0, sun = 0, ghiCs = 0, bhCs = 0;
    for (let k = 0; k < nsub; k++) {
      const g = solarGeometry(tEnd - (k + 0.5) * step, lat, lon);
      if (!(g.cosz > 0)) continue;
      const e0n = GSC / (g.r * g.r);
      const el = 90 - Math.acos(clip(g.cosz, -1, 1)) / D2R, elApp = el + refractionDeg(el);
      const cs = birdClearSky(90 - elApp, pPa, pw, aod, oz, e0n);
      e0h += e0n * g.cosz; mu += g.cosz; sun++; ghiCs += cs.ghi; bhCs += cs.dni * Math.sin(elApp * D2R);
    }
    const zero = { ghi: 0, bh: 0, dhi: 0, dni: 0, ghiCs: 0, kc: 1, mu: 0, e0h: 0, albedo: ALBEDO_REF, sunfrac: 0 };
    if (!sun) return zero;
    const sunfrac = sun / nsub; mu /= sun; e0h /= nsub; ghiCs /= nsub; bhCs /= nsub;
    const c = cloudFactors(wx.cLow || 0, wx.cMid || 0, wx.cHigh || 0, mu, wx.precip || 0, wx.cTotal ?? null, coef);
    const s = snowFactor(wx.snowDepth, c.refl, coef);
    const ghi = Math.max(0, ghiCs * c.kc * s.f), bh = Math.min(bhCs * c.kb, ghi), muAll = mu * sunfrac;
    return { ghi, bh, dhi: ghi - bh, dni: muAll > 0.02 ? bh / muAll : 0, ghiCs, kc: c.kc, mu, e0h, albedo: s.albedo, sunfrac };
  }
  /** Standard-atmosphere surface pressure (hPa) at an elevation (m), for sources without pressure */
  function pressureAtElevation(elevM) { return 1013.25 * Math.exp(-(elevM || 0) / 8434); }

  const api = { GSC, COEF, DEFAULTS, ALBEDO_REF, solarGeometry, refractionDeg, relativeAirmass, precipitableWaterCm, ozoneAtmCm,
    birdClearSky, cloudFactors, snowFactor, irradiance, pressureAtElevation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArienUSM = api;
})(typeof window !== 'undefined' ? window : globalThis);
