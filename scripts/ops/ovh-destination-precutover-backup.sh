#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only inventory and private backup of the existing OVH destination before ANY restore.
# This DOES NOT change the live OVH DB or the Supabase Cloud primary.
set -o pipefail
root=/home/ubuntu/neis-supabase
cd "$root"
docker() { sudo -n /usr/bin/docker "$@"; }
compose() { docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml "$@"; }
backup=/home/ubuntu/neis-backups/ovh-destination-precrossover-20261010
[[ ! -e "$backup" ]] || { echo 'OVH_BACKUP=BLOCKED_EXISTING_SNAPSHOT'; exit 1; }
[[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' neis-restore-test)" == none ]] || { echo 'OVH_BACKUP=BLOCKED_STAGE_NETWORK'; exit 1; }
mkdir -p /home/ubuntu/neis-backups
chmod 700 /home/ubuntu/neis-backups
tmp="$(mktemp -d /home/ubuntu/neis-backups/ovh-destination-backup-tmp.XXXXXX)"
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT
python3 - <<'PY'
import subprocess,sys
base=['sudo','-n','/usr/bin/docker']
def count(stage,table):
 if stage:
  cmd=[*base,'exec','neis-restore-test','psql','-X','-U','supabase_admin','-d','neis_fresh_archive_20261010','-Atqc']
 else:
  cmd=[*base,'compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc']
 # Check existence in a separate query so missing tables do not fail SQL parsing.
 check=subprocess.run([*cmd,"select to_regclass('"+table+"') is not null"],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=25)
 if check.returncode or check.stdout.strip() not in ('t','f'):raise RuntimeError('relation')
 if check.stdout.strip()=='f':return '-1'
 p=subprocess.run([*cmd,'select count(*) from '+table],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=25)
 if p.returncode or not p.stdout.strip().isdigit():raise RuntimeError('count')
 return p.stdout.strip()
tables={'AUTH_USERS':'auth.users','PROFILES':'public.profiles','POSTS':'public.posts','CIRCLES':'public.circles','MESSAGES':'public.messages','CIRCLE_MESSAGES':'public.circle_messages','NOTIFICATIONS':'public.notifications','STORAGE':'storage.objects'}
try:
 for label,table in tables.items():
  print('OVH_DESTINATION_'+label+'='+count(False,table))
  print('OVH_ISOLATED_SNAPSHOT_'+label+'='+count(True,table))
except Exception:
 print('OVH_BACKUP=BLOCKED_COUNT_QUERY')
 sys.exit(1)
print('OVH_SNAPSHOT_INVENTORY=COMPLETE_READ_ONLY')
PY
echo 'OVH_BACKUP_PHASE=INVENTORY_DONE'
# Verify free disk capacity before writing backup files.
free="$(df -B1 --output=avail /home/ubuntu/neis-backups | tail -1 | tr -d ' ')"
(( free > 1073741824 )) || { echo 'OVH_BACKUP=BLOCKED_LOW_DISK'; exit 1; }
umask 077
if ! compose exec -T db pg_dump -U postgres -d postgres --format=custom --no-owner --no-acl </dev/null >"$tmp/live.dump" 2>"$tmp/dump.err";then
 echo 'OVH_BACKUP=FAILED_PG_DUMP';exit 1
fi
if ! compose exec -T db pg_dumpall -U postgres --globals-only </dev/null >"$tmp/globals.sql" 2>"$tmp/globals.err";then
 echo 'OVH_BACKUP=FAILED_GLOBAL_ROLES';exit 1
fi
[[ -s "$tmp/live.dump" && -s "$tmp/globals.sql" ]] || { echo 'OVH_BACKUP=BLOCKED_EMPTY_BACKUP';exit 1; }
echo 'OVH_BACKUP_PHASE=ARCHIVES_CAPTURED'
if ! compose exec -T db pg_restore --list <"$tmp/live.dump" >/dev/null 2>&1;then
 echo 'OVH_BACKUP=FAILED_ARCHIVE_VALIDATION';exit 1
fi
(
 cd "$tmp"
 sha256sum live.dump globals.sql > checksums.sha256
 sha256sum --status -c checksums.sha256
)
rm -f "$tmp/dump.err" "$tmp/globals.err"
chmod 600 "$tmp/live.dump" "$tmp/globals.sql" "$tmp/checksums.sha256"
mv "$tmp" "$backup"
echo 'OVH_BACKUP_PHASE=ARCHIVE_HASHES_VALIDATED'
echo 'OVH_BACKUP=VERIFIED_PRIVATE_SNAPSHOT'
echo 'OVH_ACTIVE_DB=UNCHANGED'
echo 'SUPABASE_CLOUD=UNCHANGED'
echo 'CUTOVER=NOT_PERFORMED'
