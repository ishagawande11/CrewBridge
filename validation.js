'use strict';
const { HttpError } = require('./http');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(body, field, { min = 1, max = 200, optional = false } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined;
    throw new HttpError(400, `${field} is required`);
  }
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be a string`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new HttpError(400, `${field} must be ${min}-${max} characters`);
  return t;
}

function num(body, field, { min, max, integer = false, optional = false } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined;
    throw new HttpError(400, `${field} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a number`);
  if (integer && !Number.isInteger(n)) throw new HttpError(400, `${field} must be a whole number`);
  if (min !== undefined && n < min) throw new HttpError(400, `${field} must be at least ${min}`);
  if (max !== undefined && n > max) throw new HttpError(400, `${field} must be at most ${max}`);
  return n;
}

function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

function isoDate(body, field, { optional = false } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined;
    throw new HttpError(400, `${field} is required (YYYY-MM-DD)`);
  }
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw new HttpError(400, `${field} must be a valid date (YYYY-MM-DD)`);
  }
  return v;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function email(body, field = 'email') {
  const v = str(body, field, { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw new HttpError(400, `${field} must be a valid email address`);
  return v;
}

module.exports = { str, num, oneOf, isoDate, email, DATE_RE };
