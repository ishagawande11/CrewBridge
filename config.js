'use strict';
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  root: ROOT,
  host: process.env.HOST || '127.0.0.1', // loopback only: nothing outside this machine can connect
  port: Number(process.env.PORT) || 3000,
  dataDir: process.env.CREWBRIDGE_DATA || path.join(ROOT, 'data'),
  publicDir: path.join(ROOT, 'public'),
  currency: process.env.CREWBRIDGE_CURRENCY || 'INR',
  // Anyone who knows this code can register as a manager. Change it with CREWBRIDGE_MANAGER_CODE.
  managerCode: process.env.CREWBRIDGE_MANAGER_CODE || 'CREW-MANAGER',
  seed: process.env.CREWBRIDGE_SEED !== '0', // load demo data into an empty database
  maxUploadBytes: 8 * 1024 * 1024,
  sessionDays: 7,
  backupsToKeep: 10,
};
