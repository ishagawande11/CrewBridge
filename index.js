'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const baseConfig = require('./config');
const { openDatabase } = require('./db');
const { createStore } = require('./store');
const { createStorage } = require('./storage');
const { createAuth } = require('./auth');
const { createBackups } = require('./backup');
const { createScheduler } = require('./scheduler');
const { createRouter } = require('./routes');
const { SECURITY_HEADERS } = require('./http');
const { seedDemo } = require('./seed');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
};

/** Build the whole app. Options override config, which lets tests use a temp folder and port 0. */
function createApp(options = {}) {
  const config = { ...baseConfig, ...options };
  const { db, file: dbFile } = openDatabase(config.dataDir);
  const store = createStore(db);
  const storage = createStorage(config.dataDir);
  const auth = createAuth({ store, sessionDays: config.sessionDays, now: options.now });
  const backups = createBackups({ db, dataDir: config.dataDir, keep: config.backupsToKeep });
  const scheduler = createScheduler({ db, store, storage, backups, currency: config.currency, now: options.now });
  const api = createRouter({ store, storage, auth, backups, scheduler, config, dbFile, now: options.now });

  if (config.seed && !store.getUserByEmail('manager@crewbridge.local') && store.counts().workers === 0) {
    seedDemo({ db, store, storage, currency: config.currency });
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    let file = path.resolve(config.publicDir, `.${rel}`);
    if (!file.startsWith(config.publicDir + path.sep)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(rel)) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
      file = path.join(config.publicDir, 'index.html'); // single-page app fallback
    }
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return api.handle(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url);
  });

  return {
    config, db, store, storage, server, scheduler, backups,
    close() { scheduler.stop(); server.closeAllConnections?.(); server.close(); db.close(); },
  };
}

function main() {
  const app = createApp();
  const { host, port } = app.config;
  app.server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`\nPort ${port} is already in use. Start on another one with:  PORT=3100 npm start\n`);
    else console.error(e);
    process.exit(1);
  });
  app.server.listen(port, host, () => {
    app.scheduler.start();
    const demo = app.store.getUserByEmail('manager@crewbridge.local');
    console.log(`\n  CrewBridge is running at  http://${host}:${port}\n`);
    if (demo) {
      console.log('  Demo accounts');
      console.log('    manager  manager@crewbridge.local  /  Manager@123');
      console.log('    worker   aarav@crewbridge.local    /  Worker@123');
      console.log(`  Manager invite code for new sign-ups: ${app.config.managerCode}\n`);
    }
  });
  const stop = () => { app.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) main();

module.exports = { createApp };
