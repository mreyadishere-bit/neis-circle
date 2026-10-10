#!/usr/bin/env bash
set -Eeuo pipefail
# Activate approved Edge Compose integration settings with a service-only rollback.
cd /home/ubuntu/neis-supabase
overlay=docker-compose.edge-integrations.yml
[[ -f "$overlay" && ! -L "$overlay" ]] || { echo 'EDGE_ENV_ACTIVATE=BLOCKED_NO_OVERLAY'; exit 1; }
[[ "$(stat -c '%a' "$overlay")" == 600 ]] || { echo 'EDGE_ENV_ACTIVATE=BLOCKED_OVERLAY_PERMISSIONS'; exit 1; }
docker() { sudo -n /usr/bin/docker "$@"; }
base() { docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml "$@"; }
extended() { docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f "$overlay" "$@"; }
tmp="$(mktemp -d)"
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT
rollback() {
  echo 'EDGE_ACTIVATION=ROLLING_BACK_SERVICE_CONFIGURATION'
  if base up -d --no-deps --force-recreate functions >"$tmp/rollback.log" 2>&1; then
    echo 'EDGE_ROLLBACK=SUCCESS_BASE_STACK'
  else
    echo 'EDGE_ROLLBACK=FAILED_MANUAL_REVIEW_REQUIRED'
  fi
}
if ! python3 - <<'PY'
import json,subprocess,sys
cmd=['sudo','-n','/usr/bin/docker','compose']
for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.edge-integrations.yml'):cmd+=['-f',f]
p=subprocess.run([*cmd,'config','--format','json'],capture_output=True,text=True,timeout=40)
if p.returncode: print('EDGE_COMPOSE=INVALID');sys.exit(1)
try:
 d=json.loads(p.stdout)
 env=d['services']['functions']['environment']
 required=('SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEYS','SUPABASE_SERVICE_ROLE_KEY','BREVO_API_KEY','EMAIL_WORKER_SECRET','FIREBASE_SERVICE_ACCOUNT_JSON','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEKIT_URL','NOTIFICATION_FROM_EMAIL','NOTIFICATION_FROM_NAME','SITE_URL')
 assert all(env.get(k) for k in required)
except Exception:
 print('EDGE_COMPOSE=INCOMPLETE');sys.exit(1)
print('EDGE_COMPOSE=VALIDATED_13_OF_13')
PY
then
 echo 'EDGE_ENV_ACTIVATE=BLOCKED_INVALID_CONFIG'; exit 1
fi
if ! extended up -d --no-deps --force-recreate functions >"$tmp/recreate.log" 2>&1; then
 echo 'EDGE_ENV_ACTIVATE=FAILED_CONTAINER_RECREATE'
 rollback
 exit 1
fi
if ! python3 - <<'PY'
import json,subprocess,sys
cmd=['sudo','-n','/usr/bin/docker']
live=subprocess.run([*cmd,'inspect','--format','{{json .}}','supabase-edge-functions'],capture_output=True,text=True,timeout=30)
if live.returncode:print('EDGE_CONTAINER=INSPECT_FAILED');sys.exit(1)
try:obj=json.loads(live.stdout)
except ValueError:print('EDGE_CONTAINER=INSPECT_INVALID');sys.exit(1)
if obj.get('State',{}).get('Running') is not True:
 print('EDGE_CONTAINER=NOT_RUNNING');sys.exit(1)
labels=obj.get('Config',{}).get('Labels') or {}
if labels.get('com.docker.compose.service')!='functions':
 print('EDGE_CONTAINER=UNEXPECTED_SERVICE');sys.exit(1)
env=dict(x.split('=',1) for x in obj.get('Config',{}).get('Env',[]) if '=' in x)
required=('SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEYS','SUPABASE_SERVICE_ROLE_KEY','BREVO_API_KEY','EMAIL_WORKER_SECRET','FIREBASE_SERVICE_ACCOUNT_JSON','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEKIT_URL','NOTIFICATION_FROM_EMAIL','NOTIFICATION_FROM_NAME','SITE_URL')
count=sum(bool(env.get(k)) for k in required)
print('EDGE_RUNNING_ENV_NONEMPTY='+str(count)+'/13')
print('EDGE_RUNTIME=RUNNING')
print('EDGE_VALUES_LOGGED=NO')
sys.exit(0 if count==13 else 1)
PY
then
 echo 'EDGE_ENV_ACTIVATE=FAILED_RUNTIME_CHECK'
 rollback
 exit 1
fi
echo 'EDGE_ENV_ACTIVATE=PASS_SERVICE_ONLY'
echo 'DATABASE_SERVICE=UNCHANGED'
echo 'PRODUCTION_CLOUD=UNCHANGED'
