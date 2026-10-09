#!/usr/bin/env bash
set -Eeuo pipefail
dock() { sudo -n /usr/bin/docker "$@"; }
C=neis-restore-test
test "$(dock inspect -f '{{.HostConfig.NetworkMode}}' "$C")" = none
shopt -s nullglob
archives=(/home/ubuntu/neis-backups/cloud-import-*-37988124956/cloud.dump)
test "${#archives[@]}" = 1
D=neis_fresh_restore_37988124956
# Read the isolated database only, report extension names and installability.
dock exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT 'STAGE_EXTENSION='||extname FROM pg_extension ORDER BY extname" </dev/null
dock exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT 'AVAILABLE_EXTENSION='||name FROM pg_available_extensions WHERE name IN ('pg_cron','pg_net','pgcrypto','uuid-ossp','vector','pg_graphql','pgjwt','http','vault') ORDER BY name" </dev/null
echo "EXTENSION_DIAGNOSTIC=READ_ONLY"
