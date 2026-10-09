#!/usr/bin/env bash
set -Eeuo pipefail
dock() { sudo -n /usr/bin/docker "$@"; }
C=neis-restore-test
D=neis_fresh_pgcron_retry_37988124956
test "$(dock inspect -f '{{.HostConfig.NetworkMode}}' "$C")" = none
test "$(dock inspect -f '{{.State.Running}}' "$C")" = true
shopt -s nullglob
archives=(/home/ubuntu/neis-backups/cloud-import-*-37988124956/cloud.dump)
test "${#archives[@]}" = 1
archive="${archives[0]}"
expected="$(cat "$(dirname "$archive")/cloud.sha256")"
test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$expected"
exists="$(dock exec "$C" psql -X -U supabase_admin -d postgres -Atqc "SELECT count(*) FROM pg_database WHERE datname='$D'")"
test "$exists" = 0 || { echo "RETRY=EXISTING_STAGE_ABORT"; exit 1; }
temp="$(mktemp -d)"
chmod 700 "$temp"
trap 'rm -rf "$temp"' EXIT
# pg_cron can be installed only in the designated postgres DB in this image.
# Filter exactly the pg_cron extension TOC entries for this disconnected test.
dock exec -i "$C" pg_restore --list < "$archive" > "$temp/full.list"
python3 - "$temp/full.list" "$temp/filtered.list" <<'PY'
import sys,re
from pathlib import Path
lines=Path(sys.argv[1]).read_text().splitlines(keepends=True)
out=[]; skipped=0
for line in lines:
 if re.search(r'^\d+;.*\b(?:EXTENSION - pg_cron|COMMENT - EXTENSION pg_cron)\b',line):
  out.append(';'+line); skipped+=1
 else:out.append(line)
if skipped not in (1,2):
 raise SystemExit('RETRY=UNEXPECTED_PGCRON_ARCHIVE_ENTRIES_'+str(skipped))
Path(sys.argv[2]).write_text(''.join(out))
print('PGCRON_ENTRIES_SKIPPED='+str(skipped))
PY
dock exec "$C" psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $D OWNER supabase_admin TEMPLATE template0" >/dev/null
echo 'ISOLATED_RETRY_DB=CREATED'
# Archive restored as PostgreSQL schema only; data import comes only after this passes.
# --use-list is read from stdin: archive must be available as a temporary internal file.
# Copying into the isolated container leaves production untouched.
dock cp "$archive" "$C:/tmp/neis-fresh-37988124956.dump"
trap 'dock exec "$C" rm -f /tmp/neis-fresh-37988124956.dump >/dev/null 2>&1 || true; rm -rf "$temp"' EXIT
if dock exec -i "$C" pg_restore -U supabase_admin -d "$D" --schema-only --no-owner --no-acl --exit-on-error -L /dev/stdin /tmp/neis-fresh-37988124956.dump < "$temp/filtered.list" >"$temp/restore.log" 2>&1; then
 echo 'FRESH_SCHEMA_PGCRON_RETRY=PASS'
 dock exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT 'PUBLIC_TABLES='||count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" </dev/null
else
 echo 'FRESH_SCHEMA_PGCRON_RETRY=FAIL'
 if grep -qi 'permission denied\|must be superuser' "$temp/restore.log"; then echo 'ERROR_CLASS=PERMISSION'
 elif grep -qi 'extension' "$temp/restore.log"; then echo 'ERROR_CLASS=EXTENSION'
 elif grep -qi 'already exists' "$temp/restore.log"; then echo 'ERROR_CLASS=ALREADY_EXISTS'
 elif grep -qi 'does not exist' "$temp/restore.log"; then echo 'ERROR_CLASS=MISSING_DEPENDENCY'
 else echo 'ERROR_CLASS=OTHER'; fi
 exit 1
fi
echo 'PRODUCTION=UNCHANGED'
