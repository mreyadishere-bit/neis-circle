#!/usr/bin/env bash
set -Eeuo pipefail
# Prepare separate verified writable storage release. Never modify active storage.
python3 - <<'PY'
from pathlib import Path
import hashlib,os,shutil,subprocess,json,sys
source=Path('/home/ubuntu/neis-backups/storage-release-candidate-20261009/files')
dest=Path('/home/ubuntu/neis-backups/storage-runtime-release-20261010/files')
if not source.is_dir() or dest.exists() or dest.parent.exists():
 print('STORAGE_RELEASE=BLOCKED_SOURCE_OR_TARGET_EXISTS');sys.exit(1)
docker=['sudo','-n','/usr/bin/docker']
p=subprocess.run([*docker,'compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','config','--format','json'],cwd='/home/ubuntu/neis-supabase',capture_output=True,text=True,timeout=40)
if p.returncode:
 print('STORAGE_RELEASE=BLOCKED_COMPOSE');sys.exit(1)
try:
 svc=json.loads(p.stdout)['services']['storage']
 volumes=svc.get('volumes') or []
 mount=[x for x in volumes if isinstance(x,dict) and x.get('target')=='/var/lib/storage']
 if len(mount)!=1:raise ValueError('mount missing')
 print('ACTIVE_STORAGE_MOUNT_TYPE='+str(mount[0].get('type','UNKNOWN')).upper())
except Exception:
 print('STORAGE_RELEASE=BLOCKED_MOUNT');sys.exit(1)
files={}
for path in source.rglob('*'):
 if path.is_symlink():
  print('STORAGE_RELEASE=BLOCKED_SYMLINK');sys.exit(1)
 if path.is_file():
  rel=path.relative_to(source).as_posix()
  if rel in files:raise SystemExit('STORAGE_RELEASE=BLOCKED_DUPLICATE')
  files[rel]=path
if len(files)!=104:
 print('STORAGE_RELEASE=BLOCKED_SOURCE_COUNT');sys.exit(1)
dest.parent.mkdir(parents=True,mode=0o700,exist_ok=False)
try:
 shutil.copytree(source,dest,copy_function=shutil.copy2,symlinks=False)
 mismatch=0
 for rel,file in sorted(files.items()):
  copied=dest/rel
  def hash_file(path):
   digest=hashlib.sha256()
   with path.open('rb') as fh:
    for chunk in iter(lambda:fh.read(1024*1024),b''):digest.update(chunk)
   return digest.digest()
  if not copied.is_file() or file.stat().st_size!=copied.stat().st_size or hash_file(file)!=hash_file(copied):
   mismatch+=1
 if mismatch:raise ValueError('integrity')
 os.chmod(dest.parent,0o700)
 print('STORAGE_RELEASE_OBJECTS_COPIED='+str(len(files)))
 print('STORAGE_RELEASE_SHA256_MATCHES='+str(len(files)-mismatch))
 print('STORAGE_RELEASE=READY_PRIVATE_STAGE_ONLY')
 print('ACTIVE_STORAGE_MOUNT=UNCHANGED')
except Exception:
 shutil.rmtree(dest.parent,ignore_errors=True)
 print('STORAGE_RELEASE=FAILED_COPY_OR_INTEGRITY')
 sys.exit(1)
PY
