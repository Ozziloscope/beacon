'use strict';
const fs = require('node:fs');
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
// Schema migrations, tracked with PRAGMA user_version.
// ---------------------------------------------------------------------------
const MIGRATIONS = [
  // 1: initial schema
  `
  CREATE TABLE roles (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,                       -- set for the built-in roles only
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    permissions TEXT NOT NULL DEFAULT '[]',-- JSON array of permission keys
    is_system INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','revoked')),
    avatar TEXT,
    job_title TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    contacts TEXT NOT NULL DEFAULT '[]',   -- JSON [{label, value}] e.g. Slack, Discord, Teams
    bio TEXT NOT NULL DEFAULT '',
    must_change_password INTEGER NOT NULL DEFAULT 0,
    revoked_reason TEXT,
    revoked_at TEXT,
    revoked_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE spaces (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#D55C13',
    sort INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL
  );

  CREATE TABLE articles (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    space_id INTEGER NOT NULL REFERENCES spaces(id),
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    author_id INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    current_rev INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT,
    deleted_at TEXT,
    deleted_by INTEGER REFERENCES users(id)
  );
  CREATE INDEX articles_space ON articles(space_id);
  CREATE INDEX articles_updated ON articles(updated_at);

  CREATE TABLE article_redirects (
    old_slug TEXT PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE
  );

  CREATE TABLE revisions (
    id INTEGER PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    rev INTEGER NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    space_id INTEGER,
    tags TEXT NOT NULL DEFAULT '[]',       -- JSON array of tag names at the time
    status TEXT NOT NULL,
    note TEXT NOT NULL,                    -- revision note, always required
    kind TEXT NOT NULL DEFAULT 'edit',     -- create | edit | publish | unpublish | restore
    restored_from INTEGER,
    author_id INTEGER REFERENCES users(id),
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (article_id, rev)
  );

  CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    slug TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE article_tags (
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (article_id, tag_id)
  );
  CREATE INDEX article_tags_tag ON article_tags(tag_id);

  CREATE TABLE uploads (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,             -- relative to the uploads dir, e.g. 2026/10/ab12.webp
    original_name TEXT NOT NULL DEFAULT '',
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploader_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    actor_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    ip TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX audit_created ON audit_log(created_at);

  CREATE VIRTUAL TABLE articles_fts USING fts5(
    title, summary, body, tags,
    tokenize = 'porter unicode61'
  );
  `,
];

function migrate() {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
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
