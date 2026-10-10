#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only Compose and running Edge environment inventory. Never print config values.
python3 - <<'PY'
from pathlib import Path
import json,subprocess,re,sys
root=Path('/home/ubuntu/neis-supabase')
files=['docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml']
for f in files:
 if not (root/f).is_file():print('OVH_COMPOSE_FILES=MISSING');sys.exit(1)
def run(argv):
 p=subprocess.run(argv,cwd=root,capture_output=True,text=True,timeout=40)
 return p.stdout if p.returncode==0 else None
docker=['sudo','-n','/usr/bin/docker']
raw=run([*docker,'inspect','--format','{{json .}}','supabase-edge-functions'])
if raw is None:print('EDGE_INSPECT=FAILED');sys.exit(1)
try:live=json.loads(raw)
except ValueError:print('EDGE_INSPECT=INVALID');sys.exit(1)
if not live.get('State',{}).get('Running'):
 print('EDGE_CONTAINER=NOT_RUNNING');sys.exit(1)
labels=live.get('Config',{}).get('Labels') or {}
service=labels.get('com.docker.compose.service') or ''
print('EDGE_COMPOSE_SERVICE='+service if re.fullmatch(r'[a-z0-9_-]+',service) else 'EDGE_COMPOSE_SERVICE=UNRECOGNIZED')
cmd=[*docker,'compose']
for f in files:cmd+=['-f',f]
output=run([*cmd,'config','--format','json'])
if output is None:print('OVH_COMPOSE_CONFIG=FAILED');sys.exit(1)
try:config=json.loads(output)
except ValueError:print('OVH_COMPOSE_CONFIG=UNPARSABLE');sys.exit(1)
services=config.get('services') or {}
if service not in services:
 print('EDGE_COMPOSE_SERVICE=NOT_DEFINED');sys.exit(1)
edge=services[service]
rawenv=edge.get('environment') or {}
if isinstance(rawenv,list):
 configured={x.split('=',1)[0]:x.split('=',1)[1] if '=' in x else '' for x in rawenv}
elif isinstance(rawenv,dict):configured=rawenv
else:
 print('OVH_COMPOSE_ENV=INVALID');sys.exit(1)
running_names={x.split('=',1)[0] for x in live.get('Config',{}).get('Env',[]) if '=' in x}
required=('SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEYS','SUPABASE_SERVICE_ROLE_KEY','BREVO_API_KEY','EMAIL_WORKER_SECRET','FIREBASE_SERVICE_ACCOUNT_JSON','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEKIT_URL','NOTIFICATION_FROM_EMAIL','NOTIFICATION_FROM_NAME','SITE_URL')
print('OVH_COMPOSE_SERVICES='+str(len(services)))
print('OVH_COMPOSE_FUNCTION_ENV_DECLARED='+str(sum(k in configured for k in required))+'/'+str(len(required)))
print('OVH_COMPOSE_FUNCTION_ENV_NONEMPTY='+str(sum(bool(configured.get(k)) for k in required))+'/'+str(len(required)))
print('OVH_RUNNING_FUNCTION_ENV_PRESENT='+str(sum(k in running_names for k in required))+'/'+str(len(required)))
for k in required:
 if k not in configured: print('OVH_EDGE_COMPOSE_MISSING='+k)
mounts=[x.get('Destination') for x in live.get('Mounts',[]) if isinstance(x,dict)]
print('OVH_EDGE_FUNCTION_MOUNT='+('PRESENT' if '/home/deno/functions' in mounts else 'MISSING'))
print('OVH_COMPOSE_HAS_ENV_FILE='+('YES' if edge.get('env_file') else 'NO'))
print('OVH_COMPOSE_READ_ONLY=YES')
print('OVH_SECRET_VALUES_LOGGED=NO')
PY
