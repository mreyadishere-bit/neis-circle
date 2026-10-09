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
# Storage tables depend on storage.buckettype. Extract only that enum from the
# initialized OVH database and prepend its authentic values, without row data.
enum_values="$(sudo -n docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml exec -T db psql -X -U postgres -d postgres -Atqc "SELECT quote_literal(e.enumlabel) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='storage' AND t.typname='buckettype' ORDER BY e.enumsortorder" </dev/null)"
if [[ -z "$enum_values" ]]; then echo 'ABORT: storage.buckettype enum absent from source'; exit 1; fi
# Permit only safely quoted enum literals generated server-side via quote_literal.
enum_sql="$(printf '%s\n' "$enum_values" | paste -sd, -)"

echo 'TEST_ONLY_DEPENDENCY=storage.buckettype enum recreated from initialized metadata'
# Exact Storage function definition, sourced read-only from the running OVH
# Supabase database. Only the disconnected test receives the SQL.
func_file="$(mktemp)"
chmod 600 "$func_file"
trap 'rm -f "$tmp" "$func_file"' EXIT
sudo -n docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml exec -T db psql -X -U postgres -d postgres -Atqc "SELECT pg_get_functiondef('storage.enforce_bucket_name_length()'::regprocedure)" </dev/null > "$func_file"
if ! grep -Eq '^CREATE OR REPLACE FUNCTION storage[.]enforce_bucket_name_length[(][)]' "$func_file"; then
  echo 'ABORT: expected Storage function definition not found'; exit 1
fi
# Append exact function DDL before any table statements; no app/user rows exported.
combined="$(mktemp)"
chmod 600 "$combined"
trap 'rm -f "$tmp" "$func_file" "$combined"' EXIT
{
  printf '%s\n' "CREATE TYPE storage.buckettype AS ENUM ($enum_sql);"
  cat "$func_file"
  cat "$tmp"
} > "$combined"
mv "$combined" "$tmp"
echo 'TEST_ONLY_DEPENDENCY=storage.enforce_bucket_name_length function copied as DDL only'

# Source the second required trigger function DDL from initialized Storage only.
second_function="$(mktemp)"
chmod 600 "$second_function"
trap 'rm -f "$tmp" "$func_file" "$second_function"' EXIT
sudo -n docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml exec -T db psql -X -U postgres -d postgres -Atqc "SELECT pg_get_functiondef('storage.protect_bucket_control_columns()'::regprocedure)" </dev/null > "$second_function"
if ! grep -Fq 'protect_bucket_control_columns' "$second_function"; then
  echo 'ABORT: required trigger function missing'; exit 1
fi
prepended="$(mktemp)"
chmod 600 "$prepended"
python3 - "$tmp" "$second_function" "$prepended" <<'PY'
from pathlib import Path
import sys
sql=Path(sys.argv[1]).read_text()
function=Path(sys.argv[2]).read_text().strip()
# Insert the dependency before the first table definition; after the enum.
marker='\nCREATE TABLE '
position=sql.find(marker)
if position < 0 or 'CREATE TYPE storage.buckettype' not in sql[:position]:
    raise SystemExit('ABORT: cannot safely determine DDL ordering')
Path(sys.argv[3]).write_text(sql[:position]+'\n'+function+'\n'+sql[position:])
PY
mv "$prepended" "$tmp"
echo 'TEST_ONLY_DEPENDENCY=storage.protect_bucket_control_columns loaded for rehearsal'


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
  python3 - "$log" "$tmp" <<'PY'
from pathlib import Path
import re,sys
message=Path(sys.argv[1]).read_text(errors='replace')
m=re.search(r'psql:<stdin>:(\d+):\s*ERROR:\s*([^\r\n]+)',message)
if m:
    print('SQL_LINE='+m.group(1))
    lines=Path(sys.argv[2]).read_text(errors='replace').splitlines()
    i=int(m.group(1))
    if 1 <= i <= len(lines):
        line=lines[i-1].strip()
        print('ERROR_LINE_LENGTH='+str(len(line)))
        print('ERROR_LINE_PUNCTUATION='+''.join(c for c in line if c in '$();')[:30])
    err=re.sub(r'"[^"]*"','"[identifier]"',m.group(2))
    print('ERROR_SUMMARY='+err[:160])
else:
    print('SQL_ERROR=UNCLASSIFIED')
PY
  exit 1
fi
