#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only reachability checks. Never treat a 404 as verified route health.
python3 - <<'PY'
import sys, urllib.request, urllib.error
base='https://supabase.neiscircle.site'
paths={
 'AUTH':'/auth/v1/health',
 'REST':'/rest/v1/',
 'REALTIME':'/realtime/v1/',
 'EDGE':'/functions/v1/',
}
problems=[]
for name,path in paths.items():
 req=urllib.request.Request(base+path,headers={'User-Agent':'NEIS-OVH-Readiness/1.1'})
 try:
  with urllib.request.urlopen(req,timeout=12) as r: code=r.status
 except urllib.error.HTTPError as e:
  code=e.code
 except Exception:
  print(name+'_NETWORK=FAILED')
  problems.append(name+'_NETWORK')
  continue
 print(name+'_HTTP='+str(code))
 # Protected services may correctly reject requests without credentials.
 if name=='AUTH':
  verified=(code==200)
 else:
  verified=(code in (200,400,401,403,405,426))
 print(name+'_GATEWAY_RESPONSE='+('PLAUSIBLE' if verified else 'UNVERIFIED'))
 if not verified: problems.append(name+'_ROUTING')
print('HEALTH_CHECK=READ_ONLY')
print('HEALTH_CHECK_RESULT='+('PASS_PASSIVE_ONLY' if not problems else 'FAIL_INCONCLUSIVE'))
sys.exit(1 if problems else 0)
PY
