'use strict';
// Beacon 1.1: upgrade from a 1.0 database without losing data, organization
// on profiles, emailed password resets, sub-spaces, People removed, About page.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-v11-'));
process.env.BEACON_DATA_DIR = dataDir;
const PW = 'correct horse battery';

// ----------------------------------------------------- a Beacon 1.0 database
function scryptHash(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return ['scrypt', 16384, 8, 1, salt.toString('base64'), hash.toString('base64')].join('$');
}
{
  const MIGRATIONS = require('../lib/migrations');
  const v1 = new DatabaseSync(path.join(dataDir, 'beacon.db'));
  v1.exec(MIGRATIONS[0]);
  v1.exec('PRAGMA user_version = 1');
  const t = new Date().toISOString();
  v1.prepare(`INSERT INTO roles (key, name, description, permissions, is_system, sort, created_at) VALUES ('admin','Admin','', '[]', 1, 0, ?)`).run(t);
  v1.prepare(`INSERT INTO users (username, email, password_hash, display_name, role_id, status, job_title, department, created_at)
              VALUES ('nick','nick@example.com',?,'Nick Okafor',1,'active','DCO Technician','Row 4',?)`).run(scryptHash(PW), t);
  v1.prepare(`INSERT INTO spaces (slug, name, description, color, sort, created_at) VALUES ('tech','Technical','','#D55C13',0,?)`).run(t);
  v1.prepare(`INSERT INTO articles (slug, space_id, title, content, status, author_id, updated_by, current_rev, created_at, updated_at)
              VALUES ('psu-swap',1,'PSU swap','## Steps\nPull it.','published',1,1,1,?,?)`).run(t, t);
  v1.prepare(`INSERT INTO revisions (article_id, rev, title, content, space_id, tags, status, note, kind, author_id, size, created_at)
              VALUES (1,1,'PSU swap','## Steps\nPull it.',1,'[]','published','Written before the upgrade','create',1,20,?)`).run(t);
  v1.prepare(`INSERT INTO settings (key, value) VALUES ('site_name','Lighthouse Wiki'), ('registration','open'), ('default_role','reader'), ('require_login','1')`).run();
  v1.close();
}

// ---------------------------------------------------------- fake SMTP server
const inbox = [];
const smtp = net.createServer((sock) => {
  let buf = '', data = false, msg = '';
  sock.write('220 fake ESMTP\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) {
        if (line === '.') { data = false; inbox.push(msg); msg = ''; sock.write('250 queued\r\n'); }
        else msg += line + '\r\n';
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') sock.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
      else if (cmd === 'AUTH') sock.write('235 ok\r\n');
      else if (cmd === 'MAIL' || cmd === 'RCPT') sock.write('250 ok\r\n');
      else if (cmd === 'DATA') { data = true; sock.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 ok\r\n');
    }
  });
});
function textOf(raw) {
  const parts = raw.split(/--beacon-[a-f0-9]+/);
  const plain = parts.find((p) => /Content-Type: text\/plain/.test(p)) || raw;
  const b64 = plain.split(/\r\n\r\n/).slice(1).join('').replace(/\s+/g, '');
  return Buffer.from(b64, 'base64').toString('utf8');
}
const header = (raw, name) => (raw.match(new RegExp(`^${name}: (.*)$`, 'mi')) || [])[1];

let base, server, smtpPort;
before(async () => {
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  smtpPort = smtp.address().port;
  ({ server } = require('../server'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  smtp.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

class Browser {
  constructor() { this.cookies = {}; }
  async req(method, p, { form, headers = {} } = {}) {
    const h = { ...headers, Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) {
      h['Content-Type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(form)) [].concat(v).forEach((x) => params.append(k, x));
      body = params.toString();
    }
    const res = await fetch(base + p, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (/Max-Age=0/.test(c)) delete this.cookies[pair.slice(0, i)]; else this.cookies[pair.slice(0, i)] = pair.slice(i + 1);
    }
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }
  get(p) { return this.req('GET', p); }
  async post(p, form, from) {
    const page = await this.get(from || p);
    const m = page.text.match(/name="_csrf" value="([^"]+)"/);
    assert.ok(m, `no CSRF token on ${from || p}`);
    return this.req('POST', p, { form: { _csrf: m[1], ...form } });
  }
}
const nick = new Browser();

test('a 1.0 database upgrades in place with nothing lost', async () => {
  const backups = fs.readdirSync(path.join(dataDir, 'backups'));
  assert.ok(backups.some((f) => /^pre-upgrade-v1-.*\.db$/.test(f)), 'pre-upgrade backup written');
  const login = await nick.post('/login', { login: 'nick', password: PW });
  assert.equal(login.status, 303, 'the old account and password still work');
  const page = await nick.get('/w/psu-swap');
  assert.equal(page.status, 200);
  assert.match(page.text, /Written before the upgrade/);
  assert.match(page.text, /Lighthouse Wiki/, 'existing settings are kept');
  const acct = await nick.get('/account');
  assert.match(acct.text, /value="DCO Technician"/);
  assert.match(acct.text, /value="Row 4"/);
});

test('organization shows as "Job title, Team @ Organization"', async () => {
  await nick.post('/account', { display_name: 'Nick Okafor', email: 'nick@example.com', job_title: 'DCO Technician', department: 'Row 4', organization: 'Lighthouse Techs' }, '/account');
  assert.match((await nick.get('/u/nick')).text, /DCO Technician, Row 4 @ Lighthouse Techs/);
  await nick.post('/account', { display_name: 'Nick Okafor', email: 'nick@example.com', job_title: 'DCO Technician', department: 'Row 4', organization: '' }, '/account');
  const p = (await nick.get('/u/nick')).text;
  assert.match(p, /DCO Technician, Row 4</);
  assert.doesNotMatch(p, /DCO Technician, Row 4 @/);
});

test('People is gone', async () => {
  const home = await nick.get('/');
  assert.doesNotMatch(home.text, /href="\/people"/);
  assert.equal((await nick.get('/people')).status, 301);
});

test('sub-spaces nest under main spaces and roll up into them', async () => {
  const tech = (await nick.get('/admin/spaces')).text.match(/action="\/admin\/spaces\/(\d+)" class="space-edit"/)[1];
  const r = await nick.post('/admin/spaces', { name: 'Networking', slug: 'networking', description: '', parent_id: tech }, '/admin/spaces');
  assert.equal(r.status, 303);
  const editor = await nick.get('/new');
  const netId = editor.text.match(/<option value="(\d+)"[^>]*>Technical \/ Networking<\/option>/)[1];
  const a = await nick.post('/new', { title: 'IB link flaps', content: 'Reseat first.', space_id: netId, status: 'published', note: 'First notes' }, '/new');
  assert.equal(a.status, 303);
  const techPage = await nick.get('/s/tech');
  assert.match(techPage.text, /IB link flaps/, 'main space lists sub-space articles');
  assert.match(techPage.text, /PSU swap/);
  assert.match(techPage.text, /class="space-link is-sub"[^>]*>[\s\S]*?Networking/, 'tree shows the sub-space');
  const netPage = await nick.get('/s/networking');
  assert.match(netPage.text, /IB link flaps/);
  assert.doesNotMatch(netPage.text, /article-row-title" href="\/w\/psu-swap"/);
  assert.match(netPage.text, /space-crumb"><a href="\/s\/tech">Technical<\/a>/);
  // A space with sub-spaces can't be deleted or nested.
  const del = await nick.post(`/admin/spaces/${tech}/delete`, {}, '/admin/spaces');
  assert.equal(del.status, 400);
});

test('sign-in page shows the About section', async () => {
  const anon = new Browser();
  const page = await anon.get('/login');
  assert.match(page.text, /About Lighthouse Wiki/);
  assert.match(page.text, /personal experience first/);
  assert.match(page.text, /href="\/forgot"/);
});

test('email settings, test email and forgot-password link', async () => {
  const save = await nick.post('/admin/settings', {
    site_name: 'Lighthouse Wiki', site_tagline: 'Field notes', registration: 'open', default_role: 'reader', require_login: '1',
    site_url: 'https://wiki.example.com', about_text: 'Personal experience first.',
    smtp_host: '127.0.0.1', smtp_port: String(smtpPort), smtp_security: 'none', smtp_user: 'u', smtp_pass: 'p', mail_from: 'Beacon <wiki@example.com>',
  }, '/admin/settings');
  assert.equal(save.status, 303);
  await nick.post('/admin/settings/test-email', {}, '/admin/settings');
  assert.equal(header(inbox.at(-1), 'To'), 'nick@example.com');

  const anon = new Browser();
  const sent = await anon.post('/forgot', { login: 'nick@example.com' }, '/forgot');
  assert.match(sent.text, /Check your email/);
  const unknown = await anon.post('/forgot', { login: 'nobody' }, '/forgot');
  assert.match(unknown.text, /Check your email/, 'same answer for unknown accounts');
  const body = textOf(inbox.at(-1));
  const link = body.match(/https:\/\/wiki\.example\.com\/reset\/([A-Za-z0-9_-]+)/);
  assert.ok(link, 'email contains a reset link on the public address');
  const token = link[1];

  const form = await anon.get(`/reset/${token}`);
  assert.equal(form.status, 200);
  const mismatch = await anon.post(`/reset/${token}`, { password: 'a whole new passphrase', password2: 'different' }, `/reset/${token}`);
  assert.equal(mismatch.status, 422);
  const ok = await anon.post(`/reset/${token}`, { password: 'a whole new passphrase', password2: 'a whole new passphrase' }, `/reset/${token}`);
  assert.equal(ok.status, 303);
  assert.equal((await anon.get('/account')).status, 200, 'signed in after reset');
  assert.equal((await nick.get('/account')).status, 303, 'other sessions were signed out');
  assert.equal((await anon.get(`/reset/${token}`)).status, 410, 'links work once');
  for (let i = 0; i < 40 && !/password was changed/.test(header(inbox.at(-1), 'Subject')); i++) await new Promise((r) => setTimeout(r, 50));
  assert.match(header(inbox.at(-1), 'Subject'), /password was changed/, 'confirmation email sent');
  const old = await new Browser().post('/login', { login: 'nick', password: PW });
  assert.equal(old.status, 401);
  const fresh = await nick.post('/login', { login: 'nick', password: 'a whole new passphrase' });
  assert.equal(fresh.status, 303);
});

test('admin reset emails the member a link and locks the old password', async () => {
  const maya = new Browser();
  await maya.post('/register', { display_name: 'Maya Lind', username: 'maya', email: 'maya@example.com', password: PW, password2: PW }, '/register');
  const id = (await nick.get('/admin/users?q=maya')).text.match(/href="\/admin\/users\/(\d+)"/)[1];
  const r = await nick.post(`/admin/users/${id}/reset-password`, {}, `/admin/users/${id}`);
  assert.equal(r.status, 303);
  const msg = inbox.at(-1);
  assert.equal(header(msg, 'To'), 'maya@example.com');
  assert.match(textOf(msg), /administrator reset the password/);
  assert.equal((await maya.get('/account')).status, 303, 'signed out');
  assert.equal((await new Browser().post('/login', { login: 'maya', password: PW })).status, 401, 'old password stops working');
  const token = textOf(msg).match(/\/reset\/([A-Za-z0-9_-]+)/)[1];
  const done = await maya.post(`/reset/${token}`, { password: 'harbor lantern ridge', password2: 'harbor lantern ridge' }, `/reset/${token}`);
  assert.equal(done.status, 303);
  const audit = await nick.get('/admin/audit');
  assert.match(audit.text, /Emailed reset link/);
  assert.doesNotMatch(audit.text, /smtp_pass: p/, 'mail password never shown in the audit log');
});
