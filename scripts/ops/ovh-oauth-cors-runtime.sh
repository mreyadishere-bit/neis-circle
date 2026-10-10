#!/usr/bin/env bash
set -Eeuo pipefail
python3 - <<'PY'
import urllib.request,urllib.error,urllib.parse,json,subprocess,re
base='https://supabase.neiscircle.site'
origin='https://neiscircle.site'
checks=[
 ('AUTH_OPTIONS','/auth/v1/token?grant_type=refresh_token','OPTIONS',None),
 ('USER_OPTIONS','/auth/v1/user','OPTIONS',None),
 ('REST_OPTIONS','/rest/v1/profiles?select=id&limit=1','OPTIONS',None),
 ('AUTH_HEALTH','/auth/v1/health','GET',None),
 ('REFRESH_INVALID','/auth/v1/token?grant_type=refresh_token','POST',b'{"refresh_token":"not-a-real-refresh-token"}'),
]
for name,path,method,data in checks:
 hdr={'Origin':origin,'User-Agent':'NEIS-OAuth-Readiness','Content-Type':'application/json'}
 if method=='OPTIONS':hdr.update({'Access-Control-Request-Method':'POST' if name=='AUTH_OPTIONS' else 'GET','Access-Control-Request-Headers':'apikey,authorization,content-type,x-client-info'})
 req=urllib.request.Request(base+path,method=method,headers=hdr,data=data)
 try:
  resp=urllib.request.urlopen(req,timeout=10)
 except urllib.error.HTTPError as e:resp=e
 except Exception as e:
  print(name+'_NETWORK='+type(e).__name__);continue
 with resp:
  h=resp.headers
  print(name+'_HTTP='+str(resp.status))
  print(name+'_ACAO_OK='+str(h.get('Access-Control-Allow-Origin','') in (origin,'*')))
  print(name+'_ACAM_PRESENT='+str(bool(h.get('Access-Control-Allow-Methods'))))
  print(name+'_ACAH_PRESENT='+str(bool(h.get('Access-Control-Allow-Headers'))))
# summarize only response status and route for Auth, never emit URL params, requests or bodies
r=subprocess.run(['sudo','-n','/usr/bin/docker','logs','--since','45m','--tail','2000','supabase-auth'],capture_output=True,text=True,timeout=25)
if r.returncode:print('GOTRUE_LOGS=UNAVAILABLE')
else:
 events={}
 for ln in (r.stdout+'\n'+r.stderr).splitlines():
  if not any(x in ln for x in ['/token','/user','/callback','token?','grant_type']):continue
  route='token' if '/token' in ln or 'token?' in ln else 'user' if '/user' in ln else 'callback'
  status=re.search(r'\b(?:status|status_code|response_status)\W+([1-5][0-9]{2})\b',ln)
  key=route+'_'+(status.group(1) if status else 'UNKNOWN')
  events[key]=events.get(key,0)+1
 for k,n in sorted(events.items()):print('AUTH_LOG_'+k.upper()+'='+str(n))
 print('AUTH_LOG_RELEVANT_COUNT='+str(sum(events.values())))
print('DIAG_PRIVACY=PATH_STATUS_ONLY')
PY
