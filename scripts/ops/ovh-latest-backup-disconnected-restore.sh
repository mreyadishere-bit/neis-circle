#!/usr/bin/env bash
set -Eeuo pipefail
# Disconnected disposable OVH restore only. Never writes live database or proxy.
dock() { sudo -n /usr/bin/docker "$@"; }
C=neis-restore-test
SOURCE=neis_fresh_pgcron_retry_37988124956
TARGET=neis_fresh_20261010_verified
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
  dock exec "$C" rm -f /tmp/neis-20261010-verification.dump /tmp/neis-20261010-filtered.list >/dev/null 2>&1 || true
  rm -rf "$temp"
}
trap cleanup EXIT
superuser="$(dock exec "$C" psql -X -U supabase_admin -d postgres -Atqc "SELECT rolname FROM pg_roles WHERE rolsuper AND rolcanlogin ORDER BY CASE WHEN rolname='supabase_admin' THEN 0 ELSE 1 END LIMIT 1")"
[[ -n "$superuser" ]] || { echo 'RESTORE=BLOCKED_SUPERUSER'; exit 1; }
exists="$(dock exec "$C" psql -X -U "$superuser" -d postgres -Atqc "SELECT count(*) FROM pg_database WHERE datname='$TARGET'")"
if [[ "$exists" == 0 ]]; then
  if ! dock exec "$C" pg_dump -U "$superuser" -d "$SOURCE" --schema-only --no-owner --no-acl >"$temp/schema.sql" 2>"$temp/schema.err"; then
    echo 'RESTORE=BLOCKED_SCHEMA_EXPORT'; exit 1
  fi
  [[ -s "$temp/schema.sql" ]] || { echo 'RESTORE=BLOCKED_EMPTY_SCHEMA'; exit 1; }
  dock exec "$C" psql -X -U "$superuser" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $TARGET WITH TEMPLATE template0 OWNER $superuser" >/dev/null
  echo 'RESTORE_TEST_DATABASE=CREATED_DISCONNECTED'
  if ! dock exec -i "$C" psql -X -U "$superuser" -d "$TARGET" -v ON_ERROR_STOP=1 --single-transaction -f - <"$temp/schema.sql" >"$temp/schema.log" 2>&1; then
    echo 'RESTORE=FAILED_SCHEMA_IMPORT'; exit 1
  fi
elif [[ "$exists" == 1 ]]; then
  # Prior data-only restore failed atomically. Reuse only after verifying empty.
  for table in auth.users public.profiles public.posts public.messages public.circle_messages public.notifications storage.objects; do
    count="$(dock exec "$C" psql -X -U "$superuser" -d "$TARGET" -Atqc "SELECT count(*) FROM $table")" || { echo 'RESTORE=BLOCKED_REUSE_QUERY'; exit 1; }
    [[ "$count" == 0 ]] || { echo 'RESTORE=BLOCKED_STAGE_NOT_EMPTY'; exit 1; }
  done
  echo 'RESTORE_TEST_DATABASE=REUSE_EMPTY_DISCONNECTED_STAGE'
else
  echo 'RESTORE=BLOCKED_AMBIGUOUS_DB'; exit 1
fi
dock cp "$archive" "$C:/tmp/neis-20261010-verification.dump"
dock exec "$C" pg_restore --list /tmp/neis-20261010-verification.dump >"$temp/archive.list"
python3 - "$temp/archive.list" "$temp/filtered.list" <<'PY'
from pathlib import Path
import re,sys
source=Path(sys.argv[1]).read_text().splitlines(keepends=True)
output=[]
for line in source:
    m=re.match(r'^\d+;\s+\d+\s+\d+\s+(TABLE DATA|SEQUENCE SET)\s+(\S+)\s+',line)
    output.append(';'+line if m and m.group(2)=='cron' else line)
Path(sys.argv[2]).write_text(''.join(output))
PY
dock cp "$temp/filtered.list" "$C:/tmp/neis-20261010-filtered.list"
if ! dock exec "$C" pg_restore -U "$superuser" -d "$TARGET" --data-only --disable-triggers --no-owner --no-acl --exit-on-error --single-transaction -L /tmp/neis-20261010-filtered.list /tmp/neis-20261010-verification.dump >"$temp/data.log" 2>&1; then
  python3 - "$temp/data.log" <<'PY'
from pathlib import Path
import re,sys
data=Path(sys.argv[1]).read_text(errors='replace').lower()
rules=[
 ('SCHEMA_OR_RELATION_MISSING',r'(relation|schema|table)\s+"[^"]+"\s+does not exist'),
 ('COLUMN_MISSING',r'column\s+"[^"]+"\s+.*does not exist'),
 ('FK_VIOLATION',r'foreign key constraint'),
 ('UNIQUE_VIOLATION',r'duplicate key value'),
 ('UNDEFINED_ROLE',r'role\s+"[^"]+"\s+does not exist'),
 ('PERMISSION',r'permission denied|must be owner'),
 ('INVALID_DATA',r'invalid input syntax|invalid byte sequence'),
 ('ARCHIVE',r'unsupported version|could not read from input file'),
 ('EXTENSION',r'extension\s+"[^"]+"'),
 ('TABLE_DEFINITION',r'has no column named|extra data after last expected column'),
]
for code,pattern in rules:
 if re.search(pattern,data):
  print('RESTORE_ERROR_CLASS='+code)
  break
else:
 print('RESTORE_ERROR_CLASS=OTHER')
print('RESTORE_PRIVATE_LOG_DISCLOSED=NO')
PY
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
