'use strict';
const { HttpError } = require('./http');
const { transaction } = require('./db');

const isUnique = (e) => /UNIQUE|PRIMARY KEY/i.test(String(e.message));
const iso = () => new Date().toISOString();

// ----- row -> API shape -----
const jobView = (r) => r && ({
  jobId: r.id, title: r.title, description: r.description, location: r.location,
  hourlyRate: r.hourly_rate, slots: r.slots, filled: r.filled,
  startDate: r.start_date, endDate: r.end_date, status: r.status, createdAt: r.created_at,
});

const applicationView = (r) => r && ({
  applicationId: r.id, jobId: r.job_id, jobTitle: r.job_title, workerId: r.worker_id, workerName: r.worker_name,
  note: r.note, status: r.status, createdAt: r.created_at, decidedAt: r.decided_at,
});

const timesheetView = (r) => r && ({
  timesheetId: r.id, applicationId: r.application_id, jobId: r.job_id, jobTitle: r.job_title,
  workerId: r.worker_id, workerName: r.worker_name, workDate: r.work_date, hours: r.hours,
  hourlyRate: r.hourly_rate, amount: ((Math.round(r.hourly_rate * 100) * r.hours) / 100).toFixed(2),
  notes: r.notes, status: r.status, managerNote: r.manager_note, decidedAt: r.decided_at,
  payrollRunId: r.payroll_run_id, createdAt: r.created_at,
});

const runView = (r) => r && ({
  runId: r.id, periodStart: r.period_start, periodEnd: r.period_end, generatedAt: r.generated_at,
  generatedBy: r.generated_by, currency: r.currency, workerCount: r.worker_count,
  timesheetCount: r.timesheet_count, totalHours: r.total_hours, totalGross: r.total_gross,
});

/** The public face of a stored document: never exposes the file key or the full ID number. */
function documentView(json) {
  if (!json) return null;
  const d = JSON.parse(json);
  const { key, ...publicPart } = d; // eslint-disable-line no-unused-vars
  return publicPart;
}

const workerView = (r) => r && ({
  workerId: r.id, name: r.name, email: r.email, phone: r.phone, status: r.status,
  reviewNote: r.review_note, reviewedAt: r.reviewed_at, document: documentView(r.doc_json), createdAt: r.created_at,
});

function createStore(db) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  return {
    db,
    tx: (fn) => transaction(db, fn),

    // ----- users & sessions -----
    createUser(u) {
      try {
        run(`INSERT INTO users (id, email, name, role, password_hash, status, created_at) VALUES (?,?,?,?,?,?,?)`,
          u.id, u.email, u.name, u.role, u.passwordHash, u.role === 'worker' ? 'REGISTERED' : null, u.createdAt || iso());
      } catch (e) {
        if (isUnique(e)) throw new HttpError(409, 'An account with this email already exists');
        throw e;
      }
    },
    getUserById: (id) => one('SELECT * FROM users WHERE id = ?', id),
    getUserByEmail: (email) => one('SELECT * FROM users WHERE email = ?', email),
    updateProfile: (id, { name, phone }) => run('UPDATE users SET name = ?, phone = ? WHERE id = ?', name, phone ?? null, id),
    getWorker: (id) => workerView(one(`SELECT * FROM users WHERE id = ? AND role = 'worker'`, id)),
    /** The raw stored document including its private file key (server-side use only). */
    getDocumentRecord(id) {
      const r = one('SELECT doc_json FROM users WHERE id = ?', id);
      return r?.doc_json ? JSON.parse(r.doc_json) : null;
    },
    workersById(ids) {
      const out = {};
      for (const id of new Set(ids)) { const u = one('SELECT name, email FROM users WHERE id = ?', id); if (u) out[id] = { name: u.name, email: u.email }; }
      return out;
    },
    listWorkers(status) {
      return all(`SELECT * FROM users WHERE role = 'worker' AND status = ? ORDER BY created_at DESC`, status).map(workerView);
    },
    managerIds: () => all(`SELECT id FROM users WHERE role = 'manager'`).map((r) => r.id),
    findIdHashOwner: (hash, exceptId) => one('SELECT id FROM users WHERE id_hash = ? AND id != ?', hash, exceptId),
    setDocument(id, doc, idHash) {
      run(`UPDATE users SET status = 'PENDING_REVIEW', doc_json = ?, id_hash = ?, review_note = NULL, reviewed_by = NULL, reviewed_at = NULL WHERE id = ?`,
        JSON.stringify(doc), idHash, id);
    },
    decideWorker(id, decision, note, by, at) {
      const r = run(`UPDATE users SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND role = 'worker' AND status = 'PENDING_REVIEW'`,
        decision, note ?? null, by, at, id);
      if (r.changes === 0) throw new HttpError(409, 'This worker is no longer waiting for review');
    },

    createSession: (hash, userId, created, expires) => run('INSERT INTO sessions VALUES (?,?,?,?)', hash, userId, created, expires),
    getSession: (hash) => one('SELECT * FROM sessions WHERE token_hash = ?', hash),
    deleteSession: (hash) => run('DELETE FROM sessions WHERE token_hash = ?', hash),
    purgeExpiredSessions: (at) => run('DELETE FROM sessions WHERE expires_at < ?', at),

    // ----- jobs -----
    createJob(j) {
      run(`INSERT INTO jobs (id, title, description, location, hourly_rate, slots, filled, start_date, end_date, status, created_by, created_at)
           VALUES (?,?,?,?,?,?,0,?,?,'OPEN',?,?)`,
        j.jobId, j.title, j.description, j.location, j.hourlyRate, j.slots, j.startDate, j.endDate ?? null, j.createdBy, j.createdAt);
    },
    getJob: (id) => jobView(one('SELECT * FROM jobs WHERE id = ?', id)),
    listJobs: (status) => all('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC', status).map(jobView),
    setJobStatus: (id, status) => run('UPDATE jobs SET status = ? WHERE id = ?', status, id),

    // ----- applications -----
    createApplication(a) {
      try {
        run(`INSERT INTO applications (id, job_id, job_title, worker_id, worker_name, note, status, created_at) VALUES (?,?,?,?,?,?,'PENDING',?)`,
          a.applicationId, a.jobId, a.jobTitle, a.workerId, a.workerName, a.note ?? null, a.createdAt);
      } catch (e) {
        if (isUnique(e)) throw new HttpError(409, 'You have already applied to this job');
        throw e;
      }
    },
    getApplication: (id) => applicationView(one('SELECT * FROM applications WHERE id = ?', id)),
    listApplicationsByWorker: (id) => all('SELECT * FROM applications WHERE worker_id = ? ORDER BY created_at DESC', id).map(applicationView),
    listApplicationsByStatus: (s) => all('SELECT * FROM applications WHERE status = ? ORDER BY created_at DESC', s).map(applicationView),
    appliedJobIds: (workerId) => new Set(all('SELECT job_id FROM applications WHERE worker_id = ?', workerId).map((r) => r.job_id)),

    /** Approve the application and claim one job slot in a single transaction. */
    approveApplication(id, by, at) {
      transaction(db, () => {
        const a = one('SELECT job_id FROM applications WHERE id = ?', id);
        const pending = run(`UPDATE applications SET status = 'APPROVED', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'PENDING'`, by, at, id);
        const slot = a && run(`UPDATE jobs SET filled = filled + 1 WHERE id = ? AND filled < slots AND status = 'OPEN'`, a.job_id);
        if (!pending.changes || !slot?.changes) throw new HttpError(409, 'Application is no longer pending, or the job has no open slots');
        run(`UPDATE jobs SET status = 'FILLED' WHERE id = ? AND filled >= slots AND status = 'OPEN'`, a.job_id);
      });
    },
    rejectApplication(id, by, at) {
      const r = run(`UPDATE applications SET status = 'REJECTED', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'PENDING'`, by, at, id);
      if (!r.changes) throw new HttpError(409, 'Application is no longer pending');
    },

    // ----- timesheets -----
    createTimesheet(t) {
      try {
        run(`INSERT INTO timesheets (id, application_id, job_id, job_title, worker_id, worker_name, work_date, hours, hourly_rate, notes, status, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,'SUBMITTED',?)`,
          t.timesheetId, t.applicationId, t.jobId, t.jobTitle, t.workerId, t.workerName, t.workDate, t.hours, t.hourlyRate, t.notes ?? null, t.createdAt);
      } catch (e) {
        if (isUnique(e)) throw new HttpError(409, 'Hours for that day were already submitted');
        throw e;
      }
    },
    getTimesheet: (id) => timesheetView(one('SELECT * FROM timesheets WHERE id = ?', id)),
    listTimesheetsByWorker: (id) => all('SELECT * FROM timesheets WHERE worker_id = ? ORDER BY work_date DESC', id).map(timesheetView),
    listTimesheetsByStatus: (s) => all('SELECT * FROM timesheets WHERE status = ? ORDER BY work_date DESC', s).map(timesheetView),
    decideTimesheet(id, status, by, note, at) {
      const r = run(`UPDATE timesheets SET status = ?, decided_by = ?, decided_at = ?, manager_note = ? WHERE id = ? AND status = 'SUBMITTED'`,
        status, by, at, note ?? null, id);
      if (!r.changes) throw new HttpError(409, 'This timesheet was already decided');
    },
    listApprovedUnpaid: (start, end) => all(
      `SELECT * FROM timesheets WHERE status = 'APPROVED' AND payroll_run_id IS NULL AND work_date BETWEEN ? AND ? ORDER BY work_date`,
      start, end).map(timesheetView),
    /** Flip APPROVED -> PAID exactly once; false means another run got there first. */
    markPaid: (id, runId) => run(`UPDATE timesheets SET status = 'PAID', payroll_run_id = ? WHERE id = ? AND status = 'APPROVED' AND payroll_run_id IS NULL`, runId, id).changes > 0,

    // ----- payroll runs -----
    createPayrollRun(r) {
      run(`INSERT INTO payroll_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        r.runId, r.periodStart, r.periodEnd, r.generatedAt, r.generatedBy, r.currency, r.workerCount, r.timesheetCount, r.totalHours, r.totalGross, r.jsonKey, r.csvKey);
    },
    getPayrollRunRecord: (id) => one('SELECT * FROM payroll_runs WHERE id = ?', id),
    listPayrollRuns: () => all('SELECT * FROM payroll_runs ORDER BY generated_at DESC LIMIT 50').map(runView),

    // ----- notifications (the local SNS) -----
    notify({ userId = null, kind = 'info', title, body }) {
      run('INSERT INTO notifications (user_id, kind, title, body, created_at) VALUES (?,?,?,?,?)', userId, kind, title, body, iso());
    },
    listNotifications(user, limit = 30) {
      const where = user.isManager ? '(user_id IS NULL OR user_id = ?)' : 'user_id = ?';
      return all(`SELECT * FROM notifications WHERE ${where} ORDER BY id DESC LIMIT ?`, user.id, limit)
        .map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, read: !!r.is_read, createdAt: r.created_at }));
    },
    unreadCount(user) {
      const where = user.isManager ? '(user_id IS NULL OR user_id = ?)' : 'user_id = ?';
      return one(`SELECT COUNT(*) n FROM notifications WHERE ${where} AND is_read = 0`, user.id).n;
    },
    markAllRead(user) {
      const where = user.isManager ? '(user_id IS NULL OR user_id = ?)' : 'user_id = ?';
      run(`UPDATE notifications SET is_read = 1 WHERE ${where}`, user.id);
    },

    // ----- audit log (the local CloudTrail) -----
    audit(user, action, details = {}, at = iso()) {
      run('INSERT INTO audit_log (at, actor_id, actor_email, action, details) VALUES (?,?,?,?,?)',
        at, user?.id ?? null, user?.email ?? 'system', action, JSON.stringify(details));
    },
    listAudit(limit = 100, q = '') {
      const like = `%${q}%`;
      return all(`SELECT * FROM audit_log WHERE (? = '' OR action LIKE ? OR actor_email LIKE ? OR details LIKE ?) ORDER BY id DESC LIMIT ?`,
        q, like, like, like, limit)
        .map((r) => ({ id: r.id, at: r.at, actor: r.actor_email, action: r.action, details: JSON.parse(r.details || '{}') }));
    },

    // ----- key/value (scheduler bookkeeping) -----
    getKv: (key) => one('SELECT value FROM kv WHERE key = ?', key)?.value,
    setKv: (key, value) => run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value)),

    // ----- dashboards -----
    counts() {
      const n = (sql, ...p) => one(sql, ...p).n;
      return {
        workers: n(`SELECT COUNT(*) n FROM users WHERE role = 'worker'`),
        verified: n(`SELECT COUNT(*) n FROM users WHERE role = 'worker' AND status = 'VERIFIED'`),
        pendingVerifications: n(`SELECT COUNT(*) n FROM users WHERE role = 'worker' AND status = 'PENDING_REVIEW'`),
        openJobs: n(`SELECT COUNT(*) n FROM jobs WHERE status = 'OPEN'`),
        pendingApplications: n(`SELECT COUNT(*) n FROM applications WHERE status = 'PENDING'`),
        pendingTimesheets: n(`SELECT COUNT(*) n FROM timesheets WHERE status = 'SUBMITTED'`),
        payrollRuns: n('SELECT COUNT(*) n FROM payroll_runs'),
        auditEvents: n('SELECT COUNT(*) n FROM audit_log'),
      };
    },
    timesheetStatusCounts: () => Object.fromEntries(all('SELECT status, COUNT(*) n FROM timesheets GROUP BY status').map((r) => [r.status, r.n])),
    /** Hours per day for the last `days` days (zero-filled), optionally for one worker. */
    hoursByDay(days, workerId, today) {
      const start = new Date(new Date(`${today}T00:00:00Z`).getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
      const rows = workerId
        ? all(`SELECT work_date d, SUM(hours) h FROM timesheets WHERE work_date >= ? AND worker_id = ? AND status != 'REJECTED' GROUP BY work_date`, start, workerId)
        : all(`SELECT work_date d, SUM(hours) h FROM timesheets WHERE work_date >= ? AND status != 'REJECTED' GROUP BY work_date`, start);
      const byDate = Object.fromEntries(rows.map((r) => [r.d, r.h]));
      return Array.from({ length: days }, (_, i) => {
        const d = new Date(new Date(`${start}T00:00:00Z`).getTime() + i * 86400000).toISOString().slice(0, 10);
        return { date: d, hours: byDate[d] || 0 };
      });
    },
    /** Money by timesheet state for one worker (or everyone), in integer cents. */
    earnings(workerId) {
      const rows = workerId
        ? all('SELECT status, hours, hourly_rate FROM timesheets WHERE worker_id = ?', workerId)
        : all('SELECT status, hours, hourly_rate FROM timesheets');
      const out = { SUBMITTED: 0, APPROVED: 0, PAID: 0, hoursApproved: 0 };
      for (const r of rows) {
        const cents = Math.round(Math.round(r.hourly_rate * 100) * r.hours);
        if (r.status in out) out[r.status] += cents;
        if (r.status === 'APPROVED' || r.status === 'PAID') out.hoursApproved += r.hours;
      }
      return out;
    },
  };
}

module.exports = { createStore };
