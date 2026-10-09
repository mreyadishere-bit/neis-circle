#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
compose=(sudo -n docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml)
for table in profiles circles; do
  exists="$("${compose[@]}" exec -T db psql -X -U postgres -d postgres -Atqc "SELECT to_regclass('public.$table') IS NOT NULL" </dev/null)"
  echo "LIVE_DATABASE_PUBLIC_${table}=$exists"
done
test "$(sudo -n docker inspect -f '{{.HostConfig.NetworkMode}}' neis-restore-test)" = none
for table in profiles circles; do
  exists="$(sudo -n docker exec neis-restore-test psql -X -U supabase_admin -d neis_restore_full_stage -Atqc "SELECT to_regclass('public.$table') IS NOT NULL" </dev/null)"
  echo "DISCONNECTED_STAGE_PUBLIC_${table}=$exists"
done
echo 'LIVE_VS_STAGE_SCHEMA_CHECK=COMPLETE_READ_ONLY'
