import { h, toast, skeletonPage, setCurrency } from './ui.js';
import { api } from './api.js';
import { authView } from './authView.js';
import { createShell } from './shell.js';
import { workerViews } from './worker.js';
import { managerViews } from './manager.js';

const root = document.getElementById('app');

const NAV = {
  worker: [
    { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { key: 'verification', label: 'ID verification', icon: 'shield' },
    { key: 'jobs', label: 'Find jobs', icon: 'briefcase' },
    { key: 'applications', label: 'Applications', icon: 'file' },
    { key: 'hours', label: 'My hours', icon: 'clock' },
  ],
  manager: [
    { key: 'overview', label: 'Overview', icon: 'dashboard' },
    { key: 'verification', label: 'Verification', icon: 'shield', badge: 'pendingVerifications' },
    { key: 'applications', label: 'Applications', icon: 'file', badge: 'pendingApplications' },
    { key: 'timesheets', label: 'Timesheets', icon: 'clock', badge: 'pendingTimesheets' },
    { key: 'jobs', label: 'Jobs', icon: 'briefcase' },
    { key: 'payroll', label: 'Payroll', icon: 'wallet' },
    { key: 'system', label: 'Audit & system', icon: 'activity' },
  ],
};

let config = { demo: false };
let me = null;
let shell = null;
let pollTimer = null;
let renderToken = 0;
let shownPage = null;

const go = (target) => { location.hash = `#/${target}`; };

function currentRoute() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const nav = NAV[me.role];
  return { key: nav.some((n) => n.key === path) ? path : nav[0].key, params: new URLSearchParams(query || '') };
}

async function render({ quiet = false } = {}) {
  const { key, params } = currentRoute();
  const token = ++renderToken;
  const views = me.role === 'manager' ? managerViews : workerViews;
  shell.setActive(key);

  // Show a skeleton only when moving to a new page; after an action, swap content in place.
  if (!quiet || shownPage !== key) shell.main.replaceChildren(skeletonPage());
  const page = h('div', { class: 'page' });
  try {
    if (me.role === 'worker') me = { ...me, ...(await api('GET', '/me')) }; // keep the verification status fresh
    await views[key]({ page, me, params, go, refresh: () => render({ quiet: true }) });
  } catch (e) {
    if (e.status === 401) return signedOut();
    page.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'Could not load this page'), h('p', { class: 'muted', style: { marginTop: '6px' } }, e.message),
      h('button', { class: 'btn', style: { marginTop: '14px' }, onclick: () => render() }, 'Try again')));
  }
  if (token !== renderToken) return; // the user already moved on
  shownPage = key;
  shell.main.replaceChildren(page);
  pollCounts();
}

async function pollCounts() {
  try { shell?.setCounts(await api('GET', '/counts')); } catch { /* the next page load will surface auth problems */ }
}

function enterApp(user) {
  me = user;
  shownPage = null;
  shell = createShell({
    me, nav: NAV[me.role],
    onNavigate: go,
    onSignOut: async () => { try { await api('POST', '/auth/logout'); } catch { /* ignore */ } signedOut(); },
  });
  root.replaceChildren(shell.el);
  clearInterval(pollTimer);
  pollTimer = setInterval(pollCounts, 30_000);
  if (!location.hash || location.hash === '#') go(NAV[me.role][0].key);
  render();
}

function signedOut() {
  clearInterval(pollTimer);
  me = null; shell = null;
  history.replaceState(null, '', location.pathname);
  document.title = 'Sign in · CrewBridge';
  root.replaceChildren(authView({ config, onAuthed: enterApp }));
}

window.addEventListener('hashchange', () => { if (me) render(); });

(async function start() {
  try { config = await api('GET', '/config'); setCurrency(config.currency); } catch { /* server unreachable: the sign-in form will say so */ }
  try {
    const session = await api('GET', '/session');
    if (session.role) enterApp(session); else signedOut();
  } catch (e) {
    toast(e.message, 'bad');
    signedOut();
  }
})();

