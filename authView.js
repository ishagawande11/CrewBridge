import { h, icon, busy, toast } from './ui.js';
import { api } from './api.js';
import { toggleTheme, themeIcon } from './shell.js';
import { brandMark } from './components.js';

/** A suspension-bridge illustration; every x position is computed so the hangers sit exactly on the cable. */
function bridgeArt() {
  const quad = (p0, p1, p2, t) => (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
  const deck = 214;
  let hangers = '';
  const addHangers = (xAt, yAt, count) => {
    for (let i = 1; i < count; i++) {
      const t = i / count;
      hangers += `<line x1="${xAt(t).toFixed(1)}" y1="${yAt(t).toFixed(1)}" x2="${xAt(t).toFixed(1)}" y2="${deck}"/>`;
    }
  };
  addHangers((t) => 240 * t, (t) => quad(180, 180, 66, t), 8);
  addHangers((t) => 240 + 320 * t, (t) => quad(66, 258, 66, t), 18);
  addHangers((t) => 560 + 240 * t, (t) => quad(66, 180, 180, t), 8);
  return `
  <svg class="auth-art" viewBox="0 0 800 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs><linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <path d="M0 236 Q50 226 100 236 T200 236 T300 236 T400 236 T500 236 T600 236 T700 236 T800 236 V300 H0Z" fill="url(#water)"/>
    <g stroke="#fff" stroke-opacity=".88" stroke-linecap="round" fill="none">
      <path d="M0 180 Q120 180 240 66 Q400 258 560 66 Q680 180 800 180" stroke-width="3"/>
      <g stroke-width="1.6" stroke-opacity=".6">${hangers}</g>
      <path d="M0 214H800" stroke-width="7"/>
      <path d="M240 58V244M560 58V244" stroke-width="14"/>
    </g>
  </svg>`;
}

export function authView({ config, onAuthed }) {
  let mode = 'login';
  let role = 'worker';
  const root = h('div', { class: 'auth' });

  const hero = h('aside', { class: 'auth-hero' });
  hero.innerHTML = bridgeArt(); // static string built from numbers only
  hero.prepend(
    h('div', { class: 'blob b1' }), h('div', { class: 'blob b2' }),
    h('div', { class: 'hero-copy' },
      h('div', { class: 'brand' }, brandMark(), h('div', { class: 'brand-name' }, 'Crew', h('span', {}, 'Bridge'))),
      h('h1', { style: { marginTop: '44px' } }, 'From sign-up to ', h('span', {}, 'payday'), ', in one place.'),
      h('p', { class: 'lede' }, 'Onboard contract and gig workers, verify their IDs, approve hours and run payroll, without the spreadsheets.'),
      h('div', { class: 'hero-features' },
        feature('shield', 'ID checks with a human in the loop'),
        feature('clock', 'Hours logged, approved and paid'),
        feature('lock', 'Everything stays on this computer'))));

  const main = h('main', { class: 'auth-main' });
  const themeBtn = h('button', { class: 'icon-btn auth-theme', type: 'button', 'aria-label': 'Toggle theme' }, themeIcon());
  themeBtn.addEventListener('click', () => { toggleTheme(); themeBtn.replaceChildren(themeIcon()); });
  root.append(hero, main);

  function draw() {
    const isLogin = mode === 'login';
    const error = h('div', { class: 'form-error hidden', role: 'alert' });
    const showError = (msg) => { error.replaceChildren(icon('alert'), msg); error.classList.remove('hidden'); };

    const name = h('input', { class: 'input', placeholder: 'Your full name', autocomplete: 'name', required: true, maxlength: '100' });
    const email = h('input', { class: 'input', type: 'email', placeholder: 'you@example.com', autocomplete: 'email', required: true });
    const password = h('input', { class: 'input', type: 'password', placeholder: isLogin ? 'Your password' : 'At least 8 characters, with a number', autocomplete: isLogin ? 'current-password' : 'new-password', required: true });
    const code = h('input', { class: 'input', placeholder: 'Invite code from your administrator' });
    if (isLogin) { email.value = 'manager@crewbridge.local'; password.value = 'Manager@123'; } // sample sign-in, prefilled
    const reveal = h('button', { class: 'reveal', type: 'button', 'aria-label': 'Show password' }, icon('eye'));
    reveal.addEventListener('click', () => {
      const show = password.type === 'password';
      password.type = show ? 'text' : 'password';
      reveal.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
    });
    const submit = h('button', { class: 'btn primary block', type: 'submit' }, isLogin ? 'Sign in' : 'Create account');

    const form = h('form', { novalidate: true, onsubmit: (ev) => {
      ev.preventDefault();
      error.classList.add('hidden');
      busy(submit, async () => {
        try {
          const body = isLogin
            ? { email: email.value, password: password.value }
            : { name: name.value, email: email.value, password: password.value, role, managerCode: role === 'manager' ? code.value : undefined };
          const me = await api('POST', isLogin ? '/auth/login' : '/auth/register', body);
          if (!isLogin) toast(`Welcome to CrewBridge, ${me.name.split(' ')[0]}!`);
          onAuthed(me);
        } catch (e) { showError(e.message); }
      });
    } },
    error,
    !isLogin && h('div', { class: 'role-pick' },
      roleButton('worker', 'user', 'Worker', 'Find and log jobs'),
      roleButton('manager', 'users', 'Manager', 'Review and pay')),
    !isLogin && h('div', { class: 'field' }, h('label', {}, 'Full name'), name),
    h('div', { class: 'field' }, h('label', {}, 'Email'), email),
    h('div', { class: 'field' }, h('label', {}, 'Password'), h('div', { class: 'input-wrap' }, password, reveal)),
    !isLogin && role === 'manager' && h('div', { class: 'field' }, h('label', {}, 'Manager invite code'), code),
    submit);

    function roleButton(value, iconName, label, sub) {
      const b = h('button', { type: 'button', class: role === value ? 'active' : '' }, icon(iconName), h('span', {}, label, h('small', {}, sub)));
      b.addEventListener('click', () => { role = value; draw(); });
      return b;
    }

    const demo = config.demo && isLogin && h('div', { class: 'demo-box' },
      h('h4', {}, 'Try the demo'),
      h('div', { class: 'row' },
        demoButton('Manager', 'manager@crewbridge.local', 'Manager@123', 'users'),
        demoButton('Worker', 'aarav@crewbridge.local', 'Worker@123', 'user')));
    function demoButton(label, e, p, ic) {
      const b = h('button', { class: 'btn sm', type: 'button' }, icon(ic), `Sign in as ${label.toLowerCase()}`);
      b.addEventListener('click', () => { email.value = e; password.value = p; form.requestSubmit(); });
      return b;
    }

    const tab = (m, label) => {
      const b = h('button', { type: 'button', class: mode === m ? 'active' : '' }, label);
      b.addEventListener('click', () => { mode = m; draw(); });
      return b;
    };
    main.replaceChildren(themeBtn, h('div', { class: 'auth-card' },
      h('h2', {}, isLogin ? 'Welcome back' : 'Create your account'),
      h('p', { class: 'sub' }, isLogin ? 'Sign in to continue to CrewBridge.' : 'It takes less than a minute.'),
      h('div', { class: 'auth-tabs' }, tab('login', 'Sign in'), tab('register', 'Create account')),
      form, demo));
    if (!isLogin) name.focus();
  }

  draw();
  return root;
}

const feature = (ic, text) => h('div', {}, icon(ic), text);
