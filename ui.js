// UI toolkit: DOM helper, icons, toasts, modals, badges, tables, formatting.
// Text is always added as text nodes, so user-supplied data can never inject HTML.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') { if (v) el[k] = true; }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---------- icons (24x24, stroke) ----------
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.8"/><rect x="14" y="3" width="7" height="5" rx="1.8"/><rect x="14" y="12" width="7" height="9" rx="1.8"/><rect x="3" y="16" width="7" height="5" rx="1.8"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8.3-8 9-4.8-.7-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2.4"/><path d="M9 7V5.5A1.5 1.5 0 0110.5 4h3A1.5 1.5 0 0115 5.5V7M3 13h18"/>',
  file: '<path d="M14 3H7.5A2.5 2.5 0 005 5.5v13A2.5 2.5 0 007.5 21h9a2.5 2.5 0 002.5-2.5V8l-5-5z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wallet: '<path d="M3 7.5A2.5 2.5 0 015.5 5H18a1 1 0 011 1v2"/><path d="M3 7.5V18a2 2 0 002 2h14a1 1 0 001-1v-3"/><path d="M21 9h-4.5a2.5 2.5 0 000 5H21V9z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18.5 14.3c1.9.8 3 2.6 3 5.7"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  bell: '<path d="M6 9a6 6 0 1112 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 004 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 9.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 18v1a2 2 0 002 2h12a2 2 0 002-2v-1"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 004.2 4.2"/>',
  alert: '<path d="M12 3.5l10 17.5H2L12 3.5z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.4"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2.2"/><rect x="3" y="13" width="18" height="7" rx="2.2"/><path d="M7 7.5v.01M7 16.5v.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2.4"/><path d="M8 10V7a4 4 0 018 0v3"/>',
  database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  refresh: '<path d="M20 11a8 8 0 00-14.6-4M4 4v4h4M4 13a8 8 0 0014.6 4M20 20v-4h-4"/>',
  idcard: '<rect x="3" y="5" width="18" height="14" rx="2.4"/><circle cx="9" cy="11" r="2"/><path d="M5.8 16c.5-1.7 1.7-2.5 3.2-2.5s2.7.8 3.2 2.5M15 10h3M15 14h3"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  bridge: '<path d="M3 17h18M6 17V8M18 8v9M6 8c3 6 9 6 12 0M9.5 17v-4M12 17v-5M14.5 17v-4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.4"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2.4"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5v.01M18 14.5v.01"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/>',
};

export function icon(name, size) {
  const span = document.createElement('span');
  span.className = 'ico';
  if (size) span.style.fontSize = `${size}px`;
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`; // static constants only
  return span;
}

// ---------- formatting ----------
let currency = 'INR';
export const setCurrency = (c) => { currency = c; };
export const getCurrency = () => currency;
export function money(value) {
  const n = Number(value);
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: n % 1 ? 2 : 0, minimumFractionDigits: n % 1 ? 2 : 0 }).format(n); }
  catch { return `${currency} ${n.toFixed(2)}`; }
}
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const fmtDay = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const hoursText = (n) => `${Number(n).toFixed(2).replace(/\.?0+$/, '')}h`;
export const titleCase = (s) => String(s).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return fmtDay(iso);
}
export const todayLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

// ---------- colours: stable gradient per name ----------
const GRADS = [
  ['#6366f1', '#8b5cf6'], ['#0ea5e9', '#6366f1'], ['#10b981', '#0ea5e9'], ['#f59e0b', '#ef4444'],
  ['#ec4899', '#8b5cf6'], ['#14b8a6', '#22c55e'], ['#f43f5e', '#f59e0b'], ['#3b82f6', '#06b6d4'],
];
export function gradientFor(text) {
  let hash = 0;
  for (const ch of String(text)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = GRADS[hash % GRADS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}
export function avatar(name, size = '') {
  const initials = String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  return h('div', { class: `avatar ${size}`, style: { background: gradientFor(name) }, 'aria-hidden': 'true' }, initials || '?');
}

// ---------- status badges ----------
const TONE = {
  VERIFIED: 'ok', APPROVED: 'ok', OPEN: 'ok', PAID: 'ok',
  PENDING_REVIEW: 'warn', PENDING: 'warn', SUBMITTED: 'warn',
  REJECTED: 'bad', CLOSED: 'bad', EXPIRED: 'bad',
  REGISTERED: 'neutral', FILLED: 'neutral',
};
export const badge = (status, label) => h('span', { class: `badge ${TONE[status] ?? ''}` }, label || titleCase(status));

// ---------- toasts ----------
export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind === 'bad' ? 'bad' : ''}`, role: kind === 'bad' ? 'alert' : 'status' }, icon(kind === 'bad' ? 'xCircle' : 'checkCircle'), h('span', {}, message));
  box.append(t);
  const remove = () => { t.classList.add('leaving'); setTimeout(() => t.remove(), 200); };
  setTimeout(remove, kind === 'bad' ? 6000 : 3200);
  t.addEventListener('click', remove);
}

// ---------- modal ----------
export function openModal({ title, subtitle, body, actions = [], wide = false, onClose }) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const foot = actions.length && h('div', { class: 'modal-foot' }, actions.map((a) => {
    const b = h('button', { class: `btn ${a.kind || ''}`, type: 'button' }, a.icon && icon(a.icon), a.label);
    b.addEventListener('click', () => (a.onClick ? a.onClick({ close, button: b }) : close()));
    return b;
  }));
  const modal = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('div', {}, h('h3', {}, title), subtitle && h('p', {}, subtitle)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div', { class: 'modal-body' }, body), foot);
  backdrop.append(modal);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  modal.querySelector('input, textarea, select')?.focus();
  return { close, modal };
}

/** Ask for a yes/no. Resolves true or false. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', kind = 'primary' }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { answered = true; resolve(v); };
    openModal({
      title, body: h('p', { class: 'ink-2' }, message),
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: ({ close }) => { done(false); close(); } },
        { label: confirmLabel, kind, onClick: ({ close }) => { done(true); close(); } },
      ],
    });
  });
}

/** Ask for a short note. Resolves to the text ('' if optional and empty) or null if cancelled. */
export function noteDialog({ title, subtitle, label, placeholder, required = false, confirmLabel = 'Confirm', kind = 'danger' }) {
  return new Promise((resolve) => {
    let answered = false;
    const area = h('textarea', { class: 'textarea', maxlength: '300', placeholder: placeholder || '' });
    const error = h('div', { class: 'hint', style: { color: 'var(--bad)', minHeight: '1.2em' } });
    const done = (v) => { answered = true; resolve(v); };
    openModal({
      title, subtitle,
      body: h('div', { class: 'field', style: { margin: 0 } }, h('label', {}, label), area, error),
      onClose: () => { if (!answered) resolve(null); },
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: ({ close }) => { done(null); close(); } },
        { label: confirmLabel, kind, onClick: ({ close }) => {
          const text = area.value.trim();
          if (required && !text) { error.textContent = 'Please write a short note.'; area.focus(); return; }
          done(text); close();
        } },
      ],
    });
  });
}

// ---------- layout helpers ----------
export const field = (label, input, hint) => h('div', { class: 'field' }, h('label', {}, label), input, hint && h('div', { class: 'hint' }, hint));

export function pageHead(title, subtitle, ...actions) {
  return h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), subtitle && h('p', {}, subtitle)), actions.length ? h('div', { class: 'row' }, actions) : null);
}

export function empty(iconName, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, icon(iconName)), h('h4', {}, title), text && h('p', {}, text), action && h('div', { style: { marginTop: '16px' } }, action));
}

export function table(columns, rows, { emptyView, foot } = {}) {
  if (!rows.length) return emptyView || empty('inbox', 'Nothing here yet');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => h('td', { class: c.num ? 'num' : '' }, c.render(r)))))),
    foot && h('tfoot', {}, h('tr', {}, foot.map((cell, i) => h('td', { class: columns[i]?.num ? 'num' : '' }, cell))))));
}

export function statTile({ label, value, sub, iconName, tone = 'brand', onClick }) {
  const onkeydown = onClick && ((e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
  return h('div', { class: `card stat ${onClick ? 'link' : ''}`, onclick: onClick, onkeydown, role: onClick ? 'link' : undefined, tabindex: onClick ? '0' : undefined },
    h('div', { class: `stat-icon tone-${tone}` }, icon(iconName)),
    h('div', {}, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), sub && h('div', { class: 'stat-sub' }, sub)));
}

export function skeletonPage() {
  const block = (hgt, w = '100%') => h('div', { class: 'skel', style: { height: `${hgt}px`, width: w } });
  return h('div', { class: 'page' },
    block(34, '260px'), h('div', { style: { height: '8px' } }), block(16, '420px'), h('div', { style: { height: '24px' } }),
    h('div', { class: 'grid cols-4' }, [1, 2, 3, 4].map(() => block(88))),
    h('div', { class: 'grid split mt' }, block(300), block(300)));
}

/** Disable a button and show a spinner while an async action runs; errors become a toast. */
export async function busy(button, fn) {
  button.disabled = true; button.classList.add('loading');
  try { return await fn(); } catch (e) { toast(e.message, 'bad'); } finally { button.disabled = false; button.classList.remove('loading'); }
}

export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };


