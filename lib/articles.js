'use strict';
const md = require('../public/js/markdown');
const { tx, get, all, run, now, audit } = require('./db');
const { can } = require('./auth');
const { HttpError } = require('./http');

const LIMITS = { title: 200, summary: 300, content: 1_000_000, noteMin: 3, noteMax: 500, tags: 25 };

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------
/**
 * Tags are lowercase, spaces become hyphens, and an optional single
 * "namespace:value" prefix groups related tags (vendor:dell, os:debian).
 */
function normalizeTag(name) {
  let t = String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/^#/, '');
  t = t.replace(/\s*:\s*/, ':').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!t) return null;
  if (t.length > 48) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._+#\/-]*(?::[\p{L}\p{N}][\p{L}\p{N}._+#\/-]*)?$/u.test(t)) return null;
  return t;
}

function splitTag(name) {
  const i = name.indexOf(':');
  return i > 0 ? { ns: name.slice(0, i), value: name.slice(i + 1) } : { ns: '', value: name };
}

function tagSlugFor(name) {
  const { ns, value } = splitTag(name);
  const base = ns ? `${md.slugify(ns)}.${md.slugify(value)}` : md.slugify(value);
  let slug = base, n = 1;
  while (get('SELECT 1 FROM tags WHERE slug = ?', slug)) slug = `${base}-${++n}`;
  return slug;
}

function parseTagInput(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  const out = [], bad = [];
  for (const r of raw) {
    if (!String(r).trim()) continue;
    const t = normalizeTag(r);
    if (!t) bad.push(String(r).trim());
    else if (!out.includes(t)) out.push(t);
  }
  return { tags: out, bad };
}

/** Resolve tag names to ids, creating new tags when the user is allowed to. */
function ensureTags(names, user) {
  const ids = [];
  const missing = [];
  for (const name of names) {
    const row = get('SELECT id FROM tags WHERE name = ?', name);
    if (row) ids.push(row.id);
    else missing.push(name);
  }
  if (missing.length && !can(user, 'tags.create')) {
    throw new HttpError(400, `These tags don't exist yet and your role can't create tags: ${missing.join(', ')}. Pick existing tags or ask a moderator.`);
  }
  for (const name of missing) {
    const r = run('INSERT INTO tags (name, slug, created_at, created_by) VALUES (?,?,?,?)', name, tagSlugFor(name), now(), user.id);
    ids.push(Number(r.lastInsertRowid));
  }
  return ids;
}

function tagsForArticle(articleId) {
  return all('SELECT t.* FROM tags t JOIN article_tags at ON at.tag_id = t.id WHERE at.article_id = ? ORDER BY t.name', articleId);
}

function tagsForArticles(ids) {
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  const rows = all(`SELECT at.article_id, t.* FROM article_tags at JOIN tags t ON t.id = at.tag_id
                    WHERE at.article_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.name`, ...ids);
  for (const r of rows) map.get(r.article_id).push(r);
  return map;
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------
/** SQL fragment + params limiting articles `a` to what the user may see. */
function visibility(user) {
  if (can(user, 'articles.view_drafts')) return { sql: 'a.deleted_at IS NULL', params: [] };
  if (user && user.id) return { sql: "a.deleted_at IS NULL AND (a.status = 'published' OR a.author_id = ?)", params: [user.id] };
  return { sql: "a.deleted_at IS NULL AND a.status = 'published'", params: [] };
}

function canSee(user, article) {
  if (!article || article.deleted_at) return false;
  if (article.status === 'published') return true;
  return can(user, 'articles.view_drafts') || (user && article.author_id === user.id);
}

function canEdit(user, article) {
  if (!article || article.deleted_at) return false;
  return can(user, 'articles.edit_any') || (can(user, 'articles.edit_own') && article.author_id === user.id);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
const ARTICLE_SELECT = `
  SELECT a.*, s.slug AS space_slug, s.name AS space_name, s.color AS space_color,
         ps.slug AS parent_space_slug, ps.name AS parent_space_name,
         au.username AS author_username, au.display_name AS author_name, au.avatar AS author_avatar,
         ub.username AS updated_username, ub.display_name AS updated_name, ub.avatar AS updated_avatar
  FROM articles a
  JOIN spaces s ON s.id = a.space_id
  LEFT JOIN spaces ps ON ps.id = s.parent_id
  LEFT JOIN users au ON au.id = a.author_id
  LEFT JOIN users ub ON ub.id = a.updated_by`;

function getArticle(slug) {
  const a = get(`${ARTICLE_SELECT} WHERE a.slug = ?`, slug);
  if (a) a.tags = tagsForArticle(a.id);
  return a || null;
}
function getArticleById(id) {
  const a = get(`${ARTICLE_SELECT} WHERE a.id = ?`, id);
  if (a) a.tags = tagsForArticle(a.id);
  return a || null;
}
function redirectFor(slug) {
  const r = get('SELECT a.slug FROM article_redirects r JOIN articles a ON a.id = r.article_id WHERE r.old_slug = ?', slug);
  return r ? r.slug : null;
}

const SORTS = {
  updated: 'a.updated_at DESC',
  created: 'a.created_at DESC',
  title: 'a.title COLLATE NOCASE ASC',
};

/**
 * List articles visible to `user`.
 * filters: { spaceId, tagIds: [] (all must match), status, authorId, sort, limit, offset }
 */
function listArticles(user, filters = {}) {
  const vis = visibility(user);
  const where = [vis.sql];
  const params = [...vis.params];
  if (filters.spaceId) { where.push('a.space_id IN (SELECT id FROM spaces WHERE id = ? OR parent_id = ?)'); params.push(filters.spaceId, filters.spaceId); }
  if (filters.status) { where.push('a.status = ?'); params.push(filters.status); }
  if (filters.authorId) { where.push('a.author_id = ?'); params.push(filters.authorId); }
  for (const tagId of filters.tagIds || []) {
    where.push('EXISTS (SELECT 1 FROM article_tags x WHERE x.article_id = a.id AND x.tag_id = ?)');
    params.push(tagId);
  }
  const whereSql = where.join(' AND ');
  const total = get(`SELECT COUNT(*) AS n FROM articles a WHERE ${whereSql}`, ...params).n;
  const order = SORTS[filters.sort] || SORTS.updated;
  const rows = all(`${ARTICLE_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params, filters.limit || 30, filters.offset || 0);
  const tags = tagsForArticles(rows.map((r) => r.id));
  for (const r of rows) r.tags = tags.get(r.id);
  return { rows, total };
}

/** Full-text search. Supports quoted phrases and -exclusions. */
function buildFtsQuery(q) {
  const parts = [];
  const re = /(-?)"([^"]+)"|(-?)([\p{L}\p{N}_]+)/gu;
  let m;
  while ((m = re.exec(q))) {
    if (m[2]) {
      const phrase = m[2].replace(/"/g, '').trim();
      if (phrase) parts.push({ neg: !!m[1], term: `"${phrase}"` });
    } else if (m[4]) {
      parts.push({ neg: !!m[3], term: `"${m[4]}"*` });
    }
  }
  const pos = parts.filter((p) => !p.neg).map((p) => p.term);
  const neg = parts.filter((p) => p.neg).map((p) => p.term);
  if (!pos.length) return null;
  return pos.join(' ') + (neg.length ? ' NOT ' + neg.join(' NOT ') : '');
}

function search(user, q, filters = {}) {
  const fts = buildFtsQuery(q);
  if (!fts) return { rows: [], total: 0 };
  const vis = visibility(user);
  const where = [vis.sql, 'articles_fts MATCH ?'];
  const params = [...vis.params, fts];
  if (filters.spaceId) { where.push('a.space_id IN (SELECT id FROM spaces WHERE id = ? OR parent_id = ?)'); params.push(filters.spaceId, filters.spaceId); }
  for (const tagId of filters.tagIds || []) {
    where.push('EXISTS (SELECT 1 FROM article_tags x WHERE x.article_id = a.id AND x.tag_id = ?)');
    params.push(tagId);
  }
  const whereSql = where.join(' AND ');
  let rows, total;
  try {
    total = get(`SELECT COUNT(*) AS n FROM articles_fts JOIN articles a ON a.id = articles_fts.rowid WHERE ${whereSql}`, ...params).n;
    rows = all(`
      SELECT a.*, s.slug AS space_slug, s.name AS space_name, s.color AS space_color,
             ps.slug AS parent_space_slug, ps.name AS parent_space_name,
             ub.display_name AS updated_name, ub.username AS updated_username,
             snippet(articles_fts, 2, char(1), char(2), '…', 28) AS snippet,
             bm25(articles_fts, 10.0, 4.0, 1.0, 6.0) AS score
      FROM articles_fts
      JOIN articles a ON a.id = articles_fts.rowid
      JOIN spaces s ON s.id = a.space_id
      LEFT JOIN spaces ps ON ps.id = s.parent_id
      LEFT JOIN users ub ON ub.id = a.updated_by
      WHERE ${whereSql}
      ORDER BY score LIMIT ? OFFSET ?`, ...params, filters.limit || 30, filters.offset || 0);
  } catch {
    return { rows: [], total: 0 };
  }
  const tags = tagsForArticles(rows.map((r) => r.id));
  for (const r of rows) r.tags = tags.get(r.id);
  return { rows, total };
}

function indexArticle(id) {
  const a = get('SELECT * FROM articles WHERE id = ?', id);
  run('DELETE FROM articles_fts WHERE rowid = ?', id);
  if (!a || a.deleted_at) return;
  const tags = tagsForArticle(id).map((t) => `${t.name} ${t.name.replace(/[:\-_.]/g, ' ')}`).join(' ');
  run('INSERT INTO articles_fts (rowid, title, summary, body, tags) VALUES (?,?,?,?,?)',
    id, a.title, a.summary, md.toPlainText(a.content), tags);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
function uniqueSlug(base, exceptId = 0) {
  base = md.slugify(base).slice(0, 80) || 'article';
  let slug = base, n = 1;
  while (
    get('SELECT 1 FROM articles WHERE slug = ? AND id != ?', slug, exceptId) ||
    get('SELECT 1 FROM article_redirects WHERE old_slug = ? AND article_id != ?', slug, exceptId)
  ) slug = `${base}-${++n}`;
  return slug;
}

function validateFields(input) {
  const errors = {};
  const title = String(input.title || '').trim().replace(/\s+/g, ' ');
  const summary = String(input.summary || '').trim().replace(/\s+/g, ' ');
  const content = String(input.content || '').replace(/\r\n?/g, '\n');
  const note = String(input.note || '').trim().replace(/\s+/g, ' ');
  const spaceId = parseInt(input.space_id, 10);
  const status = input.status === 'published' ? 'published' : 'draft';
  const slug = String(input.slug || '').trim().toLowerCase();

  if (!title) errors.title = 'Give the article a title.';
  else if (title.length > LIMITS.title) errors.title = `Keep the title under ${LIMITS.title} characters.`;
  if (summary.length > LIMITS.summary) errors.summary = `Keep the summary under ${LIMITS.summary} characters.`;
  if (content.length > LIMITS.content) errors.content = 'This article is too long. Split it into several linked articles.';
  if (note.length < LIMITS.noteMin) errors.note = 'Describe what you changed and why. A revision note is required.';
  else if (note.length > LIMITS.noteMax) errors.note = `Keep the revision note under ${LIMITS.noteMax} characters.`;
  if (!spaceId || !get('SELECT 1 FROM spaces WHERE id = ?', spaceId)) errors.space_id = 'Choose a space for this article.';
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors.slug = 'Use lowercase letters, numbers and single hyphens in the URL.';

  const { tags, bad } = parseTagInput(input.tags);
  if (bad.length) errors.tags = `These tags use characters that aren't allowed: ${bad.join(', ')}. Use letters, numbers, hyphens and an optional "group:" prefix.`;
  else if (tags.length > LIMITS.tags) errors.tags = `Use at most ${LIMITS.tags} tags.`;

  return { errors, fields: { title, summary, content, note, spaceId, status, slug, tags } };
}

/**
 * Create (article = null) or update an article. Every save writes a revision
 * carrying the required note. `baseRev` guards against overwriting someone
 * else's newer save.
 */
function saveArticle({ article, input, user, ip }) {
  const { errors, fields } = validateFields(input);
  if (Object.keys(errors).length) return { errors, fields };

  if (article) {
    const baseRev = parseInt(input.base_rev, 10);
    if (baseRev && baseRev !== article.current_rev) {
      return {
        errors: { conflict: `Someone saved revision ${article.current_rev} while you were editing revision ${baseRev}. Your text is still here. Open the history in a new tab, merge their changes into yours, then save again.` },
        fields,
      };
    }
  }

  try {
    return tx(() => {
      const tagIds = ensureTags(fields.tags, user);
      const t = now();
      let id, rev, kind;

      if (!article) {
        const slug = fields.slug ? uniqueSlug(fields.slug) : uniqueSlug(fields.title);
        const r = run(`INSERT INTO articles (slug, space_id, title, summary, content, status, author_id, updated_by, current_rev, created_at, updated_at, published_at)
                       VALUES (?,?,?,?,?,?,?,?,1,?,?,?)`,
          slug, fields.spaceId, fields.title, fields.summary, fields.content, fields.status, user.id, user.id, t, t,
          fields.status === 'published' ? t : null);
        id = Number(r.lastInsertRowid);
        rev = 1;
        kind = 'create';
      } else {
        id = article.id;
        const oldTags = article.tags.map((x) => x.name).sort().join(',');
        const newTags = fields.tags.slice().sort().join(',');
        const slugChanged = fields.slug && fields.slug !== article.slug;
        const changed =
          fields.title !== article.title || fields.summary !== article.summary || fields.content !== article.content ||
          fields.spaceId !== article.space_id || fields.status !== article.status || oldTags !== newTags || slugChanged;
        if (!changed) throw new HttpError(400, 'Nothing changed since the last revision, so there is nothing to save.', { field: 'content' });

        if (slugChanged) {
          if (get('SELECT 1 FROM articles WHERE slug = ? AND id != ?', fields.slug, id)) {
            throw new HttpError(400, `Another article already uses the URL "${fields.slug}".`, { field: 'slug' });
          }
          run('DELETE FROM article_redirects WHERE old_slug = ?', fields.slug);
          run('INSERT OR REPLACE INTO article_redirects (old_slug, article_id) VALUES (?, ?)', article.slug, id);
        }
        rev = article.current_rev + 1;
        kind = article.status !== fields.status ? (fields.status === 'published' ? 'publish' : 'unpublish') : 'edit';
        run(`UPDATE articles SET slug = ?, space_id = ?, title = ?, summary = ?, content = ?, status = ?, updated_by = ?,
               current_rev = ?, updated_at = ?, published_at = COALESCE(published_at, ?) WHERE id = ?`,
          slugChanged ? fields.slug : article.slug, fields.spaceId, fields.title, fields.summary, fields.content, fields.status,
          user.id, rev, t, fields.status === 'published' ? t : null, id);
      }

      run('DELETE FROM article_tags WHERE article_id = ?', id);
      for (const tagId of tagIds) run('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)', id, tagId);

      run(`INSERT INTO revisions (article_id, rev, title, summary, content, space_id, tags, status, note, kind, author_id, size, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, rev, fields.title, fields.summary, fields.content, fields.spaceId, JSON.stringify(fields.tags),
        fields.status, fields.note, kind, user.id, Buffer.byteLength(fields.content), t);

      indexArticle(id);
      return { article: getArticleById(id), rev, kind };
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) {
      const key = err.field || (/tag/i.test(err.message) ? 'tags' : 'form');
      return { errors: { [key]: err.message }, fields };
    }
    throw err;
  }
}

function restoreRevision({ article, revNum, user, note, ip }) {
  note = String(note || '').trim().replace(/\s+/g, ' ');
  if (note.length < LIMITS.noteMin) throw new HttpError(400, 'Add a revision note explaining why you are restoring this version.');
  if (note.length > LIMITS.noteMax) throw new HttpError(400, `Keep the revision note under ${LIMITS.noteMax} characters.`);
  const r = get('SELECT * FROM revisions WHERE article_id = ? AND rev = ?', article.id, revNum);
  if (!r) throw new HttpError(404, `Revision ${revNum} doesn't exist.`);
  if (revNum === article.current_rev) throw new HttpError(400, 'That revision is already the current version.');

  return tx(() => {
    let tags = [];
    try { tags = JSON.parse(r.tags); } catch { tags = []; }
    const tagIds = [];
    for (const name of tags) {
      let row = get('SELECT id FROM tags WHERE name = ?', name);
      if (!row) {
        const ins = run('INSERT INTO tags (name, slug, created_at, created_by) VALUES (?,?,?,?)', name, tagSlugFor(name), now(), user.id);
        row = { id: Number(ins.lastInsertRowid) };
      }
      tagIds.push(row.id);
    }
    const spaceId = r.space_id && get('SELECT 1 FROM spaces WHERE id = ?', r.space_id) ? r.space_id : article.space_id;
    const rev = article.current_rev + 1;
    const t = now();
    run('UPDATE articles SET title = ?, summary = ?, content = ?, space_id = ?, updated_by = ?, current_rev = ?, updated_at = ? WHERE id = ?',
      r.title, r.summary, r.content, spaceId, user.id, rev, t, article.id);
    run('DELETE FROM article_tags WHERE article_id = ?', article.id);
    for (const tagId of tagIds) run('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)', article.id, tagId);
    run(`INSERT INTO revisions (article_id, rev, title, summary, content, space_id, tags, status, note, kind, restored_from, author_id, size, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,'restore',?,?,?,?)`,
      article.id, rev, r.title, r.summary, r.content, spaceId, JSON.stringify(tags), article.status, note, revNum, user.id,
      Buffer.byteLength(r.content), t);
    indexArticle(article.id);
    audit(user.id, 'article.restore', article.slug, `Restored revision ${revNum} as revision ${rev}`, ip);
    return rev;
  });
}

function listRevisions(articleId) {
  return all(`SELECT r.id, r.rev, r.title, r.status, r.note, r.kind, r.restored_from, r.size, r.created_at, r.author_id,
                     u.username, u.display_name, u.avatar
              FROM revisions r LEFT JOIN users u ON u.id = r.author_id
              WHERE r.article_id = ? ORDER BY r.rev DESC`, articleId);
}

function getRevision(articleId, rev) {
  const r = get(`SELECT r.*, u.username, u.display_name, u.avatar FROM revisions r LEFT JOIN users u ON u.id = r.author_id
                 WHERE r.article_id = ? AND r.rev = ?`, articleId, rev);
  if (r) { try { r.tags = JSON.parse(r.tags); } catch { r.tags = []; } }
  return r || null;
}

function trashArticle(article, user, ip) {
  run('UPDATE articles SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), user.id, article.id);
  run('DELETE FROM articles_fts WHERE rowid = ?', article.id);
  audit(user.id, 'article.trash', article.slug, article.title, ip);
}

function recoverArticle(id, user, ip) {
  const a = get('SELECT * FROM articles WHERE id = ?', id);
  if (!a || !a.deleted_at) throw new HttpError(404, 'That article is not in the trash.');
  run('UPDATE articles SET deleted_at = NULL, deleted_by = NULL WHERE id = ?', id);
  indexArticle(id);
  audit(user.id, 'article.recover', a.slug, a.title, ip);
  return a;
}

function listTrash() {
  return all(`SELECT a.id, a.slug, a.title, a.deleted_at, s.name AS space_name, u.display_name AS deleted_by_name
              FROM articles a JOIN spaces s ON s.id = a.space_id LEFT JOIN users u ON u.id = a.deleted_by
              WHERE a.deleted_at IS NOT NULL ORDER BY a.deleted_at DESC`);
}

// ---------------------------------------------------------------------------
// Feeds and tag stats
// ---------------------------------------------------------------------------
function recentChanges(user, limit = 12) {
  const vis = visibility(user);
  return all(`
    SELECT r.rev, r.note, r.kind, r.created_at, a.slug, a.title, a.status, s.name AS space_name, s.color AS space_color,
           ps.name AS parent_space_name, u.username, u.display_name, u.avatar
    FROM revisions r
    JOIN articles a ON a.id = r.article_id
    JOIN spaces s ON s.id = a.space_id
    LEFT JOIN spaces ps ON ps.id = s.parent_id
    LEFT JOIN users u ON u.id = r.author_id
    WHERE ${vis.sql}
    ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, ...vis.params, limit);
}

function tagsWithCounts(user, { spaceId } = {}) {
  const vis = visibility(user);
  const extra = spaceId ? ' AND a.space_id IN (SELECT id FROM spaces WHERE id = ? OR parent_id = ?)' : '';
  return all(`
    SELECT t.*, COUNT(a.id) AS count
    FROM tags t
    LEFT JOIN article_tags at ON at.tag_id = t.id
    LEFT JOIN articles a ON a.id = at.article_id AND ${vis.sql}${extra}
    GROUP BY t.id
    ORDER BY t.name`, ...vis.params, ...(spaceId ? [spaceId, spaceId] : []));
}

/** Tags that most often appear alongside all of `tagIds` (for narrowing a filter). */
function relatedTags(user, tagIds, limit = 16) {
  if (!tagIds.length) return [];
  const vis = visibility(user);
  const conds = tagIds.map(() => 'EXISTS (SELECT 1 FROM article_tags x WHERE x.article_id = a.id AND x.tag_id = ?)').join(' AND ');
  return all(`
    SELECT t.*, COUNT(*) AS count
    FROM articles a
    JOIN article_tags at ON at.article_id = a.id
    JOIN tags t ON t.id = at.tag_id
    WHERE ${vis.sql} AND ${conds} AND t.id NOT IN (${tagIds.map(() => '?').join(',')})
    GROUP BY t.id ORDER BY count DESC, t.name LIMIT ?`, ...vis.params, ...tagIds, ...tagIds, limit);
}

function suggestTags(q, limit = 10) {
  const like = `%${String(q).toLowerCase().replace(/[%_]/g, '')}%`;
  return all(`SELECT t.name, t.color, COUNT(at.article_id) AS count FROM tags t LEFT JOIN article_tags at ON at.tag_id = t.id
              WHERE t.name LIKE ? GROUP BY t.id ORDER BY (t.name LIKE ?) DESC, count DESC, t.name LIMIT ?`,
    like, `${String(q).toLowerCase().replace(/[%_]/g, '')}%`, limit);
}

/** Resolver for [[wiki links]]: matches a slug, an old slug, or a title. */
function wikiResolver(user) {
  const memo = new Map();
  return (target) => {
    if (memo.has(target)) return memo.get(target);
    const slug = md.slugify(target);
    let a = get('SELECT slug, title, status, author_id, deleted_at FROM articles WHERE slug = ?', slug) ||
      get('SELECT slug, title, status, author_id, deleted_at FROM articles WHERE title = ? COLLATE NOCASE', target);
    if (!a) {
      const r = redirectFor(slug);
      if (r) a = get('SELECT slug, title, status, author_id, deleted_at FROM articles WHERE slug = ?', r);
    }
    let info;
    if (a && canSee(user, a)) info = { href: `/w/${a.slug}`, exists: true, title: a.title };
    else info = { href: `/new?title=${encodeURIComponent(target)}`, exists: false };
    memo.set(target, info);
    return info;
  };
}

/** Published articles that link to this one with [[wiki links]]. */
function backlinks(user, article) {
  const vis = visibility(user);
  const candidates = all(`SELECT a.id, a.slug, a.title, a.content FROM articles a WHERE ${vis.sql} AND a.id != ? AND a.content LIKE '%[[%'`, ...vis.params, article.id);
  const names = new Set([article.slug, article.title.toLowerCase(), md.slugify(article.title)]);
  return candidates.filter((c) => md.wikiTargets(c.content).some((t) => names.has(t.toLowerCase()) || names.has(md.slugify(t))))
    .map(({ slug, title }) => ({ slug, title }));
}

module.exports = {
  LIMITS, normalizeTag, splitTag, parseTagInput, tagSlugFor, tagsForArticle,
  visibility, canSee, canEdit,
  getArticle, getArticleById, redirectFor, listArticles, search, indexArticle,
  saveArticle, restoreRevision, listRevisions, getRevision,
  trashArticle, recoverArticle, listTrash,
  recentChanges, tagsWithCounts, relatedTags, suggestTags, wikiResolver, backlinks,
};
