#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only audit for the CLI-format source and bootstrapped self-hosted OVH destination.
cd /home/ubuntu/neis-supabase
backup=/home/ubuntu/neis-backups/ovh-destination-precrossover-20261010
source=/home/ubuntu/neis-backups/cloud-cli-import-38047355178
test -d "$backup" && test -d "$source" || { echo 'CLI_PREFLIGHT=BLOCKED_BACKUP_ABSENT'; exit 1; }
( cd "$backup"; sha256sum --status --check checksums.sha256 ) || { echo 'CLI_PREFLIGHT=BLOCKED_BACKUP_HASH'; exit 1; }
( cd "$source"; sha256sum --status --check SHA256SUMS ) || { echo 'CLI_PREFLIGHT=BLOCKED_SOURCE_HASH'; exit 1; }
docker() { sudo -n /usr/bin/docker "$@"; }
stage=neis-restore-test
[[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$stage")" == none ]] || { echo 'CLI_PREFLIGHT=BLOCKED_TEST_NETWORK'; exit 1; }
[[ "$(docker inspect -f '{{.State.Running}}' "$stage")" == true ]] || { echo 'CLI_PREFLIGHT=BLOCKED_TEST_STOPPED'; exit 1; }
python3 - "$source" "$backup" <<'PY'
from pathlib import Path
import re,subprocess,sys
source=Path(sys.argv[1]);target=Path(sys.argv[2])
tables=set()
with (source/'data.sql').open(errors='replace') as f:
 for line in f:
  if not line.startswith('COPY '):continue
  m=re.match(r'^COPY (?:"?([a-z_][a-z_0-9]*)"?\.)?"?([a-z_][a-z_0-9]*)"?\s+\(',line,re.I)
  if m:tables.add((m.group(1) or 'public')+'.'+m.group(2))
print('CLI_COPY_TABLES='+str(len(tables)))
print('CLI_REQUIRED_TABLES_PRESENT='+str({'auth.users','public.profiles','storage.objects'}.issubset(tables)).upper())
if len(tables)<80 or not {'auth.users','public.profiles','storage.objects'}.issubset(tables):
 print('CLI_PREFLIGHT=BLOCKED_SOURCE_INCOMPLETE');sys.exit(1)
docker=['sudo','-n','/usr/bin/docker']
live=[*docker,'compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc']
stage=[*docker,'exec','neis-restore-test','psql','-X','-U','supabase_admin','-d','postgres','-Atqc']
def run(cmd,sql):
 p=subprocess.run([*cmd,sql],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=25)
 if p.returncode:raise ValueError('sql')
 return p.stdout.strip()
try:
 lv=int(run(live,'show server_version_num'))
 sv=int(run(stage,'show server_version_num'))
 print('OVH_LIVE_PG_MAJOR='+str(lv//10000))
 print('OVH_TEST_PG_MAJOR='+str(sv//10000))
 if lv//10000!=sv//10000:raise ValueError('version')
 checks={
 'AUTH_TABLES':"select count(*) from information_schema.tables where table_schema='auth' and table_type='BASE TABLE'",
 'STORAGE_TABLES':"select count(*) from information_schema.tables where table_schema='storage' and table_type='BASE TABLE'",
 'PUBLIC_TABLES':"select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
 }
 for label,sql in checks.items():
  print('OVH_LIVE_'+label+'='+run(live,sql))
  print('OVH_TEST_'+label+'='+run(stage,sql))
 ext_available=set(run(stage,'select name from pg_available_extensions').splitlines())
 ext_needed=set(run(live,'select extname from pg_extension').splitlines())
 missing=ext_needed-ext_available
 print('OVH_TEST_UNAVAILABLE_LIVE_EXTENSIONS='+str(len(missing)))
 if missing:raise ValueError('extension')
except Exception:
 print('CLI_PREFLIGHT=BLOCKED_PLATFORM_MISMATCH');sys.exit(1)
p=subprocess.run([*docker,'compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','exec','-T','db','pg_restore','--list'],stdin=(target/'live.dump').open('rb'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=45)
if p.returncode:
 print('CLI_PREFLIGHT=BLOCKED_DESTINATION_ARCHIVE');sys.exit(1)
print('CLI_EXPORT_AND_DESTINATION_BACKUP=VERIFIED')
print('CLI_PREFLIGHT=PASS_READ_ONLY')
print('PRODUCTION_DATABASE=UNCHANGED')
PY
