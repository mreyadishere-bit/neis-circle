#!/usr/bin/env bash
set -Eeuo pipefail
dock() { sudo -n /usr/bin/docker "$@"; }
C=neis-restore-test
D=neis_fresh_pgcron_retry_37988124956
test "$(dock inspect -f '{{.HostConfig.NetworkMode}}' "$C")" = none
test "$(dock inspect -f '{{.State.Running}}' "$C")" = true
for t in auth.users public.profiles public.posts public.messages public.circle_messages public.notifications storage.objects; do
 n="$(dock exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT count(*) FROM $t")"
 test "$n" = 0 || { echo 'STAGED_DATA=BLOCKED_NONEMPTY'; exit 1; }
done
shopt -s nullglob
archives=(/home/ubuntu/neis-backups/cloud-import-*-37988124956/cloud.dump)
test "${#archives[@]}" = 1
archive="${archives[0]}"
test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$(cat "$(dirname "$archive")/cloud.sha256")"
tmp="$(mktemp -d)"
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT
# Use the same archive. Restore only COPY data and sequence state, not schema.
# Preserve original archive in the disconnected container from previous rehearsal.
if ! dock exec "$C" test -r /tmp/neis-fresh-37988124956.dump; then
 dock cp "$archive" "$C:/tmp/neis-fresh-37988124956.dump"
fi
# Foreign keys referencing other restored tables can reject COPY ordering.
# Use a verified superuser to disable only user triggers within the restore transaction.
is_superuser="$(dock exec "$C" psql -X -U postgres -d "$D" -Atqc "SELECT rolsuper FROM pg_roles WHERE rolname='postgres'")"
test "$is_superuser" = t || { echo 'DATA_RETRY=POSTGRES_NOT_SUPERUSER'; exit 1; }
echo 'DATA_RETRY=FK_SAFE_TRANSACTION'
if dock exec "$C" pg_restore -U postgres -d "$D" --data-only --disable-triggers --no-owner --no-acl --exit-on-error --single-transaction /tmp/neis-fresh-37988124956.dump >"$tmp/restore.log" 2>&1; then
 echo 'FRESH_DATA_RESTORE=PASS'
 for t in auth.users public.profiles public.posts public.messages public.circle_messages public.notifications storage.objects; do
  dock exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT 'COUNT_'||'$t'||'='||count(*) FROM $t" </dev/null
 done
else
 echo 'FRESH_DATA_RESTORE=FAILED_ROLLED_BACK'
 if grep -qi 'does not exist' "$tmp/restore.log";then echo 'DATA_ERROR_CLASS=MISSING_SCHEMA'
 elif grep -qi 'permission denied' "$tmp/restore.log";then echo 'DATA_ERROR_CLASS=PERMISSION'
 elif grep -qi 'foreign key' "$tmp/restore.log";then echo 'DATA_ERROR_CLASS=FOREIGN_KEY'
 elif grep -qi 'duplicate key' "$tmp/restore.log";then echo 'DATA_ERROR_CLASS=DUPLICATE'
 elif grep -qi 'column' "$tmp/restore.log";then echo 'DATA_ERROR_CLASS=COLUMN'
 else echo 'DATA_ERROR_CLASS=OTHER';fi
 exit 1
fi
echo 'PRODUCTION_DB=UNCHANGED'
