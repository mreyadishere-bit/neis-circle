#!/usr/bin/env bash
set -Eeuo pipefail
# Builds a private Docker Compose overlay from an approved GitHub Actions secret bundle.
# No container restart here. Never prints secret material or docker compose config output.
root=/home/ubuntu/neis-supabase
bundle=/home/ubuntu/neis-backups/edge-private-integrations-20261010.json
trap 'rm -f "$bundle"' EXIT
overlay="$root/docker-compose.edge-integrations.yml"
test -d "$root" && test -f "$bundle"
umask 077
python3 - "$bundle" "$overlay" <<'PY'
import json,os,sys,tempfile,subprocess
from pathlib import Path
bundle=Path(sys.argv[1])
target=Path(sys.argv[2])
needed=('BREVO_API_KEY','EMAIL_WORKER_SECRET','FIREBASE_SERVICE_ACCOUNT_JSON','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEKIT_URL','NOTIFICATION_FROM_EMAIL','NOTIFICATION_FROM_NAME','SITE_URL')
try:
 values=json.loads(bundle.read_text())
 assert set(values)==set(needed)
 assert all(isinstance(values[k],str) and values[k] for k in needed)
 firebase=json.loads(values['FIREBASE_SERVICE_ACCOUNT_JSON'])
 assert firebase.get('type')=='service_account' and firebase.get('private_key') and firebase.get('client_email')
 assert values['SITE_URL'].startswith('https://')
 assert values['LIVEKIT_URL'].startswith(('https://','wss://'))
except Exception:
 print('EDGE_SECRET_BUNDLE=INVALID');sys.exit(1)
if target.exists():
 print('EDGE_OVERLAY=ALREADY_EXISTS_REVIEW_REQUIRED');sys.exit(1)
# JSON strings are valid YAML scalar strings. Escape Compose $ interpolation without affecting delivered values.
lines=['services:','  functions:','    environment:']
for key in needed:
 lines.append('      '+key+': '+json.dumps(values[key].replace('$','$$'),ensure_ascii=True))
text='\n'.join(lines)+'\n'
fd,name=tempfile.mkstemp(prefix='.edge-integrations-',suffix='.tmp',dir=target.parent)
os.fchmod(fd,0o600)
with os.fdopen(fd,'w') as f:f.write(text)
files=['docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',Path(name).name]
cmd=['sudo','-n','/usr/bin/docker','compose']
for file in files:cmd+=['-f',file]
p=subprocess.run([*cmd,'config','--format','json'],cwd=target.parent,capture_output=True,text=True,timeout=40)
if p.returncode:
 os.unlink(name);print('EDGE_COMPOSE=VALIDATION_FAILED');sys.exit(1)
try:
 parsed=json.loads(p.stdout)
 env=parsed['services']['functions']['environment']
 assert all(env.get(key)==values[key] for key in needed)
 assert len([k for k in ('SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEYS','SUPABASE_SERVICE_ROLE_KEY') if env.get(k)])==4
except Exception:
 os.unlink(name);print('EDGE_COMPOSE=ENV_VALUE_MISMATCH');sys.exit(1)
os.replace(name,target)
os.chmod(target,0o600)
print('EDGE_COMPOSE_OVERLAY=STAGED_VALIDATED')
print('EDGE_REQUIRED_INTEGRATIONS=9')
print('EDGE_ENV_CONFIGURED=13/13')
print('EDGE_RUNNING_CONTAINER=UNCHANGED')
print('SECRET_VALUES_LOGGED=NO')
PY
rm -f "$bundle"
