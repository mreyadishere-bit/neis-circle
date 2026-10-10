#!/usr/bin/env bash
set -Eeuo pipefail
# Only inspect COPY table targets and isolated PostgreSQL catalog.
# Never print SQL rows, user identifiers, secret values, or live DB contents.
source=/home/ubuntu/neis-backups/cloud-cli-import-38047355178
test -s "$source/data.sql"
(cd "$source" && sha256sum --status -c SHA256SUMS)
[[ "$(sudo -n /usr/bin/docker inspect -f '{{.HostConfig.NetworkMode}}' neis-restore-test)" == none ]] || { echo 'COPY_AUDIT=BLOCKED_TEST_NETWORK';exit 1; }
python3 - "$source/data.sql" <<'PY'
from pathlib import Path
import re,sys,subprocess
path=Path(sys.argv[1])
names=set()
for line in path.open(errors='replace'):
 if not line.startswith('COPY '):continue
 m=re.match(r'^COPY\s+(?:"?([A-Za-z_][A-Za-z_0-9]*)"?\.)?"?([A-Za-z_][A-Za-z_0-9]*)"?\s+\(',line)
 if not m:raise SystemExit('COPY_AUDIT=UNEXPECTED_SOURCE_SYNTAX')
 names.add((m.group(1) or 'public')+'.'+m.group(2))
if len(names)<80:raise SystemExit('COPY_AUDIT=INCOMPLETE_ARCHIVE')
db='neis_cli_stage_20261010_v1'
cmd=['sudo','-n','/usr/bin/docker','exec','neis-restore-test','psql','-X','-U','supabase_admin','-d',db,'-Atqc']
missing=[]
try:
 for name in sorted(names):
  q="select to_regclass('"+name+"') is not null"
  p=subprocess.run([*cmd,q],stdin=subprocess.DEVNULL,text=True,capture_output=True,timeout=12)
  if p.returncode or p.stdout.strip() not in ('t','f'):
   raise RuntimeError('catalog query failed')
  if p.stdout.strip()=='f':missing.append(name)
 auth=subprocess.run([*cmd,'select count(*) from auth.users'],stdin=subprocess.DEVNULL,text=True,capture_output=True,timeout=15)
 profile=subprocess.run([*cmd,'select count(*) from public.profiles'],stdin=subprocess.DEVNULL,text=True,capture_output=True,timeout=15)
 if auth.returncode or profile.returncode:raise RuntimeError('empty guard failed')
 print('COPY_AUDIT_ISOLATED_AUTH_ROWS='+auth.stdout.strip())
 print('COPY_AUDIT_ISOLATED_PROFILE_ROWS='+profile.stdout.strip())
except Exception:
 print('COPY_AUDIT=BLOCKED_CATALOG')
 sys.exit(1)
print('COPY_SOURCE_TABLES='+str(len(names)))
print('COPY_STAGE_MISSING_TABLES='+str(len(missing)))
for name in missing:
 print('COPY_MISSING_TABLE='+name)
print('COPY_AUDIT=READ_ONLY_COMPLETE')
print('CLOUD_AND_LIVE_DB=UNCHANGED')
PY
