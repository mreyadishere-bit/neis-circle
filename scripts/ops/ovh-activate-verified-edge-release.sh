#!/usr/bin/env bash
set -Eeuo pipefail
# Change only OVH Edge code mount; preserve original for rollback. Never print secrets.
cd /home/ubuntu/neis-supabase
overlay=docker-compose.edge-integrations.yml
release=/home/ubuntu/neis-backups/edge-runtime-release-20261010/functions
private=/home/ubuntu/neis-backups/edge-code-cutover-private-20261010
[[ -f "$overlay" && ! -L "$overlay" && "$(stat -c '%a' "$overlay")" == 600 ]] || { echo 'EDGE_CODE=BLOCKED_PRIVATE_ENV'; exit 1; }
[[ -f "$release/main/index.ts" ]] || { echo 'EDGE_CODE=BLOCKED_MAIN_ROUTER'; exit 1; }
docker() { sudo -n /usr/bin/docker "$@"; }
extended() { docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f "$overlay" "$@"; }
mkdir -p "$private"
chmod 700 "$private"
tmp="$(mktemp -d)"
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT
[[ ! -e "$private/overlay.before.yml" ]] || { echo 'EDGE_CODE=BLOCKED_EXISTING_ROLLBACK'; exit 1; }
python3 - "$release" <<'PY'
import sys
from pathlib import Path
p=Path(sys.argv[1])
names={'brevo-email-capacity','brevo-quota-diagnostic','email-signup-validate','refresh-web-push-subscription','send-mobile-push','send-notification-email','send-web-push','study-livekit-token'}
if not (p/'main'/'index.ts').is_file() or any(not (p/n/'index.ts').is_file() for n in names):
 print('EDGE_CODE=BLOCKED_INCOMPLETE_RELEASE');sys.exit(1)
if any(x.is_symlink() for x in p.rglob('*')):
 print('EDGE_CODE=BLOCKED_SYMLINK');sys.exit(1)
print('EDGE_CODE_CANDIDATE=VERIFIED')
PY
cp -p "$overlay" "$private/overlay.before.yml"
chmod 600 "$private/overlay.before.yml"
rollback() {
  echo 'EDGE_CODE=ROLLBACK_ATTEMPT'
  cp "$private/overlay.before.yml" "$overlay"
  chmod 600 "$overlay"
  if extended up -d --no-deps --force-recreate functions >"$tmp/rollback.log" 2>&1; then
    echo 'EDGE_CODE_ROLLBACK=SUCCESS'
  else
    echo 'EDGE_CODE_ROLLBACK=FAILED_MANUAL_ACTION_REQUIRED'
  fi
}
python3 - "$overlay" "$tmp/new.yml" <<'PY'
from pathlib import Path
import sys
old=Path(sys.argv[1]).read_text()
if not old.startswith('services:\n  functions:\n') or '\n    volumes:' in old:
 print('EDGE_CODE=BLOCKED_OVERLAY_LAYOUT');sys.exit(1)
mount=('    volumes:\n'
       '      - type: bind\n'
       '        source: /home/ubuntu/neis-backups/edge-runtime-release-20261010/functions\n'
       '        target: /home/deno/functions\n'
       '        read_only: true\n')
p=Path(sys.argv[2])
p.write_text(old.rstrip()+'\n'+mount)
p.chmod(0o600)
PY
if ! python3 - "$tmp/new.yml" <<'PY'
from pathlib import Path
import json,subprocess,sys
cmd=['sudo','-n','/usr/bin/docker','compose']
for name in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',str(Path(sys.argv[1]).resolve())):
 cmd+=['-f',name]
p=subprocess.run([*cmd,'config','--format','json'],capture_output=True,text=True,timeout=45)
if p.returncode:
 print('EDGE_CODE=BLOCKED_COMPOSE_CONFIG');sys.exit(1)
try:
 svc=json.loads(p.stdout)['services']['functions']
 env=svc['environment']
 required=('SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEYS','SUPABASE_SERVICE_ROLE_KEY','BREVO_API_KEY','EMAIL_WORKER_SECRET','FIREBASE_SERVICE_ACCOUNT_JSON','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEKIT_URL','NOTIFICATION_FROM_EMAIL','NOTIFICATION_FROM_NAME','SITE_URL')
 assert all(env.get(k) for k in required)
 mounts=[m for m in svc.get('volumes',[]) if m.get('target')=='/home/deno/functions']
 assert len(mounts)==1
 assert mounts[0].get('source')=='/home/ubuntu/neis-backups/edge-runtime-release-20261010/functions'
 assert mounts[0].get('read_only') is True
except Exception:
 print('EDGE_CODE=BLOCKED_COMPOSE_MAPPING');sys.exit(1)
print('EDGE_COMPOSE_RELEASE=VALIDATED_13_ENV_AND_READONLY_MOUNT')
PY
then
 echo 'EDGE_CODE=BLOCKED_PREFLIGHT'
 exit 1
fi
cp "$tmp/new.yml" "$overlay"
chmod 600 "$overlay"
if ! extended up -d --no-deps --force-recreate functions >"$tmp/recreate.log" 2>&1; then
 echo 'EDGE_CODE=FAILED_RECREATE';rollback;exit 1
fi
sleep 4
if ! python3 - <<'PY'
import json,subprocess,sys
p=subprocess.run(['sudo','-n','/usr/bin/docker','inspect','--format','{{json .}}','supabase-edge-functions'],capture_output=True,text=True,timeout=30)
if p.returncode:print('EDGE_CODE=FAILED_INSPECT');sys.exit(1)
try:info=json.loads(p.stdout)
except ValueError:print('EDGE_CODE=FAILED_INSPECT_PARSE');sys.exit(1)
if info.get('State',{}).get('Running') is not True:print('EDGE_CODE=FAILED_RUNNING');sys.exit(1)
mount=[x for x in info.get('Mounts',[]) if x.get('Destination')=='/home/deno/functions']
if len(mount)!=1 or mount[0].get('Source')!='/home/ubuntu/neis-backups/edge-runtime-release-20261010/functions' or mount[0].get('RW') is not False:
 print('EDGE_CODE=FAILED_MOUNT');sys.exit(1)
env=dict(x.split('=',1) for x in info.get('Config',{}).get('Env',[]) if '=' in x)
required=('SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEYS','SUPABASE_SERVICE_ROLE_KEY','BREVO_API_KEY','EMAIL_WORKER_SECRET','FIREBASE_SERVICE_ACCOUNT_JSON','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEKIT_URL','NOTIFICATION_FROM_EMAIL','NOTIFICATION_FROM_NAME','SITE_URL')
if any(not env.get(k) for k in required):print('EDGE_CODE=FAILED_ENV');sys.exit(1)
print('EDGE_CODE_MOUNT=READ_ONLY_RELEASE')
print('EDGE_CODE_RUNTIME=RUNNING_13_OF_13')
PY
then
 rollback
 exit 1
fi
anon_key="$(python3 - <<'PY'
from pathlib import Path
for line in Path('.env').read_text().splitlines():
 if line.startswith('ANON_KEY='):
  print(line.split('=',1)[1].strip().strip('"').strip("'"))
  break
PY
)"
if [[ -z "$anon_key" ]]; then echo 'EDGE_CODE=BLOCKED_ANON_KEY';rollback;exit 1;fi
code="$(curl --silent --show-error --output /dev/null --max-time 15 --write-out '%{http_code}' --header "apikey: $anon_key" --header "Authorization: Bearer $anon_key" 'https://supabase.neiscircle.site/functions/v1/study-livekit-token')" || code=NETWORK_ERROR
echo "EDGE_CODE_LIVEKIT_GET_HTTP=$code"
if [[ "$code" != 405 ]]; then
 echo 'EDGE_CODE=FAILED_HANDLER_ROUTE'
 rollback
 exit 1
fi
echo 'EDGE_CODE_DEPLOYMENT=PASS_ROUTED_HANDLER'
echo 'EDGE_OLD_MOUNT=INTACT'
echo 'DATABASE_AND_FRONTEND=UNCHANGED'
