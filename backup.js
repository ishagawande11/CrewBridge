'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * Local replacement for AWS Backup: a consistent snapshot of the SQLite database
 * (VACUUM INTO works while the app is running) kept in data/backups, newest 10 only.
 */
function createBackups({ db, dataDir, keep }) {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });

  function list() {
    return fs.readdirSync(dir).filter((f) => /^crewbridge-.*\.db$/.test(f)).sort().reverse().map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, bytes: st.size, createdAt: st.mtime.toISOString() };
    });
  }

  function backupNow(now = new Date()) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const name = `crewbridge-${stamp}.db`;
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    for (const old of list().slice(keep)) fs.rmSync(path.join(dir, old.name), { force: true });
    return { name, bytes: fs.statSync(file).size };
  }

  return { list, backupNow };
}

module.exports = { createBackups };
