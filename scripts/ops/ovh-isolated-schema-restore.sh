#!/usr/bin/env bash
# Restore ONLY the SQL schema into an explicitly checked, isolated disposable test container.
# No production databases, storage, authentication sessions, or student records are modified.
set -Eeuo pipefail
container=neis-restore-test
database=neis_restore_test
schema=/home/ubuntu/neis-backups/cloud-20261009T130848Z/schema.sql
test -r "$schema" || { echo "::error::Schema snapshot unavailable"; exit 1; }
docker() { sudo -n /usr/bin/docker "$@"; }
running="$(docker inspect -f '{{.State.Running}}' "$container")"
network="$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$container")"
image="$(docker inspect -f '{{.Config.Image}}' "$container")"
if [[ "$running" != "true" || "$network" != "none" || "$image" != "supabase/postgres:17.6.1.136" ]]; then
  echo "::error::Aborted: disposable container isolation/image check failed"
  exit 1
fi
db_exists="$(docker exec "$container" psql -U postgres -d postgres -Atqc "SELECT count(*) FROM pg_database WHERE datname='$database'")"
[[ "$db_exists" == "1" ]] || { echo "::error::Disposable test database not found"; exit 1; }
# Schema-only exercise. Single transaction rolls back schema changes on any SQL error.
log="$(mktemp)"
chmod 600 "$log"
trap 'rm -f "$log"' EXIT
echo "Trying schema.sql in isolated $container/$database (single transaction)."
if docker exec -i "$container" psql -X -U postgres -d "$database" -v ON_ERROR_STOP=1 --single-transaction -f - < "$schema" > "$log" 2>&1; then
  echo "SCHEMA_RESTORE_TEST=PASSED"
  docker exec "$container" psql -U postgres -d "$database" -Atqc "SELECT table_schema||'='||count(*) FROM information_schema.tables WHERE table_schema IN ('public','private') AND table_type='BASE TABLE' GROUP BY table_schema ORDER BY table_schema"
else
  echo "::error::SCHEMA_RESTORE_TEST=FAILED (disposable environment only)"
  # Do not publish raw SQL or secrets into GitHub Actions logs.
  echo "A statement was rejected; transaction should have rolled back. Inspect locally before adjusting the test."
  exit 1
fi
