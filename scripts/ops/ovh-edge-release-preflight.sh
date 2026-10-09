#!/usr/bin/env bash
set -Eeuo pipefail
# No changes to running Docker containers, mounts or databases.
python3 - <<'PY'
from pathlib import Path
import json,subprocess,hashlib,sys
staged=Path('/home/ubuntu/neis-backups/edge-functions-ready-20261009/supabase/functions')
expected={'brevo-email-capacity','brevo-quota-diagnostic','email-signup-validate','refresh-web-push-subscription','send-mobile-push','send-notification-email','send-web-push','study-livekit-token'}
actual={p.parent.name for p in staged.glob('*/index.ts')}
if actual!=expected:
 print('EDGE_PREFLIGHT=BLOCKED_STAGED_SET_MISMATCH');sys.exit(1)
p=subprocess.run(['sudo','-n','/usr/bin/docker','inspect','supabase-edge-functions','--format','{{json .}}'],capture_output=True,text=True)
if p.returncode:
 print('EDGE_PREFLIGHT=BLOCKED_DOCKER_INSPECT');sys.exit(1)
try: info=json.loads(p.stdout)
except ValueError:print('EDGE_PREFLIGHT=BLOCKED_INVALID_INSPECT');sys.exit(1)
mounts=info.get('Mounts') or []
targets=[m.get('Source') for m in mounts if m.get('Destination')=='/home/deno/functions']
if len(targets)!=1:
 print('EDGE_PREFLIGHT=BLOCKED_MOUNT_AMBIGUOUS');sys.exit(1)
active=Path(targets[0])
if not active.is_dir():
 print('EDGE_PREFLIGHT=BLOCKED_ACTIVE_MOUNT_MISSING');sys.exit(1)
print('EDGE_RUNNING='+('YES' if info.get('State',{}).get('Running') else 'NO'))
print('EDGE_STAGED_REQUIRED_FUNCTIONS='+str(len(actual)))
print('EDGE_ACTIVE_FUNCTIONS='+str(sum(1 for x in active.glob('*/index.ts'))))
print('EDGE_STAGING_IS_ACTIVE='+('YES' if active.resolve()==staged.resolve() else 'NO'))
same=0
for name in sorted(expected):
 src=staged/name/'index.ts'; dest=active/name/'index.ts'
 match=dest.is_file() and hashlib.sha256(src.read_bytes()).digest()==hashlib.sha256(dest.read_bytes()).digest()
 same+=bool(match)
 print('EDGE_RELEASE_DIFF_'+name+'='+('MATCHES' if match else 'NEEDS_DEPLOYMENT'))
print('EDGE_MATCHING_FUNCTIONS='+str(same))
# Report host mount permissions only; no source paths or secrets.
print('EDGE_MOUNT_WRITE_ACCESS='+('YES' if active.stat().st_mode & 0o222 else 'NO'))
print('EDGE_RELEASE_PREFLIGHT=PASS_READ_ONLY')
PY
