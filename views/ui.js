'use strict';
const { html, raw, time, esc } = require('../lib/html');
const { icon, logo, wordmark } = require('../lib/icons');
const { splitTag } = require('../lib/articles');

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------
const PALETTE = ['#D55C13', '#3E7F6E', '#5B6FA8', '#9A7B12', '#A24B6B', '#2F7A8C', '#6E8B3D', '#4F5755'];
function colorFor(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** user-ish object: { avatar, display_name, username } */
function avatar(u, size = 32) {
  const name = (u && (u.display_name || u.username)) || 'Unknown';
  if (u && u.avatar) {
    return html`<img class="avatar" src="/avatars/${u.avatar}" alt="" width="${size}" height="${size}" style="--size:${size}px">`;
  }
  return html`<span class="avatar avatar-initials" style="--size:${size}px;--avatar-bg:${colorFor(u && u.username || name)}" aria-hidden="true">${initials(name)}</span>`;
}

function userLink(username, name) {
  if (!username) return html`<span class="muted">Beacon</span>`;
  return html`<a class="user-link" href="/u/${encodeURIComponent(username)}">${name || username}</a>`;
}

function tagChip(t, { href, removable = false, count } = {}) {
  const { ns, value } = splitTag(t.name);
  const color = t.color || colorFor(ns || t.name);
  const link = href === undefined ? `/tags/${t.slug}` : href;
  const inner = html`<span class="tag-dot" aria-hidden="true"></span>${ns ? html`<span class="tag-ns">${ns}:</span>` : ''}<span class="tag-name">${value}</span>${count !== undefined ? html`<span class="tag-count">${count}</span>` : ''}`;
  if (!link) return html`<span class="tag" style="--tag:${color}">${inner}</span>`;
  return html`<a class="tag" href="${link}" style="--tag:${color}" ${removable ? raw('aria-label="Remove filter ' + esc(t.name) + '"') : ''}>${inner}${removable ? icon('x', { size: 13 }) : ''}</a>`;
}

function tagList(tags) {
  if (!tags || !tags.length) return '';
  return html`<ul class="tag-list">${tags.map((t) => html`<li>${tagChip(t)}</li>`)}</ul>`;
}

function spaceBadge(a) {
  return html`<a class="space-badge" href="/s/${a.space_slug}" style="--space:${a.space_color}">${a.space_name}</a>`;
}

function statusBadge(status) {
  return status === 'draft' ? html`<span class="badge badge-draft">Draft</span>` : '';
}

function csrfField(ctx) {
  return html`<input type="hidden" name="_csrf" value="${ctx.csrf || ''}">`;
}

function fieldError(errors, name) {
  return errors && errors[name] ? html`<p class="field-error" id="${name}-error">${errors[name]}</p>` : '';
}

function input({ name, label, value = '', type = 'text', errors, hint, required, autocomplete, attrs = '', placeholder }) {
  const err = errors && errors[name];
  return html`
    <div class="field ${err ? 'has-error' : ''}">
      <label for="f-${name}">${label}</label>
      <input id="f-${name}" name="${name}" type="${type}" value="${value || ''}" ${required ? raw('required') : ''}
        ${autocomplete ? raw(`autocomplete="${autocomplete}"`) : ''} ${placeholder ? raw(`placeholder="${esc(placeholder)}"`) : ''}
        ${err ? raw(`aria-invalid="true" aria-describedby="${name}-error"`) : ''} ${raw(attrs)}>
      ${hint ? html`<p class="hint">${hint}</p>` : ''}
      ${fieldError(errors, name)}
    </div>`;
}

function textarea({ name, label, value = '', errors, hint, rows = 4, attrs = '' }) {
  const err = errors && errors[name];
  return html`
    <div class="field ${err ? 'has-error' : ''}">
      <label for="f-${name}">${label}</label>
      <textarea id="f-${name}" name="${name}" rows="${rows}" ${err ? raw(`aria-invalid="true" aria-describedby="${name}-error"`) : ''} ${raw(attrs)}>${value || ''}</textarea>
      ${hint ? html`<p class="hint">${hint}</p>` : ''}
      ${fieldError(errors, name)}
    </div>`;
}

function select({ name, label, options, value, errors, hint, attrs = '' }) {
  return html`
    <div class="field ${errors && errors[name] ? 'has-error' : ''}">
      <label for="f-${name}">${label}</label>
      <select id="f-${name}" name="${name}" ${raw(attrs)}>
        ${options.map((o) => html`<option value="${o.value}" ${String(o.value) === String(value) ? raw('selected') : ''} ${o.disabled ? raw('disabled') : ''}>${o.label}</option>`)}
      </select>
      ${hint ? html`<p class="hint">${hint}</p>` : ''}
      ${fieldError(errors, name)}
    </div>`;
}

function pagination(ctx, { total, page, perPage }) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return '';
  const link = (p) => {
    const q = new URLSearchParams(ctx.url.search);
    q.set('page', p);
    return `${ctx.url.pathname}?${q}`;
  };
  return html`<nav class="pagination" aria-label="Pages">
    ${page > 1 ? html`<a class="btn btn-ghost" href="${link(page - 1)}" rel="prev">Previous</a>` : html`<span></span>`}
    <span class="muted">Page ${page} of ${pages}</span>
    ${page < pages ? html`<a class="btn btn-ghost" href="${link(page + 1)}" rel="next">Next</a>` : html`<span></span>`}
  </nav>`;
}

function emptyState(title, body, action) {
  return html`<div class="empty"><p class="empty-title">${title}</p>${body ? html`<p>${body}</p>` : ''}${action || ''}</div>`;
}

/** Row in an article list. */
function articleRow(a, { snippet } = {}) {
  let snip = '';
  if (snippet) {
    snip = raw(esc(snippet).replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>'));
  }
  return html`
    <li class="article-row">
      <div class="article-row-main">
        <a class="article-row-title" href="/w/${a.slug}">${a.title}</a>
        ${statusBadge(a.status)}
        ${a.summary && !snippet ? html`<p class="article-row-summary">${a.summary}</p>` : ''}
        ${snippet ? html`<p class="article-row-summary snippet">${snip}</p>` : ''}
        <div class="article-row-meta">
          ${spaceBadge(a)}
          <span>Updated ${time(a.updated_at)}${a.updated_name ? html` by ${a.updated_name}` : ''}</span>
        </div>
      </div>
      ${a.tags && a.tags.length ? html`<div class="article-row-tags">${tagList(a.tags.slice(0, 6))}</div>` : ''}
    </li>`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
function hasAdminAccess(ctx) {
  return ['users.manage', 'roles.manage', 'settings.manage', 'tags.manage', 'spaces.manage', 'audit.view', 'articles.delete'].some((p) => ctx.can(p));
}

function header(ctx) {
  const u = ctx.user;
  const s = ctx.settings;
  const current = (p) => (ctx.url.pathname === p || ctx.url.pathname.startsWith(p + '/') ? raw('aria-current="page"') : '');
  const readable = ctx.can('articles.read');
  return html`
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="/" aria-label="${s.site_name} home">${logo(30)}${wordmark(s.site_name)}</a>
      ${readable ? html`
      <nav class="main-nav" id="main-nav" aria-label="Main">
        ${ctx.spaces.map((sp) => html`<a href="/s/${sp.slug}" ${current('/s/' + sp.slug)} style="--space:${sp.color}"><span class="space-dot"></span>${sp.name}</a>`)}
        <a href="/tags" ${current('/tags')}>Tags</a>
        <a href="/people" ${current('/people')}>People</a>
      </nav>
      <form class="header-search" action="/search" method="get" role="search">
        ${icon('search', { size: 17 })}
        <input type="search" name="q" placeholder="Search" aria-label="Search the wiki" value="${ctx.url.pathname === '/search' ? ctx.query.q || '' : ''}" autocomplete="off">
        <kbd class="search-kbd" aria-hidden="true">/</kbd>
      </form>` : html`<span class="header-spacer"></span>`}
      <div class="header-actions">
        ${ctx.can('articles.create') ? html`<a class="btn btn-primary btn-sm new-article" href="/new">${icon('plus', { size: 16 })}<span>New article</span></a>` : ''}
        <button type="button" class="icon-btn theme-toggle" data-theme-toggle aria-label="Switch color theme" title="Switch color theme">
          <span class="theme-icon theme-icon-light">${icon('sun')}</span>
          <span class="theme-icon theme-icon-dark">${icon('moon')}</span>
          <span class="theme-icon theme-icon-system">${icon('monitor')}</span>
        </button>
        ${u ? html`
        <div class="menu" data-menu>
          <button type="button" class="menu-trigger" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">
            ${avatar(u, 30)}
          </button>
          <div class="menu-panel" role="menu" hidden>
            <div class="menu-head">
              <strong>${u.display_name}</strong>
              <span class="muted">@${u.username} <span class="role-pill">${u.role_name}</span></span>
            </div>
            <a role="menuitem" href="/u/${u.username}">${icon('user')}Your profile</a>
            <a role="menuitem" href="/account">${icon('sliders')}Account settings</a>
            ${hasAdminAccess(ctx) ? html`<a role="menuitem" href="/admin">${icon('shield')}Administration</a>` : ''}
            <form method="post" action="/logout">${csrfField(ctx)}<button role="menuitem" type="submit">${icon('logout')}Sign out</button></form>
          </div>
        </div>` : html`
        <a class="btn btn-ghost btn-sm" href="/login">Sign in</a>
        ${s.registration !== 'closed' ? html`<a class="btn btn-sm" href="/register">Create account</a>` : ''}`}
        ${readable ? html`<button type="button" class="icon-btn nav-toggle" data-nav-toggle aria-controls="main-nav" aria-expanded="false" aria-label="Menu">${icon('menu')}</button>` : ''}
      </div>
    </div>
  </header>`;
}

function flashes(ctx) {
  if (!ctx.flash || !ctx.flash.length) return '';
  return html`<div class="flash-stack" role="status">${ctx.flash.map((f) => html`
    <div class="flash flash-${f.type}">${icon(f.type === 'error' ? 'info' : 'check', { size: 17 })}<span>${f.message}</span>
      <button type="button" class="flash-close" aria-label="Dismiss">${icon('x', { size: 15 })}</button></div>`)}</div>`;
}

function layout(ctx, { title, body, bodyClass = '', scripts = [], wide = false }) {
  const s = ctx.settings;
  const v = ctx.assetVersion;
  const fullTitle = title ? `${title} – ${s.site_name}` : s.site_name;
  return '<!doctype html>' + html`
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fullTitle}</title>
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#EDEFEC" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#161A1A" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml">
  <script src="/static/js/theme.js?v=${v}"></script>
  <link rel="stylesheet" href="/static/css/app.css?v=${v}">
</head>
<body class="${bodyClass}">
  <a class="skip-link" href="#main">Skip to content</a>
  ${header(ctx)}
  ${flashes(ctx)}
  <main id="main" class="${wide ? 'main main-wide' : 'main'}">
    ${body}
  </main>
  <footer class="site-footer">
    <span>${s.site_name}</span>
    ${ctx.user ? html`<a href="/help/markdown">Formatting guide</a>` : ''}
  </footer>
  <script src="/static/js/app.js?v=${v}" defer></script>
  ${scripts.map((src) => html`<script src="${src}?v=${v}" defer></script>`)}
</body>
</html>`;
}

/** Narrow centered page used for sign-in, registration and messages. */
function authLayout(ctx, { title, body }) {
  return layout(ctx, { title, bodyClass: 'auth-page', body: html`<div class="auth-wrap"><div class="auth-brand">${logo(44)}${wordmark(ctx.settings.site_name)}</div>${body}</div>` });
}

module.exports = {
  layout, authLayout, avatar, userLink, tagChip, tagList, spaceBadge, statusBadge, csrfField,
  input, textarea, select, fieldError, pagination, emptyState, articleRow, colorFor, hasAdminAccess, icon,
};
