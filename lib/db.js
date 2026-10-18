'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { DEFAULT_ROLES, ALL } = require('./permissions');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.avatarDir, { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Schema migrations (see lib/migrations.js). Before upgrading an existing
// database, a full copy is written to <data>/backups so nothing can be lost.
// ---------------------------------------------------------------------------
const MIGRATIONS = require('./migrations');

function backupBeforeUpgrade(fromVersion) {
  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `pre-upgrade-v${fromVersion}-${stamp}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  console.log(`Database backed up before upgrade: ${file}`);
}

function migrate() {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  if (current > MIGRATIONS.length) {
    throw new Error(`This database was created by a newer version of Beacon (schema ${current}). Update the app instead of downgrading it.`);
  }
  if (current > 0 && current < MIGRATIONS.length) backupBeforeUpgrade(current);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}

// Prepared statement cache.
const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}
const get = (sql, ...params) => stmt(sql).get(...params);
const all = (sql, ...params) => stmt(sql).all(...params);
const run = (sql, ...params) => stmt(sql).run(...params);

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  site_name: 'Beacon',
  site_tagline: 'Technical know-how and everyday life, written down.',
  registration: 'open',          // open | approval | closed
  default_role: 'reader',        // role key or id new self-registered users receive
  require_login: '1',            // 1 = only signed-in members can read
  allowed_email_domains: '',     // comma separated; empty = any domain
  site_url: '',                  // public address used in emailed links, e.g. https://wiki.example.com
  about_text: [
    'Beacon is a collection of field notes. Everything here was written by someone who did the work: the fix that finally held, the runbook pieced together after a long night, the checklist made after the first attempt went sideways.',
    '',
    'Articles are personal experience first. Each one says what the writer did and what happened, with enough fact behind it (a command, a part number, a link to the source) that you can check it yourself. Read them the way you would read a colleague\'s notes, not an official manual.',
    '',
    'When you learn something the hard way, write it down here.',
  ].join('\n'),
  smtp_host: '',
  smtp_port: '587',
  smtp_security: 'starttls',     // starttls | tls | none
  smtp_user: '',
  smtp_pass: '',
  mail_from: '',                 // e.g. Beacon <wiki@example.com>
};

function seed() {
  tx(() => {
    for (const r of DEFAULT_ROLES) {
      const existing = get('SELECT id FROM roles WHERE key = ?', r.key);
      if (!existing) {
        run(
          'INSERT INTO roles (key, name, description, permissions, is_system, sort, created_at) VALUES (?,?,?,?,1,?,?)',
          r.key, r.name, r.description, JSON.stringify(r.permissions), r.sort, now()
        );
      }
    }
    // Admin always holds every permission, including ones added in later versions.
    run("UPDATE roles SET permissions = ? WHERE key = 'admin'", JSON.stringify(ALL));

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, value);
    }

    if (!get('SELECT id FROM spaces LIMIT 1')) {
      run('INSERT INTO spaces (slug, name, description, color, sort, created_at) VALUES (?,?,?,?,?,?)',
        'tech', 'Technical', 'Runbooks, hardware notes, network references and fixes worth keeping.', '#D55C13', 0, now());
      run('INSERT INTO spaces (slug, name, description, color, sort, created_at) VALUES (?,?,?,?,?,?)',
        'life', 'Life', 'Home, money, travel, recipes and the other things you want to remember.', '#3E7F6E', 1, now());
    }
  });
}

migrate();
seed();

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of all('SELECT key, value FROM settings')) out[row.key] = row.value;
  return out;
}
function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
function parseRole(row) {
  if (!row) return null;
  let perms = [];
  try { perms = JSON.parse(row.permissions); } catch { perms = []; }
  if (row.key === 'admin') perms = ALL.slice();
  return { ...row, permissions: perms };
}
const getRole = (id) => parseRole(get('SELECT * FROM roles WHERE id = ?', id));
const getRoleByKey = (key) => parseRole(get('SELECT * FROM roles WHERE key = ?', key));
const listRoles = () => all('SELECT * FROM roles ORDER BY sort, name').map(parseRole);

function audit(actorId, action, target = '', detail = '', ip = null) {
  run('INSERT INTO audit_log (actor_id, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?)',
    actorId || null, action, String(target), typeof detail === 'string' ? detail : JSON.stringify(detail), ip, now());
}

module.exports = {
  db, tx, get, all, run, now,
  getSettings, setSetting, DEFAULT_SETTINGS,
  getRole, getRoleByKey, listRoles, parseRole,
  audit,
};
