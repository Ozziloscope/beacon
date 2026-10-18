#!/usr/bin/env bash
# Install or update Beacon on Debian 12/13 (Proxmox LXC or VM). Run as root from the
# unpacked beacon folder:  sudo bash deploy/install.sh
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/beacon
DATA=/var/lib/beacon

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
install -d -m 755 "$APP"

# Copy the app (never the data directory or local backups).
tar -C "$SRC" --exclude=./data --exclude=./backups --exclude=./node_modules --exclude=./.git -cf - . | tar -C "$APP" -xf -
bash "$APP/deploy/fetch-fonts.sh" "$APP/public/fonts" || echo "Couldn't download Barlow Semi Condensed; pages will use a fallback font until you run deploy/fetch-fonts.sh."
chown -R root:root "$APP"
chmod +x "$APP/scripts/backup.sh"

install -m 644 "$APP/deploy/beacon.service" /etc/systemd/system/beacon.service
install -m 644 "$APP/deploy/beacon-backup.service" /etc/systemd/system/beacon-backup.service
install -m 644 "$APP/deploy/beacon-backup.timer" /etc/systemd/system/beacon-backup.timer
systemctl daemon-reload
systemctl enable --now beacon.service beacon-backup.timer
systemctl restart beacon.service

sleep 1
if curl -fsS http://127.0.0.1:3000/healthz >/dev/null; then
  echo "Beacon is running on http://127.0.0.1:3000"
  echo "Point your Cloudflare Tunnel at it (see deploy/cloudflared-ingress.yml),"
  echo "then open the site and create the first account. It becomes the admin."
else
  echo "Beacon didn't answer. Check: journalctl -u beacon -n 50"
  exit 1
fi
