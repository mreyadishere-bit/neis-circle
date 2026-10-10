#!/usr/bin/env bash
set -Eeuo pipefail
# Supabase CLI-filtered Cloud export, private SQL and logs only.
# Fresh owner-approved maintenance snapshot; Cloud cron jobs were paused separately.
# Does not imply a database-level write freeze; verify final catch-up before cutover.
test -n "$CLOUD_DATABASE_URL" && test -n "$OVH_HOST" && test -n "$GITHUB_RUN_ID"
private="$(mktemp -d)"
chmod 700 "$private"
trap 'rm -rf "$private"' EXIT
export PGCONNECT_TIMEOUT=20 PGSSLMODE=require
cli=(npx --yes supabase@2.108.0)
if ! "${cli[@]}" db dump --db-url "$CLOUD_DATABASE_URL" -f "$private/roles.sql" --role-only >"$private/roles.log" 2>&1; then
 echo 'CLOUD_CLI_ROLES_EXPORT=FAILED';exit 1
fi
if ! "${cli[@]}" db dump --db-url "$CLOUD_DATABASE_URL" -f "$private/schema.sql" >"$private/schema.log" 2>&1; then
 echo 'CLOUD_CLI_SCHEMA_EXPORT=FAILED';exit 1
fi
if ! "${cli[@]}" db dump --db-url "$CLOUD_DATABASE_URL" -f "$private/data.sql" --use-copy --data-only >"$private/data.log" 2>&1; then
 echo 'CLOUD_CLI_DATA_EXPORT=FAILED';exit 1
fi
python3 - "$private" <<'PY'
from pathlib import Path
import re,sys
root=Path(sys.argv[1])
files=('roles.sql','schema.sql','data.sql')
if not all((root/n).is_file() and (root/n).stat().st_size>0 for n in files):
 print('CLOUD_CLI_EXPORT=BLOCKED_EMPTY_SQL');sys.exit(1)
schema=(root/'schema.sql').read_text(errors='replace')
if not any(t in schema for t in ('CREATE TABLE','CREATE OR REPLACE FUNCTION','CREATE FUNCTION')):
 print('CLOUD_CLI_SCHEMA=INVALID');sys.exit(1)
tables=set()
with (root/'data.sql').open(errors='replace') as data:
 for line in data:
  if line.startswith('COPY '):
   match=re.match(r'^COPY\s+(?:"?([A-Za-z_][A-Za-z_0-9]*)"?\.)?"?([A-Za-z_][A-Za-z_0-9]*)"?\s+\(',line)
   if match: tables.add('.'.join((match.group(1) or 'public',match.group(2))))
required={'auth.users','public.profiles','storage.objects'}
if not required.issubset(tables):
 print('CLOUD_CLI_DATA=BLOCKED_MISSING_REQUIRED_TABLES');sys.exit(1)
print('CLOUD_CLI_DUMP_COPY_TABLES='+str(len(tables)))
print('CLOUD_CLI_DUMP_REQUIRED_TABLES=VERIFIED')
print('CLOUD_CLI_SQL_LOGS_PRINTED=NO')
PY
(
 cd "$private"
 sha256sum roles.sql schema.sql data.sql > SHA256SUMS
 sha256sum --status --check SHA256SUMS
)
remote="/home/ubuntu/neis-backups/cloud-cli-import-$GITHUB_RUN_ID"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "ubuntu@$OVH_HOST" \
 "umask 077; test ! -e '$remote'; mkdir -p '$remote'; chmod 700 '$remote'"
scp -q -o BatchMode=yes -o StrictHostKeyChecking=yes \
 "$private/roles.sql" "$private/schema.sql" "$private/data.sql" "$private/SHA256SUMS" \
 "ubuntu@$OVH_HOST:$remote/"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "ubuntu@$OVH_HOST" \
 "set -eu; cd '$remote'; chmod 600 roles.sql schema.sql data.sql SHA256SUMS; sha256sum --status --check SHA256SUMS; test -s roles.sql -a -s schema.sql -a -s data.sql; echo CLOUD_CLI_DUMP_ON_OVH=VERIFIED"
echo 'CLOUD_CLI_EXPORT=VERIFIED_PRIVATE_TRIPLET'
echo 'DATABASE_AND_STORAGE=UNCHANGED'
echo 'CUTOVER=NOT_PERFORMED'
