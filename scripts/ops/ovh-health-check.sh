#!/usr/bin/env bash
# Read-only OVH Supabase health check. Does not print .env, secrets, or user data.
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
for file in docker-compose.yml docker-compose.security.yml docker-compose.caddy.yml; do
  test -f "$file" || { echo "MISSING_COMPOSE_FILE: $file"; exit 1; }
done
echo "=== Compose containers ==="
sudo -n docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml ps --format "table {{.Name}}\t{{.Status}}"
echo "=== Backups presence (names only) ==="
for folder in /home/ubuntu/neis-backups/cloud-20261009T130848Z /home/ubuntu/neis-backups/storage-20261009T133940Z /home/ubuntu/neis-backups/edge-functions-initial; do
  if test -d "$folder"; then echo "PRESENT: $(basename "$folder")"; else echo "MISSING: $(basename "$folder")"; fi
done
echo "=== Server free space ==="
df -h / | tail -n 1
echo "=== Test container ==="
sudo -n docker ps -a --filter name='^/neis-restore-test$' --format 'table {{.Names}}\t{{.Status}}'
echo "Health checks are read-only. No deployment or restore performed."
