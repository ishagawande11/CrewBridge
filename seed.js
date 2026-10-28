'use strict';
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { hashPassword } = require('./auth');
const { evaluateId, maskNumber, imageSize } = require('./idcheck');
const { runPayroll, previousWeek } = require('./payroll');

const DAY = 86400000;

// ---- a tiny PNG writer, just to give the demo workers a placeholder ID image ----
function makePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A generic "sample ID card" picture: header band, photo block, text lines. */
function sampleCard(width, height, hue) {
  const s = width / 800;
  const inRect = (x, y, x0, y0, x1, y1) => x >= x0 * s && x < x1 * s && y >= y0 * s && y < y1 * s;
  return makePng(width, height, (x, y) => {
    if (inRect(x, y, 0, 0, 800, 90)) return hue;
    if (inRect(x, y, 50, 140, 260, 400)) { // photo with a head-and-shoulders silhouette
      const cx = 155 * s; const head = Math.hypot(x - cx, y - 235 * s) < 45 * s;
      const body = Math.hypot(x - cx, y - 380 * s) < 85 * s;
      return head || body ? [150, 160, 178] : [208, 214, 226];
    }
    for (const [y0, w] of [[150, 380], [205, 300], [260, 340], [315, 220]]) {
      if (inRect(x, y, 310, y0, 310 + w, y0 + 22)) return [196, 203, 217];
    }
    return [243, 245, 250];
  });
}

function seedDemo({ db, store, storage, currency, now = new Date() }) {
  const iso = (offsetDays) => new Date(now.getTime() + offsetDays * DAY).toISOString();
  const day = (offsetDays) => iso(offsetDays).slice(0, 10);
  const id = () => crypto.randomUUID();

  // ---- accounts ----
  const manager = { id: id(), email: 'manager@crewbridge.local', name: 'Priya Sharma', role: 'manager' };
  store.createUser({ ...manager, passwordHash: hashPassword('Manager@123'), createdAt: iso(-40) });

  const workerHash = hashPassword('Worker@123');
  const mk = (first, last, email, joined) => {
    const w = { id: id(), email, name: `${first} ${last}`, role: 'worker' };
    store.createUser({ ...w, passwordHash: workerHash, createdAt: iso(joined) });
    return w;
  };
  const aarav = mk('Aarav', 'Mehta', 'aarav@crewbridge.local', -30);
  const rohan = mk('Rohan', 'Kulkarni', 'rohan@crewbridge.local', -28);
  const diya = mk('Diya', 'Nair', 'diya@crewbridge.local', -3);
  const sneha = mk('Sneha', 'Joshi', 'sneha@crewbridge.local', -2);
  const meera = mk('Meera', 'Iyer', 'meera@crewbridge.local', -9);
  mk('Karan', 'Desai', 'karan@crewbridge.local', -1);

  // ---- ID documents (checked with the same rules the live upload uses) ----
  function submitId(worker, { nameOnId, idNumber, expiry, docType = 'NATIONAL_ID', width = 800, height = 500, hue = [67, 97, 238], at }) {
    const bytes = sampleCard(width, height, hue);
    const declared = { nameOnId, idNumber, expiryDate: expiry };
    const hash = storage.hashIdNumber(idNumber);
    const check = evaluateId({ declared, profileName: worker.name, size: imageSize(bytes, 'image/png'), duplicateOwner: store.findIdHashOwner(hash, worker.id), now });
    const key = storage.saveDocument(worker.id, docType, 'png', bytes);
    store.setDocument(worker.id, {
      key, docType, fileName: 'id-scan.png', contentType: 'image/png', size: bytes.length, uploadedAt: iso(at),
      declared: { nameOnId, idMasked: maskNumber(idNumber), expiryDate: expiry }, check,
    }, hash);
  }
  const verify = (w, at) => store.decideWorker(w.id, 'VERIFIED', null, manager.id, iso(at));

  submitId(aarav, { nameOnId: 'Aarav Mehta', idNumber: 'MH12 2021 0045312', expiry: day(900), docType: 'DRIVERS_LICENSE', at: -29 });
  verify(aarav, -29);
  submitId(rohan, { nameOnId: 'Rohan S Kulkarni', idNumber: 'ZP4412908', expiry: day(1500), docType: 'PASSPORT', hue: [16, 150, 120], at: -27 });
  verify(rohan, -27);
  submitId(diya, { nameOnId: 'Diya Nair', idNumber: 'KA05 2020 0099871', expiry: day(600), docType: 'DRIVERS_LICENSE', hue: [217, 119, 6], at: -1 });
  submitId(sneha, { nameOnId: 'Sneha R Joshi', idNumber: 'ABCDE1234F', expiry: day(14), width: 400, height: 250, hue: [190, 52, 85], at: -1 }); // low resolution, expiring soon
  submitId(meera, { nameOnId: 'Meera Iyer', idNumber: 'KA05 2020 0099871', expiry: day(-20), hue: [99, 102, 241], at: -8 }); // expired + same ID number as Diya
  store.decideWorker(meera.id, 'REJECTED', 'Your document has expired. Please upload a current ID.', manager.id, iso(-7));

  // ---- jobs ----
  const mkJob = (title, location, rate, slots, description, startOffset, endOffset, status = 'OPEN') => {
    const j = { jobId: id(), title, location, hourlyRate: rate, slots, description, startDate: day(startOffset), endDate: endOffset == null ? undefined : day(endOffset), createdBy: manager.id, createdAt: iso(startOffset - 2) };
    store.createJob(j);
    if (status !== 'OPEN') store.setJobStatus(j.jobId, status);
    return j;
  };
  const warehouse = mkJob('Warehouse Associate', 'Pune · Chakan MIDC', 220, 6, 'Pick, pack and load outbound orders on the day shift. Safety shoes provided; training on day one.', -30, 60);
  const events = mkJob('Event Crew', 'Mumbai · BKC', 350, 4, 'Set-up and teardown for corporate conferences. Flexible evening and weekend shifts.', -25, 45);
  mkJob('Retail Promoter', 'Bengaluru · Indiranagar', 260, 3, 'Demo new products on the shop floor and help customers choose. Good communication in English and Kannada.', -5, 90);
  mkJob('Data Entry Operator', 'Remote', 300, 5, 'Type and verify records from scanned forms. Accuracy matters more than speed. Own laptop required.', -10, null);
  mkJob('Delivery Partner', 'Pune · Hinjewadi', 180, 8, 'Last-mile deliveries on your own two-wheeler. Fuel allowance paid weekly.', -1, 120);
  mkJob('Festival Stage Hand', 'Goa · Panjim', 400, 2, 'Season is over. Both positions were filled.', -60, -35, 'CLOSED');

  // ---- applications ----
  const apply = (worker, job, status, at) => {
    const a = { applicationId: `${job.jobId}_${worker.id}`, jobId: job.jobId, jobTitle: job.title, workerId: worker.id, workerName: worker.name, createdAt: iso(at) };
    store.createApplication(a);
    if (status === 'APPROVED') store.approveApplication(a.applicationId, manager.id, iso(at + 0.1));
    return a;
  };
  const aaravWh = apply(aarav, warehouse, 'APPROVED', -28);
  const aaravEv = apply(aarav, events, 'APPROVED', -20);
  const rohanWh = apply(rohan, warehouse, 'APPROVED', -26);
  apply(rohan, events, 'APPROVED', -18);
  apply(aarav, store.listJobs('OPEN').find((j) => j.title === 'Retail Promoter'), 'PENDING', -1);
  apply(rohan, store.listJobs('OPEN').find((j) => j.title === 'Data Entry Operator'), 'PENDING', -1);

  // ---- timesheets: three weeks of mostly-weekday shifts ----
  const log = (app, worker, job, offset, hours, status, note) => {
    const d = day(offset);
    const t = { timesheetId: `${app.applicationId}_${d}`, applicationId: app.applicationId, jobId: job.jobId, jobTitle: job.title, workerId: worker.id, workerName: worker.name, workDate: d, hours, hourlyRate: job.hourlyRate, createdAt: iso(offset) };
    store.createTimesheet(t);
    if (status !== 'SUBMITTED') store.decideTimesheet(t.timesheetId, status, manager.id, note, iso(offset + 1));
  };
  const hoursFor = (offset, base) => base + ((Math.abs(offset) * 7) % 5) * 0.5; // varied but deterministic
  let rejectedOne = false; // one rejected timesheet, so that state shows up in the UI
  for (let offset = -21; offset <= -1; offset++) {
    const dow = new Date(now.getTime() + offset * DAY).getUTCDay();
    if (dow === 0) continue; // Sundays off
    const status = offset >= -3 ? 'SUBMITTED' : 'APPROVED';
    log(aaravWh, aarav, warehouse, offset, hoursFor(offset, 6), status);
    if (dow !== 6 && offset >= -14) {
      const reject = !rejectedOne && offset <= -5;
      rejectedOne ||= reject;
      log(rohanWh, rohan, warehouse, offset, hoursFor(offset, 5), reject ? 'REJECTED' : status, reject ? 'Shift was cancelled that day.' : undefined);
    }
    if (dow === 6 && offset >= -20) log(aaravEv, aarav, events, offset, hoursFor(offset, 4), status);
  }

  // pay the oldest week for real, so there is a genuine report and run in the history
  runPayroll({ db, store, storage, periodStart: day(-21), periodEnd: day(-12), by: manager.email, now: new Date(now.getTime() - 11 * DAY), currency });
  // The demo's most recent week stays unpaid so the manager can try Preview / Generate; tell
  // the scheduler this week's automatic run has "already happened".
  store.setKv('weekly_payroll_period', previousWeek(now).periodStart);

  store.notify({ kind: 'worker', title: 'New worker registered', body: 'Karan Desai (karan@crewbridge.local) created an account.' });
  store.notify({ kind: 'verification', title: 'Worker awaiting verification', body: 'Sneha Joshi uploaded national id. Automatic check: flagged (2).' });
  store.notify({ kind: 'verification', title: 'Worker awaiting verification', body: 'Diya Nair uploaded drivers license. Automatic check: no problems found.' });

  // ---- audit history, so the activity feed and audit log are not empty on first run ----
  const history = [
    ...[aarav, rohan, diya, sneha, meera].map((w, i) => [[-30, -28, -3, -2, -9][i], w, 'ACCOUNT_REGISTERED', { role: 'worker' }]),
    [-29.5, aarav, 'DOCUMENT_UPLOADED', { docType: 'DRIVERS_LICENSE', flags: [] }],
    [-29, manager, 'WORKER_VERIFIED', { worker: aarav.name }],
    [-27.5, rohan, 'DOCUMENT_UPLOADED', { docType: 'PASSPORT', flags: [] }],
    [-27, manager, 'WORKER_VERIFIED', { worker: rohan.name }],
    [-8, meera, 'DOCUMENT_UPLOADED', { docType: 'NATIONAL_ID', flags: ['DOCUMENT_EXPIRED', 'DUPLICATE_ID_NUMBER'] }],
    [-7, manager, 'WORKER_REJECTED', { worker: meera.name }],
    [-32, manager, 'JOB_CREATED', { title: warehouse.title }],
    [-27, manager, 'JOB_CREATED', { title: events.title }],
    [-28, manager, 'APPLICATION_APPROVED', { worker: aarav.name, job: warehouse.title }],
    [-26, manager, 'APPLICATION_APPROVED', { worker: rohan.name, job: warehouse.title }],
    [-11, manager, 'PAYROLL_RUN', { periodStart: day(-21), periodEnd: day(-12) }],
    [-1.2, diya, 'DOCUMENT_UPLOADED', { docType: 'DRIVERS_LICENSE', flags: [] }],
    [-1.1, sneha, 'DOCUMENT_UPLOADED', { docType: 'NATIONAL_ID', flags: ['EXPIRING_SOON', 'LOW_RESOLUTION'] }],
    [-0.4, manager, 'JOB_CREATED', { title: 'Delivery Partner' }],
  ];
  for (const [offset, who, action, details] of history.sort((a, b) => a[0] - b[0])) store.audit(who, action, details, iso(offset));
}

module.exports = { seedDemo, sampleCard };

// `npm run seed` wipes the data folder and loads a fresh demo.
if (require.main === module) {
  const fs = require('node:fs');
  const config = require('./config');
  if (process.argv.includes('--reset')) fs.rmSync(config.dataDir, { recursive: true, force: true });
  const { createApp } = require('./index');
  const app = createApp({ seed: true });
  console.log(`Demo data loaded into ${config.dataDir}`);
  app.close();
}


