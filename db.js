'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// The five application tables of the original design (workers, jobs, applications,
// timesheets, payroll runs) plus the local stand-ins for Cognito (users, sessions),
// SNS (notifications) and CloudTrail (audit_log).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('worker', 'manager')),
  password_hash TEXT NOT NULL,
  phone         TEXT,
  status        TEXT,                -- workers only: REGISTERED | PENDING_REVIEW | VERIFIED | REJECTED
  review_note   TEXT,
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  doc_json      TEXT,                -- uploaded ID metadata and automatic check result
  id_hash       TEXT,                -- salted hash of the ID number, used to spot reused IDs
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS users_by_status ON users (role, status);
CREATE INDEX IF NOT EXISTS users_by_id_hash ON users (id_hash);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  location    TEXT NOT NULL,
  hourly_rate REAL NOT NULL,
  slots       INTEGER NOT NULL,
  filled      INTEGER NOT NULL DEFAULT 0,
  start_date  TEXT NOT NULL,
  end_date    TEXT,
  status      TEXT NOT NULL,         -- OPEN | FILLED | CLOSED
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_by_status ON jobs (status, created_at);

CREATE TABLE IF NOT EXISTS applications (
  id         TEXT PRIMARY KEY,       -- jobId_workerId: one application per worker per job
  job_id     TEXT NOT NULL REFERENCES jobs (id),
  job_title  TEXT NOT NULL,
  worker_id  TEXT NOT NULL REFERENCES users (id),
  worker_name TEXT NOT NULL,
  note       TEXT,
  status     TEXT NOT NULL,          -- PENDING | APPROVED | REJECTED
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS applications_by_worker ON applications (worker_id, created_at);
CREATE INDEX IF NOT EXISTS applications_by_status ON applications (status, created_at);

CREATE TABLE IF NOT EXISTS timesheets (
  id             TEXT PRIMARY KEY,   -- applicationId_workDate: one entry per day per job
  application_id TEXT NOT NULL REFERENCES applications (id),
  job_id         TEXT NOT NULL,
  job_title      TEXT NOT NULL,
  worker_id      TEXT NOT NULL REFERENCES users (id),
  worker_name    TEXT NOT NULL,
  work_date      TEXT NOT NULL,
  hours          REAL NOT NULL,
  hourly_rate    REAL NOT NULL,      -- snapshot: later rate changes never alter submitted hours
  notes          TEXT,
  status         TEXT NOT NULL,      -- SUBMITTED | APPROVED | REJECTED | PAID
  manager_note   TEXT,
  decided_by     TEXT,
  decided_at     TEXT,
  payroll_run_id TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS timesheets_by_worker ON timesheets (worker_id, work_date);
CREATE INDEX IF NOT EXISTS timesheets_by_status ON timesheets (status, work_date);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id              TEXT PRIMARY KEY,
  period_start    TEXT NOT NULL,
  period_end      TEXT NOT NULL,
  generated_at    TEXT NOT NULL,
  generated_by    TEXT NOT NULL,
  currency        TEXT NOT NULL,
  worker_count    INTEGER NOT NULL,
  timesheet_count INTEGER NOT NULL,
  total_hours     REAL NOT NULL,
  total_gross     TEXT NOT NULL,
  json_key        TEXT NOT NULL,
  csv_key         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,                   -- NULL = visible to every manager
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_by_user ON notifications (user_id, id);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  actor_id    TEXT,
  actor_email TEXT,
  action      TEXT NOT NULL,
  details     TEXT
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'crewbridge.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return { db, file };
}

/** Run fn inside one transaction; any throw rolls every change back. */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { openDatabase, transaction };
