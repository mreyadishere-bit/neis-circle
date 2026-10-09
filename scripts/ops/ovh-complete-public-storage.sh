#!/usr/bin/env bash
set -Eeuo pipefail
test "$(sudo -n /usr/bin/docker inspect -f '{{.HostConfig.NetworkMode}}' neis-restore-test)" = none
export STAGED_STORAGE=/home/ubuntu/neis-backups/storage-release-candidate-20261009/files
python3 - <<'PY'
from pathlib import Path
import os,subprocess,urllib.parse,urllib.request,hashlib,sys
root=Path(os.environ['STAGED_STORAGE'])
query="SELECT bucket_id||'/'||name FROM storage.objects ORDER BY bucket_id,name"
p=subprocess.run(['sudo','-n','/usr/bin/docker','exec','neis-restore-test','psql','-X','-U','supabase_admin','-d','neis_fresh_pgcron_retry_37988124956','-Atqc',query],capture_output=True,text=True)
if p.returncode:raise SystemExit('STORAGE_SYNC=DB_UNAVAILABLE')
expected=set(p.stdout.splitlines())
actual={x.relative_to(root).as_posix() for x in root.rglob('*') if x.is_file()}
missing=expected-actual
if len(expected)!=104 or len(missing)!=1 or actual-expected:
 raise SystemExit('STORAGE_SYNC=UNEXPECTED_INVENTORY')
relative=next(iter(missing))
if not relative.startswith('community-media/'):raise SystemExit('STORAGE_SYNC=UNEXPECTED_BUCKET')
object_name=relative[len('community-media/'):]
url='https://ydieijgynqlckaczalju.supabase.co/storage/v1/object/public/community-media/'+urllib.parse.quote(object_name,safe='/')
target=root/relative
target.parent.mkdir(parents=True,exist_ok=True)
tmp=target.with_name(target.name+'.tmp-neis')
try:
 request=urllib.request.Request(url,headers={'User-Agent':'NEIS-Circle-Storage-Migration/1.0'})
 with urllib.request.urlopen(request,timeout=35) as stream, tmp.open('wb') as out:
  if stream.status!=200:raise ValueError('unexpected HTTP status')
  n=0
  while True:
   block=stream.read(1024*1024)
   if not block:break
   n+=len(block)
   if n>100*1024*1024:raise ValueError('object unexpectedly large')
   out.write(block)
 if n==0:raise ValueError('empty object')
 tmp.replace(target)
except Exception:
 tmp.unlink(missing_ok=True)
 print('STORAGE_DOWNLOAD=FAILED')
 sys.exit(1)
all_files={x.relative_to(root).as_posix() for x in root.rglob('*') if x.is_file()}
if all_files!=expected:raise SystemExit('STORAGE_SYNC=FINAL_INVENTORY_MISMATCH')
print('STORAGE_PUBLIC_OBJECT_DOWNLOAD=PASS')
print('STORAGE_RELEASE_OBJECTS='+str(len(all_files)))
print('STORAGE_RELEASE_MATCHES_METADATA=YES')
print('PRODUCTION_STORAGE=UNCHANGED')
PY
