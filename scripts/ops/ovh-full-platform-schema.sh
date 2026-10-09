#!/usr/bin/env bash
# Platform schema only, using existing Auth/Storage bootstrap in disconnected test DB.
set -Eeuo pipefail
C=neis-restore-test
D=neis_restore_full_stage
ORIGINAL=/home/ubuntu/neis-backups/cloud-20261009T130848Z/schema.sql
docker() { sudo -n /usr/bin/docker "$@"; }
[[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$C")" == none ]] || exit 1
[[ "$(docker inspect -f '{{.Config.Image}}' "$C")" == supabase/postgres:17.6.1.136 ]] || exit 1
test -r "$ORIGINAL"
precheck="$(docker exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('auth','storage') AND table_type='BASE TABLE'")"
[[ "$precheck" -ge 30 ]] || { echo 'BLOCKED: Auth/Storage bootstrap missing'; exit 1; }
existing="$(docker exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','private') AND table_type='BASE TABLE'")"
if [[ "$existing" -gt 0 ]]; then
  echo "ALREADY_PRESENT_PLATFORM_TABLES=$existing"
  [[ "$existing" -ge 60 ]] || exit 1
  exit 0
fi
filtered="$(mktemp)"
log="$(mktemp)"
chmod 600 "$filtered" "$log"
trap 'rm -f "$filtered" "$log"' EXIT
python3 - "$ORIGINAL" "$filtered" <<'PY'
from pathlib import Path
import re,sys
source=Path(sys.argv[1]).read_text()
pattern=r'(?im)^[ \t]*CREATE EXTENSION IF NOT EXISTS "?pg_cron"? WITH SCHEMA "?[a-z_]+"?;[ \t]*$'
filtered,count=re.subn(pattern,'-- pg_cron omitted in separate disconnected database only',source)
if count!=1: raise SystemExit('BLOCKED: unexpected pg_cron extension pattern')
Path(sys.argv[2]).write_text(filtered)
print('DISCONNECTED_TEST_PG_CRON=OMITTED')
PY
echo 'Applying full platform schema transactionally to disconnected test database'
if docker exec -i "$C" psql -X -U supabase_admin -d "$D" -v ON_ERROR_STOP=1 -v VERBOSITY=default --single-transaction -f - < "$filtered" > "$log" 2>&1; then
  echo 'PLATFORM_SCHEMA_BOOTSTRAP=PASSED'
  docker exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT table_schema||'='||count(*) FROM information_schema.tables WHERE table_schema IN ('public','private') AND table_type='BASE TABLE' GROUP BY table_schema ORDER BY table_schema" </dev/null
else
  echo 'PLATFORM_SCHEMA_BOOTSTRAP=FAILED_ROLLED_BACK'
  python3 - "$log" <<'PY'
from pathlib import Path
import re,sys
s=Path(sys.argv[1]).read_text(errors='replace')
m=re.search(r'psql:<stdin>:(\d+):\s*ERROR:\s*([^\r\n]+)',s)
if m:
    print('SQL_LINE='+m.group(1))
    msg=re.sub(r"'(?:''|[^'])*'",'[value]',m.group(2))
    msg=re.sub(r'"[^"]*"','[identifier]',msg)
    print('SQL_DIAGNOSTIC='+msg[:150])
else: print('SQL_DIAGNOSTIC=UNAVAILABLE')
PY
  exit 1
fi
