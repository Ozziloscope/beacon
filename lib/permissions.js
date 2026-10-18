'use strict';

// Every permission the app checks. Groups only affect how the admin matrix is laid out.
const PERMISSIONS = [
  { key: 'articles.read', group: 'Articles', label: 'Read published articles' },
  { key: 'articles.create', group: 'Articles', label: 'Create articles' },
  { key: 'articles.edit_own', group: 'Articles', label: 'Edit articles they created' },
  { key: 'articles.edit_any', group: 'Articles', label: 'Edit any article' },
  { key: 'articles.view_drafts', group: 'Articles', label: "See other people's drafts" },
  { key: 'articles.restore', group: 'Articles', label: 'Restore an older revision' },
  { key: 'articles.delete', group: 'Articles', label: 'Move articles to trash and recover them' },
  { key: 'uploads.create', group: 'Media', label: 'Upload photos' },
  { key: 'tags.create', group: 'Tags', label: 'Create new tags while editing' },
  { key: 'tags.manage', group: 'Tags', label: 'Rename, recolor, merge and delete tags' },
  { key: 'spaces.manage', group: 'Administration', label: 'Manage spaces' },
  { key: 'users.manage', group: 'Administration', label: 'Approve, revoke and change roles of users' },
  { key: 'roles.manage', group: 'Administration', label: 'Create roles and edit permissions' },
  { key: 'settings.manage', group: 'Administration', label: 'Change site settings' },
  { key: 'audit.view', group: 'Administration', label: 'View the audit log' },
];

const ALL = PERMISSIONS.map((p) => p.key);

const READER = ['articles.read'];
const EDITOR = [...READER, 'articles.create', 'articles.edit_own', 'articles.edit_any', 'uploads.create', 'tags.create'];
const MODERATOR = [...EDITOR, 'articles.view_drafts', 'articles.restore', 'articles.delete', 'tags.manage', 'users.manage', 'audit.view'];

// The four built-in roles. `key` is stable; admins can rename the description,
// adjust permissions (except admin, which always has everything), and add more roles.
const DEFAULT_ROLES = [
  { key: 'admin', name: 'Admin', description: 'Full control of the wiki, users, roles and settings.', permissions: ALL, sort: 0 },
  { key: 'moderator', name: 'Moderator', description: 'Keeps content and members in order: restores revisions, manages tags, approves and revokes members.', permissions: MODERATOR, sort: 1 },
  { key: 'editor', name: 'Editor', description: 'Writes and edits articles and uploads photos.', permissions: EDITOR, sort: 2 },
  { key: 'reader', name: 'Reader', description: 'Reads published articles.', permissions: READER, sort: 3 },
];

function isSubset(perms, ofPerms) {
  const set = new Set(ofPerms);
  return perms.every((p) => set.has(p));
}

module.exports = { PERMISSIONS, ALL, DEFAULT_ROLES, isSubset };
