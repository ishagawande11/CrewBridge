'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const { HttpError, Raw, readBody, parseJson, sendJson, sendRaw } = require('./http');
const v = require('./validation');
const { hashPassword, checkPasswordStrength } = require('./auth');
const { evaluateId, maskNumber, sniffFile, imageSize } = require('./idcheck');
const { runPayroll, nextRunTime } = require('./payroll');

const DOC_TYPES = ['PASSPORT', 'DRIVERS_LICENSE', 'NATIONAL_ID', 'RESIDENCE_PERMIT'];
const WORKER_STATUSES = ['REGISTERED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED'];
const major = (cents) => Math.round(cents) / 100;

function createRouter({ store, storage, auth, backups, scheduler, config, dbFile, now = () => new Date() }) {
  const today = () => now().toISOString().slice(0, 10);
  const stamp = () => now().toISOString();
  const startedAt = Date.now();

  const audit = (user, action, details = {}) => {
    store.audit(user, action, details);
    console.log(JSON.stringify({ audit: true, action, actor: user?.email ?? 'system', ...details }));
  };

  // ---------- route table ----------
  const routes = [];
  const route = (method, path, access, fn) => routes.push({
    method, access, fn,
    names: [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
    regex: new RegExp(`^${path.replace(/\{\w+\}/g, '([^/]+)')}$`),
  });

  const meView = (userId) => {
    const u = store.getUserById(userId);
    if (u.role === 'manager') return { role: 'manager', userId: u.id, name: u.name, email: u.email, createdAt: u.created_at };
    return { role: 'worker', userId: u.id, ...store.getWorker(u.id) };
  };

  // ----- public: config and accounts -----
  route('GET', '/config', 'public', () => ({
    appName: 'CrewBridge', currency: config.currency,
    demo: !!store.getUserByEmail('manager@crewbridge.local'),
  }));

  // The UI asks this on page load; unlike /me it answers 200 when nobody is signed in.
  route('GET', '/session', 'public', ({ user }) => (user ? meView(user.id) : { role: null }));

  route('POST', '/auth/register', 'public', ({ body, res }) => {
    const role = body.role === 'manager' ? 'manager' : 'worker';
    if (role === 'manager' && body.managerCode !== config.managerCode) throw new HttpError(403, 'That manager invite code is not valid');
    const user = {
      id: crypto.randomUUID(), email: v.email(body), name: v.str(body, 'name', { min: 2, max: 100 }), role, createdAt: stamp(),
    };
    checkPasswordStrength(body.password);
    store.createUser({ ...user, passwordHash: hashPassword(body.password) });
    auth.startSession(res, user.id);
    audit(user, 'ACCOUNT_REGISTERED', { role });
    if (role === 'worker') store.notify({ kind: 'worker', title: 'New worker registered', body: `${user.name} (${user.email}) created an account.` });
    return meView(user.id);
  });

  route('POST', '/auth/login', 'public', ({ body, res, req }) => {
    const user = auth.login(v.email(body), String(body.password ?? ''), req.socket.remoteAddress);
    auth.startSession(res, user.id);
    audit({ id: user.id, email: user.email }, 'LOGIN');
    return meView(user.id);
  });

  route('POST', '/auth/logout', 'public', ({ req, res }) => {
    auth.endSession(req, res);
    return { ok: true };
  });

  // ----- profile -----
  route('GET', '/me', 'any', ({ user }) => meView(user.id));

  route('PUT', '/me', 'any', ({ user, body }) => {
    store.updateProfile(user.id, { name: v.str(body, 'name', { min: 2, max: 100 }), phone: v.str(body, 'phone', { max: 30, optional: true }) });
    return meView(user.id);
  });

  // Small, cheap payload polled by the UI for the sidebar badges and the notification bell.
  route('GET', '/counts', 'any', ({ user }) => {
    const out = { unreadNotifications: store.unreadCount(user) };
    if (user.isManager) {
      const c = store.counts();
      Object.assign(out, { pendingVerifications: c.pendingVerifications, pendingApplications: c.pendingApplications, pendingTimesheets: c.pendingTimesheets });
    }
    return out;
  });

  route('GET', '/notifications', 'any', ({ user }) => ({ items: store.listNotifications(user), unread: store.unreadCount(user) }));
  route('POST', '/notifications/read', 'any', ({ user }) => { store.markAllRead(user); return { ok: true }; });

  // ----- dashboards -----
  route('GET', '/overview', 'any', ({ user }) => {
    if (user.isManager) {
      const e = store.earnings();
      return {
        role: 'manager',
        counts: store.counts(),
        earnings: { submitted: major(e.SUBMITTED), approvedUnpaid: major(e.APPROVED), paid: major(e.PAID) },
        hoursByDay: store.hoursByDay(14, null, today()),
        timesheetStatus: store.timesheetStatusCounts(),
        pendingQueue: store.listWorkers('PENDING_REVIEW').slice(0, 5),
        activity: store.listAudit(8),
        nextPayroll: nextRunTime(now()).toISOString(),
      };
    }
    const me = store.getWorker(user.id);
    const apps = store.listApplicationsByWorker(user.id);
    const e = store.earnings(user.id);
    return {
      role: 'worker',
      status: me.status,
      openJobs: store.listJobs('OPEN').length,
      applications: { pending: apps.filter((a) => a.status === 'PENDING').length, approved: apps.filter((a) => a.status === 'APPROVED').length, total: apps.length },
      earnings: { submitted: major(e.SUBMITTED), approvedUnpaid: major(e.APPROVED), paid: major(e.PAID), hoursApproved: Math.round(e.hoursApproved * 100) / 100 },
      hoursByDay: store.hoursByDay(14, user.id, today()),
      recentTimesheets: store.listTimesheetsByWorker(user.id).slice(0, 5),
    };
  });

  // ----- ID document (worker) -----
  route('POST', '/me/document', 'worker', ({ user, body }) => {
    const worker = store.getWorker(user.id);
    if (worker.status === 'VERIFIED') throw new HttpError(409, 'You are already verified');
    const docType = v.oneOf(body.docType, 'docType', DOC_TYPES);
    const declared = {
      nameOnId: v.str(body, 'nameOnId', { min: 2, max: 100 }),
      idNumber: v.str(body, 'idNumber', { min: 5, max: 30 }),
      expiryDate: v.isoDate(body, 'expiryDate'),
    };
    if (!/^[A-Za-z0-9 \-/]+$/.test(declared.idNumber)) throw new HttpError(400, 'idNumber may contain only letters, numbers, spaces, - and /');
    if (typeof body.data !== 'string') throw new HttpError(400, 'data (base64 file) is required');
    const bytes = Buffer.from(body.data, 'base64');
    if (!bytes.length) throw new HttpError(400, 'The file is empty');
    if (bytes.length > config.maxUploadBytes) throw new HttpError(413, 'File is larger than 8 MB');
    const kind = sniffFile(bytes);
    if (!kind) throw new HttpError(400, 'The file must be a real JPG, PNG or PDF');

    const idHash = storage.hashIdNumber(declared.idNumber);
    const check = evaluateId({
      declared, profileName: worker.name, size: imageSize(bytes, kind.type), now: now(),
      duplicateOwner: store.findIdHashOwner(idHash, user.id),
    });

    const previous = store.getDocumentRecord(user.id);
    const key = storage.saveDocument(user.id, docType, kind.ext, bytes);
    store.setDocument(user.id, {
      key, docType, fileName: v.str(body, 'fileName', { max: 150, optional: true }) || `document.${kind.ext}`,
      contentType: kind.type, size: bytes.length, uploadedAt: stamp(),
      declared: { nameOnId: declared.nameOnId, idMasked: maskNumber(declared.idNumber), expiryDate: declared.expiryDate },
      check,
    }, idHash);
    if (previous?.key) storage.deleteDocument(previous.key);

    audit(user, 'DOCUMENT_UPLOADED', { docType, flags: check.flags });
    store.notify({ kind: 'verification', title: 'Worker awaiting verification',
      body: `${worker.name} uploaded ${docType.replace(/_/g, ' ').toLowerCase()}. Automatic check: ${check.passed ? 'no problems found' : `flagged (${check.flags.length})`}.` });
    return meView(user.id);
  });

  // ----- worker verification (managers) -----
  route('GET', '/workers', 'manager', ({ query }) => {
    const status = v.oneOf(query.get('status') || 'PENDING_REVIEW', 'status', WORKER_STATUSES);
    return { items: store.listWorkers(status) };
  });

  route('GET', '/workers/{id}/document', 'manager', ({ user, params }) => {
    const doc = store.getDocumentRecord(params.id);
    if (!doc?.key) throw new HttpError(404, 'Worker has not uploaded a document');
    audit(user, 'DOCUMENT_VIEWED', { workerId: params.id });
    return new Raw(200, {
      'Content-Type': doc.contentType,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': 'sandbox', // an uploaded file can never run script on our origin
    }, storage.readDocument(doc.key));
  });

  route('POST', '/workers/{id}/decision', 'manager', ({ user, params, body }) => {
    const decision = v.oneOf(body.decision, 'decision', ['VERIFIED', 'REJECTED']);
    const note = v.str(body, 'note', { max: 500, optional: true });
    if (decision === 'REJECTED' && !note) throw new HttpError(400, 'A note is required when rejecting');
    const worker = store.getWorker(params.id);
    if (!worker) throw new HttpError(404, 'Worker not found');
    store.decideWorker(params.id, decision, note, user.id, stamp());
    audit(user, `WORKER_${decision}`, { workerId: params.id, worker: worker.name });
    store.notify({ userId: params.id, kind: 'verification',
      title: decision === 'VERIFIED' ? 'You are verified' : 'Your ID was not accepted',
      body: decision === 'VERIFIED' ? 'You can now apply for jobs.' : `Manager note: ${note}` });
    return store.getWorker(params.id);
  });

  // ----- jobs -----
  route('GET', '/jobs', 'any', ({ user, query }) => {
    if (user.isManager) return { items: store.listJobs(v.oneOf(query.get('status') || 'OPEN', 'status', ['OPEN', 'FILLED', 'CLOSED'])) };
    const applied = store.appliedJobIds(user.id);
    return { items: store.listJobs('OPEN').map((j) => ({ ...j, applied: applied.has(j.jobId) })) };
  });

  route('POST', '/jobs', 'manager', ({ user, body }) => {
    const job = {
      jobId: crypto.randomUUID(),
      title: v.str(body, 'title', { max: 100 }),
      description: v.str(body, 'description', { max: 2000 }),
      location: v.str(body, 'location', { max: 100 }),
      hourlyRate: v.num(body, 'hourlyRate', { min: 1, max: 100000 }),
      slots: v.num(body, 'slots', { min: 1, max: 500, integer: true }),
      startDate: v.isoDate(body, 'startDate'),
      endDate: v.isoDate(body, 'endDate', { optional: true }),
      createdBy: user.id, createdAt: stamp(),
    };
    if (job.endDate && job.endDate < job.startDate) throw new HttpError(400, 'endDate must be on or after startDate');
    store.createJob(job);
    audit(user, 'JOB_CREATED', { jobId: job.jobId, title: job.title });
    return store.getJob(job.jobId);
  });

  route('PATCH', '/jobs/{id}', 'manager', ({ user, params, body }) => {
    const status = v.oneOf(body.status, 'status', ['OPEN', 'CLOSED']);
    const job = store.getJob(params.id);
    if (!job) throw new HttpError(404, 'Job not found');
    if (status === 'OPEN' && job.filled >= job.slots) throw new HttpError(409, 'All slots are filled');
    store.setJobStatus(params.id, status);
    audit(user, `JOB_${status}`, { jobId: params.id, title: job.title });
    return store.getJob(params.id);
  });

  route('POST', '/jobs/{id}/apply', 'worker', ({ user, params, body }) => {
    const worker = store.getWorker(user.id);
    if (worker.status !== 'VERIFIED') throw new HttpError(403, 'Your identity must be verified before you can apply');
    const job = store.getJob(params.id);
    if (!job) throw new HttpError(404, 'Job not found');
    if (job.status !== 'OPEN') throw new HttpError(409, 'This job is not open for applications');
    const application = {
      applicationId: `${job.jobId}_${user.id}`, jobId: job.jobId, jobTitle: job.title,
      workerId: user.id, workerName: worker.name, note: v.str(body, 'note', { max: 500, optional: true }), createdAt: stamp(),
    };
    store.createApplication(application);
    store.notify({ kind: 'application', title: 'New job application', body: `${worker.name} applied for "${job.title}".` });
    return store.getApplication(application.applicationId);
  });

  // ----- applications -----
  route('GET', '/applications', 'any', ({ user, query }) => {
    if (!user.isManager) return { items: store.listApplicationsByWorker(user.id) };
    return { items: store.listApplicationsByStatus(v.oneOf(query.get('status') || 'PENDING', 'status', ['PENDING', 'APPROVED', 'REJECTED'])) };
  });

  route('POST', '/applications/{id}/decision', 'manager', ({ user, params, body }) => {
    const decision = v.oneOf(body.decision, 'decision', ['APPROVED', 'REJECTED']);
    const app = store.getApplication(params.id);
    if (!app) throw new HttpError(404, 'Application not found');
    if (decision === 'APPROVED') store.approveApplication(app.applicationId, user.id, stamp());
    else store.rejectApplication(app.applicationId, user.id, stamp());
    audit(user, `APPLICATION_${decision}`, { applicationId: app.applicationId, worker: app.workerName, job: app.jobTitle });
    store.notify({ userId: app.workerId, kind: 'application', title: `Application ${decision.toLowerCase()}`,
      body: decision === 'APPROVED' ? `You were approved for "${app.jobTitle}". You can now log hours.` : `Your application for "${app.jobTitle}" was not successful.` });
    return store.getApplication(app.applicationId);
  });

  // ----- timesheets -----
  route('POST', '/timesheets', 'worker', ({ user, body }) => {
    const app = store.getApplication(v.str(body, 'applicationId', { max: 120 }));
    if (!app || app.workerId !== user.id) throw new HttpError(404, 'Application not found');
    if (app.status !== 'APPROVED') throw new HttpError(403, 'You can only log hours for approved jobs');
    const workDate = v.isoDate(body, 'workDate');
    const hours = v.num(body, 'hours', { min: 0.25, max: 24 });
    // one day of slack so a browser ahead of UTC (e.g. IST just after midnight) is not rejected
    const tomorrow = new Date(now().getTime() + 86400000).toISOString().slice(0, 10);
    if (workDate > tomorrow) throw new HttpError(400, 'workDate cannot be in the future');
    const job = store.getJob(app.jobId);
    if (workDate < job.startDate) throw new HttpError(400, `Job starts on ${job.startDate}`);
    if (job.endDate && workDate > job.endDate) throw new HttpError(400, `Job ended on ${job.endDate}`);
    const timesheetId = `${app.applicationId}_${workDate}`;
    store.createTimesheet({
      timesheetId, applicationId: app.applicationId, jobId: job.jobId, jobTitle: job.title,
      workerId: user.id, workerName: app.workerName, workDate, hours, hourlyRate: job.hourlyRate,
      notes: v.str(body, 'notes', { max: 300, optional: true }), createdAt: stamp(),
    });
    store.notify({ kind: 'timesheet', title: 'Hours submitted', body: `${app.workerName} logged ${hours}h on ${workDate} for "${job.title}".` });
    return store.getTimesheet(timesheetId);
  });

  route('GET', '/timesheets', 'any', ({ user, query }) => {
    if (!user.isManager) return { items: store.listTimesheetsByWorker(user.id) };
    return { items: store.listTimesheetsByStatus(v.oneOf(query.get('status') || 'SUBMITTED', 'status', ['SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'])) };
  });

  route('POST', '/timesheets/{id}/decision', 'manager', ({ user, params, body }) => {
    const decision = v.oneOf(body.decision, 'decision', ['APPROVED', 'REJECTED']);
    const note = v.str(body, 'note', { max: 300, optional: true });
    const ts = store.getTimesheet(params.id);
    if (!ts) throw new HttpError(404, 'Timesheet not found');
    store.decideTimesheet(params.id, decision, user.id, note, stamp());
    audit(user, `TIMESHEET_${decision}`, { timesheetId: params.id, worker: ts.workerName, hours: ts.hours });
    store.notify({ userId: ts.workerId, kind: 'timesheet', title: `Hours ${decision.toLowerCase()}`,
      body: `${ts.hours}h on ${ts.workDate} for "${ts.jobTitle}"${note ? `. Note: ${note}` : ''}` });
    return store.getTimesheet(params.id);
  });

  // ----- payroll -----
  route('POST', '/payroll/runs', 'manager', ({ user, body }) => {
    const periodStart = v.isoDate(body, 'periodStart');
    const periodEnd = v.isoDate(body, 'periodEnd');
    const result = runPayroll({
      db: store.db, store, storage, periodStart, periodEnd, currency: config.currency,
      dryRun: body.dryRun === true, by: user.email, now: now(),
    });
    audit(user, result.dryRun ? 'PAYROLL_PREVIEW' : 'PAYROLL_RUN', { runId: result.runId, periodStart, periodEnd });
    if (!result.dryRun) {
      const r = result.report;
      store.notify({ kind: 'payroll', title: `Payroll run ${result.runId} ready`,
        body: `${periodStart} to ${periodEnd}: ${r.workerCount} workers, ${r.totalHours} hours, ${config.currency} ${r.totalGross} gross.` });
    }
    return result;
  });

  route('GET', '/payroll/runs', 'manager', () => ({ items: store.listPayrollRuns(), nextRun: nextRunTime(now()).toISOString() }));

  route('GET', '/payroll/runs/{id}/download', 'manager', ({ user, params, query }) => {
    const format = v.oneOf(query.get('format') || 'csv', 'format', ['csv', 'json']);
    const run = store.getPayrollRunRecord(params.id);
    if (!run) throw new HttpError(404, 'Payroll run not found');
    audit(user, 'PAYROLL_DOWNLOAD', { runId: run.id, format });
    return new Raw(200, {
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${run.id}.${format}"`,
      'Cache-Control': 'private, no-store',
    }, storage.readReport(format === 'csv' ? run.csv_key : run.json_key));
  });

  // ----- audit log and system health (managers) -----
  route('GET', '/audit', 'manager', ({ query }) => {
    const limit = Math.min(Math.max(Number(query.get('limit')) || 100, 1), 500);
    return { items: store.listAudit(limit, (query.get('q') || '').slice(0, 60)) };
  });

  route('GET', '/system', 'manager', () => ({
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    node: process.version,
    databaseBytes: fs.statSync(dbFile).size,
    documents: storage.countDocuments(),
    counts: store.counts(),
    backups: backups.list(),
    lastBackupAt: store.getKv('last_backup_at') || null,
    lastWeeklyPayroll: store.getKv('weekly_payroll_period') || null,
    nextPayroll: nextRunTime(now()).toISOString(),
  }));

  route('POST', '/system/backup', 'manager', ({ user }) => {
    const b = backups.backupNow(now());
    store.setKv('last_backup_at', stamp());
    audit(user, 'BACKUP_CREATED', { name: b.name });
    return b;
  });

  // ---------- dispatcher ----------
  async function handle(req, res, url) {
    try {
      const method = req.method;
      const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';

      // A page on another origin must not be able to drive the API with the user's cookie.
      if (method !== 'GET' && method !== 'HEAD' && req.headers.origin) {
        let originHost = '';
        try { originHost = new URL(req.headers.origin).host; } catch { /* invalid origin */ }
        if (originHost !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked');
      }

      let pathMatched = false;
      for (const r of routes) {
        const m = r.regex.exec(path);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;

        const user = auth.currentUser(req);
        if (r.access !== 'public' && !user) throw new HttpError(401, 'Please sign in');
        if (r.access === 'manager' && !user.isManager) throw new HttpError(403, 'Managers only');
        if (r.access === 'worker' && user.isManager) throw new HttpError(403, 'Workers only');

        const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
        const body = ['POST', 'PUT', 'PATCH'].includes(method) ? parseJson(await readBody(req)) : {};
        const result = await r.fn({ user, params, body, query: url.searchParams, req, res });
        return result instanceof Raw ? sendRaw(res, result) : sendJson(res, 200, result);
      }
      throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Method not allowed' : 'Not found');
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.statusCode, { error: e.message });
      console.error(JSON.stringify({ level: 'error', msg: e.message, stack: e.stack }));
      return sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  return { handle };
}

module.exports = { createRouter };