#!/usr/bin/env bash
# Strictly scoped GoTrue redirect allowlist fix. No user or OAuth secrets printed.
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
test -f docker-compose.yml && test -f docker-compose.security.yml
test -f docker-compose.caddy.yml && test -f docker-compose.frontend-public.yml
test -f docker-compose.edge-integrations.yml && test -w .env
dc(){ sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.edge-integrations.yml -f docker-compose.frontend-public.yml "$@"; }
dc config --quiet
mkdir -p -m 700 /home/ubuntu/neis-backups/oauth-redirect-allowlist-20261010
backup=/home/ubuntu/neis-backups/oauth-redirect-allowlist-20261010/dot-env.before
test ! -e "$backup" || { echo 'OAUTH_ORIGINS=BACKUP_ALREADY_EXISTS';exit 1; }
cp -p .env "$backup"
chmod 600 "$backup"
rollback=1
cleanup(){
 if [ "$rollback" = 1 ];then
  cp -p "$backup" .env
  dc up -d --no-deps auth >/dev/null 2>&1 || true
  echo 'OAUTH_ORIGINS=ROLLBACK_DONE'
 fi
}
trap cleanup EXIT
python3 - <<'PY'
from pathlib import Path
import os,re,stat
root=Path('/home/ubuntu/neis-supabase')
compose=(root/'docker-compose.yml').read_text()
mapping=[x.strip() for x in compose.splitlines() if x.lstrip().startswith('GOTRUE_URI_ALLOW_LIST:')]
if len(mapping)!=1 or 'ADDITIONAL_REDIRECT_URLS' not in mapping[0]:
 raise SystemExit('OAUTH_ORIGINS=UNKNOWN_COMPOSE_MAPPING')
key='ADDITIONAL_REDIRECT_URLS'
p=root/'.env'
original=p.read_text()
lines=original.splitlines(keepends=True)
found=[i for i,s in enumerate(lines) if s.startswith(key+'=')]
if len(found)>1:raise SystemExit('OAUTH_ORIGINS=DUPLICATE_KEY')
previous=lines[found[0]].partition('=')[2].strip().strip('"').strip("'") if found else ''
values=[s.strip() for s in previous.split(',') if s.strip()]
for origin in ('https://neiscircle.site','https://www.neiscircle.site'):
 if origin not in [v.rstrip('/') for v in values]:values.append(origin)
if any('\r' in v or '\n' in v or '#' in v for v in values):
 raise SystemExit('OAUTH_ORIGINS=INVALID_VALUE')
replacement=key+'='+','.join(values)+'\n'
if found:lines[found[0]]=replacement
else:lines.append(replacement)
temporary=root/'.env.oauth-origin.tmp'
if temporary.exists():raise SystemExit('OAUTH_ORIGINS=TEMP_EXISTS')
with temporary.open('x') as stream:
 stream.write(''.join(lines))
 stream.flush();os.fsync(stream.fileno())
os.chmod(temporary,stat.S_IMODE(p.stat().st_mode))
os.replace(temporary,p)
print('OAUTH_ORIGINS=STAGED')
PY
dc config --quiet
python3 - <<'PY'
import json,subprocess
c=subprocess.run(['sudo','-n','/usr/bin/docker','compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','-f','docker-compose.edge-integrations.yml','-f','docker-compose.frontend-public.yml','config','--format','json'],capture_output=True,text=True,timeout=25)
if c.returncode:raise SystemExit('OAUTH_ORIGINS=COMPOSE_INVALID')
env=json.loads(c.stdout)['services']['auth']['environment']
if isinstance(env,list):env=dict(x.split('=',1) for x in env)
urls=[x.strip().rstrip('/') for x in env.get('GOTRUE_URI_ALLOW_LIST','').split(',')]
if not all(x in urls for x in ('https://neiscircle.site','https://www.neiscircle.site')):
 raise SystemExit('OAUTH_ORIGINS=RENDERED_ENV_MISMATCH')
print('OAUTH_ORIGINS=COMPOSE_VERIFIED')
PY
dc up -d --no-deps auth >/dev/null
python3 - <<'PY'
import json,subprocess,time,urllib.request,urllib.error,urllib.parse
for attempt in range(25):
 p=subprocess.run(['sudo','-n','/usr/bin/docker','inspect','--format','{{json .Config.Env}}','supabase-auth'],capture_output=True,text=True,timeout=15)
 try:env=dict(x.split('=',1) for x in json.loads(p.stdout) if '=' in x)
 except Exception:env={}
 urls=[x.strip().rstrip('/') for x in env.get('GOTRUE_URI_ALLOW_LIST','').split(',')]
 if all(x in urls for x in ('https://neiscircle.site','https://www.neiscircle.site')):break
 time.sleep(1)
else:raise SystemExit('OAUTH_ORIGINS=RUNTIME_MISMATCH')
print('OAUTH_ORIGINS=RUNTIME_VERIFIED')
for attempt in range(20):
 try:
  with urllib.request.urlopen('https://supabase.neiscircle.site/auth/v1/health',timeout=5) as r:
   if r.status==200:break
 except Exception:time.sleep(1)
else:raise SystemExit('OAUTH_ORIGINS=AUTH_UNHEALTHY')
class NoFollow(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):return None
opener=urllib.request.build_opener(NoFollow)
for host in ('neiscircle.site','www.neiscircle.site'):
 q=urllib.parse.urlencode({'provider':'google','redirect_to':'https://'+host+'/',
 'code_challenge':'A'*43,'code_challenge_method':'s256'})
 try:r=opener.open('https://supabase.neiscircle.site/auth/v1/authorize?'+q,timeout=13)
 except urllib.error.HTTPError as e:r=e
 with r:
  good=r.status==302 and urllib.parse.urlsplit(r.headers.get('Location','')).hostname=='accounts.google.com'
 if not good:raise SystemExit('OAUTH_ORIGINS=GOOGLE_AUTHORIZE_FAILED')
print('OAUTH_ORIGINS=GOOGLE_PROVIDER_HEALTHY')
print('OAUTH_ORIGINS=NO_DB_OR_FRONTEND_CHANGES')
PY
rollback=0
echo 'OAUTH_ORIGINS=SUCCESS'
