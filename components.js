// Pieces shared by the worker and manager screens.
import { h, icon, money, fmtDay, gradientFor, openModal, badge, titleCase } from './ui.js';

export const brandMark = () => h('div', { class: 'brand-mark', style: { color: '#fff' } }, icon('bridge', 24));

// ---------- automatic ID-check flags ----------
const FLAGS = {
  DOCUMENT_EXPIRED: { tone: 'bad', icon: 'xCircle', worker: 'The document has expired.', manager: 'The document has expired.' },
  EXPIRING_SOON: { tone: 'info', icon: 'info', worker: 'The document expires within 30 days.', manager: 'The document expires within 30 days.' },
  NAME_MISMATCH: { tone: '', icon: 'alert', worker: 'The name on the ID does not match your profile name.', manager: 'The name on the ID does not match the profile name.' },
  LOW_RESOLUTION: { tone: '', icon: 'alert', worker: 'The image resolution is low. A sharper, well-lit photo helps.', manager: 'Low-resolution scan. Check that it is readable.' },
  DUPLICATE_ID_NUMBER: { tone: 'bad', icon: 'alert', worker: 'This ID number is already linked to another account.', manager: 'This ID number is already used by another account.' },
};
export const flagChips = (flags, audience = 'worker') => h('div', { class: 'chips' }, flags.map((f) => {
  const d = FLAGS[f] || { tone: '', icon: 'alert', worker: f, manager: f };
  return h('span', { class: `chip ${d.tone}` }, icon(d.icon), d[audience]);
}));

export const DOC_TYPES = [['PASSPORT', 'Passport'], ['DRIVERS_LICENSE', "Driver's licence"], ['NATIONAL_ID', 'National ID card'], ['RESIDENCE_PERMIT', 'Residence permit']];
export const docTypeLabel = (t) => (DOC_TYPES.find(([v]) => v === t) || [t, titleCase(t || 'ID')])[1];

/** Open a worker's ID scan (served decrypted by the API, managers only). */
export function viewDocument(worker) {
  const url = `/api/workers/${worker.workerId}/document`;
  const doc = worker.document;
  const isPdf = doc.contentType === 'application/pdf';
  const body = isPdf
    ? h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, icon('file')), h('h4', {}, doc.fileName), h('p', {}, 'PDF documents open in a new tab.'),
        h('div', { style: { marginTop: '14px' } }, h('a', { class: 'btn primary', href: url, target: '_blank', rel: 'noopener' }, icon('eye'), 'Open PDF')))
    : h('img', { class: 'doc-view', src: url, alt: `ID document of ${worker.name}` });
  openModal({
    title: `${worker.name}'s ${docTypeLabel(doc.docType)}`,
    subtitle: 'Viewing is recorded in the audit log.',
    wide: true, body,
    actions: [{ label: 'Close', kind: 'ghost' }],
  });
}

// ---------- job card ----------
/** `footer` is the node placed at the bottom right (Apply button, or manager actions). */
export function jobCard(job, footer) {
  const left = job.slots - job.filled;
  return h('div', { class: 'card job' },
    h('div', { class: 'job-top', style: { background: gradientFor(job.title) } },
      h('span', { class: 'job-rate' }, `${money(job.hourlyRate)}/h`),
      h('h3', {}, job.title),
      h('div', { class: 'where' }, icon('pin', 14), job.location)),
    h('div', { class: 'job-body' },
      h('p', {}, job.description),
      h('div', { class: 'job-meta' },
        h('span', {}, icon('calendar', 14), `From ${fmtDay(job.startDate)}`),
        job.endDate && h('span', {}, icon('clock', 14), `to ${fmtDay(job.endDate)}`)),
      h('div', { class: 'job-foot' },
        h('div', { class: 'slots' },
          h('small', {}, job.status === 'OPEN' ? `${left} of ${job.slots} slots left` : `${job.filled}/${job.slots} filled`),
          h('div', { class: 'progress' }, h('i', { style: { width: `${Math.round((job.filled / job.slots) * 100)}%` } }))),
        job.status !== 'OPEN' && badge(job.status),
        footer)));
}

/** Greeting that matches the time of day. */
export function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}
