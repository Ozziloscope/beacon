'use strict';
const { html, raw, time, fmtDate, plural } = require('../lib/html');
const ui = require('./ui');
const { icon } = require('../lib/icons');
const md = require('../public/js/markdown');

/**
 * Sign-in and sign-up pages: an editorial About column beside the form.
 * stats: { articles, writers }
 */
function welcome(ctx, { title, card, stats }) {
  const s = ctx.settings;
  const about = md.render(s.about_text || '').html;
  return ui.layout(ctx, {
    title,
    bodyClass: 'welcome-page',
    wide: true,
    body: html`
    <div class="welcome">
      <section class="welcome-about" aria-labelledby="about-h">
        <p class="welcome-headline">${s.site_tagline}</p>
        <h2 id="about-h" class="welcome-label">About ${s.site_name}</h2>
        <div class="welcome-text">${raw(about)}</div>
        ${stats && stats.articles ? html`<p class="welcome-stats"><strong>${plural(stats.articles, 'article')}</strong> from <strong>${plural(stats.writers, 'writer')}</strong> so far.</p>` : ''}
      </section>
      <div class="welcome-card">${card}</div>
    </div>`,
  });
}

function login(ctx, { values = {}, error, next, stats }) {
  const s = ctx.settings;
  return welcome(ctx, {
    title: 'Sign in',
    stats,
    card: html`
    <div class="auth-card">
      <h1>Sign in</h1>
      ${error ? html`<div class="form-errors" role="alert">${error}</div>` : ''}
      <form method="post" action="/login" class="stack">
        ${ui.csrfField(ctx)}
        <input type="hidden" name="next" value="${next || ''}">
        ${ui.input({ name: 'login', label: 'Username or email', value: values.login, required: true, autocomplete: 'username', attrs: 'autofocus' })}
        ${ui.input({ name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'current-password' })}
        <p class="forgot-link"><a href="/forgot">Forgot your password?</a></p>
        <button class="btn btn-primary btn-block" type="submit">Sign in</button>
      </form>
      ${s.registration !== 'closed' ? html`<p class="auth-alt">New here? <a href="/register">Create an account</a></p>` : ''}
    </div>`,
  });
}

function register(ctx, { values = {}, errors = {}, firstUser, stats }) {
  const s = ctx.settings;
  if (s.registration === 'closed' && !firstUser) {
    return welcome(ctx, {
      title: 'Registration closed',
      stats,
      card: html`<div class="auth-card"><h1>Registration is closed</h1><p>New accounts are created by an admin. Ask whoever runs ${s.site_name} to invite you.</p><p><a class="btn btn-block" href="/login">Sign in</a></p></div>`,
    });
  }
  const errList = Object.values(errors);
  return welcome(ctx, {
    title: 'Create account',
    stats,
    card: html`
    <div class="auth-card">
      <h1>Create your account</h1>
      ${firstUser ? html`<p class="callout-inline">You're the first person here, so this account becomes the admin.</p>` :
        s.registration === 'approval' ? html`<p class="muted">An admin or moderator approves new accounts before you can sign in.</p>` : ''}
      ${errList.length ? html`<div class="form-errors" role="alert"><ul>${errList.map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
      <form method="post" action="/register" class="stack" novalidate>
        ${ui.csrfField(ctx)}
        ${ui.input({ name: 'display_name', label: 'Your name', value: values.display_name, errors, required: true, autocomplete: 'name', attrs: 'autofocus maxlength="80"' })}
        ${ui.input({ name: 'username', label: 'Username', value: values.username, errors, required: true, autocomplete: 'username', hint: '3–32 characters: letters, numbers, dots, hyphens and underscores.', attrs: 'maxlength="32" pattern="[A-Za-z0-9._-]{3,32}"' })}
        ${ui.input({ name: 'email', label: 'Email', type: 'email', value: values.email, errors, required: true, autocomplete: 'email',
          hint: s.allowed_email_domains ? `Use an address at ${s.allowed_email_domains.split(',').map((d) => d.trim()).join(' or ')}.` : 'Used to sign in and to reset your password.' })}
        ${ui.input({ name: 'password', label: 'Password', type: 'password', errors, required: true, autocomplete: 'new-password', hint: 'At least 10 characters. A short sentence works well.', attrs: 'minlength="10"' })}
        ${ui.input({ name: 'password2', label: 'Confirm password', type: 'password', errors, required: true, autocomplete: 'new-password' })}
        <button class="btn btn-primary btn-block" type="submit">Create account</button>
      </form>
      <p class="auth-alt">Already have an account? <a href="/login">Sign in</a></p>
    </div>`,
  });
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------
function forgot(ctx, { values = {}, sent, mailReady, error }) {
  if (!mailReady) {
    return ui.authLayout(ctx, { title: 'Reset your password', body: html`
      <div class="auth-card"><h1>Reset your password</h1>
        <p>Password reset by email isn't set up on this site yet. Ask an admin to reset your password from Administration.</p>
        <p><a href="/login">Back to sign in</a></p></div>` });
  }
  if (sent) {
    return ui.authLayout(ctx, { title: 'Check your email', body: html`
      <div class="auth-card"><h1>Check your email</h1>
        <p>If an active account matches <strong>${values.login}</strong>, we've sent a link to its email address. The link works once, for 60 minutes.</p>
        <p class="muted small">Nothing after a few minutes? Check your spam folder, or try again with your username instead of your email.</p>
        <p><a href="/login">Back to sign in</a></p></div>` });
  }
  return ui.authLayout(ctx, { title: 'Reset your password', body: html`
    <div class="auth-card">
      <h1>Reset your password</h1>
      <p class="muted">Enter your username or email. We'll email you a link to choose a new password.</p>
      ${error ? html`<div class="form-errors" role="alert">${error}</div>` : ''}
      <form method="post" action="/forgot" class="stack">
        ${ui.csrfField(ctx)}
        ${ui.input({ name: 'login', label: 'Username or email', value: values.login, required: true, autocomplete: 'username', attrs: 'autofocus maxlength="200"' })}
        <button class="btn btn-primary btn-block" type="submit">Email me a reset link</button>
      </form>
      <p class="auth-alt"><a href="/login">Back to sign in</a></p>
    </div>` });
}

function resetForm(ctx, { reset, token, errors = {} }) {
  if (!reset) {
    return ui.authLayout(ctx, { title: 'Link expired', body: html`
      <div class="auth-card"><h1>This link has expired</h1>
        <p>Reset links work once, and only for a limited time. Request a new one and use the most recent email.</p>
        <p><a class="btn btn-primary btn-block" href="/forgot">Request a new link</a></p></div>` });
  }
  return ui.authLayout(ctx, { title: 'Choose a new password', body: html`
    <div class="auth-card">
      <h1>Choose a new password</h1>
      <p class="muted">For <strong>@${reset.username}</strong>. Saving it signs you out on every other device.</p>
      <form method="post" action="/reset/${token}" class="stack" novalidate>
        ${ui.csrfField(ctx)}
        <input type="text" name="username" value="${reset.username}" autocomplete="username" hidden>
        ${ui.input({ name: 'password', label: 'New password', type: 'password', errors, required: true, autocomplete: 'new-password', hint: 'At least 10 characters. A short sentence works well.', attrs: 'minlength="10" autofocus' })}
        ${ui.input({ name: 'password2', label: 'Confirm new password', type: 'password', errors, required: true, autocomplete: 'new-password' })}
        <button class="btn btn-primary btn-block" type="submit">Save password and sign in</button>
      </form>
    </div>` });
}

function message(ctx, { title, text, action }) {
  return ui.authLayout(ctx, { title, body: html`<div class="auth-card"><h1>${title}</h1><p>${text}</p>${action || ''}</div>` });
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
function contactLink(label, value) {
  const v = String(value);
  if (/^https?:\/\//i.test(v)) return html`<a href="${v}" rel="noopener noreferrer" target="_blank">${v.replace(/^https?:\/\//, '')}</a>`;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return html`<a href="mailto:${v}">${v}</a>`;
  return v;
}

function contactRows(u) {
  const rows = [];
  if (u.contact_email || u.email) rows.push(['mail', 'Email', html`<a href="mailto:${u.contact_email || u.email}">${u.contact_email || u.email}</a>`]);
  if (u.phone) rows.push(['phone', 'Phone', html`<a href="tel:${u.phone.replace(/[^\d+]/g, '')}">${u.phone}</a>`]);
  if (u.location) rows.push(['pin', 'Location', u.location]);
  if (u.website) rows.push(['globe', 'Website', contactLink('Website', u.website)]);
  for (const c of u.contacts || []) rows.push(['chat', c.label, contactLink(c.label, c.value)]);
  return rows;
}

function profile(ctx, { profileUser: u, articles, edits, isSelf }) {
  const rows = contactRows(u);
  const body = html`
  <div class="profile">
    <aside class="profile-card">
      ${ui.avatar(u, 120)}
      <h1>${u.display_name}</h1>
      <p class="muted">@${u.username}</p>
      ${ui.roleLine(u) ? html`<p class="profile-role">${ui.roleLine(u)}</p>` : ''}
      <p><span class="role-pill">${u.role_name}</span>${u.status !== 'active' ? html` <span class="badge badge-warn">${u.status === 'revoked' ? 'Access revoked' : 'Awaiting approval'}</span>` : ''}</p>
      ${u.bio ? html`<p class="profile-bio">${u.bio}</p>` : ''}
      ${rows.length ? html`<dl class="contact-list">${rows.map(([ic, label, value]) => html`
        <div><dt>${icon(ic, { size: 16 })}<span>${label}</span></dt><dd>${value}</dd></div>`)}</dl>` : ''}
      <p class="muted small">Member since ${fmtDate(u.created_at)}</p>
      ${isSelf ? html`<a class="btn btn-block" href="/account">${icon('edit', { size: 16 })}Edit profile</a>` : ''}
      ${!isSelf && ctx.can('users.manage') ? html`<a class="btn btn-block btn-ghost" href="/admin/users/${u.id}">${icon('shield', { size: 16 })}Manage account</a>` : ''}
    </aside>
    <div class="profile-main">
      <section>
        <h2 class="section-title">Articles by ${u.display_name.split(' ')[0]}</h2>
        ${articles.length ? html`<ul class="article-list">${articles.map((a) => ui.articleRow(a))}</ul>` : html`<p class="muted">No articles yet.</p>`}
      </section>
      <section>
        <h2 class="section-title">Recent revisions</h2>
        ${edits.length ? html`<ol class="changes">${edits.map((c) => html`
          <li class="change change-compact"><div>
            <p class="change-line"><a href="/w/${c.slug}/rev/${c.rev}">${c.title}</a> <span class="muted small">revision ${c.rev}, ${time(c.created_at)}</span></p>
            <p class="change-note">${c.note}</p></div></li>`)}</ol>` : html`<p class="muted">No revisions yet.</p>`}
      </section>
    </div>
  </div>`;
  return ui.layout(ctx, { title: u.display_name, body });
}

// ---------------------------------------------------------------------------
// Account settings
// ---------------------------------------------------------------------------
function account(ctx, { values, errors = {}, pwErrors = {}, sessions }) {
  const u = ctx.user;
  const v = values || u;
  const contacts = (v.contacts && v.contacts.length ? v.contacts : []).concat([{ label: '', value: '' }]);
  const body = html`
  <div class="page-head"><h1>Account settings</h1>
    ${u.must_change_password ? html`<div class="form-errors" role="alert">An admin reset your password. Choose a new one below to keep using your account.</div>` : ''}
  </div>
  <div class="settings-grid">
    <section class="settings-section">
      <h2>Profile photo</h2>
      <div class="avatar-editor" data-avatar-editor>
        <div class="avatar-preview">${ui.avatar(u, 112)}</div>
        <div class="stack-sm">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-avatar-input hidden>
          <button class="btn" type="button" data-avatar-pick>${icon('upload', { size: 16 })}Upload photo</button>
          ${u.avatar ? html`<form method="post" action="/account/avatar/remove">${ui.csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">Remove photo</button></form>` : ''}
          <p class="hint">Square photos look best. Large images are cropped to the center and resized before upload.</p>
          <p class="field-error" data-avatar-error hidden></p>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h2>Profile and contact details</h2>
      <form method="post" action="/account" class="stack" novalidate>
        ${ui.csrfField(ctx)}
        <div class="grid-2">
          ${ui.input({ name: 'display_name', label: 'Name', value: v.display_name, errors, required: true, attrs: 'maxlength="80"' })}
          ${ui.input({ name: 'email', label: 'Sign-in email', type: 'email', value: v.email, errors, required: true, hint: 'Used to sign in.' })}
          ${ui.input({ name: 'job_title', label: 'Job title', value: v.job_title, errors, attrs: 'maxlength="80"' })}
          ${ui.input({ name: 'department', label: 'Team / Dept (optional)', value: v.department, errors, attrs: 'maxlength="80"' })}
          ${ui.input({ name: 'organization', label: 'Organization (optional)', value: v.organization, errors, attrs: 'maxlength="80"', hint: html`Shown as <em>Job title, Team / Dept @ Organization</em>.` })}
          <div class="field role-preview" aria-live="polite"><span class="hint">Preview</span><p data-role-preview>${ui.roleLine(v) || html`<span class="muted">Add a job title</span>`}</p></div>
          ${ui.input({ name: 'contact_email', label: 'Contact email', type: 'email', value: v.contact_email, errors, hint: 'Shown on your profile instead of your sign-in email.' })}
          ${ui.input({ name: 'phone', label: 'Phone', type: 'tel', value: v.phone, errors, attrs: 'maxlength="40"' })}
          ${ui.input({ name: 'location', label: 'Location', value: v.location, errors, attrs: 'maxlength="80"', placeholder: 'City, site or timezone' })}
          ${ui.input({ name: 'website', label: 'Website', type: 'url', value: v.website, errors, attrs: 'maxlength="200"', placeholder: 'https://' })}
        </div>
        ${ui.textarea({ name: 'bio', label: 'About you', value: v.bio, errors, rows: 3, attrs: 'maxlength="600"' })}
        <fieldset class="contacts-fieldset">
          <legend>Other ways to reach you</legend>
          <p class="hint">Slack, Teams, Discord, Signal, on-call pager and so on.</p>
          <div class="contact-rows" data-contact-rows>
            ${contacts.map((c) => html`
            <div class="contact-row">
              <input name="contact_label" value="${c.label}" placeholder="Label, e.g. Slack" aria-label="Contact label" maxlength="40">
              <input name="contact_value" value="${c.value}" placeholder="Handle, number or link" aria-label="Contact value" maxlength="200">
            </div>`)}
          </div>
          <button class="btn btn-ghost btn-sm" type="button" data-add-contact>${icon('plus', { size: 15 })}Add another</button>
          ${ui.fieldError(errors, 'contacts')}
        </fieldset>
        <p class="hint">Contact details are visible to everyone signed in to this wiki.</p>
        <div><button class="btn btn-primary" type="submit">Save profile</button></div>
      </form>
    </section>

    <section class="settings-section">
      <h2>Password</h2>
      <form method="post" action="/account/password" class="stack" novalidate>
        ${ui.csrfField(ctx)}
        <input type="text" name="username" value="${u.username}" autocomplete="username" hidden>
        ${ui.input({ name: 'current', label: 'Current password', type: 'password', errors: pwErrors, required: true, autocomplete: 'current-password' })}
        ${ui.input({ name: 'password', label: 'New password', type: 'password', errors: pwErrors, required: true, autocomplete: 'new-password', hint: 'At least 10 characters.' })}
        ${ui.input({ name: 'password2', label: 'Confirm new password', type: 'password', errors: pwErrors, required: true, autocomplete: 'new-password' })}
        <div><button class="btn" type="submit">${icon('key', { size: 16 })}Change password</button></div>
        <p class="hint">Changing your password signs out your other devices.</p>
      </form>
    </section>

    <section class="settings-section">
      <h2>Signed-in devices</h2>
      <ul class="session-list">${sessions.map((s) => html`
        <li><strong>${describeAgent(s.user_agent)}</strong>${s.current ? html` <span class="badge">This device</span>` : ''}<span class="muted small">Signed in ${time(s.created_at)}${s.ip ? ` from ${s.ip}` : ''}</span></li>`)}</ul>
      <form method="post" action="/account/sessions/revoke">${ui.csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">Sign out other devices</button></form>
    </section>
  </div>`;
  return ui.layout(ctx, { title: 'Account settings', body, scripts: ['/static/js/account.js'] });
}

function describeAgent(ua) {
  ua = ua || '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

module.exports = { login, register, forgot, resetForm, message, profile, account, contactRows };
