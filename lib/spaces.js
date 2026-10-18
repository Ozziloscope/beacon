'use strict';
// Spaces are the top-level sections of the wiki. A main space can hold
// sub-spaces one level deep (Technical → Networking, Storage, …).
const { get, all } = require('./db');
const A = require('./articles');

function listSpaces() {
  return all('SELECT * FROM spaces ORDER BY sort, name COLLATE NOCASE');
}

/** Article counts per space that `user` can see. */
function countsFor(user) {
  const vis = A.visibility(user);
  const out = {};
  for (const r of all(`SELECT a.space_id AS id, COUNT(*) AS n FROM articles a WHERE ${vis.sql} GROUP BY a.space_id`, ...vis.params)) out[r.id] = r.n;
  return out;
}

/**
 * Nest spaces: [{ ...main, own, total, children: [{ ...sub, own, total }] }].
 * Anything that isn't a valid two-level child is shown as a main space.
 */
function buildTree(spaces, counts = {}) {
  const byId = new Map(spaces.map((s) => [s.id, { ...s, children: [] }]));
  const tops = [];
  for (const s of byId.values()) {
    const parent = s.parent_id ? byId.get(s.parent_id) : null;
    if (parent && !parent.parent_id) parent.children.push(s);
    else tops.push(s);
  }
  for (const t of tops) {
    t.own = counts[t.id] || 0;
    for (const c of t.children) { c.own = counts[c.id] || 0; c.total = c.own; }
    t.total = t.own + t.children.reduce((n, c) => n + c.own, 0);
  }
  return tops;
}

function spaceTree(user) {
  return buildTree(listSpaces(), countsFor(user));
}

/** Options for a <select>, main spaces followed by their sub-spaces. */
function options(spaces) {
  const out = [];
  for (const t of buildTree(spaces)) {
    out.push({ value: t.id, label: t.name });
    for (const c of t.children) out.push({ value: c.id, label: `${t.name} / ${c.name}` });
  }
  return out;
}

/** The space and its sub-spaces, for "show everything in Technical". */
function subtreeIds(id) {
  return all('SELECT id FROM spaces WHERE id = ? OR parent_id = ?', id, id).map((r) => r.id);
}

function getSpace(slug) {
  const s = get('SELECT * FROM spaces WHERE slug = ?', slug);
  if (!s) return null;
  s.parent = s.parent_id ? get('SELECT * FROM spaces WHERE id = ?', s.parent_id) : null;
  s.children = all('SELECT * FROM spaces WHERE parent_id = ? ORDER BY sort, name COLLATE NOCASE', s.id);
  return s;
}

module.exports = { listSpaces, countsFor, buildTree, spaceTree, options, subtreeIds, getSpace };
