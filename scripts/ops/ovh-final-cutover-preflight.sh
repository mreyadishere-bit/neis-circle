#!/usr/bin/env bash
set -Eeuo pipefail
# Strictly read-only checklist: source integrity, verified rehearsal,
# live destination state, storage candidate, and old Cloud endpoints.
cd /home/ubuntu/neis-supabase
export LC_ALL=C
source=/home/ubuntu/neis-backups/cloud-cli-import-38052670098
backup=/home/ubuntu/neis-backups/ovh-destination-precrossover-20261010
storage=/home/ubuntu/neis-backups/storage-runtime-release-20261010/files
for d in "$source" "$backup" "$storage"; do
 [[ -d "$d" && ! -L "$d" ]] || { echo 'CUTOVER_PREFLIGHT=BLOCKED_MISSING_PRIVATE_ASSET';exit 1; }
done
(cd "$source" && sha256sum --status -c SHA256SUMS) || { echo 'CUTOVER_PREFLIGHT=BLOCKED_CLOUD_SOURCE_HASH';exit 1; }
(cd "$backup" && sha256sum --status -c checksums.sha256) || { echo 'CUTOVER_PREFLIGHT=BLOCKED_ORIGINAL_TARGET_BACKUP_HASH';exit 1; }
python3 - "$source" "$backup" "$storage" <<'PY'
from pathlib import Path
import re,json,subprocess,sys,hashlib
source,backup,storage=map(Path,sys.argv[1:])
docker=['sudo','-n','/usr/bin/docker']
def query(command,stmt):
 p=subprocess.run([*command,stmt],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=35)
 if p.returncode:raise RuntimeError('db query failed')
 return p.stdout.strip()
try:
 test=subprocess.run([*docker,'inspect','-f','{{.HostConfig.NetworkMode}}','neis-restore-test'],capture_output=True,text=True,timeout=20)
 if test.returncode or test.stdout.strip()!='none':raise RuntimeError('test not offline')
 live=[*docker,'compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc']
 isolated=[*docker,'exec','neis-restore-test','psql','-X','-U','supabase_admin','-d','neis_cli_liveclone_20261010_v2','-Atqc']
 names={'AUTH_USERS':'auth.users','PROFILES':'public.profiles','POSTS':'public.posts','DM':'public.messages','CIRCLE_MSGS':'public.circle_messages','NOTIFICATIONS':'public.notifications','STORAGE_METADATA':'storage.objects'}
 expected={'AUTH_USERS':204,'PROFILES':204,'POSTS':109,'DM':515,'CIRCLE_MSGS':2370,'NOTIFICATIONS':9540,'STORAGE_METADATA':104}
 for label,table in names.items():
  got=int(query(isolated,f'select count(*) from {table}'))
  if got!=expected[label]:raise RuntimeError('source snapshot count')
  print('VERIFIED_CLONE_'+label+'='+str(got))
 live_users=int(query(live,'select count(*) from auth.users'))
 live_storage=int(query(live,'select count(*) from storage.objects'))
 print('OVH_LIVE_AUTH_USERS='+str(live_users))
 print('OVH_LIVE_STORAGE_OBJECTS='+str(live_storage))
 if live_users!=1 or live_storage!=0:raise RuntimeError('unexpected live db state')
 print('OVH_LIVE_DB=UNMODIFIED_TEST_BASELINE')
 metadata=subprocess.run([*docker,'compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','-f','docker-compose.edge-integrations.yml','config','--format','json'],capture_output=True,text=True,timeout=35)
 if metadata.returncode:raise RuntimeError('compose inspect')
 services=json.loads(metadata.stdout)['services']
 mounts=services['storage'].get('volumes') or []
 matches=[m for m in mounts if isinstance(m,dict) and m.get('target')=='/var/lib/storage']
 if len(matches)!=1:raise RuntimeError('storage mount mismatch')
 print('OVH_STORAGE_MOUNT_TYPE='+str(matches[0].get('type','unknown')).upper())
 print('OVH_STORAGE_MOUNT_SOURCE_LOCAL='+('YES' if str(matches[0].get('source','')).startswith('/') else 'NO'))
 auth=services['auth'].get('environment') or {}
 if not all(auth.get(n) for n in ('GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID','GOTRUE_EXTERNAL_GOOGLE_SECRET')):raise RuntimeError('Google creds')
 print('OVH_GOOGLE_PROVIDER_CONFIGURED=YES')
 files=[f for f in storage.rglob('*') if f.is_file()]
 if len(files)!=104 or any(f.is_symlink() for f in storage.rglob('*')):raise RuntimeError('storage candidate contents')
 print('OVH_STORAGE_RUNTIME_FILE_COUNT='+str(len(files)))
 text={n:(source/n).read_text(errors='replace') for n in ('schema.sql','roles.sql')}
 old='ydieijgynqlckaczalju.supabase.co'
 for name,s in text.items():
  print('CLOUD_OLD_URL_REFERENCES_'+name.upper().replace('.','_')+'='+str(s.count(old)))
 print('CLOUD_SOURCE_EXPORT=SHA256_VERIFIED')
 print('OVH_BACKUP=SHA256_VERIFIED')
 print('STAGED_DB=NETWORK_DISCONNECTED')
 print('CUTOVER_PREFLIGHT=PASS_METADATA_ONLY')
except Exception:
 print('CUTOVER_PREFLIGHT=BLOCKED_MISMATCH')
 sys.exit(1)
PY
