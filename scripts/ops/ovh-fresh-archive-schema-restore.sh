#!/usr/bin/env bash
set -Eeuo pipefail
dock() { sudo -n /usr/bin/docker "$@"; }
C=neis-restore-test
D=neis_fresh_restore_37988124956
test "$(dock inspect -f '{{.HostConfig.NetworkMode}}' "$C")" = none
test "$(dock inspect -f '{{.State.Running}}' "$C")" = true
test "$(dock inspect -f '{{.Config.Image}}' "$C")" = supabase/postgres:17.6.1.136
shopt -s nullglob
files=(/home/ubuntu/neis-backups/cloud-import-*-37988124956/cloud.dump)
[[ "${#files[@]}" == 1 ]] || { echo "FRESH_ARCHIVE=BLOCKED_EXPECTED_ONE"; exit 1; }
archive="${files[0]}"
folder="$(dirname "$archive")"
test -s "$archive"
expected="$(cat "$folder/cloud.sha256")"
actual="$(sha256sum "$archive" | cut -d' ' -f1)"
[[ "$expected" == "$actual" ]] || { echo "FRESH_ARCHIVE=HASH_MISMATCH"; exit 1; }
echo "FRESH_ARCHIVE=VERIFIED"
size="$(stat -c %s "$archive")"
echo "FRESH_ARCHIVE_BYTES=$size"
tmp="$(mktemp -d)"
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT
# List archive inventory locally, not student data.
if ! dock exec "$C" pg_restore --version >/dev/null 2>&1; then echo "PG_RESTORE=UNAVAILABLE"; exit 1; fi
# The target is an entirely NEW database inside the disconnected container.
exists="$(dock exec "$C" psql -X -U supabase_admin -d postgres -Atqc "SELECT count(*) FROM pg_database WHERE datname='$D'")"
[[ "$exists" == 0 ]] || { echo "FRESH_STAGE=ALREADY_EXISTS_NO_OVERWRITE"; exit 1; }
dock exec "$C" psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $D OWNER supabase_admin TEMPLATE template0" >/dev/null
echo "FRESH_STAGE=CREATED_ISOLATED"
# Stream the archive into the disconnected container using Docker exec stdin.
log="$tmp/restore.log"
if dock exec -i "$C" pg_restore -U supabase_admin -d "$D" --schema-only --no-owner --no-acl --exit-on-error -F c >"$log" 2>&1 <"$archive"; then
 echo "FRESH_SCHEMA_RESTORE=PASS"
 dock exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT 'RESTORED_PUBLIC_TABLES='||count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" </dev/null
else
 echo "FRESH_SCHEMA_RESTORE=FAILED_ISOLATED"
 # Only classify, never publish raw SQL diagnostics that may expose user content.
 if grep -qi 'already exists' "$log"; then echo "RESTORE_ERROR_CLASS=ALREADY_EXISTS"
 elif grep -qi 'permission denied\|must be superuser' "$log"; then echo "RESTORE_ERROR_CLASS=PERMISSIONS"
 elif grep -qi 'extension\|pg_cron' "$log"; then echo "RESTORE_ERROR_CLASS=EXTENSION"
 elif grep -qi 'role' "$log"; then echo "RESTORE_ERROR_CLASS=ROLE"
 elif grep -qi 'unsupported version' "$log"; then echo "RESTORE_ERROR_CLASS=VERSION"
 else echo "RESTORE_ERROR_CLASS=OTHER"; fi
 exit 1
fi
echo "PRODUCTION_DB=UNTOUCHED"
