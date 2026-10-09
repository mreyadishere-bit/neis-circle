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
# Do not replay schema when previously restored in this disconnected test database.
existing="$(docker exec "$container" psql -X -U supabase_admin -d "$database" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','private') AND table_type='BASE TABLE'")"
if [[ "$existing" == "62" ]]; then
  echo "SCHEMA_RESTORE_TEST=PASSED_PREVIOUSLY (62 existing tables)"
  exit 0
elif [[ "$existing" != "0" ]]; then
  echo "::error::Unexpected partial schema ($existing tables); refusing to overwrite"
  exit 1
fi
# Schema-only exercise. Single transaction rolls back schema changes on any SQL error.
log="$(mktemp)"
filtered="$(mktemp)"
chmod 600 "$log" "$filtered"
trap 'rm -f "$log" "$filtered"' EXIT
# In Supabase's PostgreSQL image pg_cron is attached to the postgres database,
# not neis_restore_test. This isolated schema rehearsal cannot CREATE it here.
# Exclude only its CREATE EXTENSION statement from a TEMPORARY SQL copy.
# Fail closed if the expected statement is absent or unexpectedly duplicated.
python3 - "$schema" "$filtered" <<'PY'
from pathlib import Path
import re, sys
original=Path(sys.argv[1]).read_text()
pattern = r'(?im)^[ \t]*CREATE EXTENSION IF NOT EXISTS "?pg_cron"? WITH SCHEMA "?[a-z_]+"?;[ \t]*$'
updated, count = re.subn(pattern, '-- pg_cron omitted only for the isolated rehearsal', original)
if count != 1:
    raise SystemExit('ABORT: expected exactly one pg_cron extension statement; found ' + str(count))
Path(sys.argv[2]).write_text(updated)
print('TEST_ONLY_ADAPTATION=pg_cron extension skipped in disposable DB')
PY
echo "=== Disposable database privilege preflight ==="
docker exec "$container" psql -U postgres -d "$database" -Atqc \
  "SELECT 'CURRENT_USER='||current_user UNION ALL SELECT 'DATABASE_OWNER='||pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database() UNION ALL SELECT 'CAN_CREATE_SCHEMA='||has_database_privilege(current_user,current_database(),'CREATE')"
# PostgreSQL image assigns the disposable DB to supabase_admin, not postgres.
# Verify the owner can connect and CREATE before trying any SQL restore.
if ! owner_access="$(docker exec "$container" psql -X -U supabase_admin -d "$database" -Atqc "SELECT current_user||':'||has_database_privilege(current_user,current_database(),'CREATE')" 2>/dev/null)"; then
  echo "::error::Disposable database owner login unavailable; no permission changes made"
  exit 1
fi
if [[ "$owner_access" != "supabase_admin:true" ]]; then
  echo "::error::Disposable database owner lacks CREATE; no permission changes made"
  exit 1
fi
echo "RESTORE_ROLE=supabase_admin (isolated database owner)"
echo "Trying schema.sql in isolated $container/$database (single transaction)."
if docker exec -i "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate --single-transaction -f - < "$filtered" > "$log" 2>&1; then
  echo "SCHEMA_RESTORE_TEST=PASSED"
  docker exec "$container" psql -U postgres -d "$database" -Atqc "SELECT table_schema||'='||count(*) FROM information_schema.tables WHERE table_schema IN ('public','private') AND table_type='BASE TABLE' GROUP BY table_schema ORDER BY table_schema"
else
  echo "::error::SCHEMA_RESTORE_TEST=FAILED (disposable environment only)"
  # Do not publish raw SQL or secrets into GitHub Actions logs.
  # Print only the SQLSTATE and line number, never raw SQL, secrets or database rows.
  python3 - "$log" <<'PY'
import re, sys
from pathlib import Path
content = Path(sys.argv[1]).read_text(errors='replace')
match = re.search(r'psql:<stdin>:(\d+):\s*ERROR:\s*([A-Z0-9]{5})', content)
if match:
    print(f"SQL_ERROR_LINE={match.group(1)}")
    print(f"SQLSTATE={match.group(2)}")
    line_no=int(match.group(1))
    schema_lines=Path("/home/ubuntu/neis-backups/cloud-20261009T130848Z/schema.sql").read_text(errors="replace").splitlines()
    # Print ONLY structural tokens: do not publish literal SQL, credentials or data.
    if 0 < line_no <= len(schema_lines):
        line=schema_lines[line_no-1]
        without_strings=re.sub(r"'(?:''|[^'])*'|\\$\\$.*?\\$\\$", " ", line)
        structural=re.findall(r"[A-Za-z_][A-Za-z_0-9]*", without_strings)
        print("SQL_LINE_TOKENS=" + " ".join(structural[:8])[:120])
    # Classify the error in the private log without exposing the error message itself.
    m=re.search(r'psql:<stdin>:\\d+:\\s*ERROR:\\s*[A-Z0-9]{5}:?\\s*([^\\r\\n]*)',content)
    if m:
        msg=m.group(1).lower()
        categories={'extension':'EXTENSION','already exists':'ALREADY_EXISTS','permission':'PERMISSIONS','superuser':'SUPERUSER','schema':'SCHEMA','role':'ROLE','database':'DATABASE','cron':'PG_CRON','vault':'VAULT','realtime':'REALTIME','pg_net':'PG_NET','postgres':'POSTGRES'}
        print("ERROR_HINTS=" + (",".join(v for k,v in categories.items() if k in msg) or "OTHER"))
else:
    print("SQLSTATE=UNAVAILABLE (raw error kept private on runner only)")
PY
  echo "Original SQL logs not exposed in GitHub Actions."
  exit 1
fi

