#!/usr/bin/env bash
set -Eeuo pipefail
# OVH read-only diagnostic. Never print Docker inspect output or secret values.
echo "OVH_DIAGNOSTIC=BEGIN"
if [[ ! -x /usr/bin/docker ]]; then echo "DOCKER_CLI=UNAVAILABLE"; exit 1; fi
if ! sudo -n true >/dev/null 2>&1; then echo "OVH_SUDO=UNAVAILABLE"; exit 1; fi
if ! sudo -n /usr/bin/docker info >/dev/null 2>&1; then
  echo "DOCKER_DAEMON=UNAVAILABLE_WITH_SUDO"
  exit 1
fi
echo "DOCKER_DAEMON=AVAILABLE"
python3 - <<'PY'
import json,subprocess,sys
required=(
 'SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEYS',
 'SUPABASE_SERVICE_ROLE_KEY','BREVO_API_KEY','EMAIL_WORKER_SECRET',
 'FIREBASE_SERVICE_ACCOUNT_JSON','LIVEKIT_API_KEY','LIVEKIT_API_SECRET',
 'LIVEKIT_URL','NOTIFICATION_FROM_EMAIL','NOTIFICATION_FROM_NAME','SITE_URL'
)
cmd=['sudo','-n','/usr/bin/docker']
def fetch(*args):
 p=subprocess.run([*cmd,*args],capture_output=True,text=True,timeout=15)
 return p.stdout.strip() if p.returncode==0 else None
running=fetch('ps','--format','{{.ID}}')
if running is None:
 print('DOCKER_LIST=FAILED');sys.exit(2)
print('RUNNING_CONTAINERS='+str(len(running.splitlines())))
# Use established container identity; no fuzzy guesses about unrelated services.
state=fetch('inspect','--format','{{.State.Running}}','supabase-edge-functions')
if state is None:
 print('EDGE_CONTAINER=NOT_FOUND');sys.exit(3)
if state!='true':
 print('EDGE_CONTAINER=NOT_RUNNING');sys.exit(3)
print('EDGE_CONTAINER=RUNNING')
raw=fetch('inspect','--format','{{json .Config.Env}}','supabase-edge-functions')
if raw is None:
 print('EDGE_ENV_INSPECTION=FAILED');sys.exit(4)
try: env=dict(s.split('=',1) for s in json.loads(raw) if '=' in s)
except (ValueError,TypeError):
 print('EDGE_ENV_PARSE=FAILED');sys.exit(4)
missing=[name for name in required if not env.get(name)]
print('EDGE_REQUIRED_NONEMPTY='+str(len(required)-len(missing))+'/'+str(len(required)))
print('EDGE_MISSING_OR_EMPTY='+(','.join(missing) if missing else 'NONE'))
print('EDGE_SECRET_VALUES_LOGGED=NO')
if missing:sys.exit(5)
PY
echo "OVH_DIAGNOSTIC=PASS_ENV_NAMES_NONEMPTY_ONLY"
