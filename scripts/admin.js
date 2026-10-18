'use strict';
// Command-line recovery tools. Run on the server, e.g.:
//   npm run admin -- list-users
//   npm run admin -- make-admin nick
//   npm run admin -- reset-password nick
//   npm run admin -- registration approval
const { get, all, run, audit, getRoleByKey, setSetting } = require('../lib/db');
const auth = require('../lib/auth');

const [cmd, arg] = process.argv.slice(2);

function findUser(name) {
  const u = get('SELECT id, username FROM users WHERE username = ? OR email = ?', name, String(name || '').toLowerCase());
  if (!u) { console.error(`No user "${name}".`); process.exit(1); }
  return u;
}

switch (cmd) {
  case 'list-users': {
    const rows = all(`SELECT u.username, u.email, u.status, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id`);
    console.table(rows);
    break;
  }
  case 'make-admin': {
    const u = findUser(arg);
    const admin = getRoleByKey('admin');
    run("UPDATE users SET role_id = ?, status = 'active', revoked_reason = NULL, revoked_at = NULL WHERE id = ?", admin.id, u.id);
    audit(null, 'user.role', `@${u.username}`, 'Made admin from the command line');
    console.log(`@${u.username} is now an active admin.`);
    break;
  }
  case 'reset-password': {
    const u = findUser(arg);
    const temp = auth.randomPassword();
    run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', auth.hashPassword(temp), u.id);
    auth.destroyUserSessions(u.id);
    audit(null, 'user.reset_password', `@${u.username}`, 'Reset from the command line');
    console.log(`Temporary password for @${u.username}: ${temp}`);
    console.log('They will be asked to choose a new one after signing in.');
    break;
  }
  case 'registration': {
    if (!['open', 'approval', 'closed'].includes(arg)) { console.error('Use: registration open|approval|closed'); process.exit(1); }
    setSetting('registration', arg);
    audit(null, 'settings.update', 'settings', `registration → ${arg} (command line)`);
    console.log(`Registration is now "${arg}".`);
    break;
  }
  default:
    console.log(`Beacon admin tools

  list-users                 Show every account with its role and status
  make-admin <username>      Give an account the Admin role and reactivate it
  reset-password <username>  Issue a temporary password and sign them out
  registration <mode>        Set sign-ups to open, approval or closed`);
}
