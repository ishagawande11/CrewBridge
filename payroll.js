'use strict';
const crypto = require('node:crypto');
const { HttpError } = require('./http');
const { transaction } = require('./db');

const cents = (rate) => Math.round(Number(rate) * 100);
const money = (c) => (c / 100).toFixed(2);

/**
 * Build a payroll report from approved timesheets. Money is calculated in
 * integer cents so totals never drift because of floating point.
 */
function buildReport({ timesheets, workers = {}, periodStart, periodEnd, runId, generatedAt, generatedBy, currency }) {
  const byWorker = new Map();
  for (const t of timesheets) {
    const row = byWorker.get(t.workerId) || {
      workerId: t.workerId,
      workerName: workers[t.workerId]?.name || t.workerName,
      email: workers[t.workerId]?.email || '',
      hours: 0, grossCents: 0, lines: [],
    };
    const lineCents = Math.round(cents(t.hourlyRate) * t.hours);
    row.hours = Math.round((row.hours + t.hours) * 100) / 100;
    row.grossCents += lineCents;
    row.lines.push({
      timesheetId: t.timesheetId, workDate: t.workDate, jobId: t.jobId, jobTitle: t.jobTitle,
      hours: t.hours, hourlyRate: t.hourlyRate, amount: money(lineCents),
    });
    byWorker.set(t.workerId, row);
  }

  const rows = [...byWorker.values()]
    .sort((a, b) => a.workerName.localeCompare(b.workerName))
    .map((r) => ({
      workerId: r.workerId, workerName: r.workerName, email: r.email, hours: r.hours,
      gross: money(r.grossCents), grossCents: r.grossCents,
      lines: r.lines.sort((a, b) => a.workDate.localeCompare(b.workDate)),
    }));

  const totalCents = rows.reduce((s, r) => s + r.grossCents, 0);
  const totalHours = Math.round(rows.reduce((s, r) => s + r.hours, 0) * 100) / 100;
  return {
    runId, periodStart, periodEnd, generatedAt, generatedBy, currency,
    workerCount: rows.length, timesheetCount: timesheets.length,
    totalHours, totalGross: money(totalCents), totalGrossCents: totalCents,
    workers: rows,
  };
}

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(report) {
  const lines = [['Worker', 'Email', 'Date', 'Job', 'Hours', 'Rate', 'Amount'].join(',')];
  for (const w of report.workers) {
    for (const l of w.lines) {
      lines.push([w.workerName, w.email, l.workDate, l.jobTitle, l.hours, l.hourlyRate, l.amount].map(csvCell).join(','));
    }
    lines.push([`${w.workerName} subtotal`, '', '', '', w.hours, '', w.gross].map(csvCell).join(','));
  }
  lines.push(['TOTAL', '', '', '', report.totalHours, '', report.totalGross].map(csvCell).join(','));
  return `${lines.join('\n')}\n`;
}

const isoDay = (d) => d.toISOString().slice(0, 10);
const utcMidnight = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Previous Monday-Sunday relative to `now` (UTC), used by the weekly scheduled run. */
function previousWeek(now = new Date()) {
  const d = utcMidnight(now);
  const start = new Date(d.getTime() - (((d.getUTCDay() + 6) % 7) + 7) * 86400000);
  return { periodStart: isoDay(start), periodEnd: isoDay(new Date(start.getTime() + 6 * 86400000)) };
}

/** The Monday 02:00 UTC that starts (or started) the current week's run. */
function thisWeeksRunTime(now = new Date()) {
  const d = utcMidnight(now);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000 + 2 * 3600000);
}

const nextRunTime = (now = new Date()) => {
  const t = thisWeeksRunTime(now);
  return t > now ? t : new Date(t.getTime() + 7 * 86400000);
};

/**
 * Generate a payroll report for approved, unpaid timesheets in [periodStart, periodEnd].
 * Shared by the manager API and the weekly scheduler. Everything happens in one transaction:
 * if writing the report files fails, the timesheets go back to APPROVED and the run can be retried.
 */
function runPayroll({ db, store, storage, periodStart, periodEnd, dryRun = false, by, now = new Date(), currency }) {
  if (periodStart > periodEnd) throw new HttpError(400, 'periodStart must be on or before periodEnd');

  const base = { periodStart, periodEnd, generatedBy: by, currency };
  const generatedAt = now.toISOString();
  const preview = () => {
    const timesheets = store.listApprovedUnpaid(periodStart, periodEnd);
    return buildReport({ ...base, timesheets, workers: store.workersById(timesheets.map((t) => t.workerId)), runId: 'PREVIEW', generatedAt });
  };

  const timesheets = store.listApprovedUnpaid(periodStart, periodEnd);
  if (dryRun || timesheets.length === 0) return { dryRun: true, report: preview() };

  const runId = `PR-${generatedAt.replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const keyBase = `${periodStart}_${periodEnd}/${runId}`;
  try {
    return transaction(db, () => {
      const claimed = timesheets.filter((t) => store.markPaid(t.timesheetId, runId));
      if (claimed.length === 0) throw new HttpError(409, 'These timesheets were already paid');
      const report = buildReport({ ...base, timesheets: claimed, workers: store.workersById(claimed.map((t) => t.workerId)), runId, generatedAt });
      storage.putReport(`${keyBase}.json`, JSON.stringify(report, null, 2));
      storage.putReport(`${keyBase}.csv`, toCsv(report));
      store.createPayrollRun({
        runId, periodStart, periodEnd, generatedAt, generatedBy: by, currency,
        workerCount: report.workerCount, timesheetCount: report.timesheetCount,
        totalHours: report.totalHours, totalGross: report.totalGross,
        jsonKey: `${keyBase}.json`, csvKey: `${keyBase}.csv`,
      });
      return { dryRun: false, runId, report };
    });
  } catch (e) {
    storage.deleteReport(`${keyBase}.json`);
    storage.deleteReport(`${keyBase}.csv`);
    throw e;
  }
}

module.exports = { buildReport, toCsv, previousWeek, thisWeeksRunTime, nextRunTime, runPayroll, money };

