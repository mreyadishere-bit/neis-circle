#!/usr/bin/env bash
# Check path mapping without printing filenames, keys, URLs or user records.
set -Eeuo pipefail
C=neis-restore-test
D=neis_restore_full_stage
FILES=/home/ubuntu/neis-backups/storage-20261009T133940Z/files
test "$(sudo -n /usr/bin/docker inspect -f '{{.HostConfig.NetworkMode}}' "$C")" = none
test "$(sudo -n /usr/bin/docker inspect -f '{{.Config.Image}}' "$C")" = supabase/postgres:17.6.1.136
test -d "$FILES"
export FILES
python3 - <<'PY'
from pathlib import Path
import os,subprocess,sys
root=Path(os.environ['FILES'])
actual=set(p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file())
if len(actual)!=103: raise SystemExit('BLOCKED: unexpected physical file count')
query="SELECT bucket_id || '/' || name FROM storage.objects ORDER BY bucket_id,name"
result=subprocess.run(['sudo','-n','/usr/bin/docker','exec','neis-restore-test','psql','-X','-U','supabase_admin','-d','neis_restore_full_stage','-Atqc',query],capture_output=True,text=True)
if result.returncode: raise SystemExit('BLOCKED: no isolated storage object metadata')
expected=set(result.stdout.splitlines())
if len(expected)!=103: raise SystemExit('BLOCKED: expected 103 unique storage metadata keys')
missing=expected-actual
untracked=actual-expected
print('STORAGE_DB_OBJECTS='+str(len(expected)))
print('STORAGE_BACKUP_FILES='+str(len(actual)))
print('STORAGE_OBJECT_PATH_MATCHES='+str(len(expected&actual)))
print('STORAGE_MISSING_PHYSICAL_PATHS='+str(len(missing)))
print('STORAGE_UNTRACKED_PHYSICAL_PATHS='+str(len(untracked)))
if missing or untracked:
    print('STORAGE_PATH_MAPPING=NEEDS_RECONCILIATION')
    sys.exit(1)
print('STORAGE_PATH_MAPPING=PASSED')
PY
