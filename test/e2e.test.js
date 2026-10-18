'use strict';
// End-to-end tests: boots the real server against a throwaway data directory.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-test-'));
process.env.BEACON_DATA_DIR = dataDir;
const { server } = require('../server');
let base;

before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Minimal browser: keeps cookies and pulls CSRF tokens out of pages. */
class Browser {
  constructor() { this.cookies = {}; }
  async req(method, p, { form, body, headers = {}, follow = false } = {}) {
    const h = { ...headers, Cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    let payload = body;
    if (form) {
      h['Content-Type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(form)) [].concat(v).forEach((x) => params.append(k, x));
      payload = params.toString();
    }
    const res = await fetch(base + p, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (/Max-Age=0/.test(c)) delete this.cookies[k]; else this.cookies[k] = v;
    }
    const text = await res.text();
    const out = { status: res.status, location: res.headers.get('location'), text };
    if (follow && out.location) return this.req('GET', out.location);
    return out;
  }
  get(p) { return this.req('GET', p); }
  async csrf(p = '/login') {
    const r = await this.get(p);
    const m = r.text.match(/name="_csrf" value="([^"]+)"/);
    assert.ok(m, `no CSRF token on ${p} (status ${r.status})`);
    return m[1];
  }
  async post(p, form, from) {
    const token = await this.csrf(from || p);
    return this.req('POST', p, { form: { _csrf: token, ...form } });
  }
}

const admin = new Browser(), alice = new Browser(), bob = new Browser(), anon = new Browser();
const PW = 'correct horse battery';

test('first account becomes admin', async () => {
  const r = await admin.post('/register', { display_name: 'Nick Admin', username: 'nick', email: 'nick@example.com', password: PW, password2: PW });
  assert.equal(r.status, 303);
  assert.equal(r.location, '/admin');
  const page = await admin.get('/admin');
  assert.equal(page.status, 200);
  assert.match(page.text, /Roles and permissions/);
});

test('self-service sign-up gives the reader role', async () => {
  const r = await alice.post('/register', { display_name: 'Alice Tech', username: 'alice', email: 'alice@example.com', password: PW, password2: PW });
  assert.equal(r.status, 303);
  const acct = await alice.get('/account');
  assert.match(acct.text, /Reader/);
  const newPage = await alice.get('/new');
  assert.equal(newPage.status, 403, 'readers cannot create articles');
});

test('registration validates input', async () => {
  const r = await bob.post('/register', { display_name: '', username: 'a', email: 'bad', password: 'short', password2: 'short' }, '/register');
  assert.equal(r.status, 422);
  assert.match(r.text, /Usernames are 3/);
  assert.match(r.text, /valid email/);
  assert.match(r.text, /at least 10/);
  const dup = await bob.post('/register', { display_name: 'X', username: 'alice', email: 'x@example.com', password: PW, password2: PW }, '/register');
  assert.match(dup.text, /username is taken/);
});

test('forms without a CSRF token are rejected', async () => {
  const r = await admin.req('POST', '/admin/settings', { form: { site_name: 'Hacked' } });
  assert.equal(r.status, 403);
  const r2 = await admin.req('POST', '/admin/settings', { form: { site_name: 'Hacked' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(r2.status, 403);
});

let aliceId;
test('admin promotes a member to editor', async () => {
  const list = await admin.get('/admin/users?q=alice');
  aliceId = list.text.match(/href="\/admin\/users\/(\d+)"/)[1];
  const roles = await admin.get(`/admin/users/${aliceId}`);
  const editorId = roles.text.match(/name="role_id" value="(\d+)"[^>]*>\s*<span><strong>Editor/)[1];
  const r = await admin.post(`/admin/users/${aliceId}/role`, { role_id: editorId }, `/admin/users/${aliceId}`);
  assert.equal(r.status, 303);
  const acct = await alice.get('/account');
  assert.match(acct.text, /Editor/);
});

let slug;
test('saving an article requires a revision note', async () => {
  const spaceId = (await alice.get('/new')).text.match(/<option value="(\d+)"[^>]*>Technical/)[1];
  const noNote = await alice.post('/new', { title: 'Replacing a PSU', content: 'x', space_id: spaceId, status: 'published', note: '' }, '/new');
  assert.equal(noNote.status, 422);
  assert.match(noNote.text, /revision note is required/i);

  const content = '## Before you start\nCheck the SEL.\n\n## Swap\n1. Pull it\n2. Seat it\n\n## Verify\n```bash\nipmitool sel list\n```\n\n<script>alert(1)</script>\n';
  const ok = await alice.post('/new', { title: 'Replacing a PSU', summary: 'Hot-swap steps', content, space_id: spaceId, status: 'published', tags: 'hardware,vendor:dell', note: 'First version' }, '/new');
  assert.equal(ok.status, 303);
  slug = ok.location.split('/w/')[1];
  assert.equal(slug, 'replacing-a-psu');
  const page = await alice.get(ok.location);
  assert.match(page.text, /data-toc/, 'floating table of contents rendered');
  assert.match(page.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'raw HTML escaped');
  assert.doesNotMatch(page.text, /<script>alert/);
  assert.match(page.text, /vendor:/);
  assert.match(page.text, /First version/);
});

test('edits create revisions, detect conflicts and reject no-op saves', async () => {
  const edit = await alice.get(`/w/${slug}/edit`);
  const baseRev = edit.text.match(/name="base_rev" value="(\d+)"/)[1];
  const spaceId = edit.text.match(/<option value="(\d+)" selected/)[1];
  const fields = { title: 'Replacing a PSU', summary: 'Hot-swap steps', space_id: spaceId, status: 'published', tags: 'hardware,vendor:dell', base_rev: baseRev };
  const r = await alice.post(`/w/${slug}/edit`, { ...fields, content: '## Before you start\nCheck the SEL first.\n\n## Swap\n1. Pull it\n\n## Verify\nDone.', note: 'Clarify first step' }, `/w/${slug}/edit`);
  assert.equal(r.status, 303);

  const stale = await alice.post(`/w/${slug}/edit`, { ...fields, content: 'stale', note: 'Old tab' }, `/w/${slug}/edit`);
  assert.equal(stale.status, 409);
  assert.match(stale.text, /while you were editing/);

  const same = await alice.post(`/w/${slug}/edit`, { ...fields, base_rev: '2', content: '## Before you start\nCheck the SEL first.\n\n## Swap\n1. Pull it\n\n## Verify\nDone.', note: 'Nothing' }, `/w/${slug}/edit`);
  assert.equal(same.status, 422);
  assert.match(same.text, /Nothing changed/);

  const hist = await alice.get(`/w/${slug}/history`);
  assert.match(hist.text, /Clarify first step/);
  assert.match(hist.text, /First version/);
  const diff = await alice.get(`/w/${slug}/diff?from=1&to=2`);
  assert.match(diff.text, /diff-add/);
  assert.match(diff.text, /diff-del/);
});

test('editors cannot restore revisions; moderators can', async () => {
  const r = await alice.post(`/w/${slug}/restore/1`, { note: 'Undo' }, `/w/${slug}/rev/1`);
  assert.equal(r.status, 403);
  const ok = await admin.post(`/w/${slug}/restore/1`, { note: 'Back to the original' }, `/w/${slug}/rev/1`);
  assert.equal(ok.status, 303);
  const hist = await admin.get(`/w/${slug}/history`);
  assert.match(hist.text, /Restored from 1/);
});

test('photo uploads accept real images only', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const token = await alice.csrf(`/w/${slug}/edit`);
  const ok = await alice.req('POST', '/api/uploads', { body: png, headers: { 'Content-Type': 'image/png', 'X-CSRF-Token': token, 'X-Filename': 'rack.png' } });
  assert.equal(ok.status, 201);
  const url = JSON.parse(ok.text).url;
  assert.match(url, /^\/uploads\/\d{4}\/\d{2}\/[\w-]+\.png$/);
  assert.equal((await alice.get(url)).status, 200);
  assert.equal((await anon.get(url)).status, 303, 'uploads are private when sign-in is required');

  const svg = await alice.req('POST', '/api/uploads', { body: '<svg onload="alert(1)"/>', headers: { 'Content-Type': 'image/svg+xml', 'X-CSRF-Token': token } });
  assert.equal(svg.status, 415);
  const noToken = await alice.req('POST', '/api/uploads', { body: png, headers: { 'Content-Type': 'image/png' } });
  assert.equal(noToken.status, 403);
});

test('search and tag filtering', async () => {
  const s = await alice.get('/search?q=ipmitool');
  assert.match(s.text, /Replacing a PSU/);
  const neg = await alice.get('/search?q=psu%20-dell');
  assert.doesNotMatch(neg.text, /article-row-title/, 'tag text is indexed, so -dell excludes it');
  const tagged = await alice.get('/articles?tags=vendor.dell');
  assert.match(tagged.text, /Replacing a PSU/);
  const api = JSON.parse((await alice.get('/api/tags?q=hard')).text);
  assert.equal(api.tags[0].name, 'hardware');
});

test('drafts are private to their author and moderators', async () => {
  const spaceId = (await alice.get('/new')).text.match(/<option value="(\d+)"[^>]*>Life/)[1];
  const r = await alice.post('/new', { title: 'Car maintenance log', content: 'Oil change due.', space_id: spaceId, status: 'draft', note: 'Start log' }, '/new');
  const draftSlug = r.location.split('/w/')[1];
  await bob.post('/register', { display_name: 'Bob Reader', username: 'bob', email: 'bob@example.com', password: PW, password2: PW }, '/register');
  assert.equal((await bob.get(`/w/${draftSlug}`)).status, 404);
  assert.equal((await admin.get(`/w/${draftSlug}`)).status, 200);
  assert.equal((await alice.get(`/w/${draftSlug}`)).status, 200);
});

test('profiles keep contact details', async () => {
  const r = await alice.post('/account', {
    display_name: 'Alice Tech', email: 'alice@example.com', job_title: 'DCO Technician', department: 'Data Center Ops',
    phone: '+1 555 0100', location: 'Chicago', website: 'example.com', contact_label: ['Slack', ''], contact_value: ['@alice', ''],
  }, '/account');
  assert.equal(r.status, 303);
  const p = await bob.get('/u/alice');
  assert.match(p.text, /DCO Technician/);
  assert.match(p.text, /tel:\+15550100/);
  assert.match(p.text, /@alice/);
  assert.match(p.text, /https:\/\/example.com/);
});

test('moderators cannot manage admins or grant more than they have', async () => {
  const bobId = (await admin.get('/admin/users?q=bob')).text.match(/href="\/admin\/users\/(\d+)"/)[1];
  const page = await admin.get(`/admin/users/${bobId}`);
  const modId = page.text.match(/name="role_id" value="(\d+)"[^>]*>\s*<span><strong>Moderator/)[1];
  const adminRoleId = page.text.match(/name="role_id" value="(\d+)"[^>]*>\s*<span><strong>Admin/)[1];
  await admin.post(`/admin/users/${bobId}/role`, { role_id: modId }, `/admin/users/${bobId}`);

  const adminId = (await admin.get('/admin/users?q=nick')).text.match(/href="\/admin\/users\/(\d+)"/)[1];
  const r = await bob.post(`/admin/users/${adminId}/revoke`, { reason: 'coup' }, '/admin');
  assert.equal(r.status, 403);
  const r2 = await bob.post(`/admin/users/${aliceId}/role`, { role_id: adminRoleId }, '/admin');
  assert.equal(r2.status, 403);
  assert.equal((await bob.get('/admin/settings')).status, 403);
});

test('admins cannot revoke or demote themselves', async () => {
  const adminId = (await admin.get('/admin/users?q=nick')).text.match(/href="\/admin\/users\/(\d+)"/)[1];
  const r = await admin.post(`/admin/users/${adminId}/revoke`, { reason: 'oops' }, '/admin');
  assert.equal(r.status, 403);
  const page = await admin.get(`/admin/users/${adminId}`);
  assert.match(page.text, /can’t change your own role/);
});

test('revoking access signs the member out and blocks sign-in', async () => {
  const r = await admin.post(`/admin/users/${aliceId}/revoke`, { reason: 'Left the team' }, `/admin/users/${aliceId}`);
  assert.equal(r.status, 303);
  const after = await alice.get('/account');
  assert.equal(after.status, 303, 'existing session no longer works');
  const login = await alice.post('/login', { login: 'alice', password: PW });
  assert.equal(login.status, 403);
  assert.match(login.text, /revoked/);
  const audit = await admin.get('/admin/audit');
  assert.match(audit.text, /Left the team/);

  await admin.post(`/admin/users/${aliceId}/reinstate`, {}, `/admin/users/${aliceId}`);
  const back = await alice.post('/login', { login: 'alice', password: PW });
  assert.equal(back.status, 303);
});

test('approval mode holds new accounts until approved', async () => {
  await admin.post('/admin/settings', { site_name: 'Beacon', site_tagline: 't', registration: 'approval', default_role: 'reader', require_login: '1', allowed_email_domains: '' }, '/admin/settings');
  const carol = new Browser();
  const r = await carol.post('/register', { display_name: 'Carol', username: 'carol', email: 'carol@example.com', password: PW, password2: PW }, '/register');
  assert.equal(r.status, 200);
  assert.match(r.text, /Account requested/);
  const login = await carol.post('/login', { login: 'carol', password: PW });
  assert.equal(login.status, 403);
  const id = (await admin.get('/admin/users?q=carol')).text.match(/href="\/admin\/users\/(\d+)"/)[1];
  await admin.post(`/admin/users/${id}/approve`, {}, `/admin/users/${id}`);
  const ok = await carol.post('/login', { login: 'carol', password: PW });
  assert.equal(ok.status, 303);
});

test('password reset forces a new password', async () => {
  const r = await admin.post(`/admin/users/${aliceId}/reset-password`, {}, `/admin/users/${aliceId}`);
  const temp = r.text.match(/<code class="big-code">([^<]+)<\/code>/)[1];
  const a2 = new Browser();
  const login = await a2.post('/login', { login: 'alice', password: temp });
  assert.equal(login.location, '/account');
  assert.equal((await a2.get('/')).location, '/account', 'blocked until the password changes');
  const ch = await a2.post('/account/password', { current: temp, password: 'a brand new passphrase', password2: 'a brand new passphrase' }, '/account');
  assert.equal(ch.status, 303);
  assert.equal((await a2.get('/')).status, 200);
});

test('custom roles and permission matrix', async () => {
  const r = await admin.post('/admin/roles', { name: 'Contributor', description: 'Can draft', copy_from: '' }, '/admin/roles');
  assert.equal(r.status, 303);
  const page = await admin.get('/admin/roles');
  assert.match(page.text, /Contributor/);
  const ids = [...page.text.matchAll(/name="perm_(\d+)" value="articles\.read"/g)].map((m) => m[1]);
  const form = {};
  for (const id of ids) form[`perm_${id}`] = ['articles.read'];
  const save = await admin.post('/admin/roles/permissions', form, '/admin/roles');
  assert.equal(save.status, 303);
  const after = await admin.get('/admin/roles');
  const checked = [...after.text.matchAll(/value="articles\.create"[^>]*>/g)].filter((m) => /\bchecked\b/.test(m[0]));
  assert.equal(checked.length, 1, 'only the locked admin column still grants articles.create');
});

test('trash and recovery', async () => {
  const del = await admin.post(`/w/${slug}/delete`, {}, `/w/${slug}`);
  assert.equal(del.status, 303);
  assert.equal((await admin.get(`/w/${slug}`)).status, 404);
  const trash = await admin.get('/admin/trash');
  const id = trash.text.match(/\/admin\/trash\/(\d+)\/recover/)[1];
  const rec = await admin.post(`/admin/trash/${id}/recover`, {}, '/admin/trash');
  assert.equal(rec.status, 303);
  assert.equal((await admin.get(`/w/${slug}`)).status, 200);
});
