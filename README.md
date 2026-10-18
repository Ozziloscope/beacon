# Beacon

A Lighthouse Techs app: a self-hosted wiki for a technical knowledge base and the everyday "life stuff" worth writing down. It runs in the browser, keeps every revision, and needs nothing but Node.js: no npm packages, no database server, no build step.

## What it does

**Writing**
- Markdown editor with live split preview, toolbar and shortcuts (Ctrl+B, Ctrl+I, Ctrl+K, Ctrl+S to save)
- Paste, drag-drop or pick photos and they upload straight into the article. Large photos are resized in the browser to 2560 px and stripped of camera metadata before upload
- Callouts (`> [!WARNING]`), tables, checklists, code blocks with copy buttons, `[[wiki links]]`, image sizing (`![alt|400](…)`) and captions
- Unsaved text is kept in the browser, so a closed tab or crash can be recovered
- Edit-conflict detection: if someone saves while you edit, your text is kept and you're told

**Reading**
- Floating table of contents on articles with three or more headings: a rail that fills as you read and marks the current section. On phones it becomes a "Contents" button
- Light and dark themes, following the system by default (sun / moon / monitor button in the header)
- Full-text search across titles, summaries, tags and body, with `"exact phrases"` and `-exclusions`
- "Linked from" backlinks and a click-to-zoom photo viewer

**Organizing**
- Spaces as top-level sections (Technical and Life to start; admins can add more)
- Tags with optional groups (`vendor:dell`, `os:debian`), colors, autocomplete, multi-tag filtering that narrows as you add tags, and rename / merge / delete for moderators

**History**
- Every save is a revision with a **required revision note**, enforced in the browser and on the server
- History list, side-by-side metadata changes, line diff between any two revisions, view any old revision, and restore one as a new revision
- Changing an article's URL keeps the old link working as a redirect
- Deleted articles go to a trash that moderators and admins can recover from

**Accounts and permissions**
- Self-service sign-up with three modes: open, approval required, or closed. Optional allowed email domains
- The first account created becomes the admin
- Default roles: **Admin, Moderator, Editor, Reader**. Admins can edit their permissions in a matrix and add custom roles
- Admins and moderators can approve, revoke (signs them out everywhere immediately), reinstate, change roles, reset passwords, and sign people out
- Nobody can grant more access than they have, change their own role, or lock out the last admin
- Profiles with photo, job title, team, phone, location, website, bio and any number of extra contacts (Slack, Teams, pager…). A People directory lists everyone
- Audit log of every account, permission, settings and recovery action

### Default permissions

| Permission | Admin | Moderator | Editor | Reader |
|:--|:-:|:-:|:-:|:-:|
| Read published articles | ✓ | ✓ | ✓ | ✓ |
| Create and edit articles, upload photos, create tags | ✓ | ✓ | ✓ | |
| See other people's drafts | ✓ | ✓ | | |
| Restore revisions, trash and recover articles | ✓ | ✓ | | |
| Manage tags | ✓ | ✓ | | |
| Approve, revoke and change roles of members | ✓ | ✓ (up to their own access) | | |
| View the audit log | ✓ | ✓ | | |
| Manage spaces, roles, permissions and site settings | ✓ | | | |

## Look and feel

Beacon follows the Lighthouse Techs wordmark:

- **Colors.** Lamp-black `#161A1A` and fog `#EDEFEC` grounds, slate `#4F5755` / `#9DA6A3` for secondary text, and the beacon orange: `#D55C13` on light, `#F67F2F` on dark. Links on light backgrounds use a deeper `#A8480C` so small text stays readable.
- **Type.** Barlow Semi Condensed throughout, with monospace for code.
- **Wordmark.** The lighthouse mark in orange, then the site name with the first word bold and the rest regular in slate, the same rule as "Lighthouse Techs". Set the name under Administration → Site settings.

The font is served by Beacon itself, so pages never call out to the internet. `deploy/install.sh` downloads it into `public/fonts`; you can also run `bash deploy/fetch-fonts.sh`. Until the files are there, pages use a similar condensed system font.

## Requirements

- Node.js **22.13 or newer** (uses the built-in `node:sqlite` module). Node 22 or 24 LTS
- Any Linux, macOS or Windows host. Tested on Debian

## Try it locally

```bash
git clone https://github.com/Ozziloscope/beacon.git
cd beacon
npm start
# open http://127.0.0.1:3000 and create the first account (it becomes the admin)
```

Data goes in `./data` (database, photos, avatars). Run the test suite with `npm test`.

## Deploy on Proxmox with Cloudflare Tunnel

1. Create a Debian 12 LXC (1 vCPU, 512 MB RAM and 4 GB disk is plenty to start; give the disk room for photos).
2. Get the code inside the container:
   ```bash
   apt-get update && apt-get install -y git
   git clone https://github.com/Ozziloscope/beacon.git /root/beacon
   ```
3. Install:
   ```bash
   cd /root/beacon
   sudo bash deploy/install.sh
   ```
   This installs Node 22 if needed, creates a `beacon` system user, copies the app to `/opt/beacon`, keeps data in `/var/lib/beacon`, starts the `beacon` service on `127.0.0.1:3000`, and turns on a nightly backup to `/var/backups/beacon` (14 kept).
4. Add a hostname to your existing tunnel. See `deploy/cloudflared-ingress.yml`. If `cloudflared` runs in a different container, set `BEACON_HOST=0.0.0.0` in `/etc/systemd/system/beacon.service` and point the tunnel at the container's LAN IP.
5. Open the site and create your account first. Then set sign-up rules in **Administration → Site settings** before sharing the link.

To update later, run `git -C /root/beacon pull` and then `sudo bash /root/beacon/deploy/install.sh` again. Data and backups are untouched.

### Recommended: Cloudflare Access

Beacon has its own accounts, but putting a Cloudflare Access policy in front of the hostname (email one-time PIN or your identity provider) keeps the sign-up page off the public internet.

## Configuration

Set these in the systemd unit or your shell.

| Variable | Default | Meaning |
|:--|:--|:--|
| `BEACON_PORT` | `3000` | Port to listen on |
| `BEACON_HOST` | `127.0.0.1` | Address to bind. Use `0.0.0.0` to accept LAN connections |
| `BEACON_DATA_DIR` | `./data` | Database, photos and avatars |
| `BEACON_TRUST_PROXY` | `1` | Read client IP and https from `CF-Connecting-IP` / `X-Forwarded-*` |
| `BEACON_SECURE_COOKIES` | auto | Force the `Secure` cookie flag on or off |
| `BEACON_SESSION_DAYS` | `30` | How long a sign-in lasts (renews with use) |
| `BEACON_MAX_UPLOAD_MB` | `15` | Largest photo accepted |

Site name, tagline, sign-up mode, default role, allowed email domains and whether reading requires sign-in are changed in the app under **Administration → Site settings**.

## Backups and recovery

```bash
# On-demand backup (safe while running)
sudo -u beacon BEACON_DATA_DIR=/var/lib/beacon BACKUP_DIR=/var/backups/beacon bash /opt/beacon/scripts/backup.sh

# Restore: stop the service, unpack an archive into the data directory, start again
sudo systemctl stop beacon
sudo tar -xzf /var/backups/beacon/beacon-YYYYMMDD-HHMMSS.tar.gz -C /var/lib/beacon
sudo rm -f /var/lib/beacon/beacon.db-wal /var/lib/beacon/beacon.db-shm
sudo chown -R beacon:beacon /var/lib/beacon
sudo systemctl start beacon
```

Locked out? Command-line tools run against the same database:

```bash
cd /opt/beacon
sudo -u beacon BEACON_DATA_DIR=/var/lib/beacon node --disable-warning=ExperimentalWarning scripts/admin.js list-users
sudo -u beacon BEACON_DATA_DIR=/var/lib/beacon node --disable-warning=ExperimentalWarning scripts/admin.js make-admin nick
sudo -u beacon BEACON_DATA_DIR=/var/lib/beacon node --disable-warning=ExperimentalWarning scripts/admin.js reset-password nick
sudo -u beacon BEACON_DATA_DIR=/var/lib/beacon node --disable-warning=ExperimentalWarning scripts/admin.js registration closed
```

## Security notes

- Passwords are hashed with scrypt; sessions are random tokens stored hashed; sign-in attempts are throttled
- Every form and upload is CSRF-protected and cross-site requests are rejected
- Markdown never runs HTML: raw tags are shown as text and links are limited to http(s), mailto and tel
- Uploads are checked by their file contents (PNG, JPEG, GIF, WebP only; no SVG) and stored under random names
- Strict Content-Security-Policy, no inline scripts, no third-party requests. Pages work fully offline from the internet
- Uploaded photos and avatars are only served to signed-in members unless you turn on public reading

## Project layout

```
server.js            HTTP server, sessions, CSRF, routing
lib/                 database, auth, articles, diff, config, permissions
routes/              articles, users and accounts, administration
views/               server-rendered HTML templates (auto-escaped)
public/              CSS, browser scripts, Markdown renderer shared with the server
scripts/             backup and admin command-line tools
deploy/              installer, systemd units, Cloudflare Tunnel example
test/                end-to-end tests (npm test)
```
