#!/usr/bin/env bash
set -Eeuo pipefail
C=neis-restore-test
D=neis_fresh_pgcron_retry_37988124956
SOURCE=/home/ubuntu/neis-backups/storage-20261009T133940Z/files
DEST=/home/ubuntu/neis-backups/storage-release-candidate-20261009/files
test "$(sudo -n /usr/bin/docker inspect -f '{{.HostConfig.NetworkMode}}' "$C")" = none
test -d "$SOURCE"
export SOURCE DEST
python3 - <<'PY'
from pathlib import Path
import os,subprocess,hashlib,shutil,sys
source=Path(os.environ['SOURCE']);dest=Path(os.environ['DEST'])
backed={p.relative_to(source).as_posix():p for p in source.rglob('*') if p.is_file()}
if len(backed)!=103:raise SystemExit('STORAGE_STAGE=BLOCKED_BACKUP_COUNT')
sql="SELECT bucket_id||'/'||name FROM storage.objects ORDER BY bucket_id,name"
r=subprocess.run(['sudo','-n','/usr/bin/docker','exec','neis-restore-test','psql','-X','-U','supabase_admin','-d','neis_fresh_pgcron_retry_37988124956','-Atqc',sql],capture_output=True,text=True)
if r.returncode:raise SystemExit('STORAGE_STAGE=BLOCKED_METADATA')
expected=set(r.stdout.splitlines())
if len(expected)!=104:raise SystemExit('STORAGE_STAGE=BLOCKED_FRESH_COUNT')
missing=expected-set(backed)
extra=set(backed)-expected
print('STORAGE_CLOUD_METADATA='+str(len(expected)))
print('STORAGE_BACKED_UP='+str(len(backed)))
print('STORAGE_MATCHED='+str(len(expected&set(backed))))
print('STORAGE_MISSING_PATHS='+str(len(missing)))
print('STORAGE_EXTRA_PATHS='+str(len(extra)))
if extra or len(missing)!=1:raise SystemExit('STORAGE_STAGE=BLOCKED_PATH_MAPPING')
dest.mkdir(parents=True,exist_ok=True)
for rel,src in backed.items():
 dst=dest/rel
 dst.parent.mkdir(parents=True,exist_ok=True)
 if not dst.exists():shutil.copy2(src,dst)
 if hashlib.sha256(src.read_bytes()).digest()!=hashlib.sha256(dst.read_bytes()).digest():raise SystemExit('STORAGE_STAGE=BLOCKED_CHECKSUM')
print('STORAGE_STAGE=VERIFIED_103')
print('STORAGE_PRODUCTION_MOUNT=UNCHANGED')
print('STORAGE_FINAL_CUTOVER=BLOCKED_MISSING_ONE_OBJECT')
PY
