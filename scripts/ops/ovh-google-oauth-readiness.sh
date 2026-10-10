#!/usr/bin/env bash
set -Eeuo pipefail
# Non-mutating Google-only sign-in preflight. Never print OAuth secrets, tokens or redirect URLs.
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
import json,subprocess,sys,urllib.request,urllib.error,urllib.parse
docker=['sudo','-n','/usr/bin/docker']
args=[*docker,'compose']
for name in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.edge-integrations.yml'):
 args+=['-f',name]
p=subprocess.run([*args,'config','--format','json'],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=35)
if p.returncode:print('GOOGLE_OAUTH_PREFLIGHT=BLOCKED_COMPOSE_CONFIG');sys.exit(1)
try:
 services=json.loads(p.stdout)['services']
 auth=services['auth']['environment']
 if isinstance(auth,list):auth=dict(x.split('=',1) for x in auth if '=' in x)
except Exception:
 print('GOOGLE_OAUTH_PREFLIGHT=BLOCKED_AUTH_SETTINGS');sys.exit(1)
required=('GOTRUE_EXTERNAL_GOOGLE_ENABLED','GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID','GOTRUE_EXTERNAL_GOOGLE_SECRET')
for name in required:
 val=auth.get(name)
 print('GOOGLE_COMPOSE_'+name+'='+('PRESENT' if val else 'MISSING'))
running=subprocess.run([*docker,'inspect','--format','{{json .}}','supabase-auth'],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=20)
if running.returncode:
 print('GOOGLE_AUTH_RUNTIME=NOT_FOUND');sys.exit(1)
try:
 info=json.loads(running.stdout)
 state=info.get('State') or {}
 env=dict(s.split('=',1) for s in info['Config']['Env'] if '=' in s)
 print('GOOGLE_AUTH_RUNTIME='+('RUNNING' if state.get('Running') else 'STOPPED'))
 print('GOOGLE_AUTH_RUNNING_PROVIDER_ENABLED='+('YES' if env.get('GOTRUE_EXTERNAL_GOOGLE_ENABLED','').lower()=='true' else 'NO'))
 for name in required[1:]:
  print('GOOGLE_AUTH_RUNTIME_'+name+'_MATCH='+('YES' if bool(env.get(name)) and env.get(name)==auth.get(name) else 'NO'))
 print('GOOGLE_AUTH_SITE_URL_EXPECTED='+('YES' if env.get('GOTRUE_SITE_URL','').rstrip('/')=='https://neiscircle.site' else 'NO'))
 redirects=env.get('GOTRUE_URI_ALLOW_LIST','')
 print('GOOGLE_AUTH_SITE_IN_REDIRECT_ALLOW_LIST='+('YES' if 'neiscircle.site' in redirects else 'NO'))
except Exception:
 print('GOOGLE_AUTH_RUNTIME=INSPECT_UNAVAILABLE');sys.exit(1)
key=''
from pathlib import Path
for line in Path('.env').read_text().splitlines():
 if line.startswith('ANON_KEY='):
  key=line.split('=',1)[1].strip().strip('"').strip("'")
  break
if not key: print('GOOGLE_OAUTH_PREFLIGHT=BLOCKED_ANON_KEY');sys.exit(1)
origin='https://supabase.neiscircle.site'
hdr={'apikey':key,'authorization':'Bearer '+key,'user-agent':'NEIS-OAuth-ReadOnly/1.0'}
class NoFollow(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):return None
opener=urllib.request.build_opener(NoFollow)
try:
 req=urllib.request.Request(origin+'/auth/v1/settings',headers=hdr)
 with opener.open(req,timeout=12) as resp:
  settings=json.loads(resp.read(256*1024))
  status=resp.status
 print('GOOGLE_AUTH_SETTINGS_HTTP='+str(status))
 enabled=settings.get('external',{}).get('google') if isinstance(settings.get('external'),dict) else None
 print('GOOGLE_AUTH_SETTINGS_PROVIDER='+('ENABLED' if enabled is True else 'DISABLED_OR_UNAVAILABLE'))
except urllib.error.HTTPError as e:
 print('GOOGLE_AUTH_SETTINGS_HTTP='+str(e.code));enabled=False
except Exception:
 print('GOOGLE_AUTH_SETTINGS_HTTP=NETWORK_ERROR');enabled=False
params=urllib.parse.urlencode({'provider':'google','redirect_to':'https://neiscircle.site'})
try:
 req=urllib.request.Request(origin+'/auth/v1/authorize?'+params,headers=hdr)
 with opener.open(req,timeout=12) as resp:
  code=resp.status
  where=urllib.parse.urlsplit(resp.getheader('Location','')).hostname
except urllib.error.HTTPError as e:
 code=e.code;where=urllib.parse.urlsplit(e.headers.get('Location','')).hostname
except Exception:
 code=None;where=None
print('GOOGLE_AUTH_AUTHORIZE_HTTP='+str(code if code is not None else 'NETWORK_ERROR'))
print('GOOGLE_AUTH_AUTHORIZE_GOOGLE_REDIRECT='+('YES' if code in (301,302,303,307,308) and where in ('accounts.google.com','accounts.googleusercontent.com') else 'NO'))
print('GOOGLE_OAUTH_EMAIL_OTP_TESTS=NOT_USED')
print('GOOGLE_OAUTH_CREDENTIALS_LOGGED=NO')
ok=(state.get('Running') and auth.get('GOTRUE_EXTERNAL_GOOGLE_ENABLED','').lower()=='true' and all(auth.get(k) and auth.get(k)==env.get(k) for k in required[1:]) and enabled is True and code in (301,302,303,307,308) and where=='accounts.google.com')
print('GOOGLE_OAUTH_PREFLIGHT='+('PASS_GOOGLE_AUTHORIZE_ROUTE' if ok else 'BLOCKED_GOOGLE_PROVIDER'))
sys.exit(0 if ok else 1)
PY
