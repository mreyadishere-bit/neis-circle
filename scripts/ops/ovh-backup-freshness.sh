#!/usr/bin/env bash
set -Eeuo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
root=Path('/home/ubuntu/neis-backups')
if not root.is_dir(): raise SystemExit('BLOCKED_BACKUP_ROOT_MISSING')
for prefix,required in [('cloud-',('data.sql','schema.sql')),('storage-',('files',))]:
 candidates=sorted((p for p in root.iterdir() if p.is_dir() and p.name.startswith(prefix)),key=lambda x:x.stat().st_mtime,reverse=True)
 print(prefix.replace('-','_').upper()+'BACKUP_DIR_COUNT='+str(len(candidates)))
 for i,p in enumerate(candidates[:8]):
  print(prefix.replace('-','_').upper()+'BACKUP_'+str(i)+'_UTC='+datetime.fromtimestamp(p.stat().st_mtime,timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
  print(prefix.replace('-','_').upper()+'BACKUP_'+str(i)+'_FILES_PRESENT='+str(all((p/n).exists() for n in required)).upper())
  if prefix=='cloud-':
   print('CLOUD_BACKUP_'+str(i)+'_DATA_BYTES='+str((p/'data.sql').stat().st_size if (p/'data.sql').is_file() else 0))
  else:
   f=p/'files'
   print('STORAGE_BACKUP_'+str(i)+'_OBJECT_COUNT='+str(sum(1 for x in f.rglob('*') if x.is_file()) if f.is_dir() else 0))
print('BACKUP_INVENTORY=READ_ONLY')
PY
