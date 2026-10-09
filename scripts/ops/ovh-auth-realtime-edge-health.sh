#!/usr/bin/env bash
set -Eeuo pipefail
# Only GET requests, no credentials, no side effects or production writes.
python3 - <<'PY'
import sys, urllib.request, urllib.error
base='https://supabase.neiscircle.site'
paths={
 'AUTH':'/auth/v1/health',
 'REST':'/rest/v1/',
 'REALTIME':'/realtime/v1/',
 'EDGE_LIVEKIT':'/functions/v1/study-livekit-token',
}
problems=[]
for name,path in paths.items():
 req=urllib.request.Request(base+path,headers={'User-Agent':'NEIS-OVH-Readiness/1.2'},method='GET')
 try:
  with urllib.request.urlopen(req,timeout=12) as r:code=r.status
 except urllib.error.HTTPError as e:code=e.code
 except Exception:
  print(name+'_NETWORK=FAILED')
  problems.append(name+'_NETWORK')
  continue
 print(name+'_HTTP='+str(code))
 if name=='EDGE_LIVEKIT':
  # Function itself returns 405 on GET; 401 can be an outer auth gateway.
  routed=code in (200,401,403,405)
  verdict='FUNCTION_METHOD_REJECTED' if code==405 else ('PROTECTED_GATEWAY_ONLY' if routed else 'UNVERIFIED')
 else:
  routed=code in (200,400,401,403,405,426)
  verdict='RESPONDING_OR_PROTECTED' if routed else 'UNVERIFIED'
 print(name+'_ROUTE_STATUS='+verdict)
 if not routed:problems.append(name+'_ROUTING')
print('HEALTH_CHECK=READ_ONLY')
print('HEALTH_CHECK_RESULT='+('PASS_PASSIVE_ONLY' if not problems else 'FAIL_ROUTES'))
print('FUNCTIONAL_AUTH_RLS_REALTIME_VALIDATED=NO')
sys.exit(1 if problems else 0)
PY
