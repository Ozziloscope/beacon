'use strict';
const { html, raw, time, fmtDate, plural, fmtBytes } = require('../lib/html');
const ui = require('./ui');
const { icon } = require('../lib/icons');

const KIND_LABEL = { create: 'Created', edit: 'Edited', publish: 'Published', unpublish: 'Unpublished', restore: 'Restored' };

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
function greeting(name) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name.split(' ')[0]}` : part;
}

function home(ctx, { spaces, changes, topTags, counts }) {
  const body = html`
  <section class="home-hero">
    <h1>${ctx.user ? greeting(ctx.user.display_name) : ctx.settings.site_name}</h1>
    <p class="lede">${ctx.settings.site_tagline}</p>
    <form class="hero-search" action="/search" method="get" role="search">
      ${icon('search', { size: 20 })}
      <input type="search" name="q" placeholder="Search ${plural(counts.articles, 'article')}" aria-label="Search the wiki" autofocus>
      <button class="btn btn-primary" type="submit">Search</button>
    </form>
    <p class="hint">Use quotes for exact phrases and a minus sign to exclude words, like <code>"bmc reset" -dell</code>.</p>
  </section>

  <div class="home-grid">
    <section class="home-spaces" aria-labelledby="spaces-h">
      <h2 id="spaces-h" class="section-title">Spaces</h2>
      ${spaces.map((sp) => html`
      <div class="space-panel" style="--space:${sp.color}">
        <div class="space-panel-head">
          <a href="/s/${sp.slug}"><h3>${sp.name}</h3></a>
          <span class="muted">${plural(sp.count, 'article')}</span>
        </div>
        ${sp.description ? html`<p class="muted">${sp.description}</p>` : ''}
        ${sp.recent.length ? html`<ul class="space-recent">${sp.recent.map((a) => html`
          <li><a href="/w/${a.slug}">${a.title}</a>${ui.statusBadge(a.status)}<span class="muted">${time(a.updated_at)}</span></li>`)}
        </ul>` : html`<p class="muted small">Nothing here yet.${ctx.can('articles.create') ? html` <a href="/new?space=${sp.slug}">Write the first article</a>.` : ''}</p>`}
      </div>`)}
      ${topTags.length ? html`
      <h2 class="section-title">Popular tags</h2>
      ${ui.tagList(topTags)}
      <p><a class="small" href="/tags">All tags</a></p>` : ''}
    </section>

    <section class="home-changes" aria-labelledby="changes-h">
      <h2 id="changes-h" class="section-title">Recent changes</h2>
      ${changes.length ? html`<ol class="changes">${changes.map((c) => html`
        <li class="change">
          ${ui.avatar(c, 28)}
          <div>
            <p class="change-line"><a href="/w/${c.slug}">${c.title}</a> ${ui.statusBadge(c.status)}</p>
            <p class="change-note">${c.note}</p>
            <p class="change-meta muted">${KIND_LABEL[c.kind] || 'Edited'} by ${c.display_name || 'Beacon'} ${time(c.created_at)}, <a href="/w/${c.slug}/rev/${c.rev}">revision ${c.rev}</a></p>
          </div>
        </li>`)}</ol>` : ui.emptyState('No changes yet', 'Every save shows up here with its revision note.',
        ctx.can('articles.create') ? html`<a class="btn btn-primary" href="/new">${icon('plus', { size: 16 })}New article</a>` : '')}
    </section>
  </div>`;
  return ui.layout(ctx, { body, bodyClass: 'home' });
}

// ---------------------------------------------------------------------------
// Article
// ---------------------------------------------------------------------------
function toc(entries) {
  if (entries.length < 3) return '';
  return html`
  <aside class="toc" data-toc aria-label="Table of contents">
    <div class="toc-inner">
      <p class="toc-title">On this page</p>
      <div class="toc-body">
        <div class="toc-rail" aria-hidden="true"><div class="toc-progress"></div></div>
        <ol class="toc-list">
          ${entries.map((e) => html`<li class="toc-l${e.level}"><a href="#${e.id}" data-toc-link="${e.id}">${e.text}</a></li>`)}
        </ol>
      </div>
      <a class="toc-top" href="#top">Back to top</a>
    </div>
  </aside>
  <button type="button" class="toc-fab" data-toc-open aria-label="Show table of contents">${icon('toc', { size: 20 })}<span>Contents</span></button>`;
}

function articleView(ctx, { article: a, rendered, lastRev, backlinks, canEdit }) {
  const hasToc = rendered.toc.length >= 3;
  const body = html`
  <div class="article-layout ${hasToc ? 'has-toc' : ''}" id="top">
    <article class="article">
      <header class="article-head">
        <div class="article-crumbs">${ui.spaceBadge(a)} ${ui.statusBadge(a.status)}</div>
        <h1 class="article-title">${a.title}</h1>
        ${a.summary ? html`<p class="lede">${a.summary}</p>` : ''}
        <div class="article-meta">
          ${ui.avatar({ avatar: a.updated_avatar, display_name: a.updated_name, username: a.updated_username }, 30)}
          <div class="article-meta-text">
            <p>Updated ${time(a.updated_at)} by ${ui.userLink(a.updated_username, a.updated_name)}</p>
            ${lastRev ? html`<p class="muted article-note" title="Revision note">“${lastRev.note}”</p>` : ''}
          </div>
          <div class="article-actions">
            ${canEdit ? html`<a class="btn btn-sm" href="/w/${a.slug}/edit">${icon('edit', { size: 16 })}Edit</a>` : ''}
            <a class="btn btn-sm btn-ghost" href="/w/${a.slug}/history">${icon('history', { size: 16 })}${plural(a.current_rev, 'revision')}</a>
            ${ctx.can('articles.delete') ? html`
            <form method="post" action="/w/${a.slug}/delete" data-confirm="Move “${a.title}” to the trash? Admins and moderators can recover it from Administration.">
              ${ui.csrfField(ctx)}<button class="btn btn-sm btn-ghost btn-danger-text" type="submit" aria-label="Move to trash" title="Move to trash">${icon('trash', { size: 16 })}</button>
            </form>` : ''}
          </div>
        </div>
        ${ui.tagList(a.tags)}
      </header>
      <div class="prose" data-prose>${raw(rendered.html)}</div>
      <footer class="article-foot">
        ${backlinks.length ? html`
        <section class="backlinks">
          <h2 class="section-title">Linked from</h2>
          <ul>${backlinks.map((b) => html`<li><a href="/w/${b.slug}">${b.title}</a></li>`)}</ul>
        </section>` : ''}
        <p class="muted small">Created ${fmtDate(a.created_at)} by ${ui.userLink(a.author_username, a.author_name)}.</p>
      </footer>
    </article>
    ${hasToc ? toc(rendered.toc) : ''}
  </div>
  <div class="lightbox" data-lightbox hidden><img alt=""><p class="lightbox-caption"></p></div>`;
  return ui.layout(ctx, { title: a.title, body, wide: true });
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
const TOOLBAR = [
  ['heading', 'heading', 'Heading'],
  ['bold', 'bold', 'Bold (Ctrl+B)'],
  ['italic', 'italic', 'Italic (Ctrl+I)'],
  ['link', 'link', 'Link (Ctrl+K)'],
  ['code', 'code', 'Code'],
  '|',
  ['list', 'ul', 'Bulleted list'],
  ['listOrdered', 'ol', 'Numbered list'],
  ['check', 'task', 'Checklist'],
  ['quote', 'quote', 'Quote'],
  ['info', 'callout', 'Callout'],
  ['table', 'table', 'Table'],
  '|',
  ['image', 'image', 'Add photos'],
];

function editor(ctx, { article, fields, errors = {}, spaces, isNew }) {
  const f = fields;
  const action = isNew ? '/new' : `/w/${article.slug}/edit`;
  const allErrors = Object.values(errors);
  const draftKey = isNew ? 'new' : `a${article.id}`;
  const body = html`
  <form class="editor" method="post" action="${action}" data-editor data-draft-key="${draftKey}" data-can-upload="${ctx.can('uploads.create') ? '1' : '0'}" novalidate>
    ${ui.csrfField(ctx)}
    ${!isNew ? html`<input type="hidden" name="base_rev" value="${f.base_rev || article.current_rev}">` : ''}

    <div class="editor-head">
      <p class="muted small">${isNew ? 'New article' : html`Editing <a href="/w/${article.slug}">${article.title}</a>, revision ${article.current_rev}`}</p>
      ${allErrors.length ? html`<div class="form-errors" role="alert"><strong>Fix ${plural(allErrors.length, 'problem')} before saving:</strong><ul>${allErrors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
      <label class="sr-only" for="f-title">Title</label>
      <input class="title-input" id="f-title" name="title" value="${f.title || ''}" placeholder="Article title" maxlength="200" required ${errors.title ? raw('aria-invalid="true"') : ''}>
      <label class="sr-only" for="f-summary">Summary</label>
      <input class="summary-input" id="f-summary" name="summary" value="${f.summary || ''}" placeholder="One-line summary shown in lists and search (optional)" maxlength="300">
    </div>

    <div class="editor-meta">
      ${ui.select({ name: 'space_id', label: 'Space', value: f.spaceId, errors, options: spaces.map((s) => ({ value: s.id, label: s.name })) })}
      <div class="field field-tags ${errors.tags ? 'has-error' : ''}">
        <label for="f-tag-entry">Tags</label>
        <div class="tag-input" data-tag-input data-can-create="${ctx.can('tags.create') ? '1' : '0'}">
          <ul class="tag-input-chips" data-chips></ul>
          <input id="f-tag-entry" type="text" autocomplete="off" placeholder="Add a tag" aria-describedby="tags-hint" role="combobox" aria-expanded="false" aria-controls="tag-suggest" aria-autocomplete="list">
          <ul class="tag-suggest" id="tag-suggest" role="listbox" hidden></ul>
          <input type="hidden" name="tags" value="${(f.tags || []).join(',')}">
        </div>
        <p class="hint" id="tags-hint">Press Enter or comma to add. Group related tags with a prefix, like <code>vendor:dell</code> or <code>os:debian</code>.</p>
        ${ui.fieldError(errors, 'tags')}
      </div>
      <details class="field field-slug" ${errors.slug ? raw('open') : ''}>
        <summary>${isNew ? 'Set a custom URL' : 'Change URL'}</summary>
        <div class="slug-row"><span class="muted">/w/</span><input name="slug" value="${f.slug || ''}" placeholder="${isNew ? 'generated from the title' : article.slug}" pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-label="URL slug"></div>
        <p class="hint">${isNew ? 'Leave blank to use the title.' : 'Changing it keeps the old link working as a redirect.'}</p>
        ${ui.fieldError(errors, 'slug')}
      </details>
    </div>

    <div class="editor-shell" data-mode="split">
      <div class="editor-toolbar" role="toolbar" aria-label="Formatting">
        <div class="toolbar-group">
          ${TOOLBAR.map((t) => (t === '|' ? html`<span class="toolbar-sep" aria-hidden="true"></span>` :
            html`<button type="button" class="icon-btn" data-cmd="${t[1]}" title="${t[2]}" aria-label="${t[2]}">${icon(t[0], { size: 17 })}</button>`))}
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden data-file-input>
        </div>
        <div class="mode-switch" role="tablist" aria-label="Editor view">
          <button type="button" role="tab" data-mode-btn="write">Write</button>
          <button type="button" role="tab" data-mode-btn="split" class="split-only">Split</button>
          <button type="button" role="tab" data-mode-btn="preview">Preview</button>
        </div>
      </div>
      <div class="editor-panes">
        <div class="editor-write">
          <label class="sr-only" for="f-content">Content (Markdown)</label>
          <textarea id="f-content" name="content" spellcheck="true" data-content placeholder="Write in Markdown. Paste or drop photos anywhere here.">${f.content || ''}</textarea>
          <div class="drop-overlay" data-drop-overlay hidden>${icon('upload', { size: 28 })}<span>Drop photos to upload</span></div>
        </div>
        <div class="editor-preview prose" data-preview aria-live="off"></div>
      </div>
      <div class="editor-status">
        <span data-word-count>0 words</span>
        <span data-upload-status></span>
        <span class="muted">${ctx.can('uploads.create') ? 'Paste, drop or use the photo button to add images.' : ''} <a href="/help/markdown" target="_blank" rel="noopener">Formatting guide</a></span>
      </div>
      ${ui.fieldError(errors, 'content')}
    </div>

    <div class="publish-bar">
      <div class="publish-inner">
        <div class="field note-field ${errors.note ? 'has-error' : ''}">
          <label for="f-note">Revision note <span class="req">required</span></label>
          <input id="f-note" name="note" value="${f.note || ''}" required minlength="3" maxlength="500"
            placeholder="${isNew ? 'e.g. First draft of the PSU replacement runbook' : 'What changed, and why?'}" ${errors.note ? raw('aria-invalid="true" aria-describedby="note-error"') : ''}>
          ${ui.fieldError(errors, 'note')}
        </div>
        <fieldset class="status-choice">
          <legend class="sr-only">Visibility</legend>
          <label><input type="radio" name="status" value="published" ${f.status !== 'draft' ? raw('checked') : ''}> Published</label>
          <label><input type="radio" name="status" value="draft" ${f.status === 'draft' ? raw('checked') : ''}> Draft</label>
        </fieldset>
        <div class="publish-actions">
          <a class="btn btn-ghost" href="${isNew ? '/' : `/w/${article.slug}`}" data-cancel>Cancel</a>
          <button class="btn btn-primary" type="submit" data-save>${isNew ? 'Save article' : 'Save revision'}</button>
        </div>
      </div>
    </div>
  </form>`;
  return ui.layout(ctx, {
    title: isNew ? 'New article' : `Edit ${article.title}`,
    body,
    bodyClass: 'editing',
    wide: true,
    scripts: ['/static/js/markdown.js', '/static/js/editor.js'],
  });
}

// ---------------------------------------------------------------------------
// History, revisions and diffs
// ---------------------------------------------------------------------------
function history(ctx, { article: a, revisions }) {
  const body = html`
  <div class="page-head">
    <p class="muted small"><a href="/w/${a.slug}">${a.title}</a></p>
    <h1>Revision history</h1>
    <p class="muted">${plural(revisions.length, 'revision')}. Pick two to compare, or open one to read it as it was.</p>
  </div>
  <form method="get" action="/w/${a.slug}/diff" class="history-form">
    <div class="table-wrap">
    <table class="data-table history-table">
      <thead><tr><th scope="col" class="cmp">From</th><th scope="col" class="cmp">To</th><th scope="col">Revision</th><th scope="col">Note</th><th scope="col">Author</th><th scope="col" class="num">Size</th></tr></thead>
      <tbody>
      ${revisions.map((r, i) => {
        const prev = revisions[i + 1];
        const delta = prev ? r.size - prev.size : r.size;
        return html`
        <tr class="${r.rev === a.current_rev ? 'is-current' : ''}">
          <td class="cmp"><input type="radio" name="from" value="${r.rev}" aria-label="Compare from revision ${r.rev}" ${i === 1 ? raw('checked') : ''}></td>
          <td class="cmp"><input type="radio" name="to" value="${r.rev}" aria-label="Compare to revision ${r.rev}" ${i === 0 ? raw('checked') : ''}></td>
          <td class="nowrap">
            <a href="/w/${a.slug}/rev/${r.rev}"><strong>${r.rev}</strong></a>
            <span class="kind kind-${r.kind}">${KIND_LABEL[r.kind] || r.kind}${r.restored_from ? ` from ${r.restored_from}` : ''}</span>
            ${r.rev === a.current_rev ? html`<span class="badge">Current</span>` : ''}
            <div class="muted small">${time(r.created_at)}</div>
          </td>
          <td class="note-cell">${r.note}</td>
          <td class="nowrap"><span class="inline-user">${ui.avatar(r, 22)}${ui.userLink(r.username, r.display_name)}</span></td>
          <td class="num nowrap"><span title="${fmtBytes(r.size)}">${fmtBytes(r.size)}</span>
            ${prev ? html`<div class="small ${delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'muted'}">${delta > 0 ? '+' : ''}${delta === 0 ? '±0' : delta}</div>` : ''}</td>
        </tr>`;
      })}
      </tbody>
    </table>
    </div>
    ${revisions.length > 1 ? html`<p><button class="btn" type="submit">${icon('diff', { size: 16 })}Compare selected</button></p>` : ''}
  </form>`;
  return ui.layout(ctx, { title: `History of ${a.title}`, body });
}

function revisionView(ctx, { article: a, revision: r, rendered, canRestore, total }) {
  const isCurrent = r.rev === a.current_rev;
  const body = html`
  <div class="rev-banner ${isCurrent ? 'is-current' : ''}">
    <div>
      <p><strong>Revision ${r.rev} of ${total}</strong>, ${KIND_LABEL[r.kind] ? KIND_LABEL[r.kind].toLowerCase() : 'edited'} ${time(r.created_at)} by ${ui.userLink(r.username, r.display_name)}${isCurrent ? ' (current version)' : ''}</p>
      <p class="rev-note">“${r.note}”</p>
    </div>
    <div class="rev-actions">
      ${r.rev > 1 ? html`<a class="btn btn-sm btn-ghost" href="/w/${a.slug}/diff?from=${r.rev - 1}&to=${r.rev}">Changes in this revision</a>` : ''}
      ${!isCurrent ? html`<a class="btn btn-sm btn-ghost" href="/w/${a.slug}/diff?from=${r.rev}&to=${a.current_rev}">Compare with current</a>` : ''}
      <a class="btn btn-sm btn-ghost" href="/w/${a.slug}/history">All revisions</a>
    </div>
  </div>
  ${!isCurrent && canRestore ? html`
  <form class="restore-form" method="post" action="/w/${a.slug}/restore/${r.rev}">
    ${ui.csrfField(ctx)}
    <label for="f-restore-note">Restore this version as a new revision</label>
    <div class="inline-form">
      <input id="f-restore-note" name="note" required minlength="3" maxlength="500" placeholder="Why restore revision ${r.rev}?" value="Restore revision ${r.rev}: ">
      <button class="btn" type="submit">${icon('restore', { size: 16 })}Restore</button>
    </div>
  </form>` : ''}
  <article class="article article-revision">
    <header class="article-head">
      <h1 class="article-title">${r.title}</h1>
      ${r.summary ? html`<p class="lede">${r.summary}</p>` : ''}
      ${r.tags.length ? html`<ul class="tag-list">${r.tags.map((name) => html`<li>${ui.tagChip({ name, color: '' }, { href: null })}</li>`)}</ul>` : ''}
    </header>
    <div class="prose">${raw(rendered.html)}</div>
  </article>`;
  return ui.layout(ctx, { title: `${a.title} (revision ${r.rev})`, body });
}

function diffView(ctx, { article: a, from, to, revisions, hunks, stats }) {
  const metaRows = [];
  if (from.title !== to.title) metaRows.push(['Title', from.title, to.title]);
  if (from.summary !== to.summary) metaRows.push(['Summary', from.summary || '(none)', to.summary || '(none)']);
  if (from.status !== to.status) metaRows.push(['Status', from.status, to.status]);
  if (from.space_name !== to.space_name) metaRows.push(['Space', from.space_name, to.space_name]);
  const ft = from.tags.join(', '), tt = to.tags.join(', ');
  if (ft !== tt) metaRows.push(['Tags', ft || '(none)', tt || '(none)']);

  const revOptions = (sel) => revisions.map((r) => html`<option value="${r.rev}" ${r.rev === sel ? raw('selected') : ''}>Revision ${r.rev}: ${r.note.length > 60 ? r.note.slice(0, 57) + '…' : r.note}</option>`);

  const body = html`
  <div class="page-head">
    <p class="muted small"><a href="/w/${a.slug}">${a.title}</a> / <a href="/w/${a.slug}/history">History</a></p>
    <h1>Compare revisions</h1>
  </div>
  <form class="diff-picker" method="get" action="/w/${a.slug}/diff">
    <label>From <select name="from">${revOptions(from.rev)}</select></label>
    <label>To <select name="to">${revOptions(to.rev)}</select></label>
    <button class="btn btn-sm" type="submit">Compare</button>
  </form>
  <div class="diff-sides">
    <div class="diff-side diff-side-from"><p><strong>Revision ${from.rev}</strong> by ${from.display_name || 'Beacon'}, ${time(from.created_at)}</p><p class="rev-note">“${from.note}”</p></div>
    <div class="diff-side diff-side-to"><p><strong>Revision ${to.rev}</strong> by ${to.display_name || 'Beacon'}, ${time(to.created_at)}</p><p class="rev-note">“${to.note}”</p></div>
  </div>
  ${metaRows.length ? html`
  <table class="data-table meta-diff"><thead><tr><th scope="col">Field</th><th scope="col">Revision ${from.rev}</th><th scope="col">Revision ${to.rev}</th></tr></thead>
    <tbody>${metaRows.map((m) => html`<tr><th scope="row">${m[0]}</th><td><del>${m[1]}</del></td><td><ins>${m[2]}</ins></td></tr>`)}</tbody></table>` : ''}
  <p class="diff-stats"><span class="delta-up">+${stats.added}</span> <span class="delta-down">−${stats.removed}</span> lines</p>
  ${stats.added + stats.removed === 0 ? ui.emptyState('No text changes', metaRows.length ? 'Only the details above changed.' : 'These two revisions have identical content.') : html`
  <div class="diff" role="table" aria-label="Line changes">
    ${hunks.map((h) => (h.type === 'skip'
      ? html`<div class="diff-skip" role="row"><span role="cell">${plural(h.count, 'unchanged line')}</span></div>`
      : h.ops.map((op) => html`<div class="diff-line diff-${op.type === '+' ? 'add' : op.type === '-' ? 'del' : 'eq'}" role="row">
          <span class="ln" role="cell">${op.a || ''}</span><span class="ln" role="cell">${op.b || ''}</span>
          <span class="sign" role="cell" aria-label="${op.type === '+' ? 'added' : op.type === '-' ? 'removed' : 'unchanged'}">${op.type === '=' ? ' ' : op.type === '-' ? '−' : '+'}</span>
          <code role="cell">${op.text || ' '}</code></div>`)))}
  </div>`}`;
  return ui.layout(ctx, { title: `Compare revisions of ${a.title}`, body, wide: true });
}

// ---------------------------------------------------------------------------
// Browsing, tags and search
// ---------------------------------------------------------------------------
function filterPanel(ctx, { base, spaces, activeTags, related, filters, showSpaces }) {
  const qs = (patch) => {
    const q = new URLSearchParams();
    const merged = { ...filters, ...patch };
    if (merged.space && showSpaces) q.set('space', merged.space);
    if (merged.tags && merged.tags.length) q.set('tags', merged.tags.join(','));
    if (merged.sort && merged.sort !== 'updated') q.set('sort', merged.sort);
    if (merged.status) q.set('status', merged.status);
    if (merged.q) q.set('q', merged.q);
    const s = q.toString();
    return base + (s ? `?${s}` : '');
  };
  const tagSlugs = activeTags.map((t) => t.slug);
  return html`
  <aside class="filters" aria-label="Filters">
    ${activeTags.length ? html`
    <div class="filter-group">
      <p class="filter-title">Showing articles tagged</p>
      <ul class="tag-list">${activeTags.map((t) => html`<li>${ui.tagChip(t, { href: qs({ tags: tagSlugs.filter((s) => s !== t.slug) }), removable: true })}</li>`)}</ul>
      <a class="small" href="${qs({ tags: [] })}">Clear tags</a>
    </div>` : ''}
    ${related.length ? html`
    <div class="filter-group">
      <p class="filter-title">${activeTags.length ? 'Narrow further' : 'Filter by tag'}</p>
      <ul class="tag-list">${related.map((t) => html`<li>${ui.tagChip(t, { href: qs({ tags: [...tagSlugs, t.slug] }), count: t.count })}</li>`)}</ul>
    </div>` : ''}
    ${showSpaces ? html`
    <div class="filter-group">
      <p class="filter-title">Space</p>
      <ul class="filter-links">
        <li><a href="${qs({ space: '' })}" ${!filters.space ? raw('aria-current="true"') : ''}>All spaces</a></li>
        ${spaces.map((s) => html`<li><a href="${qs({ space: s.slug })}" ${filters.space === s.slug ? raw('aria-current="true"') : ''}><span class="space-dot" style="--space:${s.color}"></span>${s.name}</a></li>`)}
      </ul>
    </div>` : ''}
    <div class="filter-group">
      <p class="filter-title">Sort</p>
      <ul class="filter-links">
        ${[['updated', 'Recently updated'], ['created', 'Newest'], ['title', 'Title A–Z']].map(([k, label]) => html`<li><a href="${qs({ sort: k })}" ${(filters.sort || 'updated') === k ? raw('aria-current="true"') : ''}>${label}</a></li>`)}
      </ul>
    </div>
    ${ctx.user ? html`
    <div class="filter-group">
      <p class="filter-title">Status</p>
      <ul class="filter-links">
        ${[['', 'Any'], ['published', 'Published'], ['draft', 'Drafts']].map(([k, label]) => html`<li><a href="${qs({ status: k })}" ${(filters.status || '') === k ? raw('aria-current="true"') : ''}>${label}</a></li>`)}
      </ul>
    </div>` : ''}
  </aside>`;
}

function browse(ctx, { heading, intro, accent, base, rows, total, page, perPage, spaces, activeTags, related, filters, showSpaces = true, newHref, extraHead }) {
  const body = html`
  <div class="page-head" ${accent ? raw(`style="--space:${accent}"`) : ''}>
    <div class="page-head-row">
      <div>
        <h1 class="${accent ? 'space-title' : ''}">${heading}</h1>
        ${intro ? html`<p class="muted">${intro}</p>` : ''}
      </div>
      ${newHref && ctx.can('articles.create') ? html`<a class="btn btn-primary" href="${newHref}">${icon('plus', { size: 16 })}New article</a>` : ''}
    </div>
    ${extraHead || ''}
  </div>
  <div class="browse">
    ${filterPanel(ctx, { base, spaces, activeTags, related, filters, showSpaces })}
    <section class="browse-results" aria-live="polite">
      <p class="muted small">${plural(total, 'article')}</p>
      ${rows.length ? html`<ul class="article-list">${rows.map((a) => ui.articleRow(a))}</ul>` :
        ui.emptyState('No articles match', activeTags.length ? 'Remove a tag filter to see more.' : 'Nothing has been written here yet.')}
      ${ui.pagination(ctx, { total, page, perPage })}
    </section>
  </div>`;
  return ui.layout(ctx, { title: typeof heading === 'string' ? heading : 'Articles', body, wide: true });
}

function tagsIndex(ctx, { groups, total }) {
  const body = html`
  <div class="page-head">
    <div class="page-head-row">
      <div><h1>Tags</h1><p class="muted">${plural(total, 'tag')}. Open a tag to see its articles, then add more tags to narrow the list.</p></div>
      ${ctx.can('tags.manage') ? html`<a class="btn" href="/admin/tags">${icon('sliders', { size: 16 })}Manage tags</a>` : ''}
    </div>
    <div class="field tag-filter"><label for="tag-filter" class="sr-only">Filter tags</label><input id="tag-filter" type="search" placeholder="Filter tags" data-tag-filter></div>
  </div>
  ${groups.length ? html`<div class="tag-groups">${groups.map((g) => html`
    <section class="tag-group" data-tag-group>
      <h2 class="section-title">${g.ns ? g.ns : 'General'}</h2>
      <ul class="tag-list">${g.tags.map((t) => html`<li data-tag-name="${t.name}">${ui.tagChip(t, { count: t.count })}</li>`)}</ul>
    </section>`)}</div>` : ui.emptyState('No tags yet', 'Tags appear here once articles use them.')}`;
  return ui.layout(ctx, { title: 'Tags', body });
}

function searchPage(ctx, { q, rows, total, page, perPage, spaces, filters }) {
  const qs = (patch) => {
    const p = new URLSearchParams({ q, ...(filters.space ? { space: filters.space } : {}), ...patch });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    return `/search?${p}`;
  };
  const body = html`
  <div class="page-head">
    <h1>Search</h1>
    <form class="hero-search hero-search-sm" action="/search" method="get" role="search">
      ${icon('search', { size: 18 })}
      <input type="search" name="q" value="${q}" aria-label="Search the wiki" autofocus>
      ${filters.space ? html`<input type="hidden" name="space" value="${filters.space}">` : ''}
      <button class="btn btn-primary" type="submit">Search</button>
    </form>
    <ul class="filter-pills">
      <li><a href="${qs({ space: '' })}" ${!filters.space ? raw('aria-current="true"') : ''}>All spaces</a></li>
      ${spaces.map((s) => html`<li><a href="${qs({ space: s.slug })}" ${filters.space === s.slug ? raw('aria-current="true"') : ''}><span class="space-dot" style="--space:${s.color}"></span>${s.name}</a></li>`)}
    </ul>
  </div>
  ${q ? html`
    <p class="muted small">${plural(total, 'result')} for “${q}”</p>
    ${rows.length ? html`<ul class="article-list">${rows.map((a) => ui.articleRow(a, { snippet: a.snippet }))}</ul>` :
      ui.emptyState('No matches', 'Try fewer or different words. Search matches word beginnings, so "virt" finds "virtualization".',
        ctx.can('articles.create') ? html`<a class="btn" href="/new?title=${encodeURIComponent(q)}">Write “${q}”</a>` : '')}
    ${ui.pagination(ctx, { total, page, perPage })}` : ui.emptyState('Search titles, summaries, tags and article text', 'Results are ranked with titles and tags weighted highest.')}`;
  return ui.layout(ctx, { title: q ? `Search: ${q}` : 'Search', body });
}

function markdownHelp(ctx, { rendered, source }) {
  const body = html`
  <div class="article-layout has-toc" id="top">
    <article class="article">
      <header class="article-head"><h1 class="article-title">Formatting guide</h1>
        <p class="lede">Beacon articles are written in Markdown. Each example below shows the source, then the result.</p></header>
      <div class="prose">${raw(rendered.html)}</div>
    </article>
    ${toc(rendered.toc)}
  </div>`;
  return ui.layout(ctx, { title: 'Formatting guide', body, wide: true });
}

module.exports = { home, articleView, editor, history, revisionView, diffView, browse, tagsIndex, searchPage, markdownHelp, KIND_LABEL };
