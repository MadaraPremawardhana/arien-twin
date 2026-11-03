/* ARIEN charts — one Chart.js look for every chart in the app: flat bars without outlines, light grid,
 * units in tooltips and axes. Browser only: window.ArienCharts. */
(function (root) {
  'use strict';
  const css = (n, d) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d);
  const PALETTE = () => ({ sun: css('--sun', '#f3b23c'), sky: css('--sky', '#6cc3e8'), good: css('--good', '#69c38a'), bad: css('--bad', '#e5675c'),
    fg: css('--fg', '#e3ebf0'), muted: css('--muted', '#8ea3b1'), grid: 'rgba(150, 186, 206, 0.10)', axis: 'rgba(150, 186, 206, 0.28)' });
  const FONT = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif', MONO = '"IBM Plex Mono", ui-monospace, monospace';
  const fmtNum = (v, d = 0) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (v, cur = '£', d = 0) => (v < 0 ? '−' : '') + cur + fmtNum(Math.abs(v), d);

  function scales(p, o) {
    const s = {
      x: { stacked: !!o.stacked, grid: { display: false }, border: { color: p.axis }, ticks: { color: p.muted, font: { family: MONO, size: 10.5 }, maxRotation: 0, autoSkipPadding: 8 } },
      y: { stacked: !!o.stacked, beginAtZero: true, grid: { color: p.grid }, border: { display: false }, ticks: { color: p.muted, font: { family: MONO, size: 10.5 }, maxTicksLimit: 5, callback: o.yTick || ((v) => fmtNum(v, Math.abs(v) < 10 && v % 1 ? 1 : 0)) },
        title: o.yTitle ? { display: true, text: o.yTitle, color: p.muted, font: { family: FONT, size: 11 } } : undefined }
    };
    if (o.y2) s.y2 = { position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: p.muted, font: { family: MONO, size: 10.5 }, maxTicksLimit: 5, callback: o.y2Tick },
      title: o.y2Title ? { display: true, text: o.y2Title, color: p.muted, font: { family: FONT, size: 11 } } : undefined, ...(o.y2Opts || {}) };
    if (o.xTime) Object.assign(s.x, { type: 'linear', min: o.xMin, max: o.xMax, ticks: { ...s.x.ticks, stepSize: o.xStep, callback: o.xTick } });
    return s;
  }
  function options(p, o) {
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 6, right: 4 } },
      plugins: {
        legend: { display: !!o.legend, position: 'bottom', labels: { color: p.muted, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', font: { family: FONT, size: 11.5 } } },
        tooltip: { backgroundColor: 'rgba(12, 20, 26, 0.96)', borderColor: p.axis, borderWidth: 1, titleColor: p.fg, bodyColor: p.fg, padding: 9, cornerRadius: 6,
          titleFont: { family: FONT, size: 12, weight: '600' }, bodyFont: { family: MONO, size: 11.5 },
          callbacks: { label: o.tooltip || ((c) => `${c.dataset.label ? c.dataset.label + ': ' : ''}${fmtNum(c.parsed.y, o.decimals ?? 1)} ${o.unit || ''}`.trim()), ...(o.tooltipTitle ? { title: o.tooltipTitle } : {}) } }
      },
      scales: scales(p, o)
    };
  }
  const bar = (data, color, extra = {}) => ({ type: 'bar', data, backgroundColor: color, hoverBackgroundColor: color, borderWidth: 0, borderRadius: 3, borderSkipped: 'start', maxBarThickness: 34, categoryPercentage: 0.72, barPercentage: 0.9, ...extra });

  function make(canvas, config) {
    if (!root.Chart || !canvas) return null;
    const old = Chart.getChart(canvas); if (old) old.destroy();
    return new Chart(canvas, config);
  }
  /** Simple bar chart: {labels, values, color, unit, yTitle, decimals, valueLabels} */
  function bars(canvas, o) {
    const p = PALETTE();
    const ds = [bar(o.values, o.color || p.sun, { label: o.label || '' })];
    const cfg = { type: 'bar', data: { labels: o.labels, datasets: ds }, options: options(p, o) };
    if (o.valueLabels) cfg.plugins = [valueLabels(p, o)];
    return make(canvas, cfg);
  }
  /** Stacked bars plus an optional line on a second axis: {labels, stacks:[{label, values, color}], line:{label, values, color}} */
  function combo(canvas, o) {
    const p = PALETTE();
    const ds = o.stacks.map(s => bar(s.values, s.color, { label: s.label, stack: 's', yAxisID: 'y', order: 2 }));
    if (o.line) ds.push({ type: 'line', label: o.line.label, data: o.line.values, borderColor: o.line.color || p.fg, backgroundColor: o.line.color || p.fg, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25, yAxisID: o.lineAxis || 'y2', order: 1 });
    return make(canvas, { type: 'bar', data: { labels: o.labels, datasets: ds }, options: options(p, { ...o, stacked: true, legend: true }), plugins: o.zeroLine ? [zeroLine(p, o.lineAxis || 'y2')] : [] });
  }
  /** Time series of power through a day: {xs (ms), ys (kW), now, xMin, xMax, offsetMs, cloud (optional %)} */
  function dayCurve(canvas, o) {
    const p = PALETTE(), off = o.offsetMs || 0;
    const hh = (t) => { const d = new Date(t + off); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
    const ctxFill = (ctx) => {
      const { chart } = ctx; const { chartArea } = chart; if (!chartArea) return 'rgba(243,178,60,0.25)';
      const g = chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom); g.addColorStop(0, 'rgba(243,178,60,0.45)'); g.addColorStop(1, 'rgba(243,178,60,0.02)'); return g;
    };
    const ds = [{ type: 'line', label: 'Solar power', data: o.xs.map((x, i) => ({ x, y: o.ys[i] })), borderColor: p.sun, backgroundColor: ctxFill, fill: 'origin', borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.3, yAxisID: 'y' }];
    if (o.free) ds.push({ type: 'line', label: 'Without shading', data: o.xs.map((x, i) => ({ x, y: o.free[i] })), borderColor: 'rgba(243,178,60,0.7)', borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0, tension: 0.3, yAxisID: 'y' });
    if (o.load) ds.push({ type: 'line', label: 'Typical home use', data: o.xs.map((x, i) => ({ x, y: o.load[i] })), borderColor: 'rgba(227,235,240,0.55)', borderDash: [4, 3], borderWidth: 1.3, pointRadius: 0, tension: 0.3, yAxisID: 'y' });
    if (o.cloud) ds.push({ type: 'line', label: 'Cloud cover', data: o.xs.map((x, i) => ({ x, y: o.cloud[i] })), borderColor: 'rgba(108,195,232,0.6)', borderWidth: 1.2, pointRadius: 0, tension: 0.3, yAxisID: 'y2' });
    const opt = options(p, { ...o, legend: true, xTime: true, xMin: o.xMin, xMax: o.xMax, xStep: 3 * 3600000, xTick: (v) => hh(v), yTitle: 'kW',
      y2: !!o.cloud, y2Tick: (v) => v + '%', y2Opts: { min: 0, max: 100 },
      tooltipTitle: (items) => items.length ? hh(items[0].parsed.x) : '',
      tooltip: (c) => c.dataset.yAxisID === 'y2' ? `Cloud: ${Math.round(c.parsed.y)}%` : `${c.dataset.label}: ${fmtNum(c.parsed.y, 2)} kW` });
    return make(canvas, { type: 'line', data: { datasets: ds }, options: opt, plugins: o.now ? [nowMarker(p, o.now)] : [] });
  }
  // ---- small plugins
  function nowMarker(p, t) {
    return { id: 'nowMarker', afterDatasetsDraw(c) {
      const x = c.scales.x.getPixelForValue(t); if (x < c.chartArea.left || x > c.chartArea.right) return;
      const g = c.ctx; g.save(); g.strokeStyle = p.fg; g.globalAlpha = 0.6; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, c.chartArea.top); g.lineTo(x, c.chartArea.bottom); g.stroke();
      g.setLineDash([]); g.globalAlpha = 1; g.fillStyle = p.fg; g.font = `600 10px ${FONT}`; g.textAlign = 'center'; g.fillText('NOW', x, c.chartArea.top - 1); g.restore();
    } };
  }
  function zeroLine(p, axis) {
    return { id: 'zeroLine', afterDatasetsDraw(c) {
      const sc = c.scales[axis]; if (!sc) return; const y = sc.getPixelForValue(0); if (y < c.chartArea.top || y > c.chartArea.bottom) return;
      const g = c.ctx; g.save(); g.strokeStyle = p.axis; g.lineWidth = 1; g.beginPath(); g.moveTo(c.chartArea.left, y); g.lineTo(c.chartArea.right, y); g.stroke(); g.restore();
    } };
  }
  function valueLabels(p, o) {
    return { id: 'valueLabels', afterDatasetsDraw(c) {
      const g = c.ctx, meta = c.getDatasetMeta(0); g.save(); g.fillStyle = p.fg; g.font = `500 10.5px ${MONO}`; g.textAlign = 'center';
      meta.data.forEach((el, i) => { const v = o.values[i]; if (!(v > 0)) return; g.fillText(fmtNum(v, v >= 100 ? 0 : 1), el.x, el.y - 4); }); g.restore();
    } };
  }
  root.ArienCharts = { bars, combo, dayCurve, make, PALETTE, fmtNum, money };
})(typeof window !== 'undefined' ? window : globalThis);
