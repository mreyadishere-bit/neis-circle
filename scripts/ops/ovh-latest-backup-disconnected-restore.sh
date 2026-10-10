#!/usr/bin/env bash
set -Eeuo pipefail
# Restore latest archive schema AND data only inside disconnected test container.
dock() { sudo -n /usr/bin/docker "$@"; }
C=neis-restore-test
TARGET=neis_fresh_archive_20261010
[[ "$(dock inspect -f '{{.HostConfig.NetworkMode}}' "$C")" == none ]] || { echo 'RESTORE=BLOCKED_NETWORK'; exit 1; }
[[ "$(dock inspect -f '{{.State.Running}}' "$C")" == true ]] || { echo 'RESTORE=BLOCKED_CONTAINER'; exit 1; }
[[ "$(dock inspect -f '{{.Config.Image}}' "$C")" == supabase/postgres:17.6.1.136 ]] || { echo 'RESTORE=BLOCKED_IMAGE'; exit 1; }
shopt -s nullglob
set -- /home/ubuntu/neis-backups/cloud-import-*-38043355655/cloud.dump
[[ "$#" == 1 ]] || { echo 'RESTORE=BLOCKED_ARCHIVE_COUNT'; exit 1; }
archive="$1"
directory="$(dirname "$archive")"
[[ -s "$archive" && -s "$directory/cloud.sha256" ]] || { echo 'RESTORE=BLOCKED_ARCHIVE_FILES'; exit 1; }
[[ "$(sha256sum "$archive" | awk '{print $1}')" == "$(cat "$directory/cloud.sha256")" ]] || { echo 'RESTORE=BLOCKED_ARCHIVE_HASH'; exit 1; }
size="$(stat -c '%s' "$archive")"
free="$(df -B1 --output=avail /home/ubuntu/neis-backups | tail -1 | tr -d ' ')"
(( free > size * 8 + 1073741824 )) || { echo 'RESTORE=BLOCKED_DISK'; exit 1; }
temp="$(mktemp -d)"
chmod 700 "$temp"
cleanup() {
  dock exec "$C" rm -f /tmp/neis-20261010-archive.dump /tmp/neis-20261010-archive.list >/dev/null 2>&1 || true
  rm -rf "$temp"
}
trap cleanup EXIT
superuser="$(dock exec "$C" psql -X -U supabase_admin -d postgres -Atqc "SELECT rolname FROM pg_roles WHERE rolsuper AND rolcanlogin ORDER BY CASE WHEN rolname='supabase_admin' THEN 0 ELSE 1 END LIMIT 1")"
[[ -n "$superuser" ]] || { echo 'RESTORE=BLOCKED_SUPERUSER'; exit 1; }
dock cp "$archive" "$C:/tmp/neis-20261010-archive.dump"
dock exec "$C" pg_restore --list /tmp/neis-20261010-archive.dump >"$temp/full.list"
# Skip pg_cron: this isolated container cannot load cron into non-postgres DB.
python3 - "$temp/full.list" "$temp/filtered.list" <<'PY'
from pathlib import Path
import re,sys
data=Path(sys.argv[1]).read_text().splitlines(keepends=True)
result=[];cron_ext=0
for line in data:
    extension=bool(re.search(r'^\d+;.*\b(?:EXTENSION - pg_cron|COMMENT - EXTENSION pg_cron)\b',line))
    table=re.match(r'^\d+;\s+\d+\s+\d+\s+(TABLE DATA|SEQUENCE SET)\s+(\S+)\s+',line)
    if extension or (table and table.group(2)=='cron'):
        result.append(';'+line)
        cron_ext+=int(extension)
    else: result.append(line)
if cron_ext not in (1,2):raise SystemExit('RESTORE=BLOCKED_PGCRON_FILTER')
Path(sys.argv[2]).write_text(''.join(result))
print('RESTORE_PGCRON_EXTENSION_SKIPPED='+str(cron_ext))
PY
dock cp "$temp/filtered.list" "$C:/tmp/neis-20261010-archive.list"
exists="$(dock exec "$C" psql -X -U "$superuser" -d postgres -Atqc "SELECT count(*) FROM pg_database WHERE datname='$TARGET'")"
if [[ "$exists" == 0 ]]; then
  dock exec "$C" psql -X -U "$superuser" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $TARGET WITH TEMPLATE template0 OWNER $superuser" >/dev/null
  echo 'RESTORE_TEST_DATABASE=CREATED_DISCONNECTED'
  if ! dock exec "$C" pg_restore -U "$superuser" -d "$TARGET" --schema-only --no-owner --no-acl --exit-on-error -L /tmp/neis-20261010-archive.list /tmp/neis-20261010-archive.dump >"$temp/schema.log" 2>&1; then
    echo 'RESTORE=FAILED_ARCHIVE_SCHEMA_IMPORT'
    if grep -qi 'pg_cron\|extension' "$temp/schema.log";then echo 'SCHEMA_ERROR_CLASS=EXTENSION'
    elif grep -qi 'already exists' "$temp/schema.log";then echo 'SCHEMA_ERROR_CLASS=ALREADY_EXISTS'
    elif grep -qi 'does not exist' "$temp/schema.log";then echo 'SCHEMA_ERROR_CLASS=DEPENDENCY'
    else echo 'SCHEMA_ERROR_CLASS=OTHER';fi
    exit 1
  fi
elif [[ "$exists" == 1 ]]; then
  for table in auth.users public.profiles public.posts public.messages public.circle_messages public.notifications storage.objects; do
    count="$(dock exec "$C" psql -X -U "$superuser" -d "$TARGET" -Atqc "SELECT count(*) FROM $table")" || { echo 'RESTORE=BLOCKED_REUSE_QUERY'; exit 1; }
    [[ "$count" == 0 ]] || { echo 'RESTORE=BLOCKED_STAGE_NOT_EMPTY'; exit 1; }
  done
  echo 'RESTORE_TEST_DATABASE=REUSE_EMPTY_DISCONNECTED_STAGE'
else
  echo 'RESTORE=BLOCKED_AMBIGUOUS_DATABASE'; exit 1
fi
if ! dock exec "$C" pg_restore -U "$superuser" -d "$TARGET" --data-only --disable-triggers --no-owner --no-acl --exit-on-error --single-transaction -L /tmp/neis-20261010-archive.list /tmp/neis-20261010-archive.dump >"$temp/data.log" 2>&1; then
  if grep -Eqi 'relation.*does not exist|schema.*does not exist' "$temp/data.log";then echo 'DATA_ERROR_CLASS=MISSING_RELATION'
  elif grep -qi 'foreign key' "$temp/data.log";then echo 'DATA_ERROR_CLASS=FOREIGN_KEY'
  elif grep -qi 'duplicate key' "$temp/data.log";then echo 'DATA_ERROR_CLASS=DUPLICATE'
  elif grep -qi 'permission denied' "$temp/data.log";then echo 'DATA_ERROR_CLASS=PERMISSION'
  else echo 'DATA_ERROR_CLASS=OTHER';fi
  echo 'RESTORE=FAILED_DATA_IMPORT'; exit 1
fi
for item in 'USERS auth.users' 'PROFILES public.profiles' 'POSTS public.posts' 'CIRCLES public.circles' 'DM public.messages' 'CIRCLE_MESSAGES public.circle_messages' 'NOTIFICATIONS public.notifications' 'STORAGE storage.objects'; do
  read -r label table <<<"$item"
  count="$(dock exec "$C" psql -X -U "$superuser" -d "$TARGET" -Atqc "SELECT count(*) FROM $table")"
  [[ "$count" =~ ^[0-9]+$ ]] || { echo 'RESTORE=BLOCKED_COUNT'; exit 1; }
  echo "FRESH_STAGE_$label=$count"
done
echo 'RESTORE=SUCCESS_DISCONNECTED_TEST_ONLY'
echo 'PRODUCTION_DATABASE=UNCHANGED'
echo 'CUTOVER=NOT_PERFORMED'
