#!/usr/bin/env bash
# METADATA ONLY: inspect exact Supabase base tables. Does not import, create, or modify anything.
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
docker() { sudo -n /usr/bin/docker "$@"; }
test -f docker-compose.yml
test -f docker-compose.security.yml
test -f docker-compose.caddy.yml
c=neis-restore-test
[[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$c")" == none ]] || { echo 'BLOCKED: test container not network isolated'; exit 1; }
[[ "$(docker inspect -f '{{.Config.Image}}' "$c")" == supabase/postgres:17.6.1.136 ]] || { echo 'BLOCKED: wrong test image'; exit 1; }
echo '=== OVH initialized Supabase table availability (metadata only) ==='
# Explicitly target the Compose db service. No queries print row data or secrets.
sudo -n docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml exec -T db psql -X -U postgres -d postgres -Atqc "SELECT n.nspname||'.'||c.relname||'='||c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('auth','users'),('auth','identities'),('storage','objects'),('storage','buckets')) ORDER BY n.nspname,c.relname"
echo '=== Test DB table availability ==='
docker exec "$c" psql -X -U supabase_admin -d neis_restore_test -Atqc "SELECT n.nspname||'.'||c.relname||'='||c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('auth','users'),('auth','identities'),('storage','objects'),('storage','buckets')) ORDER BY n.nspname,c.relname"
echo '=== Table column definitions: production OVH scaffold metadata, no values ==='
sudo -n docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml exec -T db psql -X -U postgres -d postgres -Atqc "SELECT table_schema||'.'||table_name||'.'||column_name||':'||data_type FROM information_schema.columns WHERE (table_schema,table_name) IN (('auth','identities'),('storage','objects')) ORDER BY table_schema,table_name,ordinal_position"
echo 'SCAFFOLD_AUDIT_COMPLETE=READ_ONLY'
