#!/usr/bin/env bash
# Read-only preflight. Never imports user data.
set -Eeuo pipefail
C=neis-restore-test
D=neis_restore_test
DATA=/home/ubuntu/neis-backups/cloud-20261009T130848Z/data.sql
docker() { sudo -n /usr/bin/docker "$@"; }
[[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$C")" == none ]] || exit 1
[[ "$(docker inspect -f '{{.Config.Image}}' "$C")" == supabase/postgres:17.6.1.136 ]] || exit 1
test -r "$DATA"
echo '=== Isolated Supabase destination prerequisite tables ==='
missing=0
for table in auth.users auth.identities storage.objects public.profiles; do
  exists="$(docker exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT to_regclass('$table') IS NOT NULL")"
  echo "$table=$exists"
  if [[ "$exists" != t ]]; then missing=1; fi
done
copy_count="$(grep -c '^COPY ' "$DATA")"
echo "SOURCE_COPY_BLOCKS=$copy_count"
[[ "$copy_count" -ge 90 ]] || exit 1
if [[ "$missing" != 0 ]]; then
  echo 'BLOCKED: missing auth/storage scaffolding; never import incomplete data'
  exit 1
fi
echo 'READY_FOR_STAGED_IMPORT_PLANNING (no import executed)'
