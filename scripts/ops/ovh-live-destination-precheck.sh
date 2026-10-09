#!/usr/bin/env bash
# Read-only guardrails for live OVH destination. No credentials, student data or mutation.
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
dc=(sudo -n docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml)
echo '=== Live OVH database initialization ==='
"${dc[@]}" exec -T db psql -X -U postgres -d postgres -Atqc "
SELECT 'LIVE_PUBLIC_TABLES=' || count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
UNION ALL SELECT 'LIVE_AUTH_USERS=' || count(*) FROM auth.users
UNION ALL SELECT 'LIVE_AUTH_IDENTITIES=' || count(*) FROM auth.identities
UNION ALL SELECT 'LIVE_STORAGE_OBJECTS=' || count(*) FROM storage.objects
UNION ALL SELECT 'LIVE_STORAGE_BUCKETS=' || count(*) FROM storage.buckets
UNION ALL SELECT 'LIVE_CORE_AUTH_TABLES=' || count(*) FROM information_schema.tables WHERE table_schema='auth' AND table_type='BASE TABLE'
UNION ALL SELECT 'LIVE_CORE_STORAGE_TABLES=' || count(*) FROM information_schema.tables WHERE table_schema='storage' AND table_type='BASE TABLE'
" </dev/null
echo '=== Isolated staging verification ==='
test "$(sudo -n docker inspect -f '{{.HostConfig.NetworkMode}}' neis-restore-test)" = none
sudo -n docker exec neis-restore-test psql -X -U supabase_admin -d neis_restore_full_stage -Atqc "
SELECT 'STAGE_PUBLIC_TABLES=' || count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
UNION ALL SELECT 'STAGE_AUTH_USERS=' || count(*) FROM auth.users
UNION ALL SELECT 'STAGE_STORAGE_OBJECTS=' || count(*) FROM storage.objects
" </dev/null
echo '=== Storage backend and Edge function directory presence (names only) ==='
for path in volumes/storage volumes/functions supabase/functions; do
  if test -d "$path"; then echo "LOCAL_PATH_${path//\//_}=PRESENT"; else echo "LOCAL_PATH_${path//\//_}=NOT_FOUND"; fi
done
echo 'LIVE_DESTINATION_PRECHECK=COMPLETE_READ_ONLY'
