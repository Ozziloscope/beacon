'use strict';
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.BEACON_DATA_DIR || path.join(root, 'data'));

function bool(v, dflt) {
  if (v === undefined || v === '') return dflt;
  return /^(1|true|yes|on)$/i.test(String(v));
}

module.exports = {
  root,
  dataDir,
  dbPath: path.join(dataDir, 'beacon.db'),
  uploadDir: path.join(dataDir, 'uploads'),
  avatarDir: path.join(dataDir, 'avatars'),
  publicDir: path.join(root, 'public'),
  host: process.env.BEACON_HOST || '127.0.0.1',
  port: parseInt(process.env.BEACON_PORT || process.env.PORT || '3000', 10),
  // Set when running behind Cloudflare Tunnel / a reverse proxy so client IPs
  // and https detection come from forwarded headers.
  trustProxy: bool(process.env.BEACON_TRUST_PROXY, true),
  // Force the Secure flag on cookies. Auto-detected from X-Forwarded-Proto when unset.
  secureCookies: process.env.BEACON_SECURE_COOKIES === undefined ? null : bool(process.env.BEACON_SECURE_COOKIES, false),
  sessionDays: parseInt(process.env.BEACON_SESSION_DAYS || '30', 10),
  maxUploadBytes: parseInt(process.env.BEACON_MAX_UPLOAD_MB || '15', 10) * 1024 * 1024,
  maxFormBytes: 4 * 1024 * 1024,
  version: require('../package.json').version,
};
