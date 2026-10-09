#!/usr/bin/env bash
# Full Auth/Storage SCHEMA-ONLY bootstrap rehearsal; never accesses student records.
set -Eeuo pipefail
C=neis-restore-test
D=neis_restore_full_stage
cd /home/ubuntu/neis-supabase
docker() { sudo -n /usr/bin/docker "$@"; }
[[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$C")" == none ]] || exit 1
[[ "$(docker inspect -f '{{.Config.Image}}' "$C")" == supabase/postgres:17.6.1.136 ]] || exit 1
[[ "$(docker inspect -f '{{.State.Running}}' "$C")" == true ]] || exit 1
sql="$(mktemp)"
log="$(mktemp)"
chmod 600 "$sql" "$log"
trap 'rm -f "$sql" "$log"' EXIT
# No data copied from the live selfhosted database. It supplies exact versioned core DDL.
sudo -n docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml exec -T db pg_dump -U postgres -d postgres --schema-only --no-owner --no-acl --schema=auth --schema=storage </dev/null > "$sql"
grep -q 'CREATE TABLE' "$sql" || { echo 'BLOCKED: empty DDL'; exit 1; }
if grep -Eq '^(COPY |INSERT INTO |DROP DATABASE|CREATE DATABASE|ALTER ROLE )' "$sql"; then
  echo 'BLOCKED: unexpected SQL class'; exit 1
fi
echo 'AUTH_STORAGE_SCHEMA_ONLY_EXPORT=READY'
exists="$(docker exec "$C" psql -X -U supabase_admin -d postgres -Atqc "SELECT count(*) FROM pg_database WHERE datname='$D'")"
if [[ "$exists" == 0 ]]; then
  docker exec "$C" psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $D WITH TEMPLATE template0 OWNER supabase_admin" >/dev/null
  echo 'DISPOSABLE_STAGE_DB=CREATED'
elif [[ "$exists" != 1 ]]; then
  echo 'BLOCKED: ambiguous staging DB state'; exit 1
fi
table_count="$(docker exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('auth','storage') AND table_type='BASE TABLE'")"
if [[ "$table_count" -gt 0 ]]; then
  echo "DISPOSABLE_STAGE_EXISTING_TABLES=$table_count"
  [[ "$table_count" -ge 25 ]] || { echo 'BLOCKED: partial stage detected; will not reset'; exit 1; }
  echo 'BOOTSTRAP_ALREADY_APPLIED=CHECK_MANUALLY'
  exit 0
fi
echo 'Trying complete Auth/Storage DDL in disconnected new DB'
if docker exec -i "$C" psql -X -U supabase_admin -d "$D" -v ON_ERROR_STOP=1 -v VERBOSITY=default --single-transaction -f - < "$sql" > "$log" 2>&1; then
  echo 'FULL_AUTH_STORAGE_BOOTSTRAP=PASSED'
  docker exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT table_schema||'='||count(*) FROM information_schema.tables WHERE table_schema IN ('auth','storage') AND table_type='BASE TABLE' GROUP BY table_schema ORDER BY table_schema" </dev/null
else
  echo 'FULL_AUTH_STORAGE_BOOTSTRAP=FAILED_ROLLED_BACK'
  python3 - "$log" <<'PY'
from pathlib import Path
import re,sys
s=Path(sys.argv[1]).read_text(errors='replace')
m=re.search(r'psql:<stdin>:(\d+):\s*ERROR:\s*([^\r\n]+)',s)
if m:
    print('SQL_LINE='+m.group(1))
    msg=re.sub(r"'(?:''|[^'])*'",'[value]',m.group(2))
    msg=re.sub(r'"[^"]*"','[identifier]',msg)
    print('SQL_DIAGNOSTIC='+msg[:180])
else:
    print('SQL_DIAGNOSTIC=UNAVAILABLE')
PY
  exit 1
fi
