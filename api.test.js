'use strict';
// End-to-end tests: a real server on a random port with a throw-away data folder.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/index');
const { sampleCard } = require('../server/seed');
const { toCsv, buildReport, previousWeek } = require('../server/payroll');

let app; let base; let dataDir;
const NOW = new Date('2026-10-19T03:00:00Z'); // a Monday, just after the 02:00 UTC payroll time
const png = () => sampleCard(800, 500, [67, 97, 238]).toString('base64');

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crewbridge-test-'));
  app = createApp({ dataDir, seed: false, now: () => NOW });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => { app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

/** A tiny cookie-keeping client. */
function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.()[0];
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  return { get: (u) => call('GET', u), post: (u, b, h) => call('POST', u, b ?? {}, h), put: (u, b) => call('PUT', u, b), patch: (u, b) => call('PATCH', u, b) };
}

const register = async (name, email, extra = {}) => {
  const c = client();
  const r = await c.post('/api/auth/register', { name, email, password: 'Passw0rd!', ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return c;
};
const idUpload = (overrides = {}) => ({ docType: 'PASSPORT', nameOnId: 'Test Worker', idNumber: 'P1234567', expiryDate: '2030-01-01', fileName: 'id.png', data: png(), ...overrides });

const ctx = {}; // shared state across the ordered tests below

test('accounts: registration rules and sign-in', async () => {
  const anon = client();
  assert.equal((await anon.get('/api/overview')).status, 401);

  const noCode = await client().post('/api/auth/register', { name: 'Eve Boss', email: 'eve@x.com', password: 'Passw0rd!', role: 'manager', managerCode: 'wrong' });
  assert.equal(noCode.status, 403);
  assert.equal((await client().post('/api/auth/register', { name: 'Weak Pw', email: 'weak@x.com', password: 'short' })).status, 400);

  ctx.manager = await register('Mia Manager', 'mia@x.com', { role: 'manager', managerCode: app.config.managerCode });
  ctx.w1 = await register('Test Worker', 'w1@x.com');
  ctx.w2 = await register('Other Person', 'w2@x.com');
  assert.equal((await client().post('/api/auth/register', { name: 'Dup', email: 'W1@x.com', password: 'Passw0rd!' })).status, 409);

  const bad = await client().post('/api/auth/login', { email: 'w1@x.com', password: 'nope' });
  assert.equal(bad.status, 401);
  assert.equal((await ctx.w1.get('/api/me')).body.status, 'REGISTERED');
  assert.equal((await ctx.w1.get('/api/jobs')).status, 200);
  assert.equal((await ctx.w1.get('/api/workers')).status, 403, 'workers cannot use manager routes');
  assert.equal((await ctx.manager.post('/api/jobs/x/apply')).status, 403, 'managers cannot use worker routes');
});

test('security: cross-origin writes and path traversal are refused', async () => {
  const r = await ctx.w1.post('/api/me/document', idUpload(), { Origin: 'http://evil.example' });
  assert.equal(r.status, 403);
  const res = await fetch(`${base}/..%2fserver%2fconfig.js`);
  assert.ok([403, 404].includes(res.status) || !(await res.text()).includes('managerCode'));
  assert.ok(!fs.readFileSync(path.join(dataDir, 'crewbridge.db')).includes('Passw0rd!'), 'plain passwords are never stored');
});

test('ID check: file sniffing, flags, duplicate detection, encryption at rest', async () => {
  assert.equal((await ctx.w1.post('/api/me/document', idUpload({ data: Buffer.from('not an image').toString('base64') }))).status, 400);
  assert.equal((await ctx.w1.post('/api/me/document', idUpload({ idNumber: 'bad!!' }))).status, 400);

  const ok = await ctx.w1.post('/api/me/document', idUpload());
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'PENDING_REVIEW');
  assert.deepEqual(ok.body.document.check.flags, []);
  assert.equal(ok.body.document.declared.idMasked, '****4567');
  assert.equal(ok.body.document.key, undefined, 'the storage key is never exposed');

  const dup = await ctx.w2.post('/api/me/document', idUpload({ nameOnId: 'Somebody Else', expiryDate: '2020-01-01' }));
  assert.deepEqual(dup.body.document.check.flags.sort(), ['DOCUMENT_EXPIRED', 'DUPLICATE_ID_NUMBER', 'NAME_MISMATCH']);
  assert.equal(dup.body.document.check.passed, false);

  const stored = fs.readdirSync(path.join(dataDir, 'documents')).flatMap((d) => fs.readdirSync(path.join(dataDir, 'documents', d)).map((f) => path.join(dataDir, 'documents', d, f)));
  assert.ok(stored.length >= 2);
  for (const f of stored) assert.ok(!fs.readFileSync(f).subarray(28, 40).equals(Buffer.from(png(), 'base64').subarray(0, 12)), 'documents are encrypted');
});

test('verification: only a manager decides; a worker cannot see another worker or skip the queue', async () => {
  const pending = (await ctx.manager.get('/api/workers?status=PENDING_REVIEW')).body.items;
  assert.equal(pending.length, 2);
  ctx.w1Id = pending.find((w) => w.email === 'w1@x.com').workerId;
  ctx.w2Id = pending.find((w) => w.email === 'w2@x.com').workerId;

  const doc = await ctx.manager.get(`/api/workers/${ctx.w1Id}/document`);
  assert.equal(doc.status, 200);
  assert.equal(doc.body.subarray(1, 4).toString(), 'PNG', 'managers get the decrypted file');
  assert.match(doc.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await ctx.w1.get(`/api/workers/${ctx.w1Id}/document`)).status, 403);

  assert.equal((await ctx.manager.post(`/api/workers/${ctx.w2Id}/decision`, { decision: 'REJECTED' })).status, 400, 'a rejection needs a note');
  assert.equal((await ctx.manager.post(`/api/workers/${ctx.w2Id}/decision`, { decision: 'REJECTED', note: 'Expired' })).body.status, 'REJECTED');
  assert.equal((await ctx.manager.post(`/api/workers/${ctx.w2Id}/decision`, { decision: 'VERIFIED' })).status, 409, 'already decided');

  const before = await ctx.w1.post('/api/jobs/anything/apply');
  assert.equal(before.status, 403, 'unverified workers cannot apply');
  assert.equal((await ctx.manager.post(`/api/workers/${ctx.w1Id}/decision`, { decision: 'VERIFIED' })).body.status, 'VERIFIED');
  assert.equal((await ctx.w1.get('/api/counts')).body.unreadNotifications, 1);
});

test('jobs and applications: slots are claimed atomically', async () => {
  const job = (await ctx.manager.post('/api/jobs', { title: 'Solo Gig', description: 'one slot', location: 'Pune', hourlyRate: 200, slots: 1, startDate: '2026-10-01' })).body;
  ctx.job = job;
  assert.equal((await ctx.manager.post('/api/jobs', { title: 'Bad', description: 'x', location: 'y', hourlyRate: 10, slots: 1, startDate: '2026-10-05', endDate: '2026-10-01' })).status, 400);

  const a1 = await ctx.w1.post(`/api/jobs/${job.jobId}/apply`, { note: 'hi' });
  assert.equal(a1.status, 200);
  assert.equal((await ctx.w1.post(`/api/jobs/${job.jobId}/apply`)).status, 409, 'cannot apply twice');

  // a second verified worker for the slot race
  const w3 = await register('Third Worker', 'w3@x.com');
  await w3.post('/api/me/document', idUpload({ nameOnId: 'Third Worker', idNumber: 'Z9999999' }));
  const w3Id = (await w3.get('/api/me')).body.workerId;
  await ctx.manager.post(`/api/workers/${w3Id}/decision`, { decision: 'VERIFIED' });
  const a3 = await w3.post(`/api/jobs/${job.jobId}/apply`);

  const approve1 = await ctx.manager.post(`/api/applications/${encodeURIComponent(a1.body.applicationId)}/decision`, { decision: 'APPROVED' });
  assert.equal(approve1.body.status, 'APPROVED');
  const approve3 = await ctx.manager.post(`/api/applications/${encodeURIComponent(a3.body.applicationId)}/decision`, { decision: 'APPROVED' });
  assert.equal(approve3.status, 409, 'the only slot is already taken');
  assert.equal((await ctx.manager.get('/api/jobs?status=FILLED')).body.items[0].jobId, job.jobId, 'a full job becomes FILLED');
  assert.equal((await ctx.manager.patch(`/api/jobs/${job.jobId}`, { status: 'OPEN' })).status, 409);
  ctx.appId = a1.body.applicationId;
});

test('timesheets and payroll: hours to gross pay, paid exactly once', async () => {
  const log = (date, hours) => ctx.w1.post('/api/timesheets', { applicationId: ctx.appId, workDate: date, hours });
  assert.equal((await log('2026-12-25', 4)).status, 400, 'future');
  assert.equal((await log('2026-09-01', 4)).status, 400, 'before the job starts');
  assert.equal((await log('2026-10-14', 30)).status, 400);
  const t1 = await log('2026-10-14', 7.5);
  assert.equal(t1.status, 200);
  assert.equal(t1.body.amount, '1500.00');
  assert.equal((await log('2026-10-14', 2)).status, 409, 'one entry per day');
  const t2 = await log('2026-10-15', 4);

  // a worker cannot approve their own hours
  assert.equal((await ctx.w1.post(`/api/timesheets/${encodeURIComponent(t1.body.timesheetId)}/decision`, { decision: 'APPROVED' })).status, 403);
  await ctx.manager.post(`/api/timesheets/${encodeURIComponent(t1.body.timesheetId)}/decision`, { decision: 'APPROVED' });
  await ctx.manager.post(`/api/timesheets/${encodeURIComponent(t2.body.timesheetId)}/decision`, { decision: 'REJECTED', note: 'Cancelled' });

  const period = { periodStart: '2026-10-12', periodEnd: '2026-10-18' };
  const preview = (await ctx.manager.post('/api/payroll/runs', { ...period, dryRun: true })).body;
  assert.equal(preview.dryRun, true);
  assert.equal(preview.report.totalGross, '1500.00');
  assert.equal((await ctx.manager.get('/api/timesheets?status=APPROVED')).body.items.length, 1, 'a preview changes nothing');

  const run = (await ctx.manager.post('/api/payroll/runs', period)).body;
  assert.match(run.runId, /^PR-/);
  assert.equal(run.report.workerCount, 1);
  assert.equal((await ctx.manager.get('/api/timesheets?status=PAID')).body.items.length, 1);
  assert.equal((await ctx.manager.post('/api/payroll/runs', period)).body.report.workerCount, 0, 'nothing is paid twice');

  const csv = await ctx.manager.get(`/api/payroll/runs/${run.runId}/download?format=csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.body.toString(), /TOTAL,,,,7\.5,,1500\.00/);
  assert.equal((await ctx.w1.get(`/api/payroll/runs/${run.runId}/download`)).status, 403);
  assert.equal((await ctx.manager.get('/api/payroll/runs')).body.items.length, 1);
});

test('audit log, notifications and system endpoints', async () => {
  const actions = (await ctx.manager.get('/api/audit?limit=200')).body.items.map((a) => a.action);
  for (const a of ['ACCOUNT_REGISTERED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VIEWED', 'WORKER_VERIFIED', 'WORKER_REJECTED', 'JOB_CREATED', 'APPLICATION_APPROVED', 'TIMESHEET_APPROVED', 'PAYROLL_RUN']) {
    assert.ok(actions.includes(a), `${a} is audited`);
  }
  const note = (await ctx.w1.get('/api/notifications')).body;
  assert.ok(note.items.length >= 3);
  await ctx.w1.post('/api/notifications/read');
  assert.equal((await ctx.w1.get('/api/counts')).body.unreadNotifications, 0);
  assert.equal((await ctx.w1.get('/api/audit')).status, 403);

  const b = await ctx.manager.post('/api/system/backup');
  assert.equal(b.status, 200);
  const sys = (await ctx.manager.get('/api/system')).body;
  assert.ok(sys.backups.some((x) => x.name === b.body.name));
  assert.ok(new Date(sys.nextPayroll) > NOW);
});

test('scheduler: weekly payroll runs once when due, and a daily backup is made', async () => {
  const before = (await ctx.manager.get('/api/payroll/runs')).body.items.length;
  const log = await ctx.w1.post('/api/timesheets', { applicationId: ctx.appId, workDate: '2026-10-13', hours: 2 });
  await ctx.manager.post(`/api/timesheets/${encodeURIComponent(log.body.timesheetId)}/decision`, { decision: 'APPROVED' });

  app.scheduler.tick();
  assert.equal((await ctx.manager.get('/api/payroll/runs')).body.items.length, before + 1, 'the run for last week happened');
  app.scheduler.tick();
  assert.equal((await ctx.manager.get('/api/payroll/runs')).body.items.length, before + 1, 'and did not repeat');
  assert.equal(app.store.getKv('weekly_payroll_period'), previousWeek(NOW).periodStart);
  assert.equal(app.store.getKv('last_backup_day'), '2026-10-19');
});

test('payroll maths: cents, rounding and CSV formula injection', () => {
  const ts = [
    { workerId: 'a', workerName: '=HYPERLINK("x")', timesheetId: '1', workDate: '2026-01-01', jobId: 'j', jobTitle: 'J', hours: 0.25, hourlyRate: 10.1 },
    { workerId: 'a', workerName: '=HYPERLINK("x")', timesheetId: '2', workDate: '2026-01-02', jobId: 'j', jobTitle: 'J', hours: 0.1, hourlyRate: 10.1 },
  ];
  const report = buildReport({ timesheets: ts, periodStart: 'a', periodEnd: 'b', runId: 'r', generatedAt: 'g', generatedBy: 'x', currency: 'INR' });
  assert.equal(report.totalGross, '3.54'); // 2.53 + 1.01, never 3.5350000000000001
  assert.match(toCsv(report), /^"'=HYPERLINK/m);
  assert.deepEqual(previousWeek(new Date('2026-10-19T03:00:00Z')), { periodStart: '2026-10-12', periodEnd: '2026-10-18' });
});
