'use strict';

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** A non-JSON response (file download, document preview). */
class Raw {
  constructor(statusCode, headers, body) {
    Object.assign(this, { statusCode, headers, body });
  }
}

const MAX_BODY = 12 * 1024 * 1024; // an 8 MB file grows by a third once base64 encoded

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) tooBig = true; // keep draining so the client still gets our 413
      else chunks.push(c);
    });
    req.on('end', () => (tooBig ? reject(new HttpError(413, 'Request body too large')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

function parseJson(buffer) {
  if (!buffer.length) return {};
  let value;
  try { value = JSON.parse(buffer.toString('utf8')); } catch { throw new HttpError(400, 'Body must be valid JSON'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Body must be a JSON object');
  return value;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function sendRaw(res, raw) {
  res.writeHead(raw.statusCode, { ...SECURITY_HEADERS, 'Content-Length': raw.body.length, ...raw.headers });
  res.end(raw.body);
}

const parseCookies = (header = '') => Object.fromEntries(
  header.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
  }));

module.exports = { HttpError, Raw, readBody, parseJson, sendJson, sendRaw, parseCookies, SECURITY_HEADERS };
