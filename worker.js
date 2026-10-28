import {
  h, icon, field, toast, busy, badge, table, empty, pageHead, statTile, money, fmtDate, fmtDay, hoursText, todayLocal, openModal, debounce,
} from './ui.js';
import { api, fileToBase64 } from './api.js';
import { barChart } from './charts.js';
import { flagChips, DOC_TYPES, docTypeLabel, jobCard, greeting } from './components.js';

const STATUS_COPY = {
  REGISTERED: ['Upload a government ID so a manager can verify you.', 'You need to be verified before you can apply for jobs.'],
  PENDING_REVIEW: ['Your document is with a manager.', 'You will get a notification as soon as they decide.'],
  VERIFIED: ['You are verified.', 'You can apply for jobs and log hours.'],
  REJECTED: ['Your document was not accepted.', 'Please read the manager note below and upload a new one.'],
};

export const workerViews = {
  // ---------------------------------------------------------------- dashboard
  async dashboard({ page, me, go }) {
    const o = await api('GET', '/overview');
    page.append(pageHead(`${greeting()}, ${me.name.split(' ')[0]}`, 'Here is where things stand today.'));

    if (o.status !== 'VERIFIED') {
      page.append(h('div', { class: 'card accent', style: { marginBottom: '18px' } },
        h('div', { class: 'spread' },
          h('div', {}, h('h3', { style: { fontSize: '19px' } }, o.status === 'PENDING_REVIEW' ? 'Your ID is being reviewed' : 'Verify your identity to start working'),
            h('p', { style: { opacity: .9, marginTop: '6px', maxWidth: '58ch' } }, STATUS_COPY[o.status][1])),
          h('button', { class: 'btn', style: { color: 'var(--brand)' }, onclick: () => go('verification') }, icon('shield'), o.status === 'PENDING_REVIEW' ? 'View status' : 'Verify now'))));
    }

    page.append(h('div', { class: 'grid cols-4' },
      statTile({ label: 'Open jobs', value: o.openJobs, sub: 'Waiting for you', iconName: 'briefcase', tone: 'brand', onClick: () => go('jobs') }),
      statTile({ label: 'Approved jobs', value: o.applications.approved, sub: `${o.applications.pending} pending`, iconName: 'checkCircle', tone: 'ok', onClick: () => go('applications') }),
      statTile({ label: 'Approved hours', value: hoursText(o.earnings.hoursApproved), sub: 'All time', iconName: 'clock', tone: 'info', onClick: () => go('hours') }),
      statTile({ label: 'Paid so far', value: money(o.earnings.paid), sub: 'Gross earnings', iconName: 'wallet', tone: 'warn' })));

    const total = o.earnings.paid + o.earnings.approvedUnpaid + o.earnings.submitted || 1;
    const row = (label, amount, color) => h('li', { style: { display: 'block' } },
      h('div', { class: 'spread', style: { marginBottom: '7px' } }, h('span', { class: 'ink-2', style: { fontWeight: 600 } }, label), h('b', { class: 'num' }, money(amount))),
      h('div', { class: 'progress' }, h('i', { style: { width: `${(amount / total) * 100}%`, background: color } })));
    page.append(h('div', { class: 'grid split mt' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Hours worked'), h('div', { class: 'sub' }, 'Last 14 days'))),
        barChart(o.hoursByDay.map((d) => ({ label: String(new Date(`${d.date}T00:00:00`).getDate()), sub: fmtDay(d.date), value: d.hours })))),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Earnings'), h('div', { class: 'sub' }, 'Gross, before any deductions'))),
        h('ul', { class: 'list' },
          row('Paid', o.earnings.paid, 'var(--ok)'),
          row('Approved, waiting for payroll', o.earnings.approvedUnpaid, 'var(--brand)'),
          row('Waiting for approval', o.earnings.submitted, 'var(--warn)')))));

    page.append(h('div', { class: 'card flush mt' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Recent hours'), h('button', { class: 'btn ghost sm', onclick: () => go('hours') }, 'See all')),
      table(hourColumns(), o.recentTimesheets, { emptyView: empty('clock', 'No hours yet', 'Once a manager approves a job application you can log your shifts here.') })));
  },

  // ----------------------------------------------------------------- ID verification
  async verification({ page, me, refresh }) {
    const w = await api('GET', '/me');
    const status = w.status;
    page.append(pageHead('ID verification', 'A manager checks your document before you can apply for jobs.'));

    const steps = [
      ['Account created', 'You are signed up', 'done'],
      ['ID submitted', w.document ? `${docTypeLabel(w.document.docType)} uploaded` : 'Upload your document', status === 'REGISTERED' ? 'current' : status === 'REJECTED' ? 'error' : 'done'],
      ['Manager review', { PENDING_REVIEW: 'Waiting for a decision', VERIFIED: 'Approved', REJECTED: 'Not accepted', REGISTERED: 'Starts after upload' }[status],
        status === 'PENDING_REVIEW' ? 'current' : status === 'VERIFIED' ? 'done' : status === 'REJECTED' ? 'error' : ''],
    ];

    const statusCard = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Status'), badge(status)),
      h('div', { class: 'stepper' }, steps.map(([title, sub, state], i) => h('div', { class: `step ${state}` },
        h('div', { class: 'step-dot' }, state === 'done' ? icon('check', 18) : state === 'error' ? icon('x', 18) : i + 1),
        h('div', {}, h('b', {}, title), h('small', {}, sub))))),
      h('hr', { class: 'divider' }),
      h('div', { class: `callout ${status === 'VERIFIED' ? 'ok' : status === 'REJECTED' ? 'bad' : ''}` }, icon(status === 'VERIFIED' ? 'checkCircle' : status === 'REJECTED' ? 'alert' : 'info'),
        h('div', {}, h('b', {}, STATUS_COPY[status][0]), ' ', h('span', {}, STATUS_COPY[status][1]))),
      w.reviewNote && h('p', { style: { marginTop: '14px' } }, h('b', {}, 'Manager note: '), w.reviewNote),
      w.document?.check?.flags.length > 0 && h('div', { style: { marginTop: '14px' } }, h('div', { class: 'label' }, 'The automatic check noticed'), flagChips(w.document.check.flags, 'worker')),
      w.document && h('p', { class: 'muted', style: { marginTop: '14px', fontSize: '13px' } }, `Last upload: ${docTypeLabel(w.document.docType)} · ${fmtDate(w.document.uploadedAt)} · ID ${w.document.declared.idMasked}`));

    const left = h('div', { class: 'stack' }, statusCard);
    if (status !== 'VERIFIED') left.append(uploadCard(w, refresh));

    page.append(h('div', { class: 'grid split' }, left, h('div', { class: 'stack' }, profileCard(w, refresh), privacyCard())));
  },

  // ------------------------------------------------------------------------ jobs
  async jobs({ page, me, refresh, go }) {
    const { items } = await api('GET', '/jobs');
    const verified = me.status === 'VERIFIED';
    const search = h('input', { class: 'input', placeholder: 'Search jobs or locations', 'aria-label': 'Search jobs' });
    const grid = h('div', { class: 'grid auto' });
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const shown = items.filter((j) => !q || `${j.title} ${j.location} ${j.description}`.toLowerCase().includes(q));
      grid.replaceChildren(...(shown.length ? shown.map((j) => jobCard(j, applyButton(j))) : [empty('search', 'No jobs match', 'Try a different word.')]));
    };
    function applyButton(j) {
      const btn = h('button', { class: 'btn primary sm', disabled: !verified || j.applied }, j.applied ? [icon('check'), 'Applied'] : [icon('briefcase'), 'Apply']);
      btn.addEventListener('click', () => openModal({
        title: `Apply for ${j.title}`, subtitle: `${j.location} · ${money(j.hourlyRate)}/h`,
        body: h('div', { class: 'field', style: { margin: 0 } }, h('label', {}, 'Note for the manager (optional)'), h('textarea', { class: 'textarea', id: 'applyNote', maxlength: '500', placeholder: 'Tell them about your availability or experience.' })),
        actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Send application', kind: 'primary', icon: 'check', onClick: ({ close, button }) => busy(button, async () => {
          await api('POST', `/jobs/${j.jobId}/apply`, { note: document.getElementById('applyNote').value || undefined });
          close(); toast('Application sent.'); refresh();
        }) }],
      }));
      return btn;
    }
    page.append(pageHead('Find jobs', `${items.length} open ${items.length === 1 ? 'position' : 'positions'} right now.`,
      h('div', { class: 'search' }, icon('search'), search)));
    if (!verified) {
      page.append(h('div', { class: 'callout warn', style: { marginBottom: '18px' } }, icon('shield'),
        h('div', {}, h('b', {}, 'Verify your identity to apply. '), h('a', { href: '#/verification' }, 'Go to ID verification →'))));
    }
    search.addEventListener('input', debounce(draw, 120));
    draw();
    page.append(grid);
  },

  // ---------------------------------------------------------------- applications
  async applications({ page }) {
    const { items } = await api('GET', '/applications');
    page.append(pageHead('My applications', 'Track every job you have applied for.'));
    page.append(h('div', { class: 'card flush' }, table([
      { label: 'Job', render: (a) => h('div', { class: 'cell-main' }, a.jobTitle) },
      { label: 'Applied', render: (a) => fmtDate(a.createdAt) },
      { label: 'Your note', render: (a) => a.note || h('span', { class: 'muted' }, '—') },
      { label: 'Status', render: (a) => badge(a.status) },
      { label: '', render: (a) => a.status === 'APPROVED' && h('a', { class: 'btn sm', href: '#/hours' }, icon('clock'), 'Log hours') },
    ], items, { emptyView: empty('briefcase', 'No applications yet', 'Find a job you like and apply. It takes one click.', h('a', { class: 'btn primary', href: '#/jobs' }, 'Browse jobs')) })));
  },

  // ----------------------------------------------------------------------- hours
  async hours({ page, refresh }) {
    const [apps, sheets] = await Promise.all([api('GET', '/applications'), api('GET', '/timesheets')]);
    const approved = apps.items.filter((a) => a.status === 'APPROVED');
    const sum = (st) => sheets.items.filter((t) => st.includes(t.status)).reduce((a, t) => a + t.hours, 0);
    page.append(pageHead('My hours', 'Log the hours you worked. A manager approves them before payroll.'));
    page.append(h('div', { class: 'grid cols-3', style: { marginBottom: '18px' } },
      statTile({ label: 'Waiting for approval', value: hoursText(sum(['SUBMITTED'])), iconName: 'clock', tone: 'warn' }),
      statTile({ label: 'Approved', value: hoursText(sum(['APPROVED'])), iconName: 'checkCircle', tone: 'ok' }),
      statTile({ label: 'Paid', value: hoursText(sum(['PAID'])), iconName: 'wallet', tone: 'brand' })));

    if (approved.length) {
      const sel = h('select', { class: 'select' }, approved.map((a) => h('option', { value: a.applicationId }, a.jobTitle)));
      const date = h('input', { class: 'input', type: 'date', required: true, max: todayLocal(), value: todayLocal() });
      const hours = h('input', { class: 'input', type: 'number', step: '0.25', min: '0.25', max: '24', required: true, placeholder: 'e.g. 7.5' });
      const notes = h('input', { class: 'input', type: 'text', maxlength: '300', placeholder: 'What did you work on?' });
      const btn = h('button', { class: 'btn primary', type: 'submit' }, icon('plus'), 'Submit hours');
      page.append(h('form', { class: 'card', style: { marginBottom: '18px' }, onsubmit: (ev) => {
        ev.preventDefault();
        busy(btn, async () => {
          await api('POST', '/timesheets', { applicationId: sel.value, workDate: date.value, hours: Number(hours.value), notes: notes.value || undefined });
          toast('Hours submitted for approval.'); refresh();
        });
      } },
      h('div', { class: 'card-head' }, h('h3', {}, 'Log hours')),
      h('div', { class: 'form-grid' }, field('Job', sel), field('Date', date), field('Hours worked', hours), field('Notes (optional)', notes)),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, btn)));
    } else {
      page.append(h('div', { class: 'callout', style: { marginBottom: '18px' } }, icon('info'), h('div', {}, 'You can log hours once a manager approves one of your applications.')));
    }
    page.append(h('div', { class: 'card flush' }, h('div', { class: 'card-head' }, h('h3', {}, 'History')),
      table(hourColumns(), sheets.items, { emptyView: empty('clock', 'No hours logged yet') })));
  },
};

const hourColumns = () => [
  { label: 'Date', render: (t) => h('div', { class: 'cell-main' }, fmtDay(t.workDate)) },
  { label: 'Job', render: (t) => t.jobTitle },
  { label: 'Hours', num: true, render: (t) => hoursText(t.hours) },
  { label: 'Amount', num: true, render: (t) => money(t.amount) },
  { label: 'Status', render: (t) => h('div', {}, badge(t.status), t.managerNote && h('div', { class: 'cell-sub' }, t.managerNote)) },
];

// ---------------------------------------------------------------- ID upload card
function uploadCard(w, refresh) {
  const docType = h('select', { class: 'select' }, DOC_TYPES.map(([v, l]) => h('option', { value: v }, l)));
  const nameOnId = h('input', { class: 'input', value: w.name, required: true, maxlength: '100' });
  const idNumber = h('input', { class: 'input', required: true, maxlength: '30', placeholder: 'As printed on the document' });
  const expiry = h('input', { class: 'input', type: 'date', required: true });
  const preview = h('div');
  let file = null;

  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,application/pdf', 'aria-label': 'Choose an ID file' });
  const zone = h('div', { class: 'dropzone' },
    h('div', { class: 'big' }, icon('upload')), h('b', {}, 'Drop your ID here, or click to browse'),
    h('span', { class: 'muted' }, 'JPG, PNG or PDF · up to 8 MB'), input);

  function setFile(f) {
    if (!f) return;
    if (!/^(image\/(jpeg|png)|application\/pdf)$/.test(f.type)) return toast('Please choose a JPG, PNG or PDF file.', 'bad');
    if (f.size > 8 * 1024 * 1024) return toast('That file is larger than 8 MB.', 'bad');
    file = f;
    const thumb = f.type.startsWith('image/')
      ? h('img', { class: 'thumb', src: URL.createObjectURL(f), alt: 'Preview of the chosen file' })
      : h('div', { class: 'thumb' }, icon('file'));
    preview.replaceChildren(h('div', { class: 'file-preview' }, thumb,
      h('div', { class: 'meta' }, h('b', {}, f.name), h('span', { class: 'muted' }, `${(f.size / 1024).toFixed(0)} KB`)),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { file = null; input.value = ''; preview.replaceChildren(); zone.classList.remove('hidden'); } }, icon('x'), 'Remove')));
    zone.classList.add('hidden');
  }
  input.addEventListener('change', () => setFile(input.files[0]));
  for (const ev of ['dragenter', 'dragover']) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) zone.addEventListener(ev, () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); setFile(e.dataTransfer.files[0]); });

  const btn = h('button', { class: 'btn primary', type: 'submit' }, icon('upload'), 'Submit for review');
  return h('form', { class: 'card', onsubmit: (ev) => {
    ev.preventDefault();
    if (!file) return toast('Choose a file first.', 'bad');
    busy(btn, async () => {
      await api('POST', '/me/document', {
        docType: docType.value, nameOnId: nameOnId.value, idNumber: idNumber.value, expiryDate: expiry.value,
        fileName: file.name, data: await fileToBase64(file),
      });
      toast('Uploaded. A manager will review it soon.'); refresh();
    });
  } },
  h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, w.document ? 'Upload a new document' : 'Upload your ID'), h('div', { class: 'sub' }, 'Type in the details printed on it so we can cross-check them'))),
  h('div', { class: 'form-grid' }, field('Document type', docType), field('Name on the ID', nameOnId), field('ID number', idNumber, 'Only the last 4 characters are kept.'), field('Expiry date', expiry)),
  h('div', { class: 'field' }, h('label', {}, 'Scan or photo'), zone, preview),
  h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, btn));
}

function profileCard(w, refresh) {
  const name = h('input', { class: 'input', value: w.name, required: true, maxlength: '100' });
  const phone = h('input', { class: 'input', value: w.phone || '', maxlength: '30', placeholder: '+91 …' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Save changes');
  return h('form', { class: 'card', onsubmit: (ev) => {
    ev.preventDefault();
    busy(btn, async () => { await api('PUT', '/me', { name: name.value, phone: phone.value || undefined }); toast('Profile updated.'); refresh(); });
  } },
  h('div', { class: 'card-head' }, h('h3', {}, 'Your profile')),
  field('Full name', name), field('Email', h('input', { class: 'input', value: w.email, disabled: true })), field('Phone', phone),
  h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, btn));
}

const privacyCard = () => h('div', { class: 'card' },
  h('div', { class: 'card-head' }, h('h3', {}, 'How your ID is handled')),
  h('ul', { class: 'list' }, [
    ['lock', 'Encrypted on disk', 'Your scan is stored with AES-256 encryption.'],
    ['eye', 'Seen only by managers', 'Every time a manager opens it, the audit log records it.'],
    ['shield', 'A person decides', 'The automatic check only raises flags. It never approves or rejects.'],
  ].map(([ic, t, s]) => h('li', {}, h('div', { class: 'stat-icon tone-brand', style: { width: '38px', height: '38px', borderRadius: '12px', fontSize: '18px' } }, icon(ic)),
    h('div', {}, h('b', {}, t), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, s))))));
