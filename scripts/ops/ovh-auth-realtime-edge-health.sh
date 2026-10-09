#!/usr/bin/env bash
set -Eeuo pipefail
# Passive HTTP health checks; no user sessions, secrets, writes, or service restarts.
python3 - <<'PY'
import urllib.request,urllib.error
urls={
 'AUTH':'https://supabase.neiscircle.site/auth/v1/health',
 'REST':'https://supabase.neiscircle.site/rest/v1/',
 'REALTIME':'https://supabase.neiscircle.site/realtime/v1/',
 'EDGE':'https://supabase.neiscircle.site/functions/v1/',
}
for name,url in urls.items():
 req=urllib.request.Request(url,headers={'User-Agent':'NEIS-OVH-Readiness/1.0'})
 try:
  with urllib.request.urlopen(req,timeout=12) as r: code=r.status
 except urllib.error.HTTPError as e:code=e.code
 except Exception:
  print(name+'_NETWORK=FAILED')
  continue
 print(name+'_HTTP='+str(code))
 print(name+'_ROUTED='+('YES' if code in (200,400,401,403,404,405,426) else 'CHECK'))
print('HEALTH_CHECK=READ_ONLY')
PY
