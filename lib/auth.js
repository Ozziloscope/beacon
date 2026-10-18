'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const { get, all, run, now, getRole, parseRole } = require('./db');
const { isSubset } = require('./permissions');

// ---------------------------------------------------------------------------
// Passwords (scrypt, salted, parameters stored with the hash)
// ---------------------------------------------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// A real hash to compare against when the username doesn't exist, so login
// timing doesn't reveal which accounts exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

function passwordProblem(password, { username, email } = {}) {
  if (typeof password !== 'string' || password.length < 10) return 'Use at least 10 characters for your password.';
  if (password.length > 256) return 'Keep your password under 256 characters.';
  const lower = password.toLowerCase();
  if (username && lower.includes(String(username).toLowerCase())) return "Your password can't contain your username.";
  if (email && lower === String(email).toLowerCase()) return "Your password can't be your email address.";
  if (/^(.)\1+$/.test(password)) return 'Pick a password that is not one repeated character.';
  return null;
}

function randomPassword() {
  // Readable temporary password, e.g. "mint-harbor-4821-quill"
  const words = ['amber', 'basalt', 'cedar', 'delta', 'ember', 'fjord', 'granite', 'harbor', 'indigo', 'juniper', 'kestrel', 'lumen', 'meadow', 'nickel', 'onyx', 'pylon', 'quill', 'ridge', 'slate', 'tundra', 'umber', 'vector', 'willow', 'zephyr'];
  const pick = () => words[crypto.randomInt(words.length)];
  return `${pick()}-${pick()}-${crypto.randomInt(1000, 9999)}-${pick()}`;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId, { ip, userAgent } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400e3).toISOString();
  run('INSERT INTO sessions (token_hash, user_id, csrf, ip, user_agent, created_at, expires_at) VALUES (?,?,?,?,?,?,?)',
    sha256(token), userId, csrf, ip || null, (userAgent || '').slice(0, 300), now(), expires);
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), userId);
  return { token, csrf, expires };
}

function loadSession(token) {
  if (!token) return null;
  const hash = sha256(token);
  const s = get('SELECT * FROM sessions WHERE token_hash = ?', hash);
  if (!s) return null;
  if (s.expires_at < now()) {
    run('DELETE FROM sessions WHERE token_hash = ?', hash);
    return null;
  }
  // Slide the expiry forward once less than half the lifetime remains.
  const remaining = new Date(s.expires_at).getTime() - Date.now();
  if (remaining < (config.sessionDays * 86400e3) / 2) {
    s.expires_at = new Date(Date.now() + config.sessionDays * 86400e3).toISOString();
    run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', s.expires_at, hash);
    s.renewed = true;
  }
  return s;
}

function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

function destroyUserSessions(userId, exceptToken) {
  if (exceptToken) run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', userId, sha256(exceptToken));
  else run('DELETE FROM sessions WHERE user_id = ?', userId);
}

function pruneSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', now());
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
function loadUser(id) {
  const u = get(`SELECT u.*, r.key AS role_key, r.name AS role_name, r.permissions AS role_permissions
                 FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, id);
  if (!u) return null;
  const role = parseRole({ key: u.role_key, permissions: u.role_permissions });
  u.permissions = new Set(role.permissions);
  try { u.contacts = JSON.parse(u.contacts || '[]'); } catch { u.contacts = []; }
  delete u.role_permissions;
  return u;
}

const can = (user, perm) => !!(user && user.status === 'active' && user.permissions && user.permissions.has(perm));

function activeAdminCount() {
  return get(`SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'admin' AND u.status = 'active'`).n;
}

/**
 * Whether `actor` may change `target`'s role or account status.
 * Rule: nobody manages themselves; admins manage everyone; anyone else with
 * users.manage may only manage people whose role grants nothing they lack.
 */
function canManageUser(actor, target) {
  if (!actor || !target || actor.id === target.id) return false;
  if (!can(actor, 'users.manage')) return false;
  if (actor.role_key === 'admin') return true;
  if (target.role_key === 'admin') return false;
  const targetRole = getRole(target.role_id);
  return isSubset(targetRole.permissions, [...actor.permissions]);
}

/** Whether `actor` may hand out `role`: never more access than they have themselves. */
function canAssignRole(actor, role) {
  if (!actor || !role) return false;
  if (actor.role_key === 'admin') return true;
  if (role.key === 'admin') return false;
  return isSubset(role.permissions, [...actor.permissions]);
}

// ---------------------------------------------------------------------------
// Login throttling (in memory; resets on restart)
// ---------------------------------------------------------------------------
const attempts = new Map(); // key -> { count, first, lockedUntil }
const WINDOW_MS = 15 * 60e3;
const MAX_ATTEMPTS = 8;

function throttleKey(ip, username) {
  return `${ip}|${String(username || '').toLowerCase()}`;
}
function isThrottled(ip, username) {
  const a = attempts.get(throttleKey(ip, username));
  if (!a) return 0;
  if (a.lockedUntil && a.lockedUntil > Date.now()) return Math.ceil((a.lockedUntil - Date.now()) / 60e3);
  return 0;
}
function recordFailure(ip, username) {
  const key = throttleKey(ip, username);
  const t = Date.now();
  let a = attempts.get(key);
  if (!a || t - a.first > WINDOW_MS) a = { count: 0, first: t, lockedUntil: 0 };
  a.count++;
  if (a.count >= MAX_ATTEMPTS) a.lockedUntil = t + WINDOW_MS;
  attempts.set(key, a);
}
function clearFailures(ip, username) {
  attempts.delete(throttleKey(ip, username));
}
setInterval(() => {
  const t = Date.now();
  for (const [k, a] of attempts) if (t - a.first > WINDOW_MS && (!a.lockedUntil || a.lockedUntil < t)) attempts.delete(k);
  pruneSessions();
}, 10 * 60e3).unref();

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH, passwordProblem, randomPassword,
  createSession, loadSession, destroySession, destroyUserSessions,
  loadUser, can, canManageUser, canAssignRole, activeAdminCount,
  isThrottled, recordFailure, clearFailures,
  listSessions: (userId, currentToken) => {
    const current = currentToken ? sha256(currentToken) : '';
    return all('SELECT token_hash, created_at, expires_at, ip, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC', userId)
      .map(({ token_hash, ...s }) => ({ ...s, current: token_hash === current }));
  },
};
