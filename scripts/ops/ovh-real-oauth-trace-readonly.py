#!/usr/bin/env python3
"""Read-only aggregate OAuth callback/PKCE and session counts on OVH.

Never prints log lines, request URLs, user identifiers, tokens or credentials.
"""
import json,re,subprocess,urllib.request,urllib.error,os
os.chdir('/home/ubuntu/neis-supabase')
from collections import Counter
def run(cmd,timeout=25):
    try:return subprocess.run(cmd,capture_output=True,text=True,timeout=timeout)
    except Exception:return None
dc=['sudo','-n','/usr/bin/docker','compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc']
sql="""SELECT 'SESSIONS_5M='||count(*) FROM auth.sessions WHERE created_at>now()-interval '5 minutes'
UNION ALL SELECT 'SESSIONS_30M='||count(*) FROM auth.sessions WHERE created_at>now()-interval '30 minutes'
UNION ALL SELECT 'SESSIONS_2H='||count(*) FROM auth.sessions WHERE created_at>now()-interval '2 hours'
UNION ALL SELECT 'REFRESH_30M='||count(*) FROM auth.refresh_tokens WHERE created_at>now()-interval '30 minutes';"""
p=run(dc+[sql])
if p and p.returncode==0:
 for line in p.stdout.splitlines():
  if re.fullmatch(r'(SESSIONS_5M|SESSIONS_30M|SESSIONS_2H|REFRESH_30M)=[0-9]+',line):print(line)
else:print('AUTH_DB_STATS=UNAVAILABLE')
logs=run(['sudo','-n','/usr/bin/docker','logs','--since','120m','--tail','12000','supabase-auth'],30)
if logs and logs.returncode==0:
 results=Counter()
 for line in (logs.stdout+'\n'+logs.stderr).splitlines():
  # Only count route/status and known PKCE error categories; print nothing raw.
  low=line.lower()
  path=''
  match=re.search(r'(?:/auth/v1)?/(callback|authorize|token|user)(?:[?\s\\"\\]|$)',low)
  if match:path=match.group(1).upper()
  elif 'grant_type=pkce' in low:path='TOKEN_PKCE'
  if not path:continue
  status=re.search(r'[\\"]?(?:status|status_code|response_status)[\\"]?\s*[:=]\s*[\\"]?([1-5][0-9]{2})',low)
  statuscode=status.group(1) if status else 'UNKNOWN'
  results[path+'_HTTP_'+statuscode]+=1
  if any(x in low for x in ('code verifier','code_verifier','invalid flow state','flow state not found','invalid_grant')):
   results['PKCE_FLOW_ERRORS']+=1
 for key,count in sorted(results.items()):print('AUTH_LOG_'+key+'='+str(count))
 print('AUTH_LOGS_PARSED_TOTAL='+str(sum(results.values())))
else:print('AUTH_LOGS=UNAVAILABLE')
# Check real HTML loads core and identity in correct order; never log HTML.
for host in ('neiscircle.site','www.neiscircle.site'):
 try:
  req=urllib.request.Request('https://'+host+'/',headers={'Cache-Control':'no-cache','User-Agent':'NEIS-Safe-Auth-Diagnosis'})
  with urllib.request.urlopen(req,timeout=12) as res:html=res.read(400000).decode('utf8','replace')
  scripts=re.findall(r'<script[^>]+src="([^"]+)"',html)
  core=next((i for i,s in enumerate(scripts) if 'scripts/01-core.js' in s),-1)
  identity=next((i for i,s in enumerate(scripts) if 'scripts/identity-v15.js' in s),-1)
  auth=next((i for i,s in enumerate(scripts) if 'scripts/03-auth-i18n.js' in s),-1)
  prefix='LIVE_'+host.replace('.','_').upper()
  print(prefix+'_SCRIPTS_CORE='+str(core>=0))
  print(prefix+'_SCRIPTS_IDENTITY='+str(identity>=0))
  print(prefix+'_SCRIPTS_AUTH_LAYER='+str(auth>=0))
  print(prefix+'_SCRIPT_ORDER_CORE_AUTH_IDENTITY='+str(core>=0 and auth>=0 and identity>=0 and core<auth<identity))
 except Exception:print('LIVE_'+host.replace('.','_').upper()+'_HTML=NETWORK_ERROR')
print('OAUTH_TRACE=READ_ONLY_AGGREGATE_NO_IDENTIFIERS')
