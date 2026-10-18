#!/usr/bin/env bash
# Install or upgrade Beacon on Debian 12/13 (Proxmox LXC or VM).
# Run as root from the cloned repo:  sudo bash deploy/install.sh
#
# Upgrades are safe to run any time. This script never deletes or resets data:
#   - the database, photos and avatars in /var/lib/beacon are never touched,
#   - a backup is taken before the new version starts,
#   - the app migrates the database in place (and saves its own copy first),
#   - your settings in /etc/beacon/beacon.env are kept as they are,
#   - the previous version stays in /opt/beacon.previous for a quick rollback.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/beacon
DATA=/var/lib/beacon
ENV_DIR=/etc/beacon
ENV_FILE=$ENV_DIR/beacon.env
UNIT=/etc/systemd/system/beacon.service

need_node() {
  if ! command -v node >/dev/null; then return 0; fi
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?1:0)'
}

if need_node; then
  echo "Installing Node.js 22 LTS from NodeSource…"
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "Node $(node -v)"

id beacon >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin beacon
install -d -o beacon -g beacon -m 750 "$DATA" /var/backups/beacon
install -d -m 750 "$ENV_DIR"

# ---------------------------------------------------------------- settings
# Created once. Earlier versions kept settings inside beacon.service; carry
# any of those over so an upgrade never changes how Beacon listens.
if [ ! -f "$ENV_FILE" ]; then
  cp "$SRC/deploy/beacon.env.example" "$ENV_FILE"
  if [ -f "$UNIT" ] && grep -q '^Environment=BEACON_' "$UNIT"; then
    grep '^Environment=BEACON_' "$UNIT" | sed 's/^Environment=//' | while IFS='=' read -r key value; do
      sed -i "s|^#\?${key}=.*|${key}=${value}|" "$ENV_FILE"
      grep -q "^${key}=" "$ENV_FILE" || echo "${key}=${value}" >> "$ENV_FILE"
    done
    echo "Moved your existing settings from beacon.service into $ENV_FILE"
  fi
  chmod 640 "$ENV_FILE"
fi
set -a; . "$ENV_FILE"; set +a
PORT="${BEACON_PORT:-3000}"

# ---------------------------------------------------------- backup first
if [ -f "$DATA/beacon.db" ]; then
  echo "Backing up the current database and photos…"
  if [ -f "$APP/scripts/backup.sh" ]; then BK="$APP/scripts/backup.sh"; else BK="$SRC/scripts/backup.sh"; fi
  runuser -u beacon -- env BEACON_DATA_DIR="$DATA" BACKUP_DIR=/var/backups/beacon KEEP=30 bash "$BK"
fi

# ------------------------------------------------------- install the code
# Build the new release beside the old one, then swap, so files removed in a
# new version don't linger and the old version remains for rollback.
NEW="$APP.new"
rm -rf "$NEW"
install -d -m 755 "$NEW"
tar -C "$SRC" --exclude=./data --exclude=./backups --exclude=./node_modules --exclude=./.git -cf - . | tar -C "$NEW" -xf -
if [ -d "$APP/public/fonts" ]; then cp -n "$APP"/public/fonts/*.ttf "$NEW/public/fonts/" 2>/dev/null || true; fi
bash "$NEW/deploy/fetch-fonts.sh" "$NEW/public/fonts" || echo "Couldn't download Barlow Semi Condensed; pages use a fallback font until you run deploy/fetch-fonts.sh."
chown -R root:root "$NEW"
chmod +x "$NEW/scripts/backup.sh"

if [ -d "$APP" ]; then rm -rf "$APP.previous"; mv "$APP" "$APP.previous"; fi
mv "$NEW" "$APP"

install -m 644 "$APP/deploy/beacon.service" "$UNIT"
install -m 644 "$APP/deploy/beacon-backup.service" /etc/systemd/system/beacon-backup.service
install -m 644 "$APP/deploy/beacon-backup.timer" /etc/systemd/system/beacon-backup.timer
systemctl daemon-reload
systemctl enable beacon.service beacon-backup.timer >/dev/null
systemctl start beacon-backup.timer
systemctl restart beacon.service

# ----------------------------------------------------------------- verify
for _ in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break
  sleep 0.5
done
if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
  echo "Beacon $(node -p "require('$APP/package.json').version") is running on port $PORT."
  [ -d "$APP.previous" ] && echo "Previous version kept in $APP.previous (rollback: see README)."
else
  echo "Beacon didn't answer. Check: journalctl -u beacon -n 50"
  echo "Your data is untouched. To roll back: see 'Rolling back' in the README."
  exit 1
fi
