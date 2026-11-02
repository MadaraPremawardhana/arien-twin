/* ARIEN panel library — widely sold rooftop and ground-mount modules, from manufacturer datasheets.
 * Values are STC (1000 W/m², 25 °C cell). Efficiency is the datasheet module efficiency; the twin uses
 * efficiency × panel area × irradiance, corrected for cell temperature with the Pmax coefficient.
 * Browser: window.ArienPanels; Node: module.exports. */
(function (root) {
  'use strict';
  // w = width across the row (short side), l = length up the slope (long side), metres.
  // cellsX × cellsY = cell grid used for shading (half-cut cells count as cells here).
  const LIST = [
    { id: 'longi-himo6-430', maker: 'LONGi', name: 'Hi-MO 6 Explorer', code: 'LR5-54HTH-430M', wp: 430, eff: 0.220, w: 1.134, l: 1.722, cellsX: 6, cellsY: 18, gamma: -0.29, tech: 'HPBC back contact', use: 'Homes',
      source: 'LONGi datasheet LR5-54HTH 420–440M (V19)' },
    { id: 'longi-x10-485', maker: 'LONGi', name: 'Hi-MO X10 Explorer', code: 'LR7-54HVH-485M', wp: 485, eff: 0.2376, w: 1.134, l: 1.800, cellsX: 6, cellsY: 18, gamma: -0.26, tech: 'HPBC 2.0 back contact, n-type', use: 'Homes',
      source: 'LONGi datasheet LR7-54HVH 480–505M (BGV03)' },
    { id: 'aiko-2p-460', maker: 'AIKO', name: 'Neostar 2P', code: 'AIKO-A460-MAH54Mw', wp: 460, eff: 0.231, w: 1.134, l: 1.757, cellsX: 6, cellsY: 18, gamma: -0.26, tech: 'ABC back contact, n-type', use: 'Homes',
      source: 'AIKO Neostar 2P datasheet (A450–A485-MAH54Mw)' },
    { id: 'jinko-tn54-440', maker: 'JinkoSolar', name: 'Tiger Neo 54HL4R-B', code: 'JKM440N-54HL4R-B', wp: 440, eff: 0.2202, w: 1.134, l: 1.762, cellsX: 6, cellsY: 18, gamma: -0.29, tech: 'TOPCon, n-type, all black', use: 'Homes',
      source: 'Krannich product data for JKM440N-54HL4R-B' },
    { id: 'ja-db4-450', maker: 'JA Solar', name: 'DeepBlue 4.0 Pro', code: 'JAM54D40-450/LR', wp: 450, eff: 0.225, w: 1.134, l: 1.762, cellsX: 6, cellsY: 18, gamma: -0.29, tech: 'TOPCon, n-type, glass-glass', use: 'Homes',
      source: 'JA Solar datasheet JAM54D40 445–470/LR (Global-DE-20250609C)' },
    { id: 'trina-vsplus-440', maker: 'Trina Solar', name: 'Vertex S+', code: 'TSM-440NEG9R.28', wp: 440, eff: 0.220, w: 1.134, l: 1.762, cellsX: 6, cellsY: 24, gamma: -0.30, tech: 'TOPCon, n-type, glass-glass', use: 'Homes',
      source: 'Trina datasheet TSM-NEG9R.28 415–440 W (2022)' },
    { id: 'qcells-tron-430', maker: 'Qcells', name: 'Q.TRON BLK M-G2+', code: 'Q.TRON BLK M-G2+ 430', wp: 430, eff: 0.220, w: 1.134, l: 1.722, cellsX: 6, cellsY: 18, gamma: -0.30, tech: 'TOPCon, n-type, all black', use: 'Homes',
      source: 'Qcells datasheet Q.TRON BLK M-G2+ 415–440' },
    { id: 'rec-alpha-430', maker: 'REC', name: 'Alpha Pure-R', code: 'REC430AA Pure-R', wp: 430, eff: 0.223, w: 1.118, l: 1.730, cellsX: 5, cellsY: 16, gamma: -0.24, tech: 'Heterojunction (HJT)', use: 'Homes',
      source: 'REC Alpha Pure-R datasheet (5.2025)' },
    { id: 'maxeon7-445', maker: 'Maxeon (SunPower)', name: 'Maxeon 7', code: 'SPR-MAX7-445-PT', wp: 445, eff: 0.241, w: 1.035, l: 1.787, cellsX: 7, cellsY: 16, gamma: -0.27, tech: 'IBC back contact, n-type', use: 'Homes',
      source: 'Maxeon 7 datasheet 435–445 W (Jan 2024)' },
    { id: 'jinko-tn72-580', maker: 'JinkoSolar', name: 'Tiger Neo 72HL4-V', code: 'JKM580N-72HL4-V', wp: 580, eff: 0.2245, w: 1.134, l: 2.278, cellsX: 6, cellsY: 24, gamma: -0.29, tech: 'TOPCon, n-type, large format', use: 'Commercial and ground mount',
      source: 'JinkoSolar datasheet JKM575–595N-72HL4-(V)' }
  ];
  const CUSTOM = { id: 'custom', maker: '', name: 'Custom panel', code: '', wp: null, eff: null };
  const DEFAULT_ID = 'longi-himo6-430';
  const byId = (id) => LIST.find(p => p.id === id) || null;
  const label = (p) => p && p.id !== 'custom' ? `${p.maker} ${p.name} (${p.wp} W)` : 'Custom panel';
  const short = (p) => p && p.id !== 'custom' ? `${p.maker} ${p.name}` : 'Custom panel';

  /** Copy a model's datasheet values onto an array, keeping its portrait/landscape choice */
  function applyTo(a, id) {
    const p = byId(id);
    if (!p) { a.panelModel = 'custom'; return a; }
    const land = !!a.landscape;
    a.panelModel = p.id;
    a.panelW = land ? p.l : p.w; a.panelL = land ? p.w : p.l;
    a.cellsX = land ? p.cellsY : p.cellsX; a.cellsY = land ? p.cellsX : p.cellsY;
    a.eff = p.eff; a.gammaPct = p.gamma;
    return a;
  }
  /** Turn the panels on their side (landscape) or back (portrait) */
  function setLandscape(a, landscape) {
    if (!!a.landscape === !!landscape) return a;
    a.landscape = !!landscape;
    [a.panelW, a.panelL] = [a.panelL, a.panelW];
    [a.cellsX, a.cellsY] = [a.cellsY, a.cellsX];
    return a;
  }
  /** Rated power of one panel in watts (datasheet Wp when a model is set, otherwise area × efficiency × 1 kW/m²) */
  function panelWp(a) {
    const p = byId(a.panelModel);
    return p ? p.wp : a.panelW * a.panelL * a.eff * 1000;
  }
  const arrayKwp = (a) => a.rows * a.cols * panelWp(a) / 1000;
  /** Does an array still match its model? (manual edits turn it into a custom panel) */
  function matches(a) {
    const p = byId(a.panelModel); if (!p) return false;
    const land = !!a.landscape, w = land ? p.l : p.w, l = land ? p.w : p.l;
    return Math.abs(a.panelW - w) < 0.002 && Math.abs(a.panelL - l) < 0.002 && Math.abs(a.eff - p.eff) < 1e-4 && Math.abs(a.gammaPct - p.gamma) < 1e-4;
  }

  const api = { LIST, CUSTOM, DEFAULT_ID, byId, label, short, applyTo, setLandscape, panelWp, arrayKwp, matches };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArienPanels = api;
})(typeof window !== 'undefined' ? window : globalThis);
