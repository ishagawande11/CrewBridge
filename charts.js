// Small dependency-free SVG charts (no CDN, so everything works offline).
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(k);
  return el;
};

let tip;
function showTip(text, x, y) {
  if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; document.body.append(tip); }
  tip.textContent = text; tip.style.left = `${x}px`; tip.style.top = `${y}px`; tip.style.display = 'block';
}
const hideTip = () => { if (tip) tip.style.display = 'none'; };

/** Vertical bars. data: [{label, sub, value}] */
export function barChart(data, { unit = 'h', height = 230 } = {}) {
  const W = 640; const H = height; const m = { l: 34, r: 8, t: 12, b: 34 };
  const max = Math.max(4, Math.ceil(Math.max(...data.map((d) => d.value)) / 4) * 4);
  const iw = W - m.l - m.r; const ih = H - m.t - m.b;
  const slot = iw / data.length; const bw = Math.min(30, slot * 0.58);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Hours per day' });
  svg.append(s('defs', {}, s('linearGradient', { id: 'barGrad', x1: '0', y1: '0', x2: '0', y2: '1' },
    s('stop', { offset: '0', 'stop-color': '#8b5cf6' }), s('stop', { offset: '1', 'stop-color': '#4f46e5' }))));

  for (let i = 0; i <= 4; i++) {
    const y = m.t + ih - (ih * i) / 4;
    svg.append(s('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y, y2: y }));
    const t = s('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end' }); t.textContent = Math.round((max * i) / 4);
    svg.append(t);
  }
  data.forEach((d, i) => {
    const x = m.l + slot * i + (slot - bw) / 2;
    const bh = Math.max(d.value ? 4 : 0, (d.value / max) * ih);
    const y = m.t + ih - bh;
    const hit = s('rect', { x: m.l + slot * i, y: m.t, width: slot, height: ih, fill: 'transparent' });
    const bar = s('rect', { class: 'bar', x, y, width: bw, height: bh, rx: 6 });
    hit.addEventListener('mousemove', (e) => showTip(`${d.sub}: ${d.value}${unit}`, e.clientX, e.clientY));
    hit.addEventListener('mouseleave', hideTip);
    svg.append(bar, hit);
    if (i % 2 === 0 || data.length <= 8) {
      const t = s('text', { x: x + bw / 2, y: H - 12, 'text-anchor': 'middle' }); t.textContent = d.label;
      svg.append(t);
    }
  });
  return svg;
}

/** Donut with a legend. data: [{label, value, color}] */
export function donut(data, { centerLabel = 'total' } = {}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const R = 56; const C = 2 * Math.PI * R;
  const svg = s('svg', { viewBox: '0 0 150 150', width: 150, height: 150, role: 'img', 'aria-label': 'Timesheets by status' });
  svg.append(s('circle', { cx: 75, cy: 75, r: R, fill: 'none', stroke: 'var(--line)', 'stroke-width': 16 }));
  let offset = 0;
  if (total) {
    for (const d of data) {
      if (!d.value) continue;
      const len = (d.value / total) * C;
      svg.append(s('circle', {
        cx: 75, cy: 75, r: R, fill: 'none', stroke: d.color, 'stroke-width': 16,
        'stroke-dasharray': `${Math.max(len - 3, 0.5)} ${C}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 75 75)', 'stroke-linecap': 'round',
      }));
      offset += len;
    }
  }
  const big = s('text', { class: 'donut-center', x: 75, y: 78, 'text-anchor': 'middle' }); big.textContent = total;
  const small = s('text', { class: 'donut-sub', x: 75, y: 96, 'text-anchor': 'middle' }); small.textContent = centerLabel;
  svg.append(big, small);

  const wrap = document.createElement('div'); wrap.className = 'donut-wrap';
  const legend = document.createElement('div'); legend.className = 'legend';
  for (const d of data) {
    const row = document.createElement('div');
    const dot = document.createElement('i'); dot.style.background = d.color;
    const name = document.createElement('span'); name.textContent = d.label;
    const val = document.createElement('b'); val.textContent = d.value;
    row.append(dot, name, val); legend.append(row);
  }
  wrap.append(svg, legend);
  return wrap;
}
