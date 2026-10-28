import {
  h, icon, field, toast, busy, badge, table, empty, pageHead, statTile, money, fmtDate, fmtDay, hoursText, avatar, openModal, confirmDialog, noteDialog,
  debounce, titleCase, timeAgo, getCurrency,
} from './ui.js';
import { api, qs } from './api.js';
import { barChart, donut } from './charts.js';
import { flagChips, docTypeLabel, jobCard, viewDocument, greeting } from './components.js';

const segmented = (options, current, counts, onPick) => h('div', { class: 'seg', role: 'tablist' }, options.map(([value, label]) => {
  const b = h('button', { type: 'button', role: 'tab', class: value === current ? 'active' : '', 'aria-selected': String(value === current) }, label,
    counts?.[value] ? h('span', { class: 'count' }, counts[value]) : null);
  b.addEventListener('click', () => onPick(value));
  return b;
}));

const AUDIT_STYLE = {
  LOGIN: ['user', 'tone-brand', 'Signed in'], ACCOUNT_REGISTERED: ['user', 'tone-brand', 'Account created'],
  WORKER_VERIFIED: ['shield', 'tone-ok', 'Worker verified'], WORKER_REJECTED: ['shield', 'tone-bad', 'Worker rejected'],
  DOCUMENT_UPLOADED: ['upload', 'tone-info', 'ID uploaded'], DOCUMENT_VIEWED: ['eye', 'tone-warn', 'ID document viewed'],
  APPLICATION_APPROVED: ['file', 'tone-ok', 'Application approved'], APPLICATION_REJECTED: ['file', 'tone-bad', 'Application rejected'],
  TIMESHEET_APPROVED: ['clock', 'tone-ok', 'Hours approved'], TIMESHEET_REJECTED: ['clock', 'tone-bad', 'Hours rejected'],
  JOB_CREATED: ['briefcase', 'tone-brand', 'Job posted'], JOB_OPEN: ['briefcase', 'tone-ok', 'Job reopened'], JOB_CLOSED: ['briefcase', 'tone-bad', 'Job closed'],
  PAYROLL_RUN: ['wallet', 'tone-ok', 'Payroll generated'], PAYROLL_PREVIEW: ['wallet', 'tone-info', 'Payroll previewed'],
  PAYROLL_DOWNLOAD: ['download', 'tone-info', 'Payroll downloaded'], PAYROLL_SCHEDULED_RUN: ['refresh', 'tone-ok', 'Weekly payroll ran'],
  BACKUP_CREATED: ['database', 'tone-info', 'Backup created'],
};
const auditStyle = (a) => AUDIT_STYLE[a] || ['activity', 'tone-brand', titleCase(a)];
const detailText = (d) => Object.entries(d).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
  .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ');

export const managerViews = {
  // -------------------------------------------------------------------- overview
  async overview({ page, me, go }) {
    const o = await api('GET', '/overview');
    const c = o.counts;
    page.append(pageHead(`${greeting()}, ${me.name.split(' ')[0]}`, 'Here is what needs your attention.'));
    page.append(h('div', { class: 'grid cols-4' },
      statTile({ label: 'ID checks waiting', value: c.pendingVerifications, sub: `${c.verified} of ${c.workers} workers verified`, iconName: 'shield', tone: 'warn', onClick: () => go('verification') }),
      statTile({ label: 'Applications', value: c.pendingApplications, sub: 'To review', iconName: 'file', tone: 'info', onClick: () => go('applications') }),
      statTile({ label: 'Timesheets', value: c.pendingTimesheets, sub: 'To approve', iconName: 'clock', tone: 'brand', onClick: () => go('timesheets') }),
      statTile({ label: 'Open jobs', value: c.openJobs, sub: 'Accepting applicants', iconName: 'briefcase', tone: 'ok', onClick: () => go('jobs') })));

    const ts = o.timesheetStatus;
    const slice = (label, key, color) => ({ label, value: ts[key] || 0, color });
    page.append(h('div', { class: 'grid split mt' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Hours worked'), h('div', { class: 'sub' }, 'All workers, last 14 days'))),
        barChart(o.hoursByDay.map((d) => ({ label: String(new Date(`${d.date}T00:00:00`).getDate()), sub: fmtDay(d.date), value: d.hours })))),
      h('div', { class: 'card col' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Timesheets'), h('div', { class: 'sub' }, 'By status'))),
        donut([slice('Waiting', 'SUBMITTED', '#f59e0b'), slice('Approved', 'APPROVED', '#6366f1'), slice('Paid', 'PAID', '#10b981'), slice('Rejected', 'REJECTED', '#f43f5e')], { centerLabel: 'timesheets' }))));

    const queue = o.pendingQueue.length
      ? h('ul', { class: 'list' }, o.pendingQueue.map((w) => h('li', {},
        avatar(w.name),
        h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', {}, w.name), h('div', { class: 'cell-sub' }, `${docTypeLabel(w.document.docType)} · ${timeAgo(w.document.uploadedAt)}`)),
        w.document.check.flags.filter((f) => f !== 'EXPIRING_SOON').length
          ? h('span', { class: 'badge warn' }, `${w.document.check.flags.filter((f) => f !== 'EXPIRING_SOON').length} flagged`)
          : h('span', { class: 'badge ok' }, 'Clean'),
        h('button', { class: 'btn sm', onclick: () => go('verification') }, 'Review'))))
      : empty('checkCircle', 'Nothing waiting', 'Every uploaded ID has been reviewed.');

    const unpaid = o.earnings.approvedUnpaid;
    page.append(h('div', { class: 'grid split mt' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'ID checks to review'), h('div', { class: 'sub' }, 'Open the document, read the flags, then decide'))), queue),
        h('div', { class: 'card accent' }, h('div', { class: 'spread' },
          h('div', {}, h('div', { style: { opacity: .85, fontWeight: 600, fontSize: '13px' } }, 'Approved and waiting for payroll'),
            h('div', { style: { fontSize: '32px', fontWeight: 800, letterSpacing: '-.03em', marginTop: '4px' } }, money(unpaid)),
            h('div', { style: { opacity: .85, marginTop: '4px', fontSize: '13px' } }, `Next automatic run: ${fmtDate(o.nextPayroll)}`)),
          h('button', { class: 'btn', style: { color: 'var(--brand)' }, onclick: () => go('payroll') }, icon('wallet'), 'Open payroll')))),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Recent activity'), h('button', { class: 'btn ghost sm', onclick: () => go('system') }, 'Audit log')),
        h('ul', { class: 'activity' }, o.activity.map((a) => {
          const [ic, tone, label] = auditStyle(a.action);
          return h('li', {}, h('div', { class: `ico-wrap ${tone}` }, icon(ic)),
            h('div', {}, h('div', { class: 't' }, label), h('div', { class: 's' }, `${a.actor} · ${timeAgo(a.at)}`)));
        })))));
  },

  // ---------------------------------------------------------------- verification
  async verification({ page, params, refresh, go }) {
    const status = params.get('status') || 'PENDING_REVIEW';
    const [{ items }, counts] = await Promise.all([api('GET', `/workers${qs({ status })}`), api('GET', '/counts')]);
    const search = h('input', { class: 'input', placeholder: 'Search workers', 'aria-label': 'Search workers' });
    const grid = h('div', { class: 'grid cols-2' });

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const shown = items.filter((w) => !q || `${w.name} ${w.email}`.toLowerCase().includes(q));
      grid.replaceChildren(...(shown.length ? shown.map(workerCard) : [h('div', { class: 'card', style: { gridColumn: '1 / -1' } }, empty('users', status === 'PENDING_REVIEW' ? 'No ID checks waiting' : 'No workers in this state', status === 'PENDING_REVIEW' ? 'You are all caught up.' : undefined))]));
    };

    function workerCard(w) {
      const doc = w.document;
      const decide = (decision) => async (ev) => {
        const button = ev.currentTarget; // currentTarget is cleared once we await
        const note = await noteDialog({
          title: decision === 'VERIFIED' ? `Verify ${w.name}?` : `Reject ${w.name}'s ID?`,
          subtitle: decision === 'VERIFIED' ? 'They will be able to apply for jobs.' : 'They will see your note and can upload a new document.',
          label: decision === 'VERIFIED' ? 'Note for the worker (optional)' : 'Why is it being rejected?',
          required: decision === 'REJECTED', confirmLabel: decision === 'VERIFIED' ? 'Verify worker' : 'Reject',
          kind: decision === 'VERIFIED' ? 'good' : 'danger',
        });
        if (note === null) return;
        await busy(button, async () => {
          await api('POST', `/workers/${w.workerId}/decision`, { decision, note: note || undefined });
          toast(`${w.name} ${decision === 'VERIFIED' ? 'verified' : 'rejected'}.`); refresh();
        });
      };
      const check = doc?.check;
      const problems = check ? check.flags.filter((f) => f !== 'EXPIRING_SOON') : [];
      return h('div', { class: 'card vcard' },
        h('div', { class: 'top' }, avatar(w.name, 'lg'), h('div', { class: 'who' }, h('h3', {}, w.name), h('div', { class: 'cell-sub' }, w.email)), badge(w.status)),
        doc ? h('div', { class: 'panel' },
          h('div', { class: 'spread', style: { marginBottom: '12px' } }, h('h4', { style: { margin: 0 } }, 'Automatic check'),
            problems.length ? h('span', { class: 'badge warn' }, `${problems.length} flagged`) : h('span', { class: 'badge ok' }, 'No problems found')),
          h('dl', { class: 'kv' },
            h('dt', {}, 'Name on ID'), h('dd', {}, doc.declared.nameOnId),
            h('dt', {}, 'ID number'), h('dd', {}, doc.declared.idMasked),
            h('dt', {}, 'Expires'), h('dd', {}, fmtDay(doc.declared.expiryDate)),
            h('dt', {}, 'Document'), h('dd', {}, `${docTypeLabel(doc.docType)} · ${fmtDate(doc.uploadedAt)}`)),
          check.flags.length > 0 && h('div', { style: { marginTop: '12px' } }, flagChips(check.flags, 'manager')))
          : h('div', { class: 'callout' }, icon('info'), h('div', {}, 'This worker has not uploaded an ID yet.')),
        w.reviewNote && h('p', { class: 'ink-2', style: { fontSize: '13.5px' } }, h('b', {}, 'Note: '), w.reviewNote),
        h('div', { class: 'row' },
          h('button', { class: 'btn', disabled: !doc, onclick: () => viewDocument(w) }, icon('eye'), 'View document'),
          w.status === 'PENDING_REVIEW' && h('div', { class: 'row', style: { marginLeft: 'auto' } },
            h('button', { class: 'btn danger', onclick: decide('REJECTED') }, icon('x'), 'Reject'),
            h('button', { class: 'btn good', onclick: decide('VERIFIED') }, icon('check'), 'Verify'))));
    }

    page.append(pageHead('Worker verification', 'The automatic check only raises flags. You make the final decision.',
      h('div', { class: 'search' }, icon('search'), search)));
    page.append(h('div', { style: { marginBottom: '18px' } }, segmented(
      [['PENDING_REVIEW', 'Waiting'], ['VERIFIED', 'Verified'], ['REJECTED', 'Rejected'], ['REGISTERED', 'No ID yet']], status,
      { PENDING_REVIEW: counts.pendingVerifications }, (s) => go(`verification?status=${s}`))));
    search.addEventListener('input', debounce(draw, 120));
    draw();
    page.append(grid);
  },

  // ---------------------------------------------------------------- applications
  async applications({ page, params, refresh, go }) {
    const status = params.get('status') || 'PENDING';
    const [{ items }, counts] = await Promise.all([api('GET', `/applications${qs({ status })}`), api('GET', '/counts')]);
    const decide = (a, decision) => (ev) => busy(ev.currentTarget, async () => {
      await api('POST', `/applications/${encodeURIComponent(a.applicationId)}/decision`, { decision });
      toast(`${a.workerName}'s application ${decision.toLowerCase()}.`); refresh();
    });
    page.append(pageHead('Applications', 'Approving one claims a slot on the job.'));
    page.append(h('div', { style: { marginBottom: '18px' } }, segmented([['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']], status,
      { PENDING: counts.pendingApplications }, (s) => go(`applications?status=${s}`))));
    page.append(h('div', { class: 'card flush' }, table([
      { label: 'Worker', render: (a) => h('div', { class: 'person' }, avatar(a.workerName, 'sm'), h('span', { class: 'cell-main' }, a.workerName)) },
      { label: 'Job', render: (a) => a.jobTitle },
      { label: 'Applied', render: (a) => fmtDate(a.createdAt) },
      { label: 'Note', render: (a) => a.note || h('span', { class: 'muted' }, '—') },
      { label: 'Status', render: (a) => badge(a.status) },
      { label: '', render: (a) => a.status === 'PENDING' && h('div', { class: 'actions' },
        h('button', { class: 'btn sm good', onclick: decide(a, 'APPROVED') }, icon('check'), 'Approve'),
        h('button', { class: 'btn sm danger', onclick: decide(a, 'REJECTED') }, 'Reject')) },
    ], items, { emptyView: empty('file', 'No applications here', status === 'PENDING' ? 'New applications will show up as workers apply.' : undefined) })));
  },

  // ----------------------------------------------------------------- timesheets
  async timesheets({ page, params, refresh, go }) {
    const status = params.get('status') || 'SUBMITTED';
    const [{ items }, counts] = await Promise.all([api('GET', `/timesheets${qs({ status })}`), api('GET', '/counts')]);
    const approve = (t) => (ev) => busy(ev.currentTarget, async () => {
      await api('POST', `/timesheets/${encodeURIComponent(t.timesheetId)}/decision`, { decision: 'APPROVED' });
      toast('Hours approved.'); refresh();
    });
    const reject = (t) => async (ev) => {
      const button = ev.currentTarget; // currentTarget is cleared once we await
      const note = await noteDialog({ title: 'Reject these hours?', subtitle: `${t.workerName} · ${hoursText(t.hours)} on ${fmtDay(t.workDate)}`, label: 'Note for the worker (optional)', placeholder: 'e.g. Shift was cancelled', confirmLabel: 'Reject hours' });
      if (note === null) return;
      await busy(button, async () => {
        await api('POST', `/timesheets/${encodeURIComponent(t.timesheetId)}/decision`, { decision: 'REJECTED', note: note || undefined });
        toast('Hours rejected.'); refresh();
      });
    };
    const totalHours = items.reduce((a, t) => a + t.hours, 0);
    const totalAmount = items.reduce((a, t) => a + Number(t.amount), 0);
    page.append(pageHead('Timesheets', 'Only approved hours are included in payroll.'));
    page.append(h('div', { style: { marginBottom: '18px' } }, segmented([['SUBMITTED', 'Waiting'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['PAID', 'Paid']], status,
      { SUBMITTED: counts.pendingTimesheets }, (s) => go(`timesheets?status=${s}`))));
    page.append(h('div', { class: 'card flush' }, table([
      { label: 'Worker', render: (t) => h('div', { class: 'person' }, avatar(t.workerName, 'sm'), h('span', { class: 'cell-main' }, t.workerName)) },
      { label: 'Job', render: (t) => t.jobTitle },
      { label: 'Date', render: (t) => fmtDay(t.workDate) },
      { label: 'Hours', num: true, render: (t) => hoursText(t.hours) },
      { label: 'Amount', num: true, render: (t) => money(t.amount) },
      { label: 'Notes', render: (t) => t.notes || t.managerNote || h('span', { class: 'muted' }, '—') },
      { label: '', render: (t) => t.status === 'SUBMITTED' ? h('div', { class: 'actions' },
        h('button', { class: 'btn sm good', onclick: approve(t) }, icon('check'), 'Approve'),
        h('button', { class: 'btn sm danger', onclick: reject(t) }, 'Reject')) : badge(t.status) },
    ], items, {
      emptyView: empty('clock', 'No timesheets here', status === 'SUBMITTED' ? 'You are all caught up.' : undefined),
      foot: ['Total', '', '', hoursText(totalHours), money(totalAmount.toFixed(2)), '', ''],
    })));
  },

  // ------------------------------------------------------------------------ jobs
  async jobs({ page, params, refresh, go }) {
    const status = params.get('status') || 'OPEN';
    const { items } = await api('GET', `/jobs${qs({ status })}`);
    const toggle = (j, to) => (ev) => busy(ev.currentTarget, async () => {
      await api('PATCH', `/jobs/${j.jobId}`, { status: to });
      toast(to === 'CLOSED' ? 'Job closed.' : 'Job reopened.'); refresh();
    });
    const postBtn = h('button', { class: 'btn primary', onclick: () => postJobModal(refresh) }, icon('plus'), 'Post a job');
    page.append(pageHead('Jobs', 'Post openings and close them when you are done.', postBtn));
    page.append(h('div', { style: { marginBottom: '18px' } }, segmented([['OPEN', 'Open'], ['FILLED', 'Filled'], ['CLOSED', 'Closed']], status, null, (s) => go(`jobs?status=${s}`))));
    page.append(h('div', { class: 'grid auto' }, items.length
      ? items.map((j) => jobCard(j, j.status === 'OPEN' ? h('button', { class: 'btn sm', onclick: toggle(j, 'CLOSED') }, 'Close')
        : j.status === 'CLOSED' && j.filled < j.slots ? h('button', { class: 'btn sm', onclick: toggle(j, 'OPEN') }, icon('refresh'), 'Reopen') : null))
      : [h('div', { class: 'card', style: { gridColumn: '1 / -1' } }, empty('briefcase', 'No jobs in this state', undefined, status === 'OPEN' ? h('button', { class: 'btn primary', onclick: () => postJobModal(refresh) }, 'Post your first job') : null))]));
  },

  // --------------------------------------------------------------------- payroll
  async payroll({ page, refresh }) {
    const { items, nextRun } = await api('GET', '/payroll/runs');
    const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const lastWeek = () => { const d = new Date(); const sinceMon = (d.getDay() + 6) % 7; const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMon - 7); return [iso(mon), iso(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6))]; };
    const thisWeek = () => { const d = new Date(); const sinceMon = (d.getDay() + 6) % 7; const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMon); return [iso(mon), iso(d)]; };
    const last30 = () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 29)), iso(d)]; };

    const [defStart, defEnd] = lastWeek();
    const start = h('input', { class: 'input', type: 'date', required: true, value: defStart });
    const end = h('input', { class: 'input', type: 'date', required: true, value: defEnd });
    const result = h('div');
    const preset = (label, fn) => h('button', { class: 'btn sm', type: 'button', onclick: () => { [start.value, end.value] = fn(); } }, label);

    const show = (r, dry) => {
      const rep = r.report;
      result.replaceChildren(h('div', { class: 'card flush', style: { marginTop: '18px' } },
        h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, dry ? 'Preview' : `Payroll run ${r.runId}`), h('div', { class: 'sub' }, `${fmtDay(rep.periodStart)} to ${fmtDay(rep.periodEnd)}${dry ? ' · nothing saved yet' : ''}`)),
          dry ? badge('PENDING', 'Preview') : badge('PAID', 'Generated')),
        table([
          { label: 'Worker', render: (w) => h('div', { class: 'person' }, avatar(w.workerName, 'sm'), h('div', {}, h('div', { class: 'cell-main' }, w.workerName), h('div', { class: 'cell-sub' }, w.email))) },
          { label: 'Shifts', num: true, render: (w) => w.lines.length },
          { label: 'Hours', num: true, render: (w) => hoursText(w.hours) },
          { label: 'Gross pay', num: true, render: (w) => money(w.gross) },
        ], rep.workers, {
          emptyView: empty('wallet', 'Nothing to pay in this period', 'There are no approved, unpaid timesheets between these dates.'),
          foot: ['Total', rep.timesheetCount, hoursText(rep.totalHours), money(rep.totalGross)],
        })));
    };
    const run = (dry) => (ev) => busy(ev.currentTarget, async () => { // called synchronously, so currentTarget is still set
      if (!start.value || !end.value) return toast('Choose both dates.', 'bad');
      if (!dry && !(await confirmDialog({ title: 'Generate payroll?', message: 'This creates the CSV and JSON reports and marks the included timesheets as paid. It cannot be undone.', confirmLabel: 'Generate report' }))) return;
      const r = await api('POST', '/payroll/runs', { periodStart: start.value, periodEnd: end.value, dryRun: dry });
      show(r, r.dryRun);
      if (!dry && !r.dryRun) { toast('Payroll report created.'); refresh(); }
    });

    page.append(pageHead('Payroll', `Gross pay in ${getCurrency()} from approved hours. Net pay and tax are out of scope.`));
    page.append(h('div', { class: 'grid split' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', {}, 'Run payroll'), h('div', { class: 'row tight' }, preset('Last week', lastWeek), preset('This week', thisWeek), preset('Last 30 days', last30))),
        h('div', { class: 'form-grid' }, field('From', start), field('To', end)),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn', onclick: run(true) }, icon('eye'), 'Preview'),
          h('button', { class: 'btn primary', onclick: run(false) }, icon('wallet'), 'Generate report'))),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Automatic weekly run')),
        h('p', { class: 'ink-2' }, 'Every Monday at 02:00 UTC the app pays the previous Monday to Sunday. If the computer was off, it catches up the next time the app starts.'),
        h('div', { class: 'callout', style: { marginTop: '14px' } }, icon('calendar'), h('div', {}, h('b', {}, 'Next run '), h('span', {}, fmtDate(nextRun)))))));
    page.append(result);

    page.append(h('div', { class: 'card flush mt' }, h('div', { class: 'card-head' }, h('h3', {}, 'Past runs')),
      table([
        { label: 'Run', render: (r) => h('div', { class: 'cell-main', style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '12.5px' } }, r.runId) },
        { label: 'Period', render: (r) => `${fmtDay(r.periodStart)} → ${fmtDay(r.periodEnd)}` },
        { label: 'Workers', num: true, render: (r) => r.workerCount },
        { label: 'Hours', num: true, render: (r) => hoursText(r.totalHours) },
        { label: 'Gross', num: true, render: (r) => h('b', {}, money(r.totalGross)) },
        { label: 'By', render: (r) => r.generatedBy },
        { label: '', render: (r) => h('div', { class: 'actions' },
          h('a', { class: 'btn sm', href: `/api/payroll/runs/${r.runId}/download?format=csv`, download: '' }, icon('download'), 'CSV'),
          h('a', { class: 'btn sm', href: `/api/payroll/runs/${r.runId}/download?format=json`, download: '' }, icon('download'), 'JSON')) },
      ], items, { emptyView: empty('wallet', 'No payroll runs yet', 'Preview a period above, then generate your first report.') })));
  },

  // ------------------------------------------------------------ audit and system
  async system({ page, refresh }) {
    const sys = await api('GET', '/system');
    const search = h('input', { class: 'input', placeholder: 'Filter the audit log', 'aria-label': 'Filter the audit log' });
    const logHolder = h('div');
    const bytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
    const uptime = (s) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} d`);

    async function loadLog() {
      const { items } = await api('GET', `/audit${qs({ q: search.value.trim(), limit: 100 })}`);
      logHolder.replaceChildren(table([
        { label: 'Event', render: (a) => { const [ic, tone, label] = auditStyle(a.action); return h('div', { class: 'person', style: { whiteSpace: 'nowrap' } }, h('div', { class: `ico-wrap ${tone}` }, icon(ic)), h('span', { class: 'cell-main' }, label)); } },
        { label: 'By', render: (a) => a.actor },
        { label: 'Details', render: (a) => h('span', { class: 'cell-sub' }, detailText(a.details) || '—') },
        { label: 'When', render: (a) => h('span', { title: fmtDate(a.at), style: { whiteSpace: 'nowrap' } }, timeAgo(a.at)) },
      ], items, { emptyView: empty('activity', 'No matching events') }));
    }
    search.addEventListener('input', debounce(loadLog, 200));

    const backupBtn = h('button', { class: 'btn primary sm', onclick: (ev) => busy(ev.currentTarget, async () => { await api('POST', '/system/backup'); toast('Backup created.'); refresh(); }) }, icon('database'), 'Back up now');

    page.append(pageHead('Audit & system', 'Everything that happens is recorded here. Data never leaves this computer.'));
    page.append(h('div', { class: 'grid cols-4' },
      statTile({ label: 'Uptime', value: uptime(sys.uptimeSeconds), sub: `Node ${sys.node}`, iconName: 'server', tone: 'ok' }),
      statTile({ label: 'Database', value: bytes(sys.databaseBytes), sub: 'SQLite on disk', iconName: 'database', tone: 'brand' }),
      statTile({ label: 'Encrypted IDs', value: sys.documents, sub: 'AES-256-GCM at rest', iconName: 'lock', tone: 'warn' }),
      statTile({ label: 'Audit events', value: sys.counts.auditEvents, sub: 'Recorded so far', iconName: 'activity', tone: 'info' })));

    page.append(h('div', { class: 'grid cols-2 mt' },
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Backups'), h('div', { class: 'sub' }, `Daily, newest ${10} kept`)), backupBtn),
          sys.backups.length ? h('ul', { class: 'list' }, sys.backups.slice(0, 5).map((b) => h('li', {},
            h('div', { class: 'stat-icon tone-ok', style: { width: '36px', height: '36px', borderRadius: '11px', fontSize: '17px' } }, icon('database')),
            h('div', { class: 'grow' }, h('b', { style: { fontSize: '13px' } }, b.name), h('div', { class: 'cell-sub' }, `${bytes(b.bytes)} · ${timeAgo(b.createdAt)}`)))))
            : empty('database', 'No backups yet')),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Scheduler')),
          h('dl', { class: 'kv' },
            h('dt', {}, 'Next payroll'), h('dd', {}, fmtDate(sys.nextPayroll)),
            h('dt', {}, 'Last weekly run'), h('dd', {}, sys.lastWeeklyPayroll ? `Week of ${fmtDay(sys.lastWeeklyPayroll)}` : 'Not yet'),
            h('dt', {}, 'Last backup'), h('dd', {}, sys.lastBackupAt ? timeAgo(sys.lastBackupAt) : 'Not yet')))));
    page.append(h('div', { class: 'card flush mt' },
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Audit log'), h('div', { class: 'sub' }, 'Newest first, last 100 events')), h('div', { class: 'search' }, icon('search'), search)),
      h('div', { class: 'scroll-body' }, logHolder)));
    await loadLog();
  },
};

// ------------------------------------------------------------------ post-a-job modal
function postJobModal(refresh) {
  const f = (type, attrs = {}) => h('input', { class: 'input', type, ...attrs });
  const title = f('text', { maxlength: '100', required: true, placeholder: 'e.g. Warehouse Associate' });
  const location = f('text', { maxlength: '100', required: true, placeholder: 'City · area' });
  const rate = f('number', { min: '1', max: '100000', step: '0.01', required: true, placeholder: '250' });
  const slots = f('number', { min: '1', max: '500', step: '1', value: '1', required: true });
  const start = f('date', { required: true, value: new Date().toISOString().slice(0, 10) });
  const end = f('date');
  const desc = h('textarea', { class: 'textarea', maxlength: '2000', required: true, placeholder: 'What will the worker do? Any requirements?' });
  const body = h('div', {},
    h('div', { class: 'form-grid' }, field('Title', title), field('Location', location), field(`Hourly rate (${getCurrency()})`, rate), field('Positions', slots), field('Start date', start), field('End date (optional)', end)),
    field('Description', desc));
  openModal({
    title: 'Post a job', subtitle: 'Verified workers can apply as soon as it is posted.', wide: true, body,
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Post job', kind: 'primary', icon: 'plus', onClick: ({ close, button }) => busy(button, async () => {
      for (const el of [title, location, rate, slots, start, desc]) if (!el.value.trim()) { el.focus(); return toast('Please fill in every required field.', 'bad'); }
      await api('POST', '/jobs', { title: title.value, description: desc.value, location: location.value, hourlyRate: Number(rate.value), slots: Number(slots.value), startDate: start.value, endDate: end.value || undefined });
      close(); toast('Job posted.'); refresh();
    }) }],
  });
}

