#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only inventory of function names and Docker mapping; never log secrets.
python3 - <<'PY'
from pathlib import Path
import json,subprocess,sys
root=Path('/home/ubuntu/neis-backups/edge-functions-ready-20261009/supabase/functions')
if not root.is_dir():
 print('EDGE_INVENTORY=BLOCKED_STAGING_MISSING');sys.exit(1)
functions=sorted(p.parent.name for p in root.glob('*/index.ts'))
print('EDGE_STAGED_COUNT='+str(len(functions)))
for fn in functions:
 if not fn.replace('-','').replace('_','').isalnum():print('EDGE_INVENTORY=BLOCKED_UNEXPECTED_NAME');sys.exit(1)
 print('STAGED_FUNCTION='+fn)
p=subprocess.run(['sudo','-n','/usr/bin/docker','inspect','supabase-edge-functions','--format','{{json .Mounts}}'],capture_output=True,text=True)
if p.returncode:print('EDGE_INVENTORY=BLOCKED_DOCKER');sys.exit(1)
try: mounts=json.loads(p.stdout)
except ValueError:print('EDGE_INVENTORY=BLOCKED_PARSE');sys.exit(1)
source=next((m.get('Source') for m in mounts if m.get('Destination')=='/home/deno/functions'),None)
if not source:print('EDGE_INVENTORY=BLOCKED_ACTIVE_MOUNT');sys.exit(1)
active=Path(source)
print('EDGE_ACTIVE_COUNT='+str(sum(1 for f in active.glob('*/index.ts'))))
for fn in functions:
 print('EDGE_FUNCTION_'+fn+'='+('ACTIVE' if (active/fn/'index.ts').is_file() else 'STAGED_ONLY'))
print('EDGE_INVENTORY=PASS_READ_ONLY')
PY
