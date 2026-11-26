#!/usr/bin/env bash
set -Eeuo pipefail
# One-purpose Google OAuth rotation. Reads the client secret only from stdin.
cd /home/ubuntu/neis-supabase
readonly CLIENT_ID="765148853112-6h4mlo1cd9nsvmfl136ofjf6qap5ahkj.apps.googleusercontent.com"
readonly COMPOSE=(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.edge-integrations.yml)
SECRET=""
IFS= read -r SECRET || [[ -n "$SECRET" ]]
if [[ -z "$SECRET" || "$SECRET" == *$'\n'* || "$SECRET" == *$'\r'* ]]; then
  echo "OAUTH_ROTATION=BLOCKED_INVALID_SECRET_INPUT"; exit 2
fi
if [[ ! -f .env ]]; then echo "OAUTH_ROTATION=BLOCKED_ENV_FILE_MISSING"; exit 2; fi
BACKUP=".env.backup-google-oauth-$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
cp -p .env "$BACKUP"
cleanup_secret(){ unset SECRET; }
trap cleanup_secret EXIT
export GOOGLE_OAUTH_ROTATION_SECRET="$SECRET"
export GOOGLE_OAUTH_ROTATION_CLIENT_ID="$CLIENT_ID"
python3 - <<'PY'
import os, pathlib, tempfile
p=pathlib.Path('.env')
lines=p.read_text().splitlines()
values={
 'GOTRUE_EXTERNAL_GOOGLE_ENABLED':'true',
 'GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID':os.environ['GOOGLE_OAUTH_ROTATION_CLIENT_ID'],
 'GOTRUE_EXTERNAL_GOOGLE_SECRET':os.environ['GOOGLE_OAUTH_ROTATION_SECRET'],
}
seen=set(); out=[]
for line in lines:
 stripped=line.strip()
 key=stripped.split('=',1)[0] if '=' in stripped and not stripped.startswith('#') else None
 if key in values:
  if key not in seen: out.append(f'{key}={values[key]}'); seen.add(key)
 else: out.append(line)
for key,value in values.items():
 if key not in seen: out.append(f'{key}={value}')
data='\n'.join(out)+'\n'
fd,tmp=tempfile.mkstemp(prefix='.env.google-oauth.',dir='.')
try:
 with os.fdopen(fd,'w') as f: f.write(data); f.flush(); os.fsync(f.fileno())
 os.chmod(tmp,0o600); os.replace(tmp,p)
finally:
 try: os.unlink(tmp)
 except FileNotFoundError: pass
PY
unset GOOGLE_OAUTH_ROTATION_SECRET
# Ensure the Compose model actually picked up the new values before touching the container.
CONFIG="$("${COMPOSE[@]}" config --format json)"
printf '%s' "$CONFIG" | GOOGLE_OAUTH_ROTATION_CLIENT_ID="$CLIENT_ID" GOOGLE_OAUTH_ROTATION_SECRET="$SECRET" python3 -c '
import json,os,sys
d=json.load(sys.stdin); e=d["services"]["auth"]["environment"]
if isinstance(e,list): e=dict(x.split("=",1) for x in e if "=" in x)
assert e.get("GOTRUE_EXTERNAL_GOOGLE_ENABLED","").lower()=="true"
assert e.get("GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID")==os.environ["GOOGLE_OAUTH_ROTATION_CLIENT_ID"]
assert e.get("GOTRUE_EXTERNAL_GOOGLE_SECRET")==os.environ["GOOGLE_OAUTH_ROTATION_SECRET"]
'
unset CONFIG
if ! "${COMPOSE[@]}" up -d --no-deps auth >/dev/null; then
  cp -p "$BACKUP" .env
  "${COMPOSE[@]}" up -d --no-deps auth >/dev/null || true
  echo "OAUTH_ROTATION=ROLLED_BACK_COMPOSE_FAILED"; exit 1
fi
ok=0
for i in $(seq 1 30); do
  if sudo -n /usr/bin/docker inspect --format '{{.State.Running}}' supabase-auth 2>/dev/null | grep -qx true; then ok=1; break; fi
  sleep 2
done
if [[ "$ok" != 1 ]]; then
  cp -p "$BACKUP" .env
  "${COMPOSE[@]}" up -d --no-deps auth >/dev/null || true
  echo "OAUTH_ROTATION=ROLLED_BACK_AUTH_NOT_RUNNING"; exit 1
fi
sudo -n /usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' supabase-auth | GOOGLE_OAUTH_ROTATION_CLIENT_ID="$CLIENT_ID" GOOGLE_OAUTH_ROTATION_SECRET="$SECRET" python3 -c '
import os,sys
env=dict(x.rstrip("\n").split("=",1) for x in sys.stdin if "=" in x)
assert env.get("GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID")==os.environ["GOOGLE_OAUTH_ROTATION_CLIENT_ID"]
assert env.get("GOTRUE_EXTERNAL_GOOGLE_SECRET")==os.environ["GOOGLE_OAUTH_ROTATION_SECRET"]
assert env.get("GOTRUE_EXTERNAL_GOOGLE_ENABLED","").lower()=="true"
'
# Verify the public Auth settings and the Google authorize redirect without following it.
ANON_KEY="$(sed -n 's/^ANON_KEY=//p' .env | tail -n1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
if [[ -z "$ANON_KEY" ]]; then echo "OAUTH_ROTATION=APPLIED_AUTH_RUNNING_SETTINGS_UNVERIFIED"; exit 1; fi
ANON_KEY="$ANON_KEY" CLIENT_ID="$CLIENT_ID" python3 - <<'PY'
import json,os,urllib.request,urllib.error,urllib.parse,sys
base='https://supabase.neiscircle.site'
h={'apikey':os.environ['ANON_KEY'],'Authorization':'Bearer '+os.environ['ANON_KEY']}
try:
 req=urllib.request.Request(base+'/auth/v1/settings',headers=h)
 with urllib.request.urlopen(req,timeout=15) as r: settings=json.loads(r.read())
 assert settings.get('external',{}).get('google') is True
except Exception:
 print('OAUTH_ROTATION=APPLIED_AUTH_RUNNING_SETTINGS_CHECK_FAILED');sys.exit(1)
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args): return None
opener=urllib.request.build_opener(NoRedirect)
q=urllib.parse.urlencode({'provider':'google','redirect_to':'https://neiscircle.site'})
try:
 opener.open(urllib.request.Request(base+'/auth/v1/authorize?'+q,headers=h),timeout=15)
 print('OAUTH_ROTATION=APPLIED_AUTHORIZE_DID_NOT_REDIRECT');sys.exit(1)
except urllib.error.HTTPError as e:
 loc=e.headers.get('Location','')
 parsed=urllib.parse.urlsplit(loc)
 cid=urllib.parse.parse_qs(parsed.query).get('client_id',[''])[0]
 if e.code not in (301,302,303,307,308) or parsed.hostname!='accounts.google.com' or cid!=os.environ['CLIENT_ID']:
  print('OAUTH_ROTATION=APPLIED_GOOGLE_REDIRECT_MISMATCH');sys.exit(1)
print('OAUTH_ROTATION=SUCCESS')
print('OAUTH_CLIENT_ID='+os.environ['CLIENT_ID'])
print('OAUTH_AUTH_CONTAINER=RUNNING')
print('OAUTH_GOOGLE_REDIRECT=VERIFIED')
PY
