#!/bin/sh
set -eu

# Store backups outside the live data directory so a failed application update
# cannot overwrite the recovery copy.
data_dir=${READWEAVE_DATA_DIR:-/srv/readweave/data}
backup_dir=${READWEAVE_BACKUP_DIR:-/srv/readweave/backups}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)

install -d -o 1000 -g 1000 -m 0700 "$backup_dir"

# SQLite's online backup command produces a consistent snapshot while the
# ReadWeave container continues serving requests.
sqlite3 "$data_dir/document.db" ".backup '$backup_dir/document-$timestamp.db'"
sqlite3 "$backup_dir/document-$timestamp.db" 'PRAGMA integrity_check;' | grep -qx ok
chown 1000:1000 "$backup_dir/document-$timestamp.db"
chmod 0600 "$backup_dir/document-$timestamp.db"

# Keep the matching configuration and session secret so the snapshot can be
# restored without losing model settings or invalidating every login session.
install -o 1000 -g 1000 -m 0600 "$data_dir/config.ini" "$backup_dir/config-$timestamp.ini"
install -o 1000 -g 1000 -m 0600 "$data_dir/session_secret.txt" "$backup_dir/session-secret-$timestamp.txt"

# Retain one week of daily recovery points and remove only files created by
# this backup job.
find "$backup_dir" -type f -name 'document-*.db' -mtime +7 -delete
find "$backup_dir" -type f -name 'config-*.ini' -mtime +7 -delete
find "$backup_dir" -type f -name 'session-secret-*.txt' -mtime +7 -delete
