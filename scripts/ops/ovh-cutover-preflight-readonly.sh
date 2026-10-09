#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only, no names of private containers, credentials, URLs, or row contents printed.
echo "OVH_DIAGNOSTIC=BEGIN"
if ! command -v docker >/dev/null; then echo "DOCKER=UNAVAILABLE"; exit 1; fi
if ! docker info >/dev/null 2>&1; then echo "DOCKER_DAEMON=UNAVAILABLE"; exit 1; fi
echo "DOCKER_DAEMON=AVAILABLE"
python3 - <<'PY'
import subprocess
required=('SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','BREVO_API_KEY','EMAIL_WORKER_SECRET','FIREBASE_SERVICE_ACCOUNT_JSON','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEKIT_URL','NOTIFICATION_FROM_EMAIL','NOTIFICATION_FROM_NAME','SITE_URL')
ids=subprocess.run(['docker','ps','--format','{{.ID}}'],capture_output=True,text=True,check=True).stdout.splitlines()
print('RUNNING_CONTAINERS='+str(len(ids)))
edge=[]
for cid in ids:
 p=subprocess.run(['docker','inspect','--format','{{.Config.Image}}',cid],capture_output=True,text=True)
 if p.returncode==0 and ('edge-runtime' in p.stdout or 'functions' in p.stdout.lower()):edge.append(cid)
print('EDGE_CANDIDATES='+str(len(edge)))
if not edge:raise SystemExit(2)
ok=False
for cid in edge:
 p=subprocess.run(['docker','inspect','--format','{{json .Config.Env}}',cid],capture_output=True,text=True)
 if p.returncode:continue
 import json
 vals=json.loads(p.stdout or '[]')
 names=set(x.split('=',1)[0] for x in vals)
 missing=[x for x in required if x not in names]
 print('EDGE_REQUIRED_VARIABLE_NAMES_PRESENT='+str(len(required)-len(missing))+'/'+str(len(required)))
 print('EDGE_VARIABLE_NAMES_MISSING='+(','.join(missing) if missing else 'NONE'))
 if not missing:ok=True
if not ok:raise SystemExit(3)
PY
echo "OVH_DIAGNOSTIC=PASS_ENV_NAMES_ONLY"
