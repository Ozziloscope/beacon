'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../lib/config');
const { tx, get, all, run, now, audit, getRoleByKey, getRole } = require('../lib/db');
const auth = require('../lib/auth');
const A = require('../lib/articles');
const { HttpError, readBody, sendFile } = require('../lib/http');
const views = require('../views/users');

const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESERVED = new Set(['admin', 'administrator', 'root', 'system', 'beacon', 'moderator', 'support', 'new', 'api', 'static']);

function safeNext(next) {
  return typeof next === 'string' && /^\/(?!\/)[^\s]*$/.test(next) && !next.startsWith('/logout') ? next : '/';
}

/** Detect image type from the first bytes. Only raster formats are accepted (no SVG). */
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.slice(0, 6).toString('ascii') === 'GIF87a' || buf.slice(0, 6).toString('ascii') === 'GIF89a') return { ext: 'gif', mime: 'image/gif' };
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

function cleanText(v, max) {
  return String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
}

function validateProfile(form, { selfId } = {}) {
  const errors = {};
  const values = {
    display_name: cleanText(form.display_name, 80),
    email: cleanText(form.email, 200).toLowerCase(),
    job_title: cleanText(form.job_title, 80),
    department: cleanText(form.department, 80),
    contact_email: cleanText(form.contact_email, 200).toLowerCase(),
    phone: cleanText(form.phone, 40),
    location: cleanText(form.location, 80),
    website: cleanText(form.website, 200),
    bio: String(form.bio || '').replace(/\r\n?/g, '\n').trim().slice(0, 600),
    contacts: [],
  };
  if (!values.display_name) errors.display_name = 'Enter your name.';
  if (!EMAIL_RE.test(values.email)) errors.email = 'Enter a valid email address.';
  else if (get('SELECT 1 FROM users WHERE email = ? AND id != ?', values.email, selfId || 0)) errors.email = 'Another account already uses that email.';
  if (values.contact_email && !EMAIL_RE.test(values.contact_email)) errors.contact_email = 'Enter a valid contact email or leave it blank.';
  if (values.phone && !/^[0-9+().\-\s x]{3,40}$/i.test(values.phone)) errors.phone = 'Use digits, spaces and + ( ) - only.';
  if (values.website) {
    if (!/^https?:\/\//i.test(values.website)) values.website = 'https://' + values.website;
    try { new URL(values.website); } catch { errors.website = 'Enter a full web address, like https://example.com.'; }
  }
  const labels = [].concat(form.contact_label || []);
  const vals = [].concat(form.contact_value || []);
  for (let i = 0; i < Math.max(labels.length, vals.length) && values.contacts.length < 10; i++) {
    const label = cleanText(labels[i], 40), value = cleanText(vals[i], 200);
    if (!label && !value) continue;
    if (!label || !value) { errors.contacts = 'Each extra contact needs both a label and a value.'; continue; }
    values.contacts.push({ label, value });
  }
  return { errors, values };
}

module.exports = function register(router, { requireUser, requirePerm }) {
  // -------------------------------------------------------------------------
  // Sign in / out
  // -------------------------------------------------------------------------
  router.get('/login', (ctx) => {
    if (ctx.user) return ctx.redirect(safeNext(ctx.query.next));
    if (!get('SELECT 1 FROM users LIMIT 1')) return ctx.redirect('/register');
    return ctx.html(views.login(ctx, { next: ctx.query.next }));
  });

  router.post('/login', async (ctx) => {
    const form = await ctx.form();
    const login = cleanText(form.login, 200);
    const password = String(form.password || '');
    const next = safeNext(form.next);
    const fail = (error, status = 401) => ctx.html(views.login(ctx, { values: { login }, error, next }), status);

    const wait = auth.isThrottled(ctx.ip, login);
    if (wait) return fail(`Too many failed attempts. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`, 429);

    const row = get('SELECT id, password_hash, status FROM users WHERE username = ? OR email = ?', login, login.toLowerCase());
    const ok = auth.verifyPassword(password, row ? row.password_hash : auth.DUMMY_HASH);
    if (!row || !ok) {
      auth.recordFailure(ctx.ip, login);
      return fail("That username or password isn't right.");
    }
    if (row.status === 'pending') return fail('Your account is waiting for approval. You can sign in once an admin or moderator approves it.', 403);
    if (row.status === 'revoked') return fail('Access for this account has been revoked. Contact an admin if you think this is a mistake.', 403);

    auth.clearFailures(ctx.ip, login);
    ctx.startSession(row.id);
    const u = auth.loadUser(row.id);
    if (u.must_change_password) {
      ctx.setFlash('error', 'Choose a new password to finish signing in.');
      return ctx.redirect('/account');
    }
    return ctx.redirect(next);
  });

  router.post('/logout', async (ctx) => {
    await ctx.form();
    ctx.endSession();
    return ctx.redirect('/login');
  });

  // -------------------------------------------------------------------------
  // Self-service registration
  // -------------------------------------------------------------------------
  router.get('/register', (ctx) => {
    if (ctx.user) return ctx.redirect('/');
    const firstUser = !get('SELECT 1 FROM users LIMIT 1');
    return ctx.html(views.register(ctx, { firstUser }));
  });

  router.post('/register', async (ctx) => {
    const form = await ctx.form();
    const firstUser = !get('SELECT 1 FROM users LIMIT 1');
    const s = ctx.settings;
    if (s.registration === 'closed' && !firstUser) return ctx.html(views.register(ctx, { firstUser }), 403);

    const values = {
      display_name: cleanText(form.display_name, 80),
      username: cleanText(form.username, 32),
      email: cleanText(form.email, 200).toLowerCase(),
    };
    const errors = {};
    if (!values.display_name) errors.display_name = 'Enter your name.';
    if (!USERNAME_RE.test(values.username)) errors.username = 'Usernames are 3–32 letters, numbers, dots, hyphens or underscores.';
    else if (RESERVED.has(values.username.toLowerCase()) && !firstUser) errors.username = 'That username is reserved. Pick another.';
    else if (get('SELECT 1 FROM users WHERE username = ?', values.username)) errors.username = 'That username is taken.';
    if (!EMAIL_RE.test(values.email)) errors.email = 'Enter a valid email address.';
    else if (get('SELECT 1 FROM users WHERE email = ?', values.email)) errors.email = 'An account with that email already exists. Try signing in.';
    else if (s.allowed_email_domains.trim() && !firstUser) {
      const domains = s.allowed_email_domains.split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
      const domain = values.email.split('@')[1];
      if (!domains.includes(domain)) errors.email = `Sign-up is limited to ${domains.map((d) => '@' + d).join(', ')} addresses.`;
    }
    const pw = auth.passwordProblem(form.password, values);
    if (pw) errors.password = pw;
    else if (form.password !== form.password2) errors.password2 = "The passwords don't match.";

    if (Object.keys(errors).length) return ctx.html(views.register(ctx, { values, errors, firstUser }), 422);

    let role, status;
    if (firstUser) { role = getRoleByKey('admin'); status = 'active'; }
    else {
      role = getRoleByKey(s.default_role) || getRole(parseInt(s.default_role, 10)) || getRoleByKey('reader');
      if (role.key === 'admin') role = getRoleByKey('reader');
      status = s.registration === 'approval' ? 'pending' : 'active';
    }

    const id = tx(() => {
      const r = run(`INSERT INTO users (username, email, password_hash, display_name, role_id, status, created_at) VALUES (?,?,?,?,?,?,?)`,
        values.username, values.email, auth.hashPassword(form.password), values.display_name, role.id, status, now());
      const newId = Number(r.lastInsertRowid);
      audit(newId, 'user.register', `@${values.username}`, `${role.name}, ${status}${firstUser ? ' (first account, made admin)' : ''}`, ctx.ip);
      return newId;
    });

    if (status === 'pending') {
      return ctx.html(views.message(ctx, {
        title: 'Account requested',
        text: `Thanks, ${values.display_name.split(' ')[0]}. An admin or moderator will review your account. Once it's approved you can sign in with the username @${values.username}.`,
      }));
    }
    ctx.startSession(id);
    ctx.setFlash('success', firstUser ? 'Welcome. Your admin account is ready.' : `Welcome to ${s.site_name}. Add a photo and contact details so people can reach you.`);
    return ctx.redirect(firstUser ? '/admin' : '/account');
  });

  // -------------------------------------------------------------------------
  // Account settings
  // -------------------------------------------------------------------------
  router.get('/account', requireUser, (ctx) => {
    return ctx.html(views.account(ctx, { sessions: auth.listSessions(ctx.user.id, ctx.token) }));
  });

  router.post('/account', requireUser, async (ctx) => {
    const form = await ctx.form();
    const { errors, values } = validateProfile(form, { selfId: ctx.user.id });
    if (Object.keys(errors).length) {
      return ctx.html(views.account(ctx, { values: { ...values, username: ctx.user.username }, errors, sessions: auth.listSessions(ctx.user.id, ctx.token) }), 422);
    }
    run(`UPDATE users SET display_name = ?, email = ?, job_title = ?, department = ?, contact_email = ?, phone = ?, location = ?, website = ?, bio = ?, contacts = ? WHERE id = ?`,
      values.display_name, values.email, values.job_title, values.department, values.contact_email, values.phone,
      values.location, values.website, values.bio, JSON.stringify(values.contacts), ctx.user.id);
    ctx.setFlash('success', 'Profile saved.');
    return ctx.redirect('/account');
  });

  router.post('/account/password', requireUser, async (ctx) => {
    const form = await ctx.form();
    const pwErrors = {};
    const row = get('SELECT password_hash FROM users WHERE id = ?', ctx.user.id);
    if (!auth.verifyPassword(String(form.current || ''), row.password_hash)) pwErrors.current = "That isn't your current password.";
    const problem = auth.passwordProblem(form.password, ctx.user);
    if (problem) pwErrors.password = problem;
    else if (form.password !== form.password2) pwErrors.password2 = "The passwords don't match.";
    else if (form.password === form.current) pwErrors.password = 'Choose a password different from your current one.';
    if (Object.keys(pwErrors).length) {
      return ctx.html(views.account(ctx, { pwErrors, sessions: auth.listSessions(ctx.user.id, ctx.token) }), 422);
    }
    run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', auth.hashPassword(form.password), ctx.user.id);
    auth.destroyUserSessions(ctx.user.id, ctx.token);
    ctx.setFlash('success', 'Password changed. Your other devices were signed out.');
    return ctx.redirect('/account');
  });

  router.post('/account/sessions/revoke', requireUser, async (ctx) => {
    await ctx.form();
    auth.destroyUserSessions(ctx.user.id, ctx.token);
    ctx.setFlash('success', 'Signed out of your other devices.');
    return ctx.redirect('/account');
  });

  router.post('/api/account/avatar', requireUser, async (ctx) => {
    ctx.checkCsrf();
    const buf = await readBody(ctx.req, 5 * 1024 * 1024);
    const type = sniffImage(buf);
    if (!type) throw new HttpError(415, 'Use a PNG, JPEG, GIF or WebP image.');
    const name = `${ctx.user.id}-${crypto.randomBytes(6).toString('hex')}.${type.ext}`;
    fs.writeFileSync(path.join(config.avatarDir, name), buf);
    const old = ctx.user.avatar;
    run('UPDATE users SET avatar = ? WHERE id = ?', name, ctx.user.id);
    if (old) fs.rm(path.join(config.avatarDir, path.basename(old)), { force: true }, () => {});
    return ctx.json({ url: `/avatars/${name}` });
  });

  router.post('/account/avatar/remove', requireUser, async (ctx) => {
    await ctx.form();
    const old = ctx.user.avatar;
    run('UPDATE users SET avatar = NULL WHERE id = ?', ctx.user.id);
    if (old) fs.rm(path.join(config.avatarDir, path.basename(old)), { force: true }, () => {});
    ctx.setFlash('success', 'Profile photo removed.');
    return ctx.redirect('/account');
  });

  // -------------------------------------------------------------------------
  // People
  // -------------------------------------------------------------------------
  router.get('/people', requirePerm('articles.read'), requireUser, (ctx) => {
    const q = cleanText(ctx.query.q, 80);
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const users = all(`SELECT id, username, display_name, avatar, job_title, department, email, contact_email, phone, location
                       FROM users WHERE status = 'active'
                       ${q ? 'AND (display_name LIKE ? OR username LIKE ? OR job_title LIKE ? OR department LIKE ? OR location LIKE ?)' : ''}
                       ORDER BY display_name COLLATE NOCASE LIMIT 500`, ...(q ? [like, like, like, like, like] : []));
    return ctx.html(views.people(ctx, { users, q }));
  });

  router.get('/u/:username', requirePerm('articles.read'), requireUser, (ctx) => {
    const row = get('SELECT id FROM users WHERE username = ?', ctx.params.username);
    if (!row) throw new HttpError(404, "There's nobody here with that username.");
    const u = auth.loadUser(row.id);
    if (u.status !== 'active' && !ctx.can('users.manage') && u.id !== ctx.user.id) throw new HttpError(404, "There's nobody here with that username.");
    const articles = A.listArticles(ctx.user, { authorId: u.id, limit: 20 }).rows;
    const vis = A.visibility(ctx.user);
    const edits = all(`SELECT r.rev, r.note, r.created_at, a.slug, a.title FROM revisions r JOIN articles a ON a.id = r.article_id
                       WHERE r.author_id = ? AND ${vis.sql} ORDER BY r.created_at DESC LIMIT 15`, u.id, ...vis.params);
    return ctx.html(views.profile(ctx, { profileUser: u, articles, edits, isSelf: u.id === ctx.user.id }));
  });

  // -------------------------------------------------------------------------
  // Photo uploads for articles
  // -------------------------------------------------------------------------
  router.post('/api/uploads', requirePerm('uploads.create'), async (ctx) => {
    ctx.checkCsrf();
    const buf = await readBody(ctx.req, config.maxUploadBytes);
    const type = sniffImage(buf);
    if (!type) throw new HttpError(415, 'Only PNG, JPEG, GIF and WebP photos can be uploaded.');
    const d = new Date();
    const dir = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    fs.mkdirSync(path.join(config.uploadDir, dir), { recursive: true });
    const rel = `${dir}/${crypto.randomBytes(9).toString('base64url')}.${type.ext}`;
    fs.writeFileSync(path.join(config.uploadDir, rel), buf);
    let original = '';
    try { original = decodeURIComponent(String(ctx.req.headers['x-filename'] || '')).slice(0, 200); } catch { original = ''; }
    run('INSERT INTO uploads (path, original_name, mime, size, uploader_id, created_at) VALUES (?,?,?,?,?,?)',
      rel, original, type.mime, buf.length, ctx.user.id, now());
    return ctx.json({ url: `/uploads/${rel}`, name: original.replace(/\.[a-z0-9]+$/i, '') }, 201);
  });

  router.get('/uploads/:path*', requirePerm('articles.read'), (ctx) => {
    if (!/^\d{4}\/\d{2}\/[A-Za-z0-9_-]+\.(png|jpg|gif|webp)$/.test(ctx.params.path)) throw new HttpError(404, 'Not found');
    if (!sendFile(ctx.req, ctx.res, config.uploadDir, ctx.params.path, { maxAge: 31536000, extraHeaders: { 'Content-Security-Policy': "default-src 'none'" } })) {
      throw new HttpError(404, 'That photo no longer exists.');
    }
    ctx.sent = true;
  });

  router.get('/avatars/:file', (ctx) => {
    if (ctx.settings.require_login === '1' && !ctx.user) throw new HttpError(404, 'Not found');
    if (!/^\d+-[a-f0-9]+\.(png|jpg|gif|webp)$/.test(ctx.params.file)) throw new HttpError(404, 'Not found');
    if (!sendFile(ctx.req, ctx.res, config.avatarDir, ctx.params.file, { maxAge: 31536000 })) throw new HttpError(404, 'Not found');
    ctx.sent = true;
  });
};

module.exports.validateProfile = validateProfile;
module.exports.sniffImage = sniffImage;
