'use strict';
const { tx, get, all, run, now, audit, getRole, getRoleByKey, listRoles, getSettings, setSetting } = require('../lib/db');
const auth = require('../lib/auth');
const A = require('../lib/articles');
const md = require('../public/js/markdown');
const { ALL, PERMISSIONS } = require('../lib/permissions');
const { HttpError } = require('../lib/http');
const { fmtBytes } = require('../lib/html');
const views = require('../views/admin');

const PER_PAGE = 50;
const HEX = /^#[0-9a-fA-F]{6}$/;

function auditRows(where = '', params = [], limit = 50, offset = 0) {
  return all(`SELECT l.*, u.username, u.display_name FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id
              ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
}

function anyAdminPerm(ctx) {
  return ['users.manage', 'roles.manage', 'settings.manage', 'tags.manage', 'spaces.manage', 'audit.view', 'articles.delete'].some((p) => ctx.can(p));
}

module.exports = function register(router, { requireUser, requirePerm }) {
  const adminOnly = (ctx) => {
    if (!anyAdminPerm(ctx)) throw new HttpError(403, "Your role doesn't include any administration tools.");
  };

  // -------------------------------------------------------------------------
  // Overview
  // -------------------------------------------------------------------------
  router.get('/admin', requireUser, adminOnly, (ctx) => {
    const up = get('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM uploads');
    const stats = {
      articles: get('SELECT COUNT(*) AS n FROM articles WHERE deleted_at IS NULL').n,
      drafts: get("SELECT COUNT(*) AS n FROM articles WHERE deleted_at IS NULL AND status = 'draft'").n,
      revisions: get('SELECT COUNT(*) AS n FROM revisions').n,
      users: get("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").n,
      revoked: get("SELECT COUNT(*) AS n FROM users WHERE status = 'revoked'").n,
      uploads: up.n,
      uploadSize: fmtBytes(up.bytes),
    };
    const pending = ctx.can('users.manage') ? all("SELECT * FROM users WHERE status = 'pending' ORDER BY created_at") : [];
    const recentAudit = ctx.can('audit.view') ? auditRows('', [], 8) : [];
    return ctx.html(views.overview(ctx, { stats, pending, recentAudit }));
  });

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------
  router.get('/admin/users', requirePerm('users.manage'), (ctx) => {
    const filters = { q: String(ctx.query.q || '').trim(), status: ctx.query.status || '', role: ctx.query.role || '' };
    const where = [], params = [];
    if (filters.q) {
      const like = `%${filters.q.replace(/[%_]/g, '')}%`;
      where.push('(u.display_name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)');
      params.push(like, like, like);
    }
    if (['active', 'pending', 'revoked'].includes(filters.status)) { where.push('u.status = ?'); params.push(filters.status); }
    if (filters.role) { where.push('u.role_id = ?'); params.push(parseInt(filters.role, 10) || 0); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
    const total = get(`SELECT COUNT(*) AS n FROM users u ${whereSql}`, ...params).n;
    const rows = all(`SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id ${whereSql}
                      ORDER BY CASE u.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, u.display_name COLLATE NOCASE
                      LIMIT ? OFFSET ?`, ...params, PER_PAGE, (page - 1) * PER_PAGE);
    return ctx.html(views.users(ctx, { rows, roles: listRoles(), filters, total, page, perPage: PER_PAGE }));
  });

  function loadTarget(ctx) {
    const target = auth.loadUser(parseInt(ctx.params.id, 10));
    if (!target) throw new HttpError(404, "That user doesn't exist.");
    return target;
  }
  function requireManage(ctx, target) {
    if (!auth.canManageUser(ctx.user, target)) {
      throw new HttpError(403, target.id === ctx.user.id ? "You can't change your own role or access." : "This member's role has permissions you don't have, so only an admin can change it.");
    }
  }
  const isLastAdmin = (target) => target.role_key === 'admin' && target.status === 'active' && auth.activeAdminCount() <= 1;

  function renderUser(ctx, target, extra = {}) {
    const roles = listRoles();
    const canManage = auth.canManageUser(ctx.user, target);
    return ctx.html(views.userDetail(ctx, {
      target: { ...target, revoked_by_name: target.revoked_by ? (get('SELECT display_name FROM users WHERE id = ?', target.revoked_by) || {}).display_name : '' },
      roles,
      canManage,
      assignable: roles.filter((r) => auth.canAssignRole(ctx.user, r)),
      sessions: auth.listSessions(target.id),
      auditRows: ctx.can('audit.view') ? auditRows('WHERE l.target = ?', [`@${target.username}`], 25) : [],
      isLastAdmin: isLastAdmin(target),
      ...extra,
    }));
  }

  router.get('/admin/users/:id', requirePerm('users.manage'), (ctx) => renderUser(ctx, loadTarget(ctx)));

  router.post('/admin/users/:id/role', requirePerm('users.manage'), async (ctx) => {
    const form = await ctx.form();
    const target = loadTarget(ctx);
    requireManage(ctx, target);
    const role = getRole(parseInt(form.role_id, 10));
    if (!role) throw new HttpError(400, 'Choose a role.');
    if (!auth.canAssignRole(ctx.user, role)) throw new HttpError(403, `You can't grant the ${role.name} role because it includes permissions you don't have.`);
    if (role.id === target.role_id) return ctx.redirect(`/admin/users/${target.id}`);
    if (isLastAdmin(target)) throw new HttpError(400, 'This is the only active admin. Make someone else an admin first.');
    run('UPDATE users SET role_id = ? WHERE id = ?', role.id, target.id);
    audit(ctx.user.id, 'user.role', `@${target.username}`, `${target.role_name} → ${role.name}`, ctx.ip);
    ctx.setFlash('success', `@${target.username} is now ${/^[aeiou]/i.test(role.name) ? 'an' : 'a'} ${role.name}.`);
    return ctx.redirect(`/admin/users/${target.id}`);
  });

  router.post('/admin/users/:id/approve', requirePerm('users.manage'), async (ctx) => {
    const form = await ctx.form();
    const target = loadTarget(ctx);
    requireManage(ctx, target);
    if (target.status !== 'pending') return ctx.redirect(`/admin/users/${target.id}`);
    let role = form.role_id ? getRole(parseInt(form.role_id, 10)) : getRole(target.role_id);
    if (!role || !auth.canAssignRole(ctx.user, role)) role = getRoleByKey('reader');
    run("UPDATE users SET status = 'active', role_id = ? WHERE id = ?", role.id, target.id);
    audit(ctx.user.id, 'user.approve', `@${target.username}`, `as ${role.name}`, ctx.ip);
    ctx.setFlash('success', `Approved @${target.username} as ${role.name}. They can sign in now.`);
    return ctx.redirect(form.back === 'overview' ? '/admin' : `/admin/users/${target.id}`);
  });

  router.post('/admin/users/:id/revoke', requirePerm('users.manage'), async (ctx) => {
    const form = await ctx.form();
    const target = loadTarget(ctx);
    requireManage(ctx, target);
    if (isLastAdmin(target)) throw new HttpError(400, "You can't revoke the only active admin.");
    const reason = String(form.reason || '').trim().slice(0, 300);
    tx(() => {
      run("UPDATE users SET status = 'revoked', revoked_reason = ?, revoked_at = ?, revoked_by = ? WHERE id = ?", reason || null, now(), ctx.user.id, target.id);
      auth.destroyUserSessions(target.id);
      audit(ctx.user.id, 'user.revoke', `@${target.username}`, reason, ctx.ip);
    });
    ctx.setFlash('success', target.status === 'pending' ? `Declined @${target.username}'s registration.` : `Revoked access for @${target.username} and signed them out everywhere.`);
    return ctx.redirect(`/admin/users/${target.id}`);
  });

  router.post('/admin/users/:id/reinstate', requirePerm('users.manage'), async (ctx) => {
    await ctx.form();
    const target = loadTarget(ctx);
    requireManage(ctx, target);
    run("UPDATE users SET status = 'active', revoked_reason = NULL, revoked_at = NULL, revoked_by = NULL WHERE id = ?", target.id);
    audit(ctx.user.id, 'user.reinstate', `@${target.username}`, '', ctx.ip);
    ctx.setFlash('success', `Reinstated @${target.username}.`);
    return ctx.redirect(`/admin/users/${target.id}`);
  });

  router.post('/admin/users/:id/reset-password', requirePerm('users.manage'), async (ctx) => {
    await ctx.form();
    const target = loadTarget(ctx);
    requireManage(ctx, target);
    const temp = auth.randomPassword();
    tx(() => {
      run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', auth.hashPassword(temp), target.id);
      auth.destroyUserSessions(target.id);
      audit(ctx.user.id, 'user.reset_password', `@${target.username}`, 'Temporary password issued', ctx.ip);
    });
    ctx.res.setHeader('Cache-Control', 'no-store');
    return renderUser(ctx, auth.loadUser(target.id), { tempPassword: temp });
  });

  router.post('/admin/users/:id/signout', requirePerm('users.manage'), async (ctx) => {
    await ctx.form();
    const target = loadTarget(ctx);
    requireManage(ctx, target);
    auth.destroyUserSessions(target.id);
    audit(ctx.user.id, 'user.signout', `@${target.username}`, '', ctx.ip);
    ctx.setFlash('success', `Signed @${target.username} out of every device.`);
    return ctx.redirect(`/admin/users/${target.id}`);
  });

  // -------------------------------------------------------------------------
  // Roles and permissions
  // -------------------------------------------------------------------------
  function roleCounts() {
    const counts = {};
    for (const r of all('SELECT role_id, COUNT(*) AS n FROM users GROUP BY role_id')) counts[r.role_id] = r.n;
    return counts;
  }

  router.get('/admin/roles', requirePerm('roles.manage'), (ctx) => {
    return ctx.html(views.roles(ctx, { roles: listRoles(), counts: roleCounts() }));
  });

  router.post('/admin/roles/permissions', requirePerm('roles.manage'), async (ctx) => {
    const form = await ctx.form();
    const valid = new Set(ALL);
    const changes = [];
    tx(() => {
      for (const role of listRoles()) {
        if (role.key === 'admin') continue;
        const next = [].concat(form[`perm_${role.id}`] || []).filter((p) => valid.has(p));
        const sorted = ALL.filter((p) => next.includes(p));
        if (sorted.join() !== ALL.filter((p) => role.permissions.includes(p)).join()) {
          run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify(sorted), role.id);
          const added = sorted.filter((p) => !role.permissions.includes(p));
          const removed = role.permissions.filter((p) => !sorted.includes(p));
          changes.push(`${role.name}: ${[...added.map((p) => '+' + p), ...removed.map((p) => '−' + p)].join(', ')}`);
        }
      }
      if (changes.length) audit(ctx.user.id, 'role.permissions', 'roles', changes.join('; '), ctx.ip);
    });
    ctx.setFlash('success', changes.length ? `Permissions updated for ${changes.length} role${changes.length === 1 ? '' : 's'}.` : 'No permissions changed.');
    return ctx.redirect('/admin/roles');
  });

  router.post('/admin/roles', requirePerm('roles.manage'), async (ctx) => {
    const form = await ctx.form();
    const name = String(form.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const description = String(form.description || '').trim().slice(0, 200);
    const errors = {};
    if (!name) errors.name = 'Name the role.';
    else if (get('SELECT 1 FROM roles WHERE name = ?', name)) errors.name = 'A role with that name already exists.';
    if (Object.keys(errors).length) {
      return ctx.html(views.roles(ctx, { roles: listRoles(), counts: roleCounts(), errors, values: form }), 422);
    }
    const source = form.copy_from ? getRole(parseInt(form.copy_from, 10)) : null;
    const perms = source ? source.permissions : [];
    run('INSERT INTO roles (name, description, permissions, is_system, sort, created_at) VALUES (?,?,?,0,50,?)', name, description, JSON.stringify(perms), now());
    audit(ctx.user.id, 'role.create', name, source ? `copied from ${source.name}` : '', ctx.ip);
    ctx.setFlash('success', `Added the ${name} role. Set its permissions in the table.`);
    return ctx.redirect('/admin/roles');
  });

  router.post('/admin/roles/:id', requirePerm('roles.manage'), async (ctx) => {
    const form = await ctx.form();
    const role = getRole(parseInt(ctx.params.id, 10));
    if (!role) throw new HttpError(404, "That role doesn't exist.");
    const description = String(form.description || '').trim().slice(0, 200);
    let name = role.name;
    if (!role.is_system) {
      name = String(form.name || '').trim().replace(/\s+/g, ' ').slice(0, 40) || role.name;
      if (name !== role.name && get('SELECT 1 FROM roles WHERE name = ? AND id != ?', name, role.id)) {
        ctx.setFlash('error', `A role named ${name} already exists.`);
        return ctx.redirect('/admin/roles');
      }
    }
    run('UPDATE roles SET name = ?, description = ? WHERE id = ?', name, description, role.id);
    audit(ctx.user.id, 'role.update', name, name !== role.name ? `renamed from ${role.name}` : 'description', ctx.ip);
    ctx.setFlash('success', `Saved the ${name} role.`);
    return ctx.redirect('/admin/roles');
  });

  router.post('/admin/roles/:id/delete', requirePerm('roles.manage'), async (ctx) => {
    await ctx.form();
    const role = getRole(parseInt(ctx.params.id, 10));
    if (!role) throw new HttpError(404, "That role doesn't exist.");
    if (role.is_system) throw new HttpError(400, "Built-in roles can't be deleted.");
    const s = getSettings();
    let fallback = getRoleByKey(s.default_role) || getRoleByKey('reader');
    if (fallback.id === role.id || fallback.key === 'admin') fallback = getRoleByKey('reader');
    tx(() => {
      const moved = run('UPDATE users SET role_id = ? WHERE role_id = ?', fallback.id, role.id).changes;
      run('DELETE FROM roles WHERE id = ?', role.id);
      if (s.default_role === String(role.id)) setSetting('default_role', 'reader');
      audit(ctx.user.id, 'role.delete', role.name, `${moved} member(s) moved to ${fallback.name}`, ctx.ip);
    });
    ctx.setFlash('success', `Deleted the ${role.name} role. Its members are now ${fallback.name}s.`);
    return ctx.redirect('/admin/roles');
  });

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------
  router.get('/admin/tags', requirePerm('tags.manage'), (ctx) => {
    const q = String(ctx.query.q || '').trim().toLowerCase();
    let rows = all(`SELECT t.*, (SELECT COUNT(*) FROM article_tags at JOIN articles a ON a.id = at.article_id
                                 WHERE at.tag_id = t.id AND a.deleted_at IS NULL) AS count
                    FROM tags t ORDER BY t.name`);
    if (q) rows = rows.filter((t) => t.name.includes(q));
    return ctx.html(views.tags(ctx, { rows, q }));
  });

  function reindexTagArticles(tagId) {
    for (const r of all('SELECT article_id FROM article_tags WHERE tag_id = ?', tagId)) A.indexArticle(r.article_id);
  }

  router.post('/admin/tags/:id', requirePerm('tags.manage'), async (ctx) => {
    const form = await ctx.form();
    const tag = get('SELECT * FROM tags WHERE id = ?', parseInt(ctx.params.id, 10));
    if (!tag) throw new HttpError(404, "That tag doesn't exist.");
    const name = A.normalizeTag(form.name);
    if (!name) { ctx.setFlash('error', 'Tag names use letters, numbers and hyphens, with an optional "group:" prefix.'); return ctx.redirect('/admin/tags'); }
    const clash = get('SELECT id FROM tags WHERE name = ? AND id != ?', name, tag.id);
    if (clash) { ctx.setFlash('error', `“${name}” already exists. Use Merge to combine the two tags.`); return ctx.redirect('/admin/tags'); }
    const color = HEX.test(form.color || '') ? form.color : tag.color;
    const description = String(form.description || '').trim().slice(0, 200);
    tx(() => {
      const slug = name !== tag.name ? A.tagSlugFor(name) : tag.slug;
      run('UPDATE tags SET name = ?, slug = ?, color = ?, description = ? WHERE id = ?', name, slug, color, description, tag.id);
      if (name !== tag.name) reindexTagArticles(tag.id);
      audit(ctx.user.id, 'tag.update', name, name !== tag.name ? `renamed from ${tag.name}` : 'details', ctx.ip);
    });
    ctx.setFlash('success', `Saved “${name}”.`);
    return ctx.redirect('/admin/tags');
  });

  router.post('/admin/tags/:id/merge', requirePerm('tags.manage'), async (ctx) => {
    const form = await ctx.form();
    const tag = get('SELECT * FROM tags WHERE id = ?', parseInt(ctx.params.id, 10));
    if (!tag) throw new HttpError(404, "That tag doesn't exist.");
    const intoName = A.normalizeTag(form.into);
    const into = intoName && get('SELECT * FROM tags WHERE name = ?', intoName);
    if (!into) { ctx.setFlash('error', `Enter an existing tag to merge “${tag.name}” into.`); return ctx.redirect('/admin/tags'); }
    if (into.id === tag.id) { ctx.setFlash('error', 'Pick a different tag to merge into.'); return ctx.redirect('/admin/tags'); }
    tx(() => {
      const ids = all('SELECT article_id FROM article_tags WHERE tag_id = ?', tag.id).map((r) => r.article_id);
      for (const id of ids) run('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)', id, into.id);
      run('DELETE FROM tags WHERE id = ?', tag.id);
      for (const id of ids) A.indexArticle(id);
      audit(ctx.user.id, 'tag.merge', into.name, `merged ${tag.name} (${ids.length} article(s))`, ctx.ip);
    });
    ctx.setFlash('success', `Merged “${tag.name}” into “${into.name}”.`);
    return ctx.redirect('/admin/tags');
  });

  router.post('/admin/tags/:id/delete', requirePerm('tags.manage'), async (ctx) => {
    await ctx.form();
    const tag = get('SELECT * FROM tags WHERE id = ?', parseInt(ctx.params.id, 10));
    if (!tag) throw new HttpError(404, "That tag doesn't exist.");
    tx(() => {
      const ids = all('SELECT article_id FROM article_tags WHERE tag_id = ?', tag.id).map((r) => r.article_id);
      run('DELETE FROM tags WHERE id = ?', tag.id);
      for (const id of ids) A.indexArticle(id);
      audit(ctx.user.id, 'tag.delete', tag.name, `removed from ${ids.length} article(s)`, ctx.ip);
    });
    ctx.setFlash('success', `Deleted “${tag.name}”.`);
    return ctx.redirect('/admin/tags');
  });

  // -------------------------------------------------------------------------
  // Spaces
  // -------------------------------------------------------------------------
  const spaceRows = () => all('SELECT s.*, (SELECT COUNT(*) FROM articles a WHERE a.space_id = s.id) AS count FROM spaces s ORDER BY s.sort, s.name');

  router.get('/admin/spaces', requirePerm('spaces.manage'), (ctx) => ctx.html(views.spaces(ctx, { rows: spaceRows() })));

  function spaceFields(form, id = 0) {
    const errors = {};
    const name = String(form.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const slug = (String(form.slug || '').trim().toLowerCase() || md.slugify(name)).slice(0, 40);
    const description = String(form.description || '').trim().slice(0, 200);
    const color = HEX.test(form.color || '') ? form.color : null;
    const sort = Math.max(0, Math.min(999, parseInt(form.sort, 10) || 0));
    if (!name) errors.name = 'Name the space.';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors.slug = 'Use lowercase letters, numbers and hyphens.';
    else if (get('SELECT 1 FROM spaces WHERE slug = ? AND id != ?', slug, id)) errors.slug = 'Another space already uses that URL.';
    return { errors, values: { name, slug, description, color, sort } };
  }

  router.post('/admin/spaces', requirePerm('spaces.manage'), async (ctx) => {
    const form = await ctx.form();
    const { errors, values } = spaceFields(form);
    if (Object.keys(errors).length) return ctx.html(views.spaces(ctx, { rows: spaceRows(), errors, values: form }), 422);
    const maxSort = get('SELECT COALESCE(MAX(sort), 0) AS m FROM spaces').m;
    run('INSERT INTO spaces (slug, name, description, color, sort, created_at) VALUES (?,?,?,?,?,?)',
      values.slug, values.name, values.description, values.color || '#5B6FA8', maxSort + 1, now());
    audit(ctx.user.id, 'space.create', values.name, `/s/${values.slug}`, ctx.ip);
    ctx.setFlash('success', `Added the ${values.name} space.`);
    return ctx.redirect('/admin/spaces');
  });

  router.post('/admin/spaces/:id', requirePerm('spaces.manage'), async (ctx) => {
    const form = await ctx.form();
    const space = get('SELECT * FROM spaces WHERE id = ?', parseInt(ctx.params.id, 10));
    if (!space) throw new HttpError(404, "That space doesn't exist.");
    const { errors, values } = spaceFields(form, space.id);
    if (Object.keys(errors).length) { ctx.setFlash('error', Object.values(errors).join(' ')); return ctx.redirect('/admin/spaces'); }
    run('UPDATE spaces SET name = ?, slug = ?, description = ?, color = ?, sort = ? WHERE id = ?',
      values.name, values.slug, values.description, values.color || space.color, values.sort, space.id);
    audit(ctx.user.id, 'space.update', values.name, '', ctx.ip);
    ctx.setFlash('success', `Saved the ${values.name} space.`);
    return ctx.redirect('/admin/spaces');
  });

  router.post('/admin/spaces/:id/delete', requirePerm('spaces.manage'), async (ctx) => {
    await ctx.form();
    const space = get('SELECT * FROM spaces WHERE id = ?', parseInt(ctx.params.id, 10));
    if (!space) throw new HttpError(404, "That space doesn't exist.");
    if (get('SELECT 1 FROM articles WHERE space_id = ?', space.id)) throw new HttpError(400, 'Move or delete the articles in this space first, including any in the trash.');
    if (get('SELECT COUNT(*) AS n FROM spaces').n <= 1) throw new HttpError(400, 'Keep at least one space.');
    run('DELETE FROM spaces WHERE id = ?', space.id);
    audit(ctx.user.id, 'space.delete', space.name, '', ctx.ip);
    ctx.setFlash('success', `Deleted the ${space.name} space.`);
    return ctx.redirect('/admin/spaces');
  });

  // -------------------------------------------------------------------------
  // Trash
  // -------------------------------------------------------------------------
  router.get('/admin/trash', requirePerm('articles.delete'), (ctx) => ctx.html(views.trash(ctx, { rows: A.listTrash() })));

  router.post('/admin/trash/:id/recover', requirePerm('articles.delete'), async (ctx) => {
    await ctx.form();
    const a = A.recoverArticle(parseInt(ctx.params.id, 10), ctx.user, ctx.ip);
    ctx.setFlash('success', `Recovered “${a.title}”.`);
    return ctx.redirect(`/w/${a.slug}`);
  });

  // -------------------------------------------------------------------------
  // Settings and audit
  // -------------------------------------------------------------------------
  router.get('/admin/settings', requirePerm('settings.manage'), (ctx) => {
    return ctx.html(views.settings(ctx, { values: getSettings(), roles: listRoles() }));
  });

  router.post('/admin/settings', requirePerm('settings.manage'), async (ctx) => {
    const form = await ctx.form();
    const errors = {};
    const values = {
      site_name: String(form.site_name || '').trim().slice(0, 60),
      site_tagline: String(form.site_tagline || '').trim().slice(0, 160),
      registration: ['open', 'approval', 'closed'].includes(form.registration) ? form.registration : 'open',
      default_role: String(form.default_role || 'reader'),
      require_login: form.require_login === '1' ? '1' : '0',
      allowed_email_domains: String(form.allowed_email_domains || '').split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean).join(', '),
    };
    if (!values.site_name) errors.site_name = 'Give the site a name.';
    const role = getRoleByKey(values.default_role) || getRole(parseInt(values.default_role, 10));
    if (!role || role.key === 'admin') errors.default_role = 'Choose a role other than Admin for new accounts.';
    for (const d of values.allowed_email_domains ? values.allowed_email_domains.split(', ') : []) {
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) errors.allowed_email_domains = `“${d}” isn't a valid domain.`;
    }
    if (Object.keys(errors).length) return ctx.html(views.settings(ctx, { values, roles: listRoles(), errors }), 422);
    const before = getSettings();
    const changed = Object.keys(values).filter((k) => before[k] !== values[k]);
    tx(() => {
      for (const k of changed) setSetting(k, values[k]);
      if (changed.length) audit(ctx.user.id, 'settings.update', 'settings', changed.map((k) => `${k}: ${before[k]} → ${values[k]}`).join('; '), ctx.ip);
    });
    ctx.setFlash('success', changed.length ? 'Settings saved.' : 'No settings changed.');
    return ctx.redirect('/admin/settings');
  });

  router.get('/admin/audit', requirePerm('audit.view'), (ctx) => {
    const page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
    const total = get('SELECT COUNT(*) AS n FROM audit_log').n;
    return ctx.html(views.audit(ctx, { rows: auditRows('', [], PER_PAGE, (page - 1) * PER_PAGE), total, page, perPage: PER_PAGE }));
  });
};

module.exports.PERMISSIONS = PERMISSIONS;
