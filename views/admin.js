'use strict';
const { html, raw, time, fmtDate, plural } = require('../lib/html');
const ui = require('./ui');
const { icon } = require('../lib/icons');
const { PERMISSIONS } = require('../lib/permissions');

const SECTIONS = [
  { href: '/admin', label: 'Overview', icon: 'dashboard', perm: null },
  { href: '/admin/users', label: 'Users', icon: 'users', perm: 'users.manage' },
  { href: '/admin/roles', label: 'Roles and permissions', icon: 'shield', perm: 'roles.manage' },
  { href: '/admin/tags', label: 'Tags', icon: 'tag', perm: 'tags.manage' },
  { href: '/admin/spaces', label: 'Spaces', icon: 'space', perm: 'spaces.manage' },
  { href: '/admin/trash', label: 'Trash', icon: 'trash', perm: 'articles.delete' },
  { href: '/admin/audit', label: 'Audit log', icon: 'list', perm: 'audit.view' },
  { href: '/admin/settings', label: 'Site settings', icon: 'sliders', perm: 'settings.manage' },
];

function adminLayout(ctx, { title, body, active }) {
  const nav = SECTIONS.filter((s) => !s.perm || ctx.can(s.perm));
  return ui.layout(ctx, {
    title: `${title} – Administration`,
    wide: true,
    body: html`
    <div class="admin">
      <nav class="admin-nav" aria-label="Administration">
        <p class="admin-nav-title">Administration</p>
        ${nav.map((s) => html`<a href="${s.href}" ${active === s.href ? raw('aria-current="page"') : ''}>${icon(s.icon, { size: 17 })}${s.label}</a>`)}
      </nav>
      <div class="admin-main">
        <h1>${title}</h1>
        ${body}
      </div>
    </div>`,
  });
}

const STATUS_LABEL = { active: 'Active', pending: 'Awaiting approval', revoked: 'Revoked' };
function statusPill(status) {
  return html`<span class="status-pill status-${status}">${STATUS_LABEL[status] || status}</span>`;
}

function overview(ctx, { stats, pending, recentAudit }) {
  return adminLayout(ctx, {
    title: 'Overview',
    active: '/admin',
    body: html`
    <dl class="stat-row">
      <div><dt>Articles</dt><dd>${stats.articles}</dd><p class="muted small">${stats.drafts} drafts</p></div>
      <div><dt>Revisions</dt><dd>${stats.revisions}</dd></div>
      <div><dt>Members</dt><dd>${stats.users}</dd><p class="muted small">${stats.revoked} revoked</p></div>
      <div><dt>Photos</dt><dd>${stats.uploads}</dd><p class="muted small">${stats.uploadSize}</p></div>
    </dl>
    ${ctx.can('users.manage') ? html`
    <section class="admin-section">
      <h2>Waiting for approval</h2>
      ${pending.length ? html`<ul class="pending-list">${pending.map((u) => html`
        <li>${ui.avatar(u, 32)}<div><strong>${u.display_name}</strong> <span class="muted">@${u.username}, ${u.email}</span><div class="muted small">Requested ${time(u.created_at)}</div></div>
          <form method="post" action="/admin/users/${u.id}/approve">${ui.csrfField(ctx)}<button class="btn btn-sm btn-primary" type="submit">Approve</button></form>
          <a class="btn btn-sm btn-ghost" href="/admin/users/${u.id}">Review</a></li>`)}</ul>` : html`<p class="muted">Nobody is waiting.</p>`}
    </section>` : ''}
    ${ctx.can('audit.view') && recentAudit.length ? html`
    <section class="admin-section">
      <h2>Recent administrative activity</h2>
      ${auditTable(recentAudit)}
      <p><a href="/admin/audit">Full audit log</a></p>
    </section>` : ''}`,
  });
}

function users(ctx, { rows, roles, filters, total, page, perPage }) {
  return adminLayout(ctx, {
    title: 'Users',
    active: '/admin/users',
    body: html`
    <form class="admin-filters" method="get" action="/admin/users">
      <label class="sr-only" for="u-q">Search</label>
      <input id="u-q" type="search" name="q" value="${filters.q || ''}" placeholder="Name, username or email">
      <select name="status" aria-label="Status">
        ${[['', 'Any status'], ['active', 'Active'], ['pending', 'Awaiting approval'], ['revoked', 'Revoked']].map(([v, l]) => html`<option value="${v}" ${filters.status === v ? raw('selected') : ''}>${l}</option>`)}
      </select>
      <select name="role" aria-label="Role">
        <option value="">Any role</option>
        ${roles.map((r) => html`<option value="${r.id}" ${String(filters.role) === String(r.id) ? raw('selected') : ''}>${r.name}</option>`)}
      </select>
      <button class="btn" type="submit">Filter</button>
    </form>
    <p class="muted small">${plural(total, 'user')}</p>
    <div class="table-wrap">
    <table class="data-table">
      <thead><tr><th scope="col">Member</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Joined</th><th scope="col">Last sign-in</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows.map((u) => html`
        <tr>
          <td><span class="inline-user">${ui.avatar(u, 28)}<span><a href="/admin/users/${u.id}"><strong>${u.display_name}</strong></a><br><span class="muted small">@${u.username}, ${u.email}</span></span></span></td>
          <td>${u.role_name}</td>
          <td>${statusPill(u.status)}</td>
          <td class="nowrap">${fmtDate(u.created_at)}</td>
          <td class="nowrap">${u.last_login_at ? time(u.last_login_at) : html`<span class="muted">Never</span>`}</td>
          <td class="nowrap"><a class="btn btn-sm btn-ghost" href="/admin/users/${u.id}">Manage</a></td>
        </tr>`)}</tbody>
    </table>
    </div>
    ${ui.pagination(ctx, { total, page, perPage })}`,
  });
}

function userDetail(ctx, { target: u, roles, canManage, assignable, sessions, tempPassword, mailError, mailReady, auditRows, isLastAdmin }) {
  return adminLayout(ctx, {
    title: u.display_name,
    active: '/admin/users',
    body: html`
    <div class="user-detail-head">
      ${ui.avatar(u, 64)}
      <div>
        <p><strong>@${u.username}</strong> ${statusPill(u.status)}</p>
        ${ui.roleLine(u) ? html`<p>${ui.roleLine(u)}</p>` : ''}
        <p class="muted">${u.email}. Joined ${fmtDate(u.created_at)}. ${u.last_login_at ? html`Last signed in ${time(u.last_login_at)}.` : 'Never signed in.'}</p>
        <p><a href="/u/${u.username}">View profile</a></p>
      </div>
    </div>

    ${tempPassword ? html`
    <div class="callout callout-important temp-password" role="status">
      <p class="callout-title">Temporary password for @${u.username}</p>
      <p><code class="big-code">${tempPassword}</code></p>
      <p>Send it to them privately. It's shown only once, and they'll be asked to choose a new password after signing in.</p>
      ${mailError ? html`<p><strong>The reset email wasn't sent:</strong> ${mailError}</p>` : !mailReady ? html`<p class="small">Set up email under <a href="/admin/settings#email">Site settings</a> and future resets send a link to the member automatically.</p>` : ''}
    </div>` : ''}

    ${!canManage ? html`<div class="callout callout-info"><p class="callout-title">View only</p><p>${ctx.user.id === u.id ? 'You can’t change your own role or access. Ask another admin.' : 'This member’s role has permissions you don’t have, so only an admin can change it.'}</p></div>` : ''}

    ${u.status === 'revoked' ? html`
    <div class="callout callout-danger"><p class="callout-title">Access revoked ${time(u.revoked_at)}${u.revoked_by_name ? ` by ${u.revoked_by_name}` : ''}</p>
      ${u.revoked_reason ? html`<p>Reason: ${u.revoked_reason}</p>` : ''}</div>` : ''}

    ${canManage ? html`
    <div class="admin-cards">
      ${u.status === 'pending' ? html`
      <section class="admin-section">
        <h2>Approve account</h2>
        <p class="muted">They asked to join and can't sign in until approved.</p>
        <form method="post" action="/admin/users/${u.id}/approve" class="inline-form">${ui.csrfField(ctx)}
          <select name="role_id" aria-label="Role to grant">${assignable.map((r) => html`<option value="${r.id}" ${r.id === u.role_id ? raw('selected') : ''}>${r.name}</option>`)}</select>
          <button class="btn btn-primary" type="submit">Approve</button></form>
        <form method="post" action="/admin/users/${u.id}/revoke" class="inline-form">${ui.csrfField(ctx)}<input type="hidden" name="reason" value="Registration declined"><button class="btn btn-ghost btn-danger-text" type="submit">Decline</button></form>
      </section>` : ''}

      <section class="admin-section">
        <h2>Role</h2>
        <form method="post" action="/admin/users/${u.id}/role" class="stack-sm">
          ${ui.csrfField(ctx)}
          <div class="role-options">
            ${roles.map((r) => {
              const allowed = assignable.some((a) => a.id === r.id);
              return html`<label class="role-option ${allowed ? '' : 'is-disabled'}"><input type="radio" name="role_id" value="${r.id}" ${r.id === u.role_id ? raw('checked') : ''} ${allowed ? '' : raw('disabled')}>
                <span><strong>${r.name}</strong><span class="muted small">${r.description}</span></span></label>`;
            })}
          </div>
          ${isLastAdmin ? html`<p class="hint">This is the only active admin, so their role can't change until someone else is an admin.</p>` : ''}
          <div><button class="btn" type="submit" ${isLastAdmin ? raw('disabled') : ''}>Save role</button></div>
        </form>
      </section>

      <section class="admin-section">
        <h2>Access</h2>
        ${u.status === 'revoked' ? html`
          <p>Reinstating restores their previous role. They'll need to sign in again.</p>
          <form method="post" action="/admin/users/${u.id}/reinstate">${ui.csrfField(ctx)}<button class="btn btn-primary" type="submit">Reinstate access</button></form>` : html`
          <p class="muted">Revoking signs them out everywhere and blocks sign-in. Their articles and revisions stay.</p>
          <form method="post" action="/admin/users/${u.id}/revoke" class="stack-sm" data-confirm="Revoke access for @${u.username}? They'll be signed out immediately.">
            ${ui.csrfField(ctx)}
            ${ui.input({ name: 'reason', label: 'Reason (kept in the audit log)', attrs: 'maxlength="300"' })}
            <div><button class="btn btn-danger" type="submit" ${isLastAdmin ? raw('disabled') : ''}>${icon('ban', { size: 16 })}Revoke access</button></div>
          </form>`}
        <hr>
        <h3>Password and sessions</h3>
        <p class="muted small">${plural(sessions.length, 'active session')}</p>
        <div class="btn-row">
          <form method="post" action="/admin/users/${u.id}/reset-password" data-confirm="Reset @${u.username}'s password? Their current password stops working and they're signed out. ${mailReady ? `A reset link is emailed to ${u.email}.` : 'You get a temporary password to pass on.'}">${ui.csrfField(ctx)}<button class="btn" type="submit">${icon('key', { size: 16 })}${mailReady ? 'Reset and email a link' : 'Reset password'}</button></form>
          <form method="post" action="/admin/users/${u.id}/signout">${ui.csrfField(ctx)}<button class="btn btn-ghost" type="submit" ${sessions.length ? '' : raw('disabled')}>Sign out everywhere</button></form>
        </div>
      </section>
    </div>` : ''}

    ${auditRows.length ? html`<section class="admin-section"><h2>History</h2>${auditTable(auditRows)}</section>` : ''}`,
  });
}

function roles(ctx, { roles: list, counts, errors = {}, values = {} }) {
  const groups = [...new Set(PERMISSIONS.map((p) => p.group))];
  return adminLayout(ctx, {
    title: 'Roles and permissions',
    active: '/admin/roles',
    body: html`
    <p class="muted">Admin always has every permission. Changes take effect on each member's next page load.</p>
    <form method="post" action="/admin/roles/permissions" class="perm-form">
      ${ui.csrfField(ctx)}
      <div class="table-wrap">
      <table class="data-table perm-matrix">
        <thead><tr><th scope="col">Permission</th>${list.map((r) => html`<th scope="col" class="perm-col"><span>${r.name}</span><span class="muted small">${plural(counts[r.id] || 0, 'member')}</span></th>`)}</tr></thead>
        ${groups.map((g) => html`
        <tbody>
          <tr class="perm-group"><th scope="rowgroup" colspan="${list.length + 1}">${g}</th></tr>
          ${PERMISSIONS.filter((p) => p.group === g).map((p) => html`
          <tr><th scope="row"><span>${p.label}</span><code class="perm-key">${p.key}</code></th>
            ${list.map((r) => html`<td class="perm-col"><input type="checkbox" name="perm_${r.id}" value="${p.key}" aria-label="${r.name}: ${p.label}"
              ${r.permissions.includes(p.key) ? raw('checked') : ''} ${r.key === 'admin' ? raw('disabled') : ''}></td>`)}</tr>`)}
        </tbody>`)}
      </table>
      </div>
      <div class="sticky-actions"><button class="btn btn-primary" type="submit">Save permissions</button></div>
    </form>

    <div class="admin-cards admin-cards-roles">
      <section class="admin-section">
        <h2>Edit roles</h2>
        <ul class="role-edit-list">${list.map((r) => html`
          <li>
            <form method="post" action="/admin/roles/${r.id}" class="role-edit">
              ${ui.csrfField(ctx)}
              <input name="name" value="${r.name}" aria-label="Role name" maxlength="40" ${r.is_system ? raw('readonly title="Built-in role names are fixed"') : ''}>
              <input name="description" value="${r.description}" aria-label="Description" maxlength="200">
              <button class="btn btn-sm" type="submit">Save</button>
            </form>
            ${!r.is_system ? html`<form method="post" action="/admin/roles/${r.id}/delete" data-confirm="Delete the ${r.name} role? Its ${counts[r.id] || 0} member(s) move to the default role.">${ui.csrfField(ctx)}<button class="btn btn-sm btn-ghost btn-danger-text" type="submit">Delete</button></form>` : html`<span class="muted small">Built-in</span>`}
          </li>`)}</ul>
      </section>
      <section class="admin-section">
        <h2>Add a role</h2>
        <form method="post" action="/admin/roles" class="stack-sm">
          ${ui.csrfField(ctx)}
          ${ui.input({ name: 'name', label: 'Name', value: values.name, errors, required: true, attrs: 'maxlength="40"' })}
          ${ui.input({ name: 'description', label: 'Description', value: values.description, errors, attrs: 'maxlength="200"' })}
          ${ui.select({ name: 'copy_from', label: 'Start with permissions from', value: values.copy_from || '', options: [{ value: '', label: 'No permissions' }, ...list.map((r) => ({ value: r.id, label: r.name }))] })}
          <div><button class="btn" type="submit">Add role</button></div>
        </form>
      </section>
    </div>`,
  });
}

function tags(ctx, { rows, q }) {
  return adminLayout(ctx, {
    title: 'Tags',
    active: '/admin/tags',
    body: html`
    <p class="muted">Rename a tag to fix it everywhere at once. Merge duplicates into the tag you want to keep; articles get the kept tag and the duplicate is removed.</p>
    <form class="admin-filters" method="get"><input type="search" name="q" value="${q || ''}" placeholder="Filter tags" aria-label="Filter tags"><button class="btn" type="submit">Filter</button></form>
    <datalist id="all-tags">${rows.map((t) => html`<option value="${t.name}">`)}</datalist>
    <div class="table-wrap">
    <table class="data-table tag-admin">
      <thead><tr><th scope="col">Tag</th><th scope="col" class="num">Articles</th><th scope="col">Edit</th><th scope="col">Merge into</th><th scope="col"><span class="sr-only">Delete</span></th></tr></thead>
      <tbody>${rows.map((t) => html`
        <tr>
          <td>${ui.tagChip(t)}</td>
          <td class="num">${t.count}</td>
          <td>
            <form method="post" action="/admin/tags/${t.id}" class="tag-edit">${ui.csrfField(ctx)}
              <input name="name" value="${t.name}" aria-label="Tag name" maxlength="48">
              <input type="color" name="color" value="${t.color || ui.colorFor(t.name.split(':')[0])}" aria-label="Color">
              <input name="description" value="${t.description}" placeholder="Description" aria-label="Description" maxlength="200">
              <button class="btn btn-sm" type="submit">Save</button>
            </form>
          </td>
          <td>
            <form method="post" action="/admin/tags/${t.id}/merge" class="tag-edit" data-confirm="Merge “${t.name}” into the tag you entered? This can't be undone.">${ui.csrfField(ctx)}
              <input name="into" list="all-tags" placeholder="Tag to keep" aria-label="Merge ${t.name} into" maxlength="48">
              <button class="btn btn-sm btn-ghost" type="submit">Merge</button>
            </form>
          </td>
          <td><form method="post" action="/admin/tags/${t.id}/delete" data-confirm="Delete “${t.name}”? It's removed from ${t.count} article(s). Revision history keeps the old tag list.">${ui.csrfField(ctx)}
            <button class="icon-btn btn-danger-text" type="submit" aria-label="Delete ${t.name}">${icon('trash', { size: 16 })}</button></form></td>
        </tr>`)}</tbody>
    </table>
    </div>
    ${!rows.length ? ui.emptyState('No tags', 'Tags are created from the article editor.') : ''}`,
  });
}

function spaces(ctx, { rows, errors = {}, values = {} }) {
  const mains = rows.filter((r) => !r.parent_id);
  const ordered = [];
  for (const m of mains) {
    ordered.push(m);
    for (const c of rows.filter((r) => r.parent_id === m.id)) ordered.push(c);
  }
  for (const r of rows) if (!ordered.includes(r)) ordered.push(r);
  const parentSelect = (s, selected) => html`<select name="parent_id" ${s && s.child_count ? raw('disabled title="Has sub-spaces, so it stays a main space"') : ''}>
      <option value="">None (main space)</option>
      ${mains.filter((m) => !s || m.id !== s.id).map((m) => html`<option value="${m.id}" ${String(selected) === String(m.id) ? raw('selected') : ''}>${m.name}</option>`)}
    </select>`;
  return adminLayout(ctx, {
    title: 'Spaces',
    active: '/admin/spaces',
    body: html`
    <p class="muted">Spaces are listed in the navigation on the right of every page. A main space can hold sub-spaces one level deep, and a main space's page also lists the articles in its sub-spaces.</p>
    <ul class="space-admin-list">${ordered.map((s) => html`
      <li style="--space:${s.color}" class="${s.parent_id ? 'is-sub' : ''}">
        <form method="post" action="/admin/spaces/${s.id}" class="space-edit">
          ${ui.csrfField(ctx)}
          <div class="grid-4">
            <label>Name<input name="name" value="${s.name}" maxlength="40" required></label>
            <label>URL<input name="slug" value="${s.slug}" maxlength="40" pattern="[a-z0-9]+(-[a-z0-9]+)*" required></label>
            <label>Order<input name="sort" type="number" value="${s.sort}" min="0" max="999"></label>
            <label>Color<input name="color" type="color" value="${s.color}"></label>
          </div>
          <div class="grid-2">
            <label>Description<input name="description" value="${s.description}" maxlength="200"></label>
            <label>Inside${parentSelect(s, s.parent_id)}${s.child_count ? html`<input type="hidden" name="parent_id" value="">` : ''}</label>
          </div>
          <div class="btn-row"><button class="btn btn-sm" type="submit">Save</button><span class="muted small">${plural(s.count, 'article')}${s.child_count ? `, ${plural(s.child_count, 'sub-space')}` : ''}</span></div>
        </form>
        ${s.count === 0 && !s.child_count ? html`<form method="post" action="/admin/spaces/${s.id}/delete" data-confirm="Delete the ${s.name} space?">${ui.csrfField(ctx)}<button class="btn btn-sm btn-ghost btn-danger-text" type="submit">Delete</button></form>` : ''}
      </li>`)}</ul>
    <section class="admin-section">
      <h2>Add a space</h2>
      <form method="post" action="/admin/spaces" class="stack-sm">
        ${ui.csrfField(ctx)}
        <div class="grid-2">
          ${ui.input({ name: 'name', label: 'Name', value: values.name, errors, required: true, attrs: 'maxlength="40"' })}
          ${ui.input({ name: 'slug', label: 'URL', value: values.slug, errors, hint: 'Lowercase letters, numbers and hyphens. Leave blank to use the name.', attrs: 'maxlength="40"' })}
        </div>
        <div class="grid-2">
          ${ui.input({ name: 'description', label: 'Description', value: values.description, errors, attrs: 'maxlength="200"' })}
          <div class="field ${errors.parent_id ? 'has-error' : ''}"><label for="f-parent">Inside</label>${raw(String(parentSelect(null, values.parent_id)).replace('<select ', '<select id="f-parent" '))}
            <p class="hint">Choose a main space to make this a sub-space of it.</p>${ui.fieldError(errors, 'parent_id')}</div>
        </div>
        <div><button class="btn" type="submit">Add space</button></div>
      </form>
    </section>`,
  });
}

function settings(ctx, { values, roles: roleList, errors = {}, mailReady, detectedUrl }) {
  return adminLayout(ctx, {
    title: 'Site settings',
    active: '/admin/settings',
    body: html`
    <form method="post" action="/admin/settings" class="stack settings-form">
      ${ui.csrfField(ctx)}
      <section class="admin-section">
        <h2>General</h2>
        ${ui.input({ name: 'site_name', label: 'Site name', value: values.site_name, errors, required: true, attrs: 'maxlength="60"' })}
        ${ui.input({ name: 'site_tagline', label: 'Tagline on the home page', value: values.site_tagline, errors, attrs: 'maxlength="160"' })}
        <label class="check"><input type="checkbox" name="require_login" value="1" ${values.require_login === '1' ? raw('checked') : ''}> Only signed-in members can read articles</label>
        <p class="hint">Turn this off to let anyone with the link read published articles. Drafts always stay private.</p>
        ${ui.input({ name: 'site_url', label: 'Public address', value: values.site_url, errors, type: 'url', placeholder: detectedUrl || 'https://wiki.example.com',
          hint: 'The address people use to reach this site. Links in emails point here.' })}
      </section>
      <section class="admin-section">
        <h2>About</h2>
        ${ui.textarea({ name: 'about_text', label: 'About text on the sign-in page', value: values.about_text, errors, rows: 9, attrs: 'maxlength="4000"',
          hint: html`Shown next to the sign-in and sign-up forms, under the tagline. Markdown works; separate paragraphs with a blank line.` })}
      </section>
      <section class="admin-section">
        <h2>Sign-ups</h2>
        <fieldset class="radio-stack">
          <legend>Who can create an account</legend>
          ${[['open', 'Anyone', 'New accounts are active right away.'],
            ['approval', 'Anyone, with approval', 'New accounts wait for an admin or moderator to approve them.'],
            ['closed', 'Nobody', 'The sign-up page is turned off.']].map(([v, l, d]) => html`
            <label class="role-option"><input type="radio" name="registration" value="${v}" ${values.registration === v ? raw('checked') : ''}><span><strong>${l}</strong><span class="muted small">${d}</span></span></label>`)}
        </fieldset>
        ${ui.select({ name: 'default_role', label: 'Role for new accounts', value: values.default_role, errors,
          options: roleList.filter((r) => r.key !== 'admin').map((r) => ({ value: r.key || String(r.id), label: r.name })) })}
        ${ui.input({ name: 'allowed_email_domains', label: 'Allowed email domains', value: values.allowed_email_domains, errors, placeholder: 'example.com, example.org',
          hint: 'Comma separated. Leave blank to allow any address.' })}
      </section>
      <section class="admin-section" id="email">
        <h2>Email</h2>
        <p class="muted">Used for password reset links and account notices. Any SMTP service works. For Gmail or Google Workspace use <code>smtp.gmail.com</code>, port 587, STARTTLS, and an app password.</p>
        <p>${mailReady ? html`<span class="status-pill status-active">Set up</span>` : html`<span class="status-pill status-pending">Not set up</span> <span class="muted small">Until it is, admins reset passwords with a one-time temporary password.</span>`}</p>
        <div class="grid-2">
          ${ui.input({ name: 'smtp_host', label: 'Mail server', value: values.smtp_host, errors, placeholder: 'smtp.example.com', attrs: 'autocomplete="off"' })}
          <div class="grid-2 grid-tight">
            ${ui.input({ name: 'smtp_port', label: 'Port', value: values.smtp_port, errors, type: 'number', attrs: 'min="1" max="65535"' })}
            ${ui.select({ name: 'smtp_security', label: 'Security', value: values.smtp_security, errors, options: [
              { value: 'starttls', label: 'STARTTLS (587)' }, { value: 'tls', label: 'TLS (465)' }, { value: 'none', label: 'None' }] })}
          </div>
          ${ui.input({ name: 'smtp_user', label: 'Username', value: values.smtp_user, errors, attrs: 'autocomplete="off"' })}
          <div class="field">
            <label for="f-smtp_pass">Password</label>
            <input id="f-smtp_pass" name="smtp_pass" type="password" value="" autocomplete="new-password" placeholder="${values.smtp_pass ? 'Saved. Type to replace it.' : ''}">
            ${values.smtp_pass ? html`<label class="check small"><input type="checkbox" name="smtp_pass_clear" value="1"> Remove the saved password</label>` : ''}
          </div>
        </div>
        ${ui.input({ name: 'mail_from', label: 'Send emails from', value: values.mail_from, errors, placeholder: `${values.site_name || 'Beacon'} <wiki@example.com>`,
          hint: 'Most providers require an address on your own domain or the account you sign in with.' })}
      </section>
      <div class="btn-row"><button class="btn btn-primary" type="submit">Save settings</button></div>
    </form>
    <form method="post" action="/admin/settings/test-email" class="test-email">
      ${ui.csrfField(ctx)}
      <button class="btn" type="submit" ${mailReady ? '' : raw('disabled')}>${icon('mail', { size: 16 })}Send a test email to ${ctx.user.email}</button>
      <span class="hint">Save your email settings first.</span>
    </form>`,
  });
}

const ACTION_LABEL = {
  'user.register': 'Registered', 'user.approve': 'Approved account', 'user.role': 'Changed role', 'user.revoke': 'Revoked access',
  'user.reinstate': 'Reinstated access', 'user.reset_password': 'Reset password', 'user.signout': 'Signed out all sessions',
  'user.reset_link': 'Emailed reset link', 'user.password_reset': 'Set new password from link', 'mail.error': 'Email failed',
  'role.create': 'Created role', 'role.update': 'Updated role', 'role.delete': 'Deleted role', 'role.permissions': 'Changed permissions',
  'tag.update': 'Updated tag', 'tag.merge': 'Merged tags', 'tag.delete': 'Deleted tag',
  'space.create': 'Created space', 'space.update': 'Updated space', 'space.delete': 'Deleted space',
  'settings.update': 'Changed settings', 'article.trash': 'Moved article to trash', 'article.recover': 'Recovered article',
  'article.restore': 'Restored revision',
};

function auditTable(rows) {
  return html`<div class="table-wrap"><table class="data-table audit-table">
    <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Details</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr>
      <td class="nowrap">${time(r.created_at)}</td>
      <td class="nowrap">${r.username ? ui.userLink(r.username, r.display_name) : html`<span class="muted">System</span>`}</td>
      <td class="nowrap">${ACTION_LABEL[r.action] || r.action}</td>
      <td>${r.target}</td>
      <td class="small">${r.detail}</td></tr>`)}</tbody></table></div>`;
}

function audit(ctx, { rows, total, page, perPage }) {
  return adminLayout(ctx, {
    title: 'Audit log',
    active: '/admin/audit',
    body: html`<p class="muted">Account, permission, settings and content-recovery actions. Article edits are recorded in each article's revision history.</p>
      ${rows.length ? auditTable(rows) : ui.emptyState('Nothing logged yet')}${ui.pagination(ctx, { total, page, perPage })}`,
  });
}

function trash(ctx, { rows }) {
  return adminLayout(ctx, {
    title: 'Trash',
    active: '/admin/trash',
    body: html`<p class="muted">Articles moved to the trash keep their full revision history until recovered.</p>
    ${rows.length ? html`<div class="table-wrap"><table class="data-table">
      <thead><tr><th scope="col">Article</th><th scope="col">Space</th><th scope="col">Trashed</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows.map((a) => html`<tr><td><strong>${a.title}</strong><br><span class="muted small">/w/${a.slug}</span></td><td>${a.space_name}</td>
        <td class="nowrap">${time(a.deleted_at)}${a.deleted_by_name ? ` by ${a.deleted_by_name}` : ''}</td>
        <td><form method="post" action="/admin/trash/${a.id}/recover">${ui.csrfField(ctx)}<button class="btn btn-sm" type="submit">${icon('restore', { size: 15 })}Recover</button></form></td></tr>`)}</tbody>
    </table></div>` : ui.emptyState('The trash is empty')}`,
  });
}

module.exports = { overview, users, userDetail, roles, tags, spaces, settings, audit, trash };
