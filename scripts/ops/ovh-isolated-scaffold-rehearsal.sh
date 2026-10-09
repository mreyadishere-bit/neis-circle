#!/usr/bin/env bash
# Read-only inspection of initialized Supabase + transactional DDL rehearsal in disconnected disposable test.
set -Eeuo pipefail
C=neis-restore-test
D=neis_restore_test
cd /home/ubuntu/neis-supabase
docker() { sudo -n /usr/bin/docker "$@"; }
[[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$C")" == none ]] || exit 1
[[ "$(docker inspect -f '{{.Config.Image}}' "$C")" == supabase/postgres:17.6.1.136 ]] || exit 1
[[ "$(docker inspect -f '{{.State.Running}}' "$C")" == true ]] || exit 1
# Strongly restrict target. No docker exec into running primary database for writes.
target_status="$(docker exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT current_database()")"
[[ "$target_status" == "$D" ]] || exit 1
tmp="$(mktemp)"
chmod 600 "$tmp"
trap 'rm -f "$tmp"' EXIT
echo "Exporting DDL only (no INSERT/COPY) from initialized OVH Supabase DB"
# Run pg_dump in the database service for exact authentic DDL, never student data.
sudo -n docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml exec -T db pg_dump -U postgres -d postgres --schema-only --no-owner --no-acl --table=auth.identities --table=storage.buckets --table=storage.objects </dev/null > "$tmp"
grep -q 'CREATE TABLE' "$tmp" || { echo 'ABORT: no table definitions'; exit 1; }
if grep -Eq '^(COPY |INSERT INTO |ALTER ROLE |DROP TABLE|DROP SCHEMA|CREATE ROLE)' "$tmp"; then
  echo 'ABORT: unexpected unsafe statement in DDL dump'
  exit 1
fi
# Never write into main OVH database. Missing scaffolding only.
echo "Schema-only trial in disconnected test DB, transaction rollback on error"
log="$(mktemp)"
chmod 600 "$log"
trap 'rm -f "$tmp" "$log"' EXIT
if docker exec -i "$C" psql -X -U supabase_admin -d "$D" -v ON_ERROR_STOP=1 -v VERBOSITY=default --single-transaction -f - < "$tmp" > "$log" 2>&1; then
  echo 'ISOLATED_SCAFFOLD_IMPORT=PASSED'
  docker exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('auth','identities'),('storage','objects'),('storage','buckets')) ORDER BY 1" </dev/null
else
  echo 'ISOLATED_SCAFFOLD_IMPORT=BLOCKED (transaction rolled back)'
  # The imported artifact is DDL-only (no data). Redact quoted values and return just the first PostgreSQL error.
  python3 - "$log" <<'PY'
from pathlib import Path
import re,sys
log=Path(sys.argv[1]).read_text(errors='replace')
m=re.search(r'psql:<stdin>:(\d+):\s*ERROR:\s*([^\r\n]+)',log)
if not m:
    print('SQL_ERROR=UNCLASSIFIED')
else:
    message=re.sub(r"'(?:''|[^'])*'", "'[redacted]'", m.group(2))
    message=re.sub(r'"[^"]*"', '"[identifier]"', message)
    print('SQL_LINE='+m.group(1))
    print('SQL_ERROR_SUMMARY='+message[:200])
    # SQL identifiers in schema-only DDL are not student records or credentials.
    # Permit only a safe PostgreSQL type identifier for precise dependency diagnosis.
    found=re.search(r'type "([A-Za-z_][A-Za-z_0-9.]*)" does not exist', m.group(2))
    if found: print('MISSING_TYPE='+found.group(1))
PY
  exit 1
fi
