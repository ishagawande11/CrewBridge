'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const KEY_RE = /^[A-Za-z0-9_\-./]+$/;

/**
 * Local replacement for the private KMS-encrypted S3 buckets. ID scans are encrypted at rest
 * with AES-256-GCM using a key that lives in data/master.key (created on first run, mode 0600).
 * Payroll reports are plain files because managers download them as CSV/JSON.
 */
function createStorage(dataDir) {
  const docsDir = path.join(dataDir, 'documents');
  const reportsDir = path.join(dataDir, 'reports');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });

  const keyFile = path.join(dataDir, 'master.key');
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const masterKey = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');

  // Resolve a key inside root, refusing anything that would escape it.
  function resolve(root, key) {
    if (!KEY_RE.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  const encrypt = (plain) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  };
  const decrypt = (blob) => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
  };

  return {
    /** Salted hash used to detect the same ID number on two accounts without storing the number. */
    hashIdNumber: (n) => crypto.createHmac('sha256', masterKey).update(String(n).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex'),

    saveDocument(workerId, docType, ext, bytes) {
      const key = `${workerId}/${Date.now()}-${docType}.${ext}.enc`;
      const file = resolve(docsDir, key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, encrypt(bytes), { mode: 0o600 });
      return key;
    },
    readDocument: (key) => decrypt(fs.readFileSync(resolve(docsDir, key))),
    deleteDocument(key) { fs.rmSync(resolve(docsDir, key), { force: true }); },
    countDocuments() {
      let n = 0;
      for (const dir of fs.readdirSync(docsDir, { withFileTypes: true })) {
        if (dir.isDirectory()) n += fs.readdirSync(path.join(docsDir, dir.name)).length;
      }
      return n;
    },

    putReport(key, content) {
      const file = resolve(reportsDir, key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    },
    readReport: (key) => fs.readFileSync(resolve(reportsDir, key)),
    deleteReport(key) { fs.rmSync(resolve(reportsDir, key), { force: true }); },
  };
}

module.exports = { createStorage };
