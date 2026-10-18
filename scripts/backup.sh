#!/usr/bin/env bash
# Consistent backup of the Beacon database and uploaded photos.
# Safe to run while the server is up (uses SQLite's VACUUM INTO).
#
#   BEACON_DATA_DIR=/var/lib/beacon BACKUP_DIR=/var/backups/beacon KEEP=14 scripts/backup.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${BEACON_DATA_DIR:-$APP_DIR/data}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
KEEP="${KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$BACKUP_DIR"

node --disable-warning=ExperimentalWarning -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1]);
  db.exec("VACUUM INTO " + JSON.stringify(process.argv[2]).replace(/"/g, "\x27"));
  db.close();
' "$DATA_DIR/beacon.db" "$WORK/beacon.db"

tar -C "$WORK" -czf "$BACKUP_DIR/beacon-$STAMP.tar.gz" beacon.db \
  -C "$DATA_DIR" uploads avatars

# Keep the newest $KEEP archives.
ls -1t "$BACKUP_DIR"/beacon-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm --

echo "Backup written to $BACKUP_DIR/beacon-$STAMP.tar.gz"
