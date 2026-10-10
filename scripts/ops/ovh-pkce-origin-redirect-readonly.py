#!/usr/bin/env python3
"""Read-only: test actual redirects without following them or exposing codes."""
import json,subprocess,urllib.request,urllib.error,urllib.parse,re
from collections import Counter
class NoFollow(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,request,fp,code,msg,headers,newurl):return None
opener=urllib.request.build_opener(NoFollow)
for host in ('neiscircle.site','www.neiscircle.site'):
 for path in ('/','/scripts/01-core.js?version=auth-check'):
  prefix='PUBLIC_'+host.replace('.','_').upper()+('_HTML' if path=='/' else '_CORE')
  try:
   req=urllib.request.Request('https://'+host+path,headers={'User-Agent':'NEIS-PKCE-Canonical-Probe','Cache-Control':'no-cache'})
   try:r=opener.open(req,timeout=12)
   except urllib.error.HTTPError as e:r=e
   with r:
    destination=urllib.parse.urlsplit(r.headers.get('Location','')).hostname
    print(prefix+'_STATUS='+str(r.status))
    print(prefix+'_REDIRECT_HOST='+('APEX' if destination=='neiscircle.site' else 'WWW' if destination=='www.neiscircle.site' else 'OTHER' if destination else 'NONE'))
    if path=='/':print(prefix+'_HAS_LOGIN_UI='+str('scripts/identity-v15.js' in r.read(400000).decode('utf8','replace')))
  except Exception:print(prefix+'_ERROR=NETWORK')
# Validate source of the /token requests without logging body, URLs or users.
for container in ('supabase-auth','supabase-kong','supabase-envoy','supabase-caddy'):
 p=subprocess.run(['sudo','-n','/usr/bin/docker','logs','--since','60m','--tail','6000',container],capture_output=True,text=True,timeout=22)
 if p.returncode!=0:continue
 lines=(p.stdout+'\n'+p.stderr).splitlines()
 totals=Counter()
 for line in lines:
  s=line.lower()
  if '/token' not in s or '/auth/' not in s:continue
  if 'grant_type=pkce' in s:totals['PKCE_ROUTE_LOGS']+=1
  match=re.search(r'(?:status|status_code|response_status)\W+([1-5][0-9]{2})',s)
  if match:totals['TOKEN_HTTP_'+match.group(1)]+=1
  else:totals['TOKEN_UNCLASSIFIED']+=1
 for key,num in sorted(totals.items()):print('SERVER_'+container.replace('-','_').upper()+'_'+key+'='+str(num))
 print('SERVER_'+container.replace('-','_').upper()+'_TOKEN_ROUTE_EVENTS='+str(totals.get('PKCE_ROUTE_LOGS',0)+sum(v for k,v in totals.items() if k.startswith('TOKEN_HTTP_') or k=='TOKEN_UNCLASSIFIED')))
print('PROBE=READ_ONLY_NO_AUTH_CODES_OR_USERS')
