const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const COLORS = ['#1672d4', '#8068b5', '#2b8b78', '#c18b35', '#677184'];
const empty = () => ({ rendered: false, destroy() {} });
const number = value => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);

/** Render aggregate bars only; the caller owns the accompanying accessible table. */
export function drawBarChart(container, { title = '', labels, series, unit = '', horizontal = false } = {}) {
  const Chart = globalThis.Chart;
  if (!container?.ownerDocument || typeof container.append !== 'function' || typeof Chart !== 'function' || !Array.isArray(labels) || !labels.length || labels.some(label => typeof label !== 'string') || !Array.isArray(series) || !series.length || series.some(entry => !entry || typeof entry.label !== 'string' || !Array.isArray(entry.values))) return empty();
  const data = {
    labels: [...labels],
    datasets: series.map((entry, index) => ({
      label: entry.label,
      data: labels.map((_, position) => typeof entry.values[position] === 'number' && Number.isFinite(entry.values[position]) && entry.values[position] >= 0 ? entry.values[position] : null),
      backgroundColor: typeof entry.color === 'string' && /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(entry.color) ? entry.color : COLORS[index % COLORS.length],
      borderWidth: 0, borderRadius: 3, maxBarThickness: 26, skipNull: false,
    })),
  };
  if (!data.datasets.some(entry => entry.data.some(value => value !== null))) return empty();
  let chart, canvas, observer, frame, stopped = false;
  const resize = () => {
    if (stopped || !chart || frame !== undefined) return;
    const apply = () => { frame = undefined; if (!stopped) { try { chart?.resize(); } catch {} } };
    if (typeof globalThis.requestAnimationFrame === 'function') frame = globalThis.requestAnimationFrame(apply);
    else apply();
  };
  const destroy = () => {
    if (stopped) return;
    stopped = true;
    observer?.disconnect(); observer = null;
    globalThis.removeEventListener?.('resize', resize);
    if (frame !== undefined) globalThis.cancelAnimationFrame?.(frame);
    frame = undefined;
    try { (chart || Chart.getChart?.(canvas))?.destroy(); } catch {}
    chart = null;
    data.labels.length = 0;
    for (const entry of data.datasets) entry.data.length = 0;
    data.datasets.length = 0;
    if (canvas) {
      canvas.width = 0; canvas.height = 0;
      canvas.removeAttribute('aria-label'); canvas.removeAttribute('role');
      canvas.remove(); canvas = null;
    }
  };
  try {
    canvas = container.ownerDocument.createElement('canvas');
    canvas.className = 'platform-chart-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${typeof title === 'string' && title ? title : '统计图'}。${data.datasets.map(entry => entry.label).join('、')}。详细数值见对应表格。`);
    container.append(canvas);
    const metricAxis = horizontal ? 'x' : 'y';
    chart = new Chart(canvas, {
      type: 'bar', data,
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        locale: 'zh-CN', indexAxis: horizontal ? 'y' : 'x',
        font: { family: FONT, size: 12 }, color: '#606069',
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: data.datasets.length > 1, labels: { usePointStyle: true, boxWidth: 10, boxHeight: 10, font: { family: FONT, size: 12 } } },
          tooltip: { enabled: true, callbacks: { label(context) { const known = typeof context.raw === 'number' && Number.isFinite(context.raw) && context.raw >= 0; return `${context.dataset.label}：${known ? number(context.raw) : '未知'}${known && typeof unit === 'string' && unit ? ` ${unit}` : ''}`; } } },
        },
        scales: {
          x: { grid: { color: '#e1e1e6' }, ticks: { font: { family: FONT, size: 11 } } },
          y: { grid: { color: '#e1e1e6' }, ticks: { font: { family: FONT, size: 11 }, autoSkip: false } },
          [metricAxis]: { beginAtZero: true, grid: { color: '#e1e1e6' }, ticks: { font: { family: FONT, size: 11 }, precision: unit === '数量' || unit === '应用数' ? 0 : undefined }, title: { display: typeof unit === 'string' && Boolean(unit), text: unit, font: { family: FONT, size: 11 } } },
        },
      },
    });
    if (typeof globalThis.ResizeObserver === 'function') { observer = new globalThis.ResizeObserver(resize); observer.observe(container); }
    else globalThis.addEventListener?.('resize', resize);
    return { rendered: true, destroy };
  } catch { destroy(); return empty(); }
}
