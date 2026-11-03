/* ARIEN finance — household self-consumption, savings, payback, ROI and CO2 for a PV design.
 * Pure functions (no DOM). Browser: window.ArienFinance; Node: module.exports.
 * Defaults are UK values researched on 3 Nov 2026; every one is editable in the dashboard and listed in
 * the report. Battery storage is accepted by selfConsumption() so it plugs in once batteries are designed. */
(function (root) {
  'use strict';
  const DEFAULTS = {
    currency: 'GBP',
    importPrice: 26.32,      // p/kWh — Ofgem price cap, 1 Oct–31 Dec 2026, GB average, direct debit
    exportPrice: 12,         // p/kWh — typical customer SEG rate (Octopus Outgoing, British Gas Export Premium, OVO, ScottishPower), Oct 2026
    priceInflation: 2,       // %/yr import price growth — assumption: about the Bank of England CPI target (flat in real terms)
    exportInflation: 0,      // %/yr — export rates are usually fixed or variable, not index-linked
    annualUse: 2500,         // kWh/yr — Ofgem medium Typical Domestic Consumption Value for electricity from 1 Jul 2026
    selfUseOverride: null,   // % of generation used on site; null = simulate hour by hour against the household profile
    systemLosses: 14,        // % inverter, cabling, soiling, mismatch — the 14% PVGIS uses as its standard example
    firstYearDegradation: 1, // % — JinkoSolar Tiger Neo datasheet (LONGi: under 1.5%)
    degradation: 0.4,        // %/yr after year 1 — JinkoSolar and LONGi linear power warranties
    costPerKwp: null,        // £/kWp installed; null = by system size (see costPerKwpFor)
    totalCostOverride: null, // £ — a quote replaces the estimate
    inverterReplacement: 1000, // £ — UK fitted price range £600–2,000, typical inverter life 10–15 years (Q3 2026)
    inverterYear: 12,
    maintenance: 0,          // £/yr
    lifetime: 25,            // years — common panel performance-warranty length
    carbonFactor: 0.13096    // kgCO2e/kWh — DESNZ 2026 GHG conversion factors, UK electricity (generation)
  };
  const SOURCES = {
    importPrice: 'Ofgem, energy price cap 1 October–31 December 2026: 26.32 p/kWh, GB average, direct debit',
    exportPrice: 'Sunsave SEG rate table (26 Oct 2026): 12 p/kWh offered by Octopus, British Gas, OVO, ScottishPower to their customers',
    priceInflation: 'Assumption: 2% a year, about the Bank of England CPI target (electricity prices flat in real terms)',
    annualUse: 'Ofgem Typical Domestic Consumption Value, medium electricity, 2,500 kWh/yr from 1 July 2026',
    selfUse: 'Hour-by-hour match of generation to a typical household profile; UK field study average 37% (McKenna, Pless & Darby, Energy Policy 2018)',
    systemLosses: 'PVGIS standard example of 14% system losses (inverter, cabling, soiling, mismatch)',
    degradation: 'JinkoSolar Tiger Neo and LONGi Hi-MO 6 datasheets: about 1% in year 1, 0.40% a year after',
    cost: 'DESNZ small-scale solar cost data, median about £1,800–1,900 per kW for typical domestic systems; lower per kW for larger systems',
    inverter: 'UK fitted replacement £600–2,000, typical life 10–15 years (Best Builders, Q3 2026)',
    vat: '0% VAT on residential solar in Great Britain until 31 March 2027 (included in the cost)',
    carbon: 'DESNZ 2026 GHG conversion factors: 0.13096 kgCO2e/kWh, UK electricity generation'
  };
  /** Installed cost per kWp by size: small systems cost more per kW */
  function costPerKwpFor(kwp) { return kwp <= 4 ? 1900 : kwp <= 10 ? 1600 : 1200; }

  // ---------- household demand ----------
  // Typical domestic daily shape: low overnight, morning and evening peaks, more use in winter.
  const WEEKDAY = [0.28, 0.24, 0.22, 0.21, 0.21, 0.24, 0.38, 0.55, 0.52, 0.42, 0.38, 0.38, 0.40, 0.38, 0.36, 0.38, 0.48, 0.72, 0.85, 0.80, 0.70, 0.60, 0.48, 0.36];
  const WEEKEND = [0.30, 0.26, 0.23, 0.22, 0.21, 0.22, 0.28, 0.38, 0.52, 0.58, 0.56, 0.55, 0.56, 0.52, 0.48, 0.48, 0.55, 0.75, 0.86, 0.80, 0.72, 0.62, 0.50, 0.38];
  const SEASON = [1.22, 1.16, 1.06, 0.96, 0.88, 0.82, 0.80, 0.82, 0.88, 0.98, 1.12, 1.24]; // Jan..Dec
  const loadShape = (t, offMs) => { const d = new Date(t + offMs); const h = d.getUTCHours(), w = d.getUTCDay(); return ((w === 0 || w === 6) ? WEEKEND : WEEKDAY)[h] * SEASON[d.getUTCMonth()]; };
  /** Hourly household demand (kWh in each hour) for these hour-start times, scaled to annual use */
  function loadProfile(times, annualKWh, utcOffsetMs = 0) {
    const shape = times.map(t => loadShape(t, utcOffsetMs));
    const sum = shape.reduce((a, b) => a + b, 0) || 1;
    const hours = times.length || 1;
    const scale = annualKWh * (hours / 8760) / sum;
    return shape.map(v => v * scale);
  }
  // mean of the shape over a year, so a single moment can be scaled to the annual total
  const MEAN_SHAPE = (() => { let s = 0; const t0 = Date.UTC(2025, 0, 1); for (let h = 0; h < 8760; h++) s += loadShape(t0 + h * 3600000, 0); return s / 8760; })();
  /** Demand in kW at any time (for forecasts and recommendations) */
  function loadAt(t, annualKWh, utcOffsetMs = 0) { return loadShape(t, utcOffsetMs) * annualKWh / (8760 * MEAN_SHAPE); }

  /**
   * Match generation to demand hour by hour. pv, load: kWh per step (same length).
   * battery (optional): {capacity kWh, power kW, efficiency 0..1 round trip, stepHours}. Returns energy flows.
   */
  function selfConsumption(pv, load, battery) {
    let self = 0, exp = 0, imp = 0, soc = 0, fromBatt = 0, gen = 0, use = 0;
    const step = battery && battery.stepHours || 1, eff = battery ? Math.sqrt(battery.efficiency ?? 0.9) : 1;
    for (let i = 0; i < pv.length; i++) {
      const p = Math.max(0, pv[i]), l = Math.max(0, load[i]); gen += p; use += l;
      const direct = Math.min(p, l); self += direct;
      let surplus = p - direct, deficit = l - direct;
      if (battery && battery.capacity > 0) {
        const lim = (battery.power || battery.capacity) * step;
        if (surplus > 0) { const c = Math.min(surplus, lim, (battery.capacity - soc) / eff); soc += c * eff; surplus -= c; }
        if (deficit > 0) { const d = Math.min(deficit, lim, soc * eff); soc -= d / eff; deficit -= d; fromBatt += d; }
      }
      exp += surplus; imp += deficit;
    }
    const used = self + fromBatt;
    return { generation: gen, demand: use, direct: self, fromBattery: fromBatt, selfUsed: used, exported: exp, imported: imp,
      selfUseShare: gen > 0 ? used / gen : 0, selfSufficiency: use > 0 ? used / use : 0 };
  }

  /**
   * Year-by-year cash flows. inp: {kwp, annualDcKWh, selfUseShare, assumptions}
   * Returns {years:[{year, generation, selfUsed, exported, importPrice, exportPrice, selfSaving, exportIncome, costs, net, cumulative}], capex, payback, totals(n)}
   */
  function cashflow(inp) {
    const a = { ...DEFAULTS, ...(inp.assumptions || {}) };
    const kwp = inp.kwp;
    const capex = a.totalCostOverride != null && a.totalCostOverride > 0 ? a.totalCostOverride : kwp * (a.costPerKwp > 0 ? a.costPerKwp : costPerKwpFor(kwp));
    const ac1 = inp.annualDcKWh * (1 - a.systemLosses / 100);
    const share = a.selfUseOverride != null ? a.selfUseOverride / 100 : inp.selfUseShare;
    const years = []; let cum = -capex, payback = null;
    for (let y = 1; y <= Math.max(a.lifetime, 25); y++) {
      const deg = (1 - a.firstYearDegradation / 100) * Math.pow(1 - a.degradation / 100, y - 1);
      const gen = ac1 * deg, selfUsed = gen * share, exported = gen - selfUsed;
      const ip = a.importPrice / 100 * Math.pow(1 + a.priceInflation / 100, y - 1);
      const ep = a.exportPrice / 100 * Math.pow(1 + a.exportInflation / 100, y - 1);
      const selfSaving = selfUsed * ip, exportIncome = exported * ep;
      const costs = a.maintenance + (y === a.inverterYear ? a.inverterReplacement : 0);
      const net = selfSaving + exportIncome - costs;
      const prev = cum; cum += net;
      if (payback == null && cum >= 0) payback = y - 1 + (net > 0 ? -prev / net : 0);
      years.push({ year: y, generation: gen, selfUsed, exported, importPrice: ip, exportPrice: ep, selfSaving, exportIncome, costs, net, cumulative: cum });
    }
    const totals = (n) => {
      const ys = years.slice(0, n);
      const savings = ys.reduce((s, r) => s + r.selfSaving + r.exportIncome, 0), costs = ys.reduce((s, r) => s + r.costs, 0);
      const gen = ys.reduce((s, r) => s + r.generation, 0);
      return { years: n, savings, costs, net: savings - costs - capex, roi: capex > 0 ? (savings - costs - capex) / capex : 0, generation: gen, co2: gen * a.carbonFactor };
    };
    return { assumptions: a, capex, costPerKwp: kwp > 0 ? capex / kwp : 0, acYear1: ac1 * (1 - a.firstYearDegradation / 100), selfUseShare: share, years, payback, totals, lifetime: a.lifetime };
  }

  // ---------- when to run appliances (systems without a battery) ----------
  const DEVICES = [
    { id: 'washer', label: 'Washing machine', kw: 0.5, hours: 2 },
    { id: 'dishwasher', label: 'Dishwasher', kw: 0.6, hours: 2 },
    { id: 'dryer', label: 'Tumble dryer', kw: 1.8, hours: 1.5 },
    { id: 'ev', label: 'EV top-up (3-pin, 2.3 kW)', kw: 2.3, hours: 3 },
    { id: 'immersion', label: 'Hot water (immersion)', kw: 3, hours: 1 }
  ];
  /**
   * Best window for each device on each day. times/kw: forecast generation (kW) at regular steps.
   * Surplus = generation − household demand; coverage = share of the device's energy met by surplus.
   */
  function recommend(times, kw, opts) {
    const off = opts.utcOffsetMs || 0, annual = opts.annualUse || DEFAULTS.annualUse, now = opts.now || Date.now();
    const step = times.length > 1 ? (times[1] - times[0]) : 900000, stepH = step / 3600000;
    const surplus = times.map((t, i) => Math.max(0, kw[i] - loadAt(t, annual, off)));
    const dayKey = (t) => { const d = new Date(t + off); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - off; };
    const days = [...new Set(times.map(dayKey))].filter(d => d + 86400000 > now).slice(0, opts.days || 3);
    return days.map(d => {
      const idx = times.map((t, i) => i).filter(i => dayKey(times[i]) === d);
      const gen = idx.reduce((s, i) => s + kw[i] * stepH, 0), sur = idx.reduce((s, i) => s + surplus[i] * stepH, 0);
      let peakI = idx[0]; idx.forEach(i => { if (kw[i] > kw[peakI]) peakI = i; });
      const devices = (opts.devices || DEVICES).map(dev => {
        const n = Math.max(1, Math.round(dev.hours / stepH)); let best = null;
        for (let k = 0; k + n <= idx.length; k++) {
          const s = idx[k], t0 = times[s], h = new Date(t0 + off).getUTCHours() + new Date(t0 + off).getUTCMinutes() / 60;
          if (t0 < now - step || h < 6 || h + dev.hours > 22) continue;
          let cov = 0, head = 0; for (let j = 0; j < n; j++) { cov += Math.min(surplus[idx[k + j]], dev.kw) * stepH; head += surplus[idx[k + j]] * stepH; }
          const share = cov / (dev.kw * dev.hours);
          // most solar coverage first; among equal coverage, the most spare solar (robust if the forecast is a little off)
          const score = Math.round(share * 100) + Math.min(head / (dev.kw * dev.hours), 5) * 0.1;
          if (!best || score > best.score + 1e-9) best = { start: t0, end: t0 + dev.hours * 3600000, share, score };
        }
        return { ...dev, ...(best || { start: null, end: null, share: 0 }) };
      });
      return { day: d, generation: gen, surplus: sur, peakAt: times[peakI], peakKw: kw[peakI] || 0, devices };
    });
  }

  const api = { DEFAULTS, SOURCES, DEVICES, costPerKwpFor, loadProfile, loadAt, selfConsumption, cashflow, recommend };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArienFinance = api;
})(typeof window !== 'undefined' ? window : globalThis);
