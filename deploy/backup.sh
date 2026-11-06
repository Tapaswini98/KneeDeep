#!/usr/bin/env sh
# Back up the KneeDeep database (earnings, payouts and paid queries: money records).
# Reports themselves live on Arkiv and expire by design; they need no backup.
#
#   ./backup.sh                                   one backup now
#   crontab: 15 3 * * * /opt/kneedeep/deploy/backup.sh >> /var/log/kneedeep-backup.log 2>&1
#
# Restore: gunzip -c backups/<file>.sql.gz | docker compose exec -T postgres psql -U kneedeep kneedeep
set -eu
cd "$(dirname "$0")"
mkdir -p backups
file="backups/kneedeep-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose exec -T postgres pg_dump -U kneedeep --no-owner kneedeep | gzip > "$file"
# Keep two weeks of daily backups.
find backups -name 'kneedeep-*.sql.gz' -mtime +14 -delete
echo "Backed up to $file"
