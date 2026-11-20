/* ARIEN Dashboard — the summary a homeowner or installer reads after simulating a design:
 * overview figures, today's forecast, when to run appliances, finances over 5–20 years,
 * monthly production, saved sites and the PDF report. Browser: window.ArienDashboard. */
(function (root) {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  let api = null, S = null, F = null, horizon = 10, busy = false, lastKey = '';
  let fcDay = 0, fcKey = null; // which forecast day the forecast card shows (0 = today); back to today for a new forecast
  const C = () => root.ArienCharts;
  const num = (v, d = 0) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (v, d = 0) => (v < 0 ? '−' : '') + '£' + num(Math.abs(v), d);
  const pct = (v, d = 0) => v == null || !isFinite(v) ? '—' : num(v * 100, d) + '%';
  const hhmm = (t) => { const d = new Date(t + api.utcOffset()); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const dayName = (t, i) => i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : api.fmtDay(t);

  const FIELDS = [
    ['importPrice', 'Electricity import price', 'p/kWh', 'importPrice', 0.01],
    ['exportPrice', 'Export payment (SEG)', 'p/kWh', 'exportPrice', 0.01],
    ['priceInflation', 'Import price rise', '% a year', 'priceInflation', 0.1],
    ['exportInflation', 'Export price rise', '% a year', null, 0.1],
    ['annualUse', 'Household electricity use', 'kWh a year', 'annualUse', 50],
    ['selfUseOverride', 'Share of solar used at home', '%', 'selfUse', 1],
    ['systemLosses', 'System losses', '%', 'systemLosses', 0.5],
    ['firstYearDegradation', 'Panel ageing, first year', '%', 'degradation', 0.1],
    ['degradation', 'Panel ageing, later years', '% a year', 'degradation', 0.05],
    ['costPerKwp', 'Installed cost per kWp', '£/kWp', 'cost', 10],
    ['totalCostOverride', 'Installed cost (your quote)', '£', 'vat', 10],
    ['inverterReplacement', 'Inverter replacement', '£', 'inverter', 10],
    ['inverterYear', 'Inverter replaced in year', '', 'inverter', 1],
    ['maintenance', 'Maintenance', '£ a year', null, 5],
    ['lifetime', 'System lifetime', 'years', null, 1],
    ['carbonFactor', 'Grid carbon intensity', 'kg/kWh', 'carbon', 0.001]
  ];
  const assumptions = () => ({ ...F.DEFAULTS, ...S.finance });

  // ---------------------------------------------------------------- numbers
  function compute() {
    const y = S.yieldRes; if (!y || !y.hourly) return null;
    const a = assumptions(), kwp = api.totalKwp(), d = api.designSummary();
    const h = y.hourly, starts = h.times.map(t => t - 3600000);
    const load = F.loadProfile(starts, a.annualUse, h.utcOffset);
    const pvAc = h.kwh.map(v => v * (1 - a.systemLosses / 100));
    const sc = F.selfConsumption(pvAc, load, S.battery || null);
    const scBatt = F.selfConsumption(pvAc, load, { capacity: 5, power: 2.5, efficiency: 0.9 });
    const cf = F.cashflow({ kwp, annualDcKWh: y.total, selfUseShare: sc.selfUseShare, assumptions: S.finance });
    const y1 = cf.years[0], life = cf.totals(cf.lifetime);
    const monthly = y.months.map(v => v * (1 - a.systemLosses / 100) * (1 - a.firstYearDegradation / 100));
    let recos = null, today = null, day = null;
    const f = S.forecastRes;
    if (f && f.series) {
      recos = F.recommend(f.series.times, f.series.kw, { utcOffsetMs: api.utcOffset(), annualUse: a.annualUse, now: Date.now(), days: 3 });
      if (fcKey !== f.at) { fcKey = f.at; fcDay = 0; }
      fcDay = Math.max(0, Math.min(fcDay, (f.days || []).length - 1));
      today = dayView(f, a, 0); day = fcDay ? dayView(f, a, fcDay) || today : today;
      if (day) day.index = day === today ? 0 : fcDay;
    }
    return { a, kwp, d, sc, scBatt, cf, y1, life, monthly, recos, today, day, y, f };
  }
  /** The forecast curve for one day of the week (0 = today): power after system losses, home use, cloud */
  function dayView(f, a, i) {
    const off = api.utcOffset(), d0 = new Date(Date.now() + off), t0 = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) - off + i * 86400000;
    const idx = f.series.times.map((t, k) => k).filter(k => f.series.times[k] >= t0 && f.series.times[k] < t0 + 86400000);
    if (!idx.length) return null;
    const xs = idx.map(k => f.series.times[k]), ys = idx.map(k => f.series.kw[k] * (1 - a.systemLosses / 100));
    const free = f.series.kwFree ? idx.map(k => f.series.kwFree[k] * (1 - a.systemLosses / 100)) : null;
    const step = xs.length > 1 ? (xs[1] - xs[0]) / 3600000 : 0.25;
    let pk = 0; ys.forEach((v, k) => { if (v > ys[pk]) pk = k; });
    const cloud = idx.map(k => f.series.cloud ? f.series.cloud[k] : null);
    return { t0, xs, ys, free: free && free.some((v, k) => v - ys[k] > 0.005) ? free : null, cloud, load: xs.map(t => F.loadAt(t, a.annualUse, off)),
      kwh: ys.reduce((s, v) => s + v * step, 0), peak: ys[pk], peakAt: xs[pk],
      cloudMean: cloud.some(v => v != null) ? cloud.filter(v => v != null).reduce((s, v) => s + v, 0) / cloud.filter(v => v != null).length : null };
  }
  const longDay = (t) => { const d = new Date(t + api.utcOffset()); return `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()]} ${d.getUTCDate()} ${api.MONTHS[d.getUTCMonth()]}`; };
  const fcTitle = (m) => !m.day || !m.day.index ? 'Today’s forecast' : `${longDay(m.day.t0).split(' ')[0]}’s forecast`;

  // ---------------------------------------------------------------- render
  function card(id, title, body, extra = '', action = '') { return `<section class="db-card ${extra}" id="${id}"><header class="db-card-head"><h3>${title}</h3>${action}</header>${body}</section>`; }
  /** My sites, first on the dashboard, with the button for a new one */
  function sitesCard() {
    const n = api.listSites().length;
    return card('db-sites', `My sites${n ? ` <span class="db-count">${n}</span>` : ''}`, sitesHtml(), 'span-12',
      '<button class="btn primary db-new-site" id="db-new-site"><svg><use href="#i-plus"/></svg>New site</button>');
  }
  function kpi(label, value, unit, sub, cls = '') { return `<div class="kpi ${cls}"><span class="kpi-label">${label}</span><div class="kpi-value">${value}${unit ? `<small>${unit}</small>` : ''}</div>${sub ? `<p class="kpi-sub">${sub}</p>` : ''}</div>`; }

  function overviewHtml(m) {
    const a = m.a, y1 = m.y1, saving = y1.selfSaving + y1.exportIncome - a.maintenance;
    const models = m.d.models.map(p => api.escapeHtml(api.PN.short(p))).join(', ') || 'Custom panels';
    const extraBatt = (m.scBatt.selfUseShare - m.sc.selfUseShare) * y1.generation * Math.max(0, y1.importPrice - y1.exportPrice);
    return `<div class="kpis">
      ${kpi('System capacity', num(m.kwp, 2), 'kWp', `${m.d.groups.length} array${m.d.groups.length === 1 ? '' : 's'} · ${models}`)}
      ${kpi('Panels', num(m.d.panels), '', m.d.groups.map(g => `${g.id}: ${g.panels} at ${g.tilt}° facing ${api.escapeHtml(compassWord(g.azimuth))}`).slice(0, 3).join('<br>'))}
      ${kpi('Estimated annual production', num(y1.generation), 'kWh', `${num(y1.generation / Math.max(m.kwp, 1e-6))} kWh per kWp · after ${num((m.y.shadingLoss || 0) * 100, 1)}% shading and ${num(a.systemLosses, 0)}% system losses`)}
      ${kpi('Estimated annual savings', money(saving), '', `<b>${money(y1.selfSaving)}</b> on bills: ${num(y1.selfUsed)} kWh you use yourself instead of buying it at ${num(a.importPrice, 2)}p<br><b>${money(y1.exportIncome)}</b> export income: ${num(y1.exported)} kWh sold to the grid at ${num(a.exportPrice, 1)}p`, 'wide')}
      ${kpi('CO₂ reduction', num(y1.generation * a.carbonFactor), 'kg a year', `About ${num(m.life.co2 / 1000, 1)} t over ${m.cf.lifetime} years at today's grid intensity (${a.carbonFactor} kg/kWh)`)}
      ${kpi('Estimated payback', m.cf.payback != null ? num(m.cf.payback, 1) : `> ${m.cf.years.length}`, 'years', `Installed cost ${money(m.cf.capex)} (${money(m.cf.costPerKwp)}/kWp, 0% VAT)`)}
      ${kpi('Lifetime return', pct(m.life.roi), '', `${money(m.life.net)} net over ${m.cf.lifetime} years, after the installed cost, inverter replacement and upkeep`)}
      ${kpi('Battery storage', 'None', '', `Battery and inverter design is coming next. Preview: a 5 kWh battery would raise the share of solar used at home from ${pct(m.sc.selfUseShare)} to ${pct(m.scBatt.selfUseShare)}, worth about ${money(extraBatt)} more a year (battery cost not included).`, 'muted')}
    </div>`;
  }
  const compassWord = (az) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(((az % 360) + 360) % 360 / 45) % 8];

  function forecastHtml(m) {
    if (!m.day) return '<p class="hint">The forecast for today is not loaded yet.</p>';
    const t = m.day, f = m.f, i = t.index;
    const strip = f.days.map((d, k) => `<button type="button" class="day-chip${k === i ? ' on' : ''}" data-day="${k}" aria-pressed="${k === i}" title="${k === 0 ? 'Today' : longDay(d.t)}: show its forecast">`
      + `<span>${k === 0 ? 'Today' : api.DAYS[new Date(d.t + api.utcOffset()).getUTCDay()]}</span><b>${num(d.kwh * (1 - m.a.systemLosses / 100), 1)}</b><small>kWh</small></button>`).join('');
    const when = i === 0 ? 'today' : 'on ' + longDay(t.t0);
    const cloud = t.cloudMean != null ? ` · cloud ${num(t.cloudMean, 0)}% on average` : '';
    const note = i === 0 ? '' : `<p class="hint fc-note">${i <= 2 ? 'Forecasts a day or two ahead are usually close.' : 'Further ahead the weather forecast is less certain, so treat this day as a guide.'} <button type="button" class="link" data-day="0">Back to today</button></p>`;
    return `<div class="fc-head"><div><span class="fc-big">${num(t.kwh, 1)}</span> kWh expected ${when}</div><div class="hint">Peak ${num(t.peak, 2)} kW at ${hhmm(t.peakAt)}${cloud} · ${api.escapeHtml(api.modelLabel(f.model))}</div></div>
      <div class="db-chart tall"><canvas id="db-today-chart" aria-label="Forecast for ${api.escapeHtml(when)}"></canvas></div>${note}
      <div class="day-strip" role="group" aria-label="Pick a day to see its forecast">${strip}</div>`;
  }
  /** Show another day in the forecast card without redrawing the rest of the dashboard */
  function pickDay(i, focus) {
    fcDay = i;
    const m = compute(); if (!m || !m.day) return;
    const cardEl = $('#db-forecast'); if (!cardEl) return;
    cardEl.querySelector('.db-card-head h3').textContent = fcTitle(m);
    const head = cardEl.querySelector('.db-card-head');
    while (head.nextSibling) head.nextSibling.remove();
    head.insertAdjacentHTML('afterend', forecastHtml(m));
    drawDay(m); wireDays();
    if (focus) { const b = cardEl.querySelector(`.day-chip[data-day="${m.day.index}"]`); if (b) b.focus(); }
  }
  function wireDays() {
    const cardEl = $('#db-forecast'); if (!cardEl) return;
    $$('[data-day]', cardEl).forEach(b => { b.onclick = () => pickDay(+b.dataset.day, b.classList.contains('day-chip')); });
    const strip = cardEl.querySelector('.day-strip');
    if (strip) strip.onkeydown = (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = strip.children.length; e.preventDefault(); pickDay((fcDay + (e.key === 'ArrowRight' ? 1 : n - 1)) % n, true);
    };
  }
  function drawDay(m) {
    const Ch = C(); if (!Ch || !m.day) return; const t = m.day;
    Ch.dayCurve($('#db-today-chart'), { xs: t.xs, ys: t.ys, free: t.free, load: t.load, cloud: t.cloud.every(v => v == null) ? null : t.cloud, now: t.index === 0 ? Date.now() : null, xMin: t.t0, xMax: t.t0 + 86400000, offsetMs: api.utcOffset() });
  }
  function recoHtml(m) {
    if (!m.recos || !m.recos.length) return '<p class="hint">Recommendations need the forecast.</p>';
    const days = m.recos.map((d, i) => {
      const rows = d.devices.map(dev => {
        const good = dev.share >= 0.6, ok = dev.share >= 0.3;
        const when = dev.start ? `${hhmm(dev.start)}–${hhmm(dev.end)}` : '—';
        return `<li class="${good ? 'good' : ok ? 'ok' : 'low'}"><span class="dev">${api.escapeHtml(dev.label)}</span><span class="when">${ok ? when : 'Low sun'}</span>
          <span class="cov"><span style="width:${Math.round(dev.share * 100)}%"></span></span><span class="covn">${ok ? Math.round(dev.share * 100) + '% solar' : 'off-peak'}</span></li>`;
      }).join('');
      const head = d.surplus > 0.5 ? `${num(d.surplus, 1)} kWh spare after normal use · peak around ${hhmm(d.peakAt)}` : 'Little spare solar: run big loads on your cheapest tariff hours';
      return `<div class="reco-day"><div class="reco-day-head"><b>${dayName(d.day, i)}</b><span>${head}</span></div><ul class="reco-list">${rows}</ul></div>`;
    }).join('');
    return `<p class="hint">For homes without a battery: start these when your panels make more than the house uses. Windows are for typical appliance loads; the bar shows how much of each run the forecast solar covers.</p>${days}`;
  }
  function shadeRows(list, total, factor, unit) {
    if (!list || !list.length) return '<p class="hint">Nothing shades the panels.</p>';
    const max = Math.max(...list.map(r => r.kwh));
    return `<ul class="shade-list">${list.map(r => `<li><span>${api.escapeHtml(r.label)}</span><span class="bar"><span style="width:${Math.round(r.kwh / max * 100)}%"></span></span><b>${num(r.kwh * factor, r.kwh * factor < 10 ? 1 : 0)} ${unit}</b></li>`).join('')}</ul>`;
  }
  function shadingHtml(m) {
    const a = m.a, ac = (1 - a.systemLosses / 100), y = m.y, f = m.f && m.f.shading;
    const yLost = (y.unshadedTotal ? y.unshadedTotal - y.total : 0) * ac * (1 - a.firstYearDegradation / 100);
    const nObs = S.objects.length;
    return `<div class="shade-cols">
      <div><div class="fc-head"><div><span class="fc-big">${f ? num(f.lostKWh * ac, 1) : '—'}</span> kWh lost in the next 7 days</div><div class="hint">${f ? num(f.pct * 100, 1) + '% of what the panels would make unshaded' : ''}</div></div>
        ${f ? shadeRows(f.by, f.lostKWh, ac, 'kWh') : '<p class="hint">Run the forecast.</p>'}</div>
      <div><div class="fc-head"><div><span class="fc-big">${num(yLost)}</span> kWh a year</div><div class="hint">${num((y.shadingLoss || 0) * 100, 1)}% over the last 12 months of weather</div></div>
        ${shadeRows(y.shadingBy, yLost, ac * (1 - a.firstYearDegradation / 100), 'kWh/yr')}</div>
    </div>
    <div class="row"><button class="btn" id="db-show-traces"><svg><use href="#i-shade"/></svg>See the line traces in 3D</button>
      <span class="hint">${nObs} object${nObs === 1 ? '' : 's'} · ${S.shade.samples === 2 ? '4 rays' : '1 ray'} per cell · ${S.shade.useTiles ? '3D-tile skyline included' : '3D tiles not included (trace the skyline in the 3D view)'}</span></div>
    <p class="hint">Each cell is traced toward the sun at every forecast step (15 minutes) and every hour of the year. A cell keeps the direct sun its trace lets through: none past walls, buildings, poles and other panels, the object's transparency through a canopy. The panels' loss is the cell average, and each object is charged for the cells it blocks. Diffuse light is not shaded.</p>`;
  }
  function financeHtml(m) {
    const segs = [5, 10, 15, 20].map(n => `<button data-h="${n}" aria-pressed="${n === horizon}">${n} years</button>`).join('');
    const t = m.cf.totals(horizon);
    return `<div class="fin-top"><div class="seg small" id="db-horizon">${segs}</div>
      <div class="fin-sum">
        <div><span>Savings and income</span><b>${money(t.savings)}</b></div>
        <div><span>Installed cost</span><b>${money(m.cf.capex)}</b></div>
        <div><span>Other costs</span><b>${money(t.costs)}</b></div>
        <div class="${t.net >= 0 ? 'pos' : 'neg'}"><span>Net position</span><b>${money(t.net)}</b></div>
        <div><span>Return</span><b>${pct(t.roi)}</b></div>
      </div></div>
      <div class="db-chart tall"><canvas id="db-finance-chart"></canvas></div>
      <p class="hint">Bars: yearly bill savings and export income. Line: running total after the ${money(m.cf.capex)} installed cost, so it crosses zero at payback${m.cf.payback != null ? ` (year ${num(m.cf.payback, 1)})` : ''}. Import prices rise ${m.a.priceInflation}% a year; panels lose ${m.a.firstYearDegradation}% in year 1 and ${m.a.degradation}% a year after; inverter replaced in year ${m.a.inverterYear}.</p>
      <details class="db-table"><summary>Year by year</summary><div class="table-wrap"><table class="results"><thead><tr><th>Year</th><th>kWh</th><th>Used at home</th><th>Exported</th><th>Bill saving</th><th>Export</th><th>Costs</th><th>Running total</th></tr></thead><tbody>
      ${m.cf.years.slice(0, Math.max(horizon, 1)).map(r => `<tr><td>${r.year}</td><td>${num(r.generation)}</td><td>${num(r.selfUsed)}</td><td>${num(r.exported)}</td><td>${money(r.selfSaving)}</td><td>${money(r.exportIncome)}</td><td>${money(r.costs)}</td><td>${money(r.cumulative)}</td></tr>`).join('')}
      </tbody></table></div></details>`;
  }
  function assumptionsHtml(m) {
    const a = m.a, src = F.SOURCES;
    const auto = { selfUseOverride: num(m.sc.selfUseShare * 100, 0), costPerKwp: num(F.costPerKwpFor(m.kwp)), totalCostOverride: num(m.kwp * (a.costPerKwp > 0 ? a.costPerKwp : F.costPerKwpFor(m.kwp))) };
    const rows = FIELDS.map(([k, label, unit, srcKey, step]) => {
      const v = S.finance[k], val = v == null ? (auto[k] != null ? '' : F.DEFAULTS[k]) : v;
      const ph = auto[k] != null ? auto[k] : '';
      return `<label class="as-row" title="${api.escapeHtml(srcKey ? src[srcKey] : 'Assumption')}"><span>${label}</span><span class="as-in"><input type="number" step="${step}" data-k="${k}" value="${val === '' ? '' : val}" placeholder="${ph}"><small>${unit}</small></span></label>`;
    }).join('');
    return `<div class="as-grid">${rows}</div><div class="row"><button class="btn ghost" id="db-as-reset">Reset to UK defaults</button></div>
      <p class="hint">Blue values are worked out for you; type a number to replace one. UK defaults, checked 3 Nov 2026: Ofgem price cap Oct–Dec 2026 (26.32p), a typical 12p export tariff, Ofgem's 2,500 kWh medium household, DESNZ 2026 carbon factor, DESNZ cost data, panel warranties. Hover a row for its source.</p>`;
  }
  function monthlyHtml(m) {
    const tot = m.monthly.reduce((s, v) => s + v, 0);
    return `<div class="fc-head"><div><span class="fc-big">${num(tot)}</span> kWh in year 1</div><div class="hint">${api.escapeHtml(api.modelLabel(m.y.model))} on ERA5 weather, ${api.fmtDay(m.y.start)} ${new Date(m.y.start).getUTCFullYear()} – ${api.fmtDay(m.y.end)} ${new Date(m.y.end).getUTCFullYear()}, after ${m.a.systemLosses}% system losses</div></div>
      <div class="db-chart tall"><canvas id="db-monthly-chart"></canvas></div>`;
  }
  function sitesHtml() {
    const list = api.listSites(), acct = S.account;
    const note = acct ? `<p class="hint">In your ARIEN account${acct.user.first_name ? ' (' + api.escapeHtml(acct.user.first_name) + ')' : ''}: the same sites as on arien.base44.app, on every device you sign in on.</p>` : '';
    if (!list.length) return note + '<p class="hint">No saved sites yet. Start one with <b>New site</b>, or save the design you are working on in the Design view.</p>';
    return `${note}<ul class="site-list">${list.map(x => {
      const open = api.isOpenSite(x);
      const n = x.panels, kwp = x.kwp, d = new Date(x.savedAt), place = x.place || '';
      const when = isFinite(d) ? ` · saved ${d.getDate()} ${api.MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
      return `<li${open ? ' class="open"' : ''}><div class="sl-main"${open ? '' : ` data-open="${x.id}" data-view="dashboard" role="button" tabindex="0" title="Show this site's dashboard"`}><b>${api.escapeHtml(x.name)}${open ? ' <span class="badge info">Open now</span>' : ''}</b><small>${place ? api.escapeHtml(place) + ' · ' : ''}${n} panels · ${num(kwp, 2)} kWp${when}${acct && !x.twin ? ' · made in the web designer' : ''}</small></div>
        <div class="sl-act">${open ? '' : `<button class="btn" data-open="${x.id}" data-view="dashboard">Dashboard</button>`}<button class="btn" data-open="${x.id}" data-view="design">Edit design</button><button class="btn" data-open="${x.id}" data-view="twin">Open in 3D</button><button class="icon-btn danger" data-del="${x.id}" title="Delete"><svg><use href="#i-trash"/></svg></button></div></li>`;
    }).join('')}</ul>`;
  }
  function reportHtml() {
    return `<div class="report-box"><div><b>Site report (PDF)</b><p class="hint">Satellite map with your layout, an engineering plan of the arrays, system specification, monthly yield, 7-day forecast, financial summary and every assumption, watermarked “Generated by Arien”.</p></div>
      <button class="btn primary" id="db-pdf"><svg><use href="#i-save"/></svg>Download PDF report</button></div><div class="status" id="db-pdf-status"></div>`;
  }

  /** The header's site picker: saved sites, plus the open design when it is not one of them */
  function renderPicker() {
    const sel = $('#db-site-pick'); if (!sel) return;
    const list = api.listSites(), cur = api.openSiteId();
    const opts = list.map(x => `<option value="${api.escapeHtml(x.id)}"${x.id === cur ? ' selected' : ''}>${api.escapeHtml(x.name)}</option>`);
    if (!cur) opts.unshift(`<option value="" selected>${S.arrays.length ? api.escapeHtml(api.siteLabel()) + ' (not saved)' : 'New site (not saved)'}</option>`);
    sel.innerHTML = opts.join('');
    sel.disabled = busy || (!list.length);
    $('#db-site-pick-wrap').hidden = !list.length;
  }
  function render() {
    const root_ = $('#db-body');
    renderPicker();
    // the header follows the open design, also before it has panels or results
    $('#db-site').textContent = S.arrays.length || S.designName ? api.siteLabel() : 'New site';
    $('#db-sub').textContent = `${S.site.name} · ${S.site.lat.toFixed(5)}, ${S.site.lon.toFixed(5)}${S.arrays.length ? ' · ' + num(api.totalKwp(), 2) + ' kWp' : ' · no panels yet'}`;
    if (!S.arrays.length) {
      root_.innerHTML = `${sitesCard()}<div class="db-empty"><h3>Design a system to see its dashboard</h3><p class="hint">Place panels on the satellite map, simulate them in 3D, then come back here for production, savings and the report.</p><button class="btn primary" id="db-go-design">Open Design</button></div>`;
      $('#db-go-design').onclick = () => api.newDesign(); wireCommon(); setFoot(null); return;
    }
    const m = compute();
    if (!m) {
      root_.innerHTML = `<div class="db-empty"><span class="spinner"></span><h3>${busy ? 'Simulating a year of weather and the next 7 days…' : 'Results needed'}</h3><p class="hint">${busy ? 'This takes a few seconds.' : 'Run the forecast and yield estimate for this design.'}</p>${busy ? '' : '<button class="btn primary" id="db-run">Run now</button>'}</div>`;
      root_.insertAdjacentHTML('afterbegin', sitesCard());
      const r = $('#db-run'); if (r) r.onclick = () => run(); wireCommon(); setFoot(null); return;
    }
    const stale = (S.yieldRes && S.yieldRes.stale) || (S.forecastRes && S.forecastRes.stale);
    $('#db-site').textContent = api.siteLabel();
    $('#db-sub').textContent = `${S.site.name} · ${S.site.lat.toFixed(5)}, ${S.site.lon.toFixed(5)} · ${num(m.kwp, 2)} kWp`;
    root_.innerHTML = `${sitesCard()}
      ${stale ? '<div class="db-stale">The design changed since these results. <button class="btn" id="db-rerun">Update results</button></div>' : ''}
      ${card('db-overview', 'Overview', overviewHtml(m), 'span-12')}
      ${card('db-forecast', fcTitle(m), forecastHtml(m), 'span-7')}
      ${card('db-reco', 'Recommendations', recoHtml(m), 'span-5')}
      ${card('db-shading', 'Shading from objects', shadingHtml(m), 'span-12')}
      ${card('db-finance', 'Financial overview', financeHtml(m), 'span-12')}
      ${card('db-monthly', 'Monthly production', monthlyHtml(m), 'span-12')}
      ${card('db-assume', 'Assumptions', assumptionsHtml(m), 'span-12')}
      ${card('db-reports', 'Reports', reportHtml(), 'span-12')}`;
    drawCharts(m); wireCommon(); setFoot(m);
    const rr = $('#db-rerun'); if (rr) rr.onclick = () => run(true);
    $('#db-horizon').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; horizon = +b.dataset.h; render(); };
    $('#db-assume').addEventListener('change', (e) => {
      const el = e.target.closest('input[data-k]'); if (!el) return;
      const k = el.dataset.k, v = el.value.trim();
      if (v === '') delete S.finance[k]; else { const n = Number(v); if (isFinite(n)) S.finance[k] = n; }
      api.saveSoon(); render();
    });
    $('#db-as-reset').onclick = () => { S.finance = {}; api.saveSoon(); render(); };
    $('#db-pdf').onclick = () => downloadReport(m);
    const st = $('#db-show-traces'); if (st) st.onclick = () => api.showTraces();
  }
  function wireCommon() {
    wireDays();
    const ns = $('#db-new-site'); if (ns) ns.onclick = () => api.newSite();
    $$('[data-open]', $('#db-body')).forEach(b => {
      if (busy) b.setAttribute('aria-disabled', 'true');
      const go = () => { if (busy) { api.toast('Wait for the results to finish, then switch site.', 'info'); return; } api.openSite(b.dataset.open, b.dataset.view); };
      b.onclick = go;
      if (b.tagName !== 'BUTTON') b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    $$('[data-del]', $('#db-body')).forEach(b => { b.onclick = () => {
      if (b.dataset.armed) { api.deleteSite(b.dataset.del); render(); return; }
      b.dataset.armed = '1'; b.classList.add('armed'); b.title = 'Click again to delete'; setTimeout(() => { delete b.dataset.armed; b.classList.remove('armed'); }, 3000);
    }; });
  }
  function setFoot(m) {
    const now = new Date();
    const src = api.weatherSources();
    $('#db-foot').innerHTML = `<span>Generated ${now.getDate()} ${api.MONTHS[now.getMonth()]} ${now.getFullYear()}, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}</span>
      <span>Weather data: ${src.length ? api.escapeHtml(src.join('; ')) : 'Open-Meteo.com (CC BY 4.0)'}. Open-Meteo data is CC BY 4.0; ERA5 contains modified Copernicus Climate Change Service information.</span>
      <span>Prices, costs and carbon: see Assumptions. Estimates, not a quote.</span>`;
  }
  function drawCharts(m) {
    const Ch = C(); if (!Ch) return; const P = Ch.PALETTE();
    drawDay(m);
    const ys = m.cf.years.slice(0, horizon);
    Ch.combo($('#db-finance-chart'), { labels: ys.map(r => 'Y' + r.year), stacks: [{ label: 'Bill savings', values: ys.map(r => r.selfSaving), color: P.sun }, { label: 'Export income', values: ys.map(r => r.exportIncome), color: P.sky }],
      line: { label: 'Running total', values: ys.map(r => r.cumulative), color: P.good }, yTitle: '£ a year', y2: true, y2Title: '£ running total', zeroLine: true,
      yTick: (v) => '£' + num(v), y2Tick: (v) => (v < 0 ? '−£' : '£') + num(Math.abs(v)), tooltip: (c) => `${c.dataset.label}: ${money(c.parsed.y)}` });
    Ch.bars($('#db-monthly-chart'), { labels: api.MONTHS, values: m.monthly, color: P.sky, unit: 'kWh', decimals: 0, yTitle: 'kWh', valueLabels: true });
  }

  async function downloadReport(m) {
    const st = $('#db-pdf-status'), btn = $('#db-pdf');
    if (!root.ArienReport) { st.textContent = 'The report module did not load.'; return; }
    btn.disabled = true; st.className = 'status'; st.textContent = 'Building the report: map imagery, plan and charts…';
    try {
      const name = await root.ArienReport.download(reportData(m), (msg) => { st.textContent = msg; });
      st.className = 'status ok'; st.textContent = `Downloaded ${name}.`;
    } catch (e) { st.className = 'status err'; st.textContent = 'Could not build the PDF: ' + (e.message || e); }
    finally { btn.disabled = false; }
  }
  /** Plain data for the report (no DOM): design geometry, results, finance and sources */
  function reportData(m) {
    const a = m.a, src = F.SOURCES;
    const asRows = FIELDS.map(([k, label, unit, srcKey]) => {
      const v = S.finance[k];
      const shown = k === 'selfUseOverride' ? (v == null ? `${num(m.sc.selfUseShare * 100, 0)}% (simulated)` : `${v}%`)
        : k === 'costPerKwp' ? (v == null ? `£${num(F.costPerKwpFor(m.kwp))}/kWp (by size)` : `£${num(v)}/kWp`)
        : k === 'totalCostOverride' ? (v == null ? `£${num(m.cf.capex)} (estimate)` : `£${num(v)} (quote)`)
        : unit === '£' ? `£${num(a[k])}` : unit === '£ a year' ? `£${num(a[k])} a year`
        : `${a[k]}${unit ? (unit.startsWith('%') ? '' : ' ') + unit : ''}`;
      return [label, shown, srcKey ? src[srcKey] : 'ARIEN default', v != null];
    });
    return {
      title: api.siteLabel(), site: { ...S.site }, generatedAt: new Date(), weatherSources: api.weatherSources(),
      design: m.d, zones: S.zones.map(z => ({ name: z.name, poly: z.poly })), objects: S.objects.map(o => ({ type: o.type, label: api.PH.objectLabel(o), x: o.x, y: o.y, heading: o.heading, dims: { ...o.dims }, poly: api.PH.footprintWorld(o) })),
      kpis: { kwp: m.kwp, panels: m.d.panels, production: m.y1.generation, savings: m.y1.selfSaving + m.y1.exportIncome - a.maintenance, selfSaving: m.y1.selfSaving, exportIncome: m.y1.exportIncome,
        selfUsed: m.y1.selfUsed, exported: m.y1.exported, co2: m.y1.generation * a.carbonFactor, payback: m.cf.payback, roi: m.life.roi, net: m.life.net, capex: m.cf.capex, lifetime: m.cf.lifetime, selfUseShare: m.sc.selfUseShare, specific: m.y1.generation / Math.max(m.kwp, 1e-6) },
      shading: { year: { pct: m.y.shadingLoss || 0, by: (m.y.shadingBy || []).map(r => ({ label: r.label, kwh: r.kwh * (1 - a.systemLosses / 100) * (1 - a.firstYearDegradation / 100) })) },
        week: m.f && m.f.shading ? { pct: m.f.shading.pct, kwh: m.f.shading.lostKWh * (1 - a.systemLosses / 100), by: m.f.shading.by.map(r => ({ label: r.label, kwh: r.kwh * (1 - a.systemLosses / 100) })) } : null,
        samples: S.shade.samples, tiles: !!S.shade.useTiles, objects: S.objects.map(o => ({ label: api.PH.objectLabel(o), h: o.dims.height, transparency: api.PH.OBJECT_TYPES[o.type].porous ? (o.porosity || 0) : 0 })) },
      monthly: m.monthly, monthsLabel: api.MONTHS, yieldInfo: { model: api.modelLabel(m.y.model), start: m.y.start, end: m.y.end, shadingLoss: m.y.shadingLoss, dcTotal: m.y.total, systemLosses: a.systemLosses },
      forecast: m.f ? { model: api.modelLabel(m.f.model), days: m.f.days.map(d => ({ t: d.t, label: api.fmtDay(d.t), kwh: d.kwh * (1 - a.systemLosses / 100) })), source: m.f.source } : null,
      finance: { horizons: [5, 10, 15, 20, m.cf.lifetime].map(n => m.cf.totals(n)), years: m.cf.years.slice(0, m.cf.lifetime), capex: m.cf.capex, payback: m.cf.payback },
      assumptions: asRows, utcOffset: api.utcOffset(), models: m.d.models
    };
  }

  async function run(force) {
    if (busy) return; busy = true; render();
    try { if (force) { if (S.yieldRes) S.yieldRes.stale = true; if (S.forecastRes) S.forecastRes.stale = true; } await api.ensureResults(); }
    finally { busy = false; render(); }
  }

  root.ArienDashboard = {
    /** The saved-site list changed (account sync): redraw if the dashboard is showing */
    rerender() { if (S && S.view === 'dashboard' && !busy) render(); },
    init(a) {
      api = a; S = a.state; F = root.ArienFinance; $$('#dashboard [data-goto]').forEach(btn => { btn.onclick = () => api.setView(btn.dataset.goto); });
      const sel = $('#db-site-pick');
      if (sel) sel.onchange = () => { const id = sel.value; if (id) api.openSite(id, 'dashboard', renderPicker); };
    },
    show() {
      render();
      const need = S.arrays.length && (!S.yieldRes || !S.forecastRes || !S.forecastRes.series || S.yieldRes.stale || S.forecastRes.stale);
      if (need) run();
    },
    refresh() {
      if (!S || S.view !== 'dashboard' || busy) return;
      const key = [S.yieldRes && S.yieldRes.at, S.yieldRes && S.yieldRes.stale, S.forecastRes && S.forecastRes.at, S.forecastRes && S.forecastRes.stale, S.arrays.length].join('|');
      if (key !== lastKey) { lastKey = key; render(); }
    },
    _compute: () => compute(), _reportData: () => { const m = compute(); return m && reportData(m); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
