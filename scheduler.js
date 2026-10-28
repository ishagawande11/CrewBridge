'use strict';
const { runPayroll, previousWeek, thisWeeksRunTime } = require('./payroll');

/**
 * Local replacement for EventBridge: a timer that checks once a minute whether a job is due.
 *  - Weekly payroll for the previous Monday-Sunday, due every Monday 02:00 UTC.
 *  - A daily database backup.
 * Jobs are "due" rather than "exactly on time", so a run missed while the computer was
 * off or asleep happens as soon as the app is next started. Each job records what it
 * already did in the kv table, so nothing runs twice.
 */
function createScheduler({ db, store, storage, backups, currency, now = () => new Date() }) {
  let timer = null;

  function weeklyPayroll(at) {
    if (at < thisWeeksRunTime(at)) return null;
    const { periodStart, periodEnd } = previousWeek(at);
    if (store.getKv('weekly_payroll_period') === periodStart) return null;
    const result = runPayroll({ db, store, storage, periodStart, periodEnd, by: 'scheduler', now: at, currency });
    store.setKv('weekly_payroll_period', periodStart);
    store.audit(null, 'PAYROLL_SCHEDULED_RUN', { periodStart, periodEnd, runId: result.runId || null, empty: result.dryRun });
    if (!result.dryRun) {
      store.notify({ kind: 'payroll', title: `Weekly payroll ${result.runId} ready`,
        body: `${periodStart} to ${periodEnd}: ${result.report.workerCount} workers, ${result.report.totalHours} hours, ${currency} ${result.report.totalGross} gross.` });
    }
    return result;
  }

  function dailyBackup(at) {
    const day = at.toISOString().slice(0, 10);
    if (store.getKv('last_backup_day') === day) return null;
    const b = backups.backupNow(at);
    store.setKv('last_backup_day', day);
    store.setKv('last_backup_at', at.toISOString());
    return b;
  }

  function tick() {
    const at = now();
    for (const job of [weeklyPayroll, dailyBackup, () => store.purgeExpiredSessions(at.toISOString())]) {
      try { job(at); } catch (e) { console.error(JSON.stringify({ level: 'error', msg: `scheduler job failed: ${e.message}` })); }
    }
  }

  return {
    tick,
    start() { tick(); timer = setInterval(tick, 60_000); timer.unref(); },
    stop() { clearInterval(timer); },
  };
}

module.exports = { createScheduler };

