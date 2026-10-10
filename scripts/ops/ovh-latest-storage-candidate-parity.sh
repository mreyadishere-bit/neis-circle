#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only verification of staged objects against restored Oct 10 metadata.
C=neis-restore-test
DB=neis_fresh_archive_20261010
ROOT=/home/ubuntu/neis-backups/storage-release-candidate-20261009/files
test "$(sudo -n /usr/bin/docker inspect -f '{{.HostConfig.NetworkMode}}' "$C")" = none || { echo 'STORAGE_AUDIT=BLOCKED_TEST_DB_NOT_DISCONNECTED'; exit 1; }
test -d "$ROOT" || { echo 'STORAGE_AUDIT=BLOCKED_CANDIDATE_DIR_MISSING'; exit 1; }
export ROOT C DB
python3 - <<'PY'
import hashlib,json,os,subprocess,sys
from pathlib import Path
root=Path(os.environ['ROOT']).resolve()
q="SELECT row_to_json(t) FROM (SELECT bucket_id,name,metadata->>'size' AS expected_size FROM storage.objects ORDER BY bucket_id,name) t"
p=subprocess.run(['sudo','-n','/usr/bin/docker','exec',os.environ['C'],'psql','-X','-U','supabase_admin','-d',os.environ['DB'],'-Atqc',q],capture_output=True,text=True,timeout=35)
if p.returncode:
 print('STORAGE_AUDIT=BLOCKED_ISOLATED_METADATA_QUERY');sys.exit(1)
try:entries=[json.loads(x) for x in p.stdout.splitlines() if x]
except ValueError:print('STORAGE_AUDIT=BLOCKED_METADATA_FORMAT');sys.exit(1)
paths={}
for x in entries:
 bucket=x.get('bucket_id') or ''
 name=x.get('name') or ''
 relative=bucket+'/'+name
 resolved=(root/relative).resolve()
 if not bucket or not name or not resolved.is_relative_to(root):
  print('STORAGE_AUDIT=BLOCKED_INVALID_PATH');sys.exit(1)
 if relative in paths:
  print('STORAGE_AUDIT=BLOCKED_DUPLICATE_METADATA_PATH');sys.exit(1)
 paths[relative]=x
actual=set()
symlinks=0
for file in root.rglob('*'):
 if file.is_symlink():
  symlinks+=1
 elif file.is_file():
  actual.add(file.relative_to(root).as_posix())
expected=set(paths)
missing=expected-actual
extra=actual-expected
matched=0
sizes_checked=0
size_mismatch=0
size_unknown=0
read_errors=0
for relative in sorted(expected & actual):
 try:
  file=root/relative
  h=hashlib.sha256()
  with file.open('rb') as handle:
   while part:=handle.read(1024*1024):h.update(part)
  matched+=1
  size=paths[relative].get('expected_size')
  if size is None or str(size).strip()=='':
   size_unknown+=1
  else:
   sizes_checked+=1
   if file.stat().st_size != int(size):size_mismatch+=1
 except Exception:
  read_errors+=1
print('STORAGE_METADATA_OBJECTS='+str(len(expected)))
print('STORAGE_PHYSICAL_OBJECTS='+str(len(actual)))
print('STORAGE_MISSING_PATHS='+str(len(missing)))
print('STORAGE_EXTRA_PATHS='+str(len(extra)))
print('STORAGE_HASH_READABLE_OBJECTS='+str(matched))
print('STORAGE_SIZE_FIELDS_CHECKED='+str(sizes_checked))
print('STORAGE_SIZE_FIELDS_MISSING='+str(size_unknown))
print('STORAGE_SIZE_MISMATCHES='+str(size_mismatch))
print('STORAGE_SYMLINKS='+str(symlinks))
print('STORAGE_READ_ERRORS='+str(read_errors))
print('STORAGE_FILENAMES_OR_HASHES_DISCLOSED=NO')
ok=(len(expected)==104 and len(actual)==104 and not missing and not extra and not symlinks and not read_errors and not size_mismatch and matched==104)
print('STORAGE_LATEST_ARCHIVE_CANDIDATE_PARITY='+('PASS' if ok else 'FAIL'))
print('LIVE_STORAGE_MOUNT_UNCHANGED=YES')
sys.exit(0 if ok else 1)
PY
