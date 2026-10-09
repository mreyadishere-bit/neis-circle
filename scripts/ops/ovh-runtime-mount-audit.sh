#!/usr/bin/env bash
set -Eeuo pipefail
# Read only: Docker metadata and directory existence, never print env values or names of user files.
python3 - <<'PY'
import json,subprocess,sys
from pathlib import Path
cmd=['sudo','-n','/usr/bin/docker','inspect','supabase-edge-functions','supabase-storage','--format','{{json .}}']
r=subprocess.run(cmd,capture_output=True,text=True)
if r.returncode:
 print('RUNTIME_MOUNTS=BLOCKED_DOCKER_INSPECT')
 sys.exit(1)
try: containers=[json.loads(line) for line in r.stdout.splitlines() if line.strip()]
except ValueError:
 print('RUNTIME_MOUNTS=BLOCKED_PARSE')
 sys.exit(1)
if len(containers)!=2:
 print('RUNTIME_MOUNTS=BLOCKED_EXPECTED_TWO_SERVICES')
 sys.exit(1)
for c in containers:
 name=c.get('Name','').lstrip('/')
 mounts=c.get('Mounts') or []
 print('SERVICE_'+('EDGE' if name=='supabase-edge-functions' else 'STORAGE')+'_RUNNING='+str(bool(c.get('State',{}).get('Running'))).upper())
 print('SERVICE_'+('EDGE' if name=='supabase-edge-functions' else 'STORAGE')+'_MOUNTS='+str(len(mounts)))
 # Only publish destinations (container-internal paths), not host paths or user filenames.
 for dest in sorted(set(str(m.get('Destination','')) for m in mounts)):
  if dest in ('/home/deno/functions','/var/lib/storage','/var/lib/storage/data','/tmp/storage'):
   print('EXPECTED_MOUNT_DESTINATION_PRESENT='+dest)
edge=next(x for x in containers if x.get('Name')=='/supabase-edge-functions')
mounts=edge.get('Mounts') or []
sources=[m.get('Source','') for m in mounts if m.get('Destination')=='/home/deno/functions']
staged=Path('/home/ubuntu/neis-backups/edge-functions-ready-20261009/supabase/functions')
if not staged.is_dir():
 print('STAGED_EDGE_SOURCE=ABSENT')
else:
 print('STAGED_EDGE_FUNCTION_COUNT='+str(sum(1 for x in staged.glob('*/index.ts'))))
print('EDGE_ACTIVE_EXPECTED_MOUNT='+('PRESENT' if sources else 'MISSING'))
print('EDGE_STAGED_SOURCE_IS_ACTIVE='+('YES' if any(Path(x).resolve()==staged.resolve() for x in sources) else 'NO'))
print('RUNTIME_MOUNT_AUDIT=COMPLETE_READ_ONLY')
PY
