import { h, icon, avatar, toast, timeAgo, empty } from './ui.js';
import { api } from './api.js';
import { brandMark } from './components.js';

// ---------- theme ----------
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cb-theme', next); } catch { /* storage blocked */ }
}
export const themeIcon = () => icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');

const NOTE_STYLE = {
  verification: ['shield', 'tone-warn'], application: ['file', 'tone-info'], timesheet: ['clock', 'tone-info'],
  payroll: ['wallet', 'tone-ok'], worker: ['users', 'tone-brand'], info: ['bell', 'tone-brand'],
};

/**
 * The persistent frame: sidebar, top bar, notification bell. Pages are swapped inside `main`.
 * nav: [{ key, label, icon, badge? }]
 */
export function createShell({ me, nav, onNavigate, onSignOut }) {
  const navButtons = new Map();
  const badges = new Map();

  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' }, brandMark(), h('div', {}, h('div', { class: 'brand-name' }, 'Crew', h('span', {}, 'Bridge')), h('span', { class: 'brand-tag' }, me.role === 'manager' ? 'MANAGER WORKSPACE' : 'WORKER PORTAL'))),
    h('div', { class: 'nav-label' }, 'Menu'),
    h('nav', { class: 'nav', 'aria-label': 'Main' }, nav.map((n) => {
      const badge = n.badge ? h('span', { class: 'nav-badge hidden' }) : null;
      const b = h('button', { class: 'nav-item', type: 'button' }, icon(n.icon), n.label, badge);
      b.addEventListener('click', () => { closeMenu(); onNavigate(n.key); });
      navButtons.set(n.key, b);
      if (badge) badges.set(n.badge, badge);
      return b;
    })),
    h('div', { class: 'sidebar-foot' },
      h('div', { class: 'user-chip' }, avatar(me.name, 'sm'),
        h('div', { class: 'who' }, h('b', {}, me.name), h('span', {}, me.role)),
        h('button', { type: 'button', 'aria-label': 'Sign out', title: 'Sign out', onclick: onSignOut }, icon('logout')))));

  // top bar
  const crumb = h('div', { class: 'crumb' });
  const themeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Toggle dark mode', title: 'Toggle dark mode' }, themeIcon());
  themeBtn.addEventListener('click', () => { toggleTheme(); themeBtn.replaceChildren(themeIcon()); });

  const bellDot = h('span', { class: 'dot hidden' });
  const bell = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Notifications', 'aria-haspopup': 'true' }, icon('bell'), bellDot);
  const anchor = h('div', { class: 'pop-anchor' }, bell);
  let popover = null;

  async function toggleNotifications() {
    if (popover) return closePopover();
    popover = h('div', { class: 'popover', role: 'dialog', 'aria-label': 'Notifications' }, h('div', { class: 'popover-body' }, h('div', { class: 'empty' }, 'Loading…')));
    anchor.append(popover);
    setTimeout(() => document.addEventListener('mousedown', outside), 0);
    try {
      const { items, unread } = await api('GET', '/notifications');
      const markRead = h('button', { class: 'btn ghost sm', type: 'button', disabled: !unread }, 'Mark all read');
      markRead.addEventListener('click', async () => { await api('POST', '/notifications/read'); setUnread(0); closePopover(); });
      popover.replaceChildren(
        h('div', { class: 'popover-head' }, h('h4', {}, 'Notifications'), markRead),
        h('div', { class: 'popover-body' }, items.length ? items.map((n) => {
          const [ic, tone] = NOTE_STYLE[n.kind] || NOTE_STYLE.info;
          return h('div', { class: `note ${n.read ? '' : 'unread'}` },
            h('div', { class: `stat-icon ${tone}`, style: { width: '36px', height: '36px', borderRadius: '11px', fontSize: '17px' } }, icon(ic)),
            h('div', {}, h('div', { class: 't' }, n.title), h('div', { class: 's' }, n.body), h('div', { class: 'when' }, timeAgo(n.createdAt))));
        }) : empty('bell', 'All caught up', 'New activity will show up here.')));
    } catch (e) { toast(e.message, 'bad'); closePopover(); }
  }
  const outside = (e) => { if (popover && !anchor.contains(e.target)) closePopover(); };
  function closePopover() { popover?.remove(); popover = null; document.removeEventListener('mousedown', outside); }
  bell.addEventListener('click', toggleNotifications);

  const setUnread = (n) => { bellDot.textContent = n > 9 ? '9+' : n; bellDot.classList.toggle('hidden', !n); };

  const menuBtn = h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Open menu' }, icon('menu'));
  const topbar = h('header', { class: 'topbar' }, menuBtn, crumb, h('div', { class: 'grow' }), themeBtn, anchor);
  const main = h('main', { id: 'main' });
  const scrim = h('div', { class: 'scrim' });
  const el = h('div', { class: 'app' }, sidebar, h('div', { class: 'content' }, topbar, main), scrim);

  const closeMenu = () => el.classList.remove('menu-open');
  menuBtn.addEventListener('click', () => el.classList.toggle('menu-open'));
  scrim.addEventListener('click', closeMenu);

  return {
    el, main,
    setActive(key) {
      for (const [k, b] of navButtons) { b.classList.toggle('active', k === key); b.toggleAttribute('aria-current', k === key); }
      const item = nav.find((n) => n.key === key);
      crumb.textContent = item ? `${me.role === 'manager' ? 'Workspace' : 'Portal'} / ${item.label}` : '';
      document.title = item ? `${item.label} · CrewBridge` : 'CrewBridge';
    },
    setCounts(counts) {
      for (const [key, node] of badges) { const n = counts[key] || 0; node.textContent = n; node.classList.toggle('hidden', !n); }
      setUnread(counts.unreadNotifications || 0);
    },
  };
}
