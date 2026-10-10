#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
from pathlib import Path
import subprocess,urllib.request,urllib.error,json,re
env={}
for l in Path('.env').read_text().splitlines():
 if '=' in l and not l.lstrip().startswith('#'):
  k,v=l.split('=',1);env[k.strip()]=v.strip().strip('"').strip("'")
anon=env.get('ANON_KEY','')
if not anon:raise SystemExit('GATEWAY=BLOCKED_ANON_KEY_MISSING')
routes=['/auth/v1/settings','/auth/v1/user','/auth/v1/health','/rest/v1/']
for path in routes:
 for mode in ['APIKEY','BEARER_AND_APIKEY']:
  headers={'apikey':anon,'Origin':'https://neiscircle.site','User-Agent':'NEIS-OAuth-Gateway-Diagnostic'}
  if mode=='BEARER_AND_APIKEY':headers['Authorization']='Bearer '+anon
  try:
   req=urllib.request.Request('https://supabase.neiscircle.site'+path,headers=headers)
   resp=urllib.request.urlopen(req,timeout=12)
  except urllib.error.HTTPError as error:resp=error
  except Exception:
   print('GATEWAY_'+path.replace('/','_')+'_'+mode+'=NETWORK_ERROR');continue
  with resp:
   result=resp.read(2000).decode('utf-8','replace')
   code=resp.status
   try:
    obj=json.loads(result)
    if isinstance(obj,dict):
     keys=set(obj.keys())
     errors=['bad_jwt','invalid_token','not_authenticated','missing_sub','user_not_found','invalid_api_key','no_api_key','bad_json']
     category=next((e for e in errors if e in str(obj.get('error_code','')) or e in str(obj.get('code',''))),'OTHER')
     if 'error_code' in keys:typ='GOTRUE'
     elif 'message' in keys and 'code' not in keys and 'msg' not in keys:typ='GATEWAY_OR_GENERIC'
     else:typ='UNKNOWN'
    else:typ='NON_OBJECT';category='UNKNOWN'
   except Exception:typ='NON_JSON';category='UNKNOWN'
   print('GATEWAY_'+path.strip('/').replace('/','_').upper()+'_'+mode+'_HTTP='+str(code))
   print('GATEWAY_'+path.strip('/').replace('/','_').upper()+'_'+mode+'_ERROR_STYLE='+typ)
   print('GATEWAY_'+path.strip('/').replace('/','_').upper()+'_'+mode+'_ERROR_CLASS='+category)
r=subprocess.run(['sudo','-n','/usr/bin/docker','inspect','--format','{{json .Config.Env}}','supabase-kong'],capture_output=True,text=True)
if r.returncode==0:
 try:
  run=dict(x.split('=',1) for x in json.loads(r.stdout) if '=' in x)
  for k in ('SUPABASE_ANON_KEY','ANON_KEY','KONG_DECLARATIVE_CONFIG'):
   val=run.get(k)
   print('KONG_'+k+'_PRESENT='+str(bool(val)))
   if k!='KONG_DECLARATIVE_CONFIG' and val:print('KONG_'+k+'_MATCH='+str(val==anon))
 except Exception:print('KONG_ENV=INSPECT_UNAVAILABLE')
else:print('KONG_ENV=NOT_FOUND')
# Count auth sessions with missing users, not IDs.
q="SELECT 'SESSIONS_MISSING_USER='||count(*) FROM auth.sessions s LEFT JOIN auth.users u ON u.id=s.user_id WHERE u.id IS NULL UNION ALL SELECT 'RECENT_AUTH_SESSIONS='||count(*) FROM auth.sessions WHERE created_at>now()-interval '2 hours';"
cmd=['sudo','-n','/usr/bin/docker','compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc',q]
x=subprocess.run(cmd,capture_output=True,text=True)
if x.returncode==0:
 for ln in x.stdout.splitlines():
  if ln.startswith(('SESSIONS_MISSING_USER=','RECENT_AUTH_SESSIONS=')):print(ln)
print('GATEWAY_DIAGNOSTIC=NO_TOKENS_OR_PERSONAL_DATA')
PY
