'use strict';
const crypto = require('node:crypto');
const { HttpError, parseCookies } = require('./http');

const COOKIE = 'cb_session';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ----- passwords: scrypt with a per-user salt (replaces Cognito's user pool) -----
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Used when the email is unknown, so "no such user" and "wrong password" take the same time.
const DUMMY_HASH = hashPassword('not-a-real-password');

function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (password.length > 200) throw new HttpError(400, 'Password is too long');
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new HttpError(400, 'Password must contain a letter and a number');
}

// ----- sessions: random token in an HttpOnly cookie; only its hash is stored -----
function createAuth({ store, sessionDays, now = () => new Date() }) {
  const failures = new Map(); // key -> { count, until }
  const MAX_FAILS = 5;
  const LOCK_MS = 15 * 60 * 1000;

  function assertNotLocked(key) {
    const f = failures.get(key);
    if (f && f.count >= MAX_FAILS && f.until > Date.now()) {
      throw new HttpError(429, 'Too many failed sign-in attempts. Try again in a few minutes.');
    }
  }
  const recordFailure = (key) => {
    const f = failures.get(key);
    const count = f && f.until > Date.now() ? f.count + 1 : 1;
    failures.set(key, { count, until: Date.now() + LOCK_MS });
  };

  function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const created = now();
    const expires = new Date(created.getTime() + sessionDays * 86400000);
    store.createSession(sha256(token), userId, created.toISOString(), expires.toISOString());
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDays * 86400}`);
  }

  function endSession(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) store.deleteSession(sha256(token));
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  }

  function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const session = store.getSession(sha256(token));
    if (!session) return null;
    if (session.expires_at < now().toISOString()) { store.deleteSession(sha256(token)); return null; }
    const u = store.getUserById(session.user_id);
    return u ? { id: u.id, email: u.email, name: u.name, role: u.role, isManager: u.role === 'manager' } : null;
  }

  function login(email, password, ip) {
    const key = `${email}|${ip}`;
    assertNotLocked(key);
    const user = store.getUserByEmail(email);
    const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) { recordFailure(key); throw new HttpError(401, 'Incorrect email or password'); }
    failures.delete(key);
    return user;
  }

  return { startSession, endSession, currentUser, login };
}

module.exports = { createAuth, hashPassword, verifyPassword, checkPasswordStrength, sha256 };
