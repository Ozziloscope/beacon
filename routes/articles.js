'use strict';
const md = require('../public/js/markdown');
const { get, all } = require('../lib/db');
const A = require('../lib/articles');
const { diffLines, hunks, stats } = require('../lib/diff');
const { HttpError } = require('../lib/http');
const views = require('../views/articles');
const guide = require('../lib/guide');

const PER_PAGE = 25;

function spacesWithCounts(user) {
  const vis = A.visibility(user);
  return all(`SELECT s.*, (SELECT COUNT(*) FROM articles a WHERE a.space_id = s.id AND ${vis.sql}) AS count
              FROM spaces s ORDER BY s.sort, s.name`, ...vis.params);
}

function loadVisible(ctx, slug) {
  const a = A.getArticle(slug);
  if (a && A.canSee(ctx.user, a)) return a;
  if (!a) {
    const target = A.redirectFor(slug);
    if (target) {
      const rest = ctx.url.pathname.slice(`/w/${slug}`.length);
      throw Object.assign(new HttpError(301, 'Moved'), { location: `/w/${target}${rest}${ctx.url.search}` });
    }
  }
  throw new HttpError(404, "That article doesn't exist, or you don't have access to it.");
}

function pageNum(ctx) {
  return Math.max(1, parseInt(ctx.query.page, 10) || 1);
}

function tagsFromQuery(value) {
  const slugs = String(value || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const out = [];
  for (const slug of slugs) {
    const t = get('SELECT * FROM tags WHERE slug = ?', slug);
    if (t && !out.some((x) => x.id === t.id)) out.push(t);
  }
  return out;
}

module.exports = function register(router, { requirePerm, requireUser }) {
  // -------------------------------------------------------------------------
  // Home
  // -------------------------------------------------------------------------
  router.get('/', requirePerm('articles.read'), (ctx) => {
    const spaces = spacesWithCounts(ctx.user).map((s) => ({
      ...s,
      recent: A.listArticles(ctx.user, { spaceId: s.id, limit: 6 }).rows,
    }));
    const changes = A.recentChanges(ctx.user, 14);
    const topTags = A.tagsWithCounts(ctx.user).filter((t) => t.count > 0).sort((a, b) => b.count - a.count).slice(0, 18);
    const counts = { articles: spaces.reduce((n, s) => n + s.count, 0) };
    return ctx.html(views.home(ctx, { spaces, changes, topTags, counts }));
  });

  // -------------------------------------------------------------------------
  // Browsing
  // -------------------------------------------------------------------------
  function browse(ctx, { space, base, heading, intro, accent }) {
    const activeTags = tagsFromQuery(ctx.query.tags);
    const filters = {
      space: space ? space.slug : ctx.query.space || '',
      tags: activeTags.map((t) => t.slug),
      sort: ctx.query.sort || 'updated',
      status: ['draft', 'published'].includes(ctx.query.status) ? ctx.query.status : '',
    };
    const spaceRow = space || (filters.space ? get('SELECT * FROM spaces WHERE slug = ?', filters.space) : null);
    const page = pageNum(ctx);
    const { rows, total } = A.listArticles(ctx.user, {
      spaceId: spaceRow && spaceRow.id,
      tagIds: activeTags.map((t) => t.id),
      status: filters.status,
      sort: filters.sort,
      limit: PER_PAGE,
      offset: (page - 1) * PER_PAGE,
    });
    let related;
    if (activeTags.length) related = A.relatedTags(ctx.user, activeTags.map((t) => t.id));
    else related = A.tagsWithCounts(ctx.user, { spaceId: spaceRow && spaceRow.id }).filter((t) => t.count > 0).sort((a, b) => b.count - a.count).slice(0, 24);

    if (!heading && activeTags.length === 1) {
      heading = activeTags[0].name;
      intro = activeTags[0].description || intro;
    }
    return ctx.html(views.browse(ctx, {
      heading: heading || 'All articles', intro, accent, base,
      rows, total, page, perPage: PER_PAGE,
      spaces: ctx.spaces, activeTags, related, filters,
      showSpaces: !space,
      newHref: space ? `/new?space=${space.slug}` : '/new',
    }));
  }

  router.get('/articles', requirePerm('articles.read'), (ctx) => browse(ctx, { base: '/articles' }));

  router.get('/s/:slug', requirePerm('articles.read'), (ctx) => {
    const space = get('SELECT * FROM spaces WHERE slug = ?', ctx.params.slug);
    if (!space) throw new HttpError(404, "That space doesn't exist.");
    return browse(ctx, { space, base: `/s/${space.slug}`, heading: space.name, intro: space.description, accent: space.color });
  });

  router.get('/tags', requirePerm('articles.read'), (ctx) => {
    const tags = A.tagsWithCounts(ctx.user);
    const map = new Map();
    for (const t of tags) {
      const { ns } = A.splitTag(t.name);
      if (!map.has(ns)) map.set(ns, []);
      map.get(ns).push(t);
    }
    const groups = [...map.entries()].map(([ns, list]) => ({ ns, tags: list })).sort((a, b) => (a.ns === '' ? -1 : b.ns === '' ? 1 : a.ns.localeCompare(b.ns)));
    return ctx.html(views.tagsIndex(ctx, { groups, total: tags.length }));
  });

  router.get('/tags/:slug', requirePerm('articles.read'), (ctx) => {
    const t = get('SELECT slug FROM tags WHERE slug = ?', ctx.params.slug);
    if (!t) throw new HttpError(404, "That tag doesn't exist.");
    return ctx.redirect(`/articles?tags=${encodeURIComponent(t.slug)}`);
  });

  router.get('/search', requirePerm('articles.read'), (ctx) => {
    const q = String(ctx.query.q || '').trim().slice(0, 200);
    const space = ctx.query.space ? get('SELECT * FROM spaces WHERE slug = ?', ctx.query.space) : null;
    const page = pageNum(ctx);
    let rows = [], total = 0;
    if (q) {
      ({ rows, total } = A.search(ctx.user, q, { spaceId: space && space.id, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }));
    }
    return ctx.html(views.searchPage(ctx, { q, rows, total, page, perPage: PER_PAGE, spaces: ctx.spaces, filters: { space: space ? space.slug : '' } }));
  });

  router.get('/help/markdown', requirePerm('articles.read'), (ctx) => {
    const rendered = md.render(guide.source);
    return ctx.html(views.markdownHelp(ctx, { rendered }));
  });

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------
  router.get('/new', requirePerm('articles.create'), (ctx) => {
    const space = ctx.query.space ? get('SELECT id FROM spaces WHERE slug = ?', ctx.query.space) : null;
    const fields = {
      title: String(ctx.query.title || '').slice(0, 200),
      summary: '', content: '', note: '', tags: ctx.query.tag ? [String(ctx.query.tag)] : [],
      spaceId: space ? space.id : ctx.spaces[0] && ctx.spaces[0].id, status: 'published',
    };
    return ctx.html(views.editor(ctx, { fields, spaces: ctx.spaces, isNew: true }));
  });

  router.post('/new', requirePerm('articles.create'), async (ctx) => {
    const form = await ctx.form();
    const result = A.saveArticle({ article: null, input: form, user: ctx.user, ip: ctx.ip });
    if (result.errors) {
      return ctx.html(views.editor(ctx, { fields: { ...result.fields, slug: form.slug }, errors: result.errors, spaces: ctx.spaces, isNew: true }), 422);
    }
    ctx.setFlash('success', result.article.status === 'published' ? 'Article published.' : 'Draft saved. Only you and moderators can see it until you publish.');
    return ctx.redirect(`/w/${result.article.slug}`);
  });

  // -------------------------------------------------------------------------
  // View
  // -------------------------------------------------------------------------
  router.get('/w/:slug', requirePerm('articles.read'), (ctx) => {
    const a = loadVisible(ctx, ctx.params.slug);
    const rendered = md.render(a.content, { resolveWikiLink: A.wikiResolver(ctx.user) });
    const lastRev = get('SELECT note, kind FROM revisions WHERE article_id = ? AND rev = ?', a.id, a.current_rev);
    return ctx.html(views.articleView(ctx, {
      article: a, rendered, lastRev, backlinks: A.backlinks(ctx.user, a), canEdit: A.canEdit(ctx.user, a),
    }));
  });

  // -------------------------------------------------------------------------
  // Edit
  // -------------------------------------------------------------------------
  router.get('/w/:slug/edit', requireUser, (ctx) => {
    const a = loadVisible(ctx, ctx.params.slug);
    if (!A.canEdit(ctx.user, a)) throw new HttpError(403, "Your role can't edit this article.");
    const fields = {
      title: a.title, summary: a.summary, content: a.content, note: '', tags: a.tags.map((t) => t.name),
      spaceId: a.space_id, status: a.status, slug: '', base_rev: a.current_rev,
    };
    return ctx.html(views.editor(ctx, { article: a, fields, spaces: ctx.spaces, isNew: false }));
  });

  router.post('/w/:slug/edit', requireUser, async (ctx) => {
    const a = loadVisible(ctx, ctx.params.slug);
    if (!A.canEdit(ctx.user, a)) throw new HttpError(403, "Your role can't edit this article.");
    const form = await ctx.form();
    const result = A.saveArticle({ article: a, input: form, user: ctx.user, ip: ctx.ip });
    if (result.errors) {
      return ctx.html(views.editor(ctx, {
        article: a, fields: { ...result.fields, slug: form.slug, base_rev: form.base_rev }, errors: result.errors, spaces: ctx.spaces, isNew: false,
      }), result.errors.conflict ? 409 : 422);
    }
    const msg = { publish: 'Article published.', unpublish: 'Article moved back to drafts.' }[result.kind] || `Revision ${result.rev} saved.`;
    ctx.setFlash('success', msg);
    return ctx.redirect(`/w/${result.article.slug}`);
  });

  router.post('/w/:slug/delete', requirePerm('articles.delete'), async (ctx) => {
    await ctx.form();
    const a = loadVisible(ctx, ctx.params.slug);
    A.trashArticle(a, ctx.user, ctx.ip);
    ctx.setFlash('success', `“${a.title}” moved to the trash.`);
    return ctx.redirect(`/s/${a.space_slug}`);
  });

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------
  router.get('/w/:slug/history', requirePerm('articles.read'), (ctx) => {
    const a = loadVisible(ctx, ctx.params.slug);
    return ctx.html(views.history(ctx, { article: a, revisions: A.listRevisions(a.id) }));
  });

  router.get('/w/:slug/rev/:rev', requirePerm('articles.read'), (ctx) => {
    const a = loadVisible(ctx, ctx.params.slug);
    const r = A.getRevision(a.id, parseInt(ctx.params.rev, 10));
    if (!r) throw new HttpError(404, "That revision doesn't exist.");
    const rendered = md.render(r.content, { resolveWikiLink: A.wikiResolver(ctx.user) });
    return ctx.html(views.revisionView(ctx, { article: a, revision: r, rendered, canRestore: ctx.can('articles.restore'), total: a.current_rev }));
  });

  router.get('/w/:slug/diff', requirePerm('articles.read'), (ctx) => {
    const a = loadVisible(ctx, ctx.params.slug);
    let fromN = parseInt(ctx.query.from, 10), toN = parseInt(ctx.query.to, 10);
    if (!toN) toN = a.current_rev;
    if (!fromN) fromN = Math.max(1, toN - 1);
    if (fromN > toN) [fromN, toN] = [toN, fromN];
    const from = A.getRevision(a.id, fromN), to = A.getRevision(a.id, toN);
    if (!from || !to) throw new HttpError(404, "One of those revisions doesn't exist.");
    const spaceName = (id) => (get('SELECT name FROM spaces WHERE id = ?', id) || {}).name || '';
    from.space_name = spaceName(from.space_id);
    to.space_name = spaceName(to.space_id);
    const ops = diffLines(from.content, to.content);
    return ctx.html(views.diffView(ctx, {
      article: a, from, to, revisions: A.listRevisions(a.id), hunks: hunks(ops, 3), stats: stats(ops),
    }));
  });

  router.post('/w/:slug/restore/:rev', requirePerm('articles.restore'), async (ctx) => {
    const form = await ctx.form();
    const a = loadVisible(ctx, ctx.params.slug);
    const revNum = parseInt(ctx.params.rev, 10);
    try {
      const rev = A.restoreRevision({ article: a, revNum, user: ctx.user, note: form.note, ip: ctx.ip });
      ctx.setFlash('success', `Restored revision ${revNum} as revision ${rev}.`);
      return ctx.redirect(`/w/${a.slug}`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 400) {
        ctx.setFlash('error', err.message);
        return ctx.redirect(`/w/${a.slug}/rev/${revNum}`);
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // JSON helpers for the editor
  // -------------------------------------------------------------------------
  router.get('/api/tags', requirePerm('articles.read'), (ctx) => {
    const q = String(ctx.query.q || '').trim();
    return ctx.json({ tags: q ? A.suggestTags(q, 10) : [] });
  });

  router.get('/api/articles', requirePerm('articles.read'), (ctx) => {
    const q = String(ctx.query.q || '').trim();
    if (!q) return ctx.json({ articles: [] });
    const { rows } = A.search(ctx.user, q, { limit: 8 });
    return ctx.json({ articles: rows.map((r) => ({ slug: r.slug, title: r.title, space: r.space_name })) });
  });
};

module.exports.spacesWithCounts = spacesWithCounts;
