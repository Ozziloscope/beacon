'use strict';

// Schema migrations, applied in order and tracked with PRAGMA user_version.
// RULES: never edit or remove a migration that has shipped. Only append new
// ones, and keep them additive (ADD COLUMN, CREATE TABLE/INDEX) so upgrades
// never drop or rewrite member data.
module.exports = [
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

  // 2 (Beacon 1.1): organization on profiles, sub-spaces, emailed password resets.
  // Additive only: existing rows keep every value.
  `
  ALTER TABLE users ADD COLUMN organization TEXT NOT NULL DEFAULT '';
  ALTER TABLE spaces ADD COLUMN parent_id INTEGER REFERENCES spaces(id);
  CREATE INDEX spaces_parent ON spaces(parent_id);

  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_by INTEGER REFERENCES users(id),
    requested_ip TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX password_resets_user ON password_resets(user_id);
  `,
];
