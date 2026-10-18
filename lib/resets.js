'use strict';
// Single-use, expiring password reset links. Only a SHA-256 of each token is
// stored, so a copy of the database can't be used to reset anyone's password.
const crypto = require('node:crypto');
const { get, run, now, getSettings, audit } = require('./db');
const mail = require('./mail');
const emails = require('./emails');

const SELF_MINUTES = 60;          // "Forgot password" links
const ADMIN_MINUTES = 24 * 60;    // links sent when an admin resets an account

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function create(userId, { minutes, requestedBy = null, ip = null }) {
  const token = crypto.randomBytes(32).toString('base64url');
  // Only the newest link works.
  run('DELETE FROM password_resets WHERE user_id = ?', userId);
  run('INSERT INTO password_resets (token_hash, user_id, requested_by, requested_ip, created_at, expires_at) VALUES (?,?,?,?,?,?)',
    sha256(token), userId, requestedBy, ip, now(), new Date(Date.now() + minutes * 60e3).toISOString());
  return token;
}

/** The reset row and its user, or null if the link is unknown, used, expired or the account isn't active. */
function find(token) {
  if (!token || !/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null;
  const r = get(`SELECT pr.*, u.username, u.display_name, u.email, u.status
                 FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE pr.token_hash = ?`, sha256(token));
  if (!r || r.used_at || r.expires_at < now() || r.status !== 'active') return null;
  return r;
}

function consume(token) {
  const r = find(token);
  if (!r) return null;
  run('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', now(), sha256(token));
  run('DELETE FROM password_resets WHERE user_id = ? AND token_hash != ?', r.user_id, sha256(token));
  return r;
}

function linkFor(baseUrl, token) {
  return `${String(baseUrl).replace(/\/+$/, '')}/reset/${token}`;
}

/** Create a link and email it. Throws with a readable message if sending fails. */
async function sendLink(user, { baseUrl, byAdmin = false, requestedBy = null, ip = null }) {
  const settings = getSettings();
  const minutes = byAdmin ? ADMIN_MINUTES : SELF_MINUTES;
  const token = create(user.id, { minutes, requestedBy, ip });
  const msg = emails.passwordReset({
    site: settings.site_name, name: user.display_name.split(' ')[0], link: linkFor(baseUrl, token), minutes, byAdmin,
  });
  await mail.send({ to: user.email, ...msg }, settings);
  audit(requestedBy || user.id, 'user.reset_link', `@${user.username}`, byAdmin ? 'Reset link emailed by an admin' : 'Reset link requested from the sign-in page', ip);
}

// ------------------------------------------------- request throttling (memory)
const recent = new Map(); // key -> [timestamps]
const WINDOW = 15 * 60e3;
function allow(key, max) {
  const t = Date.now();
  const list = (recent.get(key) || []).filter((x) => t - x < WINDOW);
  if (list.length >= max) { recent.set(key, list); return false; }
  list.push(t);
  recent.set(key, list);
  return true;
}
setInterval(() => {
  const t = Date.now();
  for (const [k, list] of recent) if (!list.some((x) => t - x < WINDOW)) recent.delete(k);
}, 10 * 60e3).unref();

module.exports = { create, find, consume, linkFor, sendLink, allow, SELF_MINUTES, ADMIN_MINUTES };
