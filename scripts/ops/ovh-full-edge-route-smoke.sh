#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only HTTP checks; no POST, no email, push, meeting issuance or data writes.
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
from pathlib import Path
import urllib.request,urllib.error,urllib.parse,base64,secrets,sys
key=''
for line in Path('.env').read_text().splitlines():
 if line.startswith('ANON_KEY='):
  key=line.split('=',1)[1].strip().strip('"').strip("'")
  break
if not key:
 print('OVH_HTTP=BLOCKED_MISSING_ANON_KEY');sys.exit(1)
origin='https://supabase.neiscircle.site'
routes={
 'AUTH_HEALTH':'/auth/v1/health',
 'REST_ROOT':'/rest/v1/',
 'STORAGE_BUCKETS':'/storage/v1/bucket',
}
functions=(
 'brevo-email-capacity',
 'brevo-quota-diagnostic',
 'email-signup-validate',
 'refresh-web-push-subscription',
 'send-mobile-push',
 'send-notification-email',
 'send-web-push',
 'study-livekit-token',
)
def status(path,method='GET'):
 req=urllib.request.Request(origin+path,method=method,headers={
  'User-Agent':'NEIS-Circle-OVH-Staging-ReadOnly/1.0',
  'apikey':key,
  'Authorization':'Bearer '+key,
  'Origin':'https://neiscircle.site',
  'Access-Control-Request-Method':'POST',
 })
 try:
  with urllib.request.urlopen(req,timeout=15) as resp:return resp.status
 except urllib.error.HTTPError as err:return err.code
 except Exception:return None
all_ok=True
for label,path in routes.items():
 code=status(path)
 print(label+'_HTTP='+str(code if code is not None else 'NETWORK_ERROR'))
 if code is None or code>=500 or code==404:
  all_ok=False
# Realtime is a websocket endpoint; /realtime/v1/ itself is not a valid route.
websocket_path='/realtime/v1/websocket?'+urllib.parse.urlencode({'apikey':key,'vsn':'1.0.0'})
websocket_key=base64.b64encode(secrets.token_bytes(16)).decode('ascii')
websocket_req=urllib.request.Request(origin+websocket_path,headers={
 'User-Agent':'NEIS-Circle-OVH-Staging-ReadOnly/1.1',
 'apikey':key,
 'Authorization':'Bearer '+key,
 'Connection':'Upgrade',
 'Upgrade':'websocket',
 'Sec-WebSocket-Version':'13',
 'Sec-WebSocket-Key':websocket_key,
 'Origin':'https://neiscircle.site',
})
try:
 with urllib.request.urlopen(websocket_req,timeout=15) as response: websocket_http=response.status
except urllib.error.HTTPError as error:websocket_http=error.code
except Exception:websocket_http=None
print('REALTIME_WEBSOCKET_HTTP='+str(websocket_http if websocket_http is not None else 'NETWORK_ERROR'))
print('REALTIME_WEBSOCKET_CLASS='+('UPGRADE_VERIFIED' if websocket_http==101 else 'PROTECTED_OR_REJECTED' if websocket_http in (400,401,403,405,426) else 'UNVERIFIED'))
if websocket_http not in (101,400,401,403,405,426):all_ok=False
function_ok=0
for slug in functions:
 path='/functions/v1/'+slug
 code=status(path,'GET')
 options=status(path,'OPTIONS')
 print('FUNCTION_'+slug.replace('-','_').upper()+'_GET_HTTP='+str(code if code is not None else 'NETWORK_ERROR'))
 print('FUNCTION_'+slug.replace('-','_').upper()+'_OPTIONS_HTTP='+str(options if options is not None else 'NETWORK_ERROR'))
 # 401/403 are acceptable protection; 405 is a proven handler response.
 good=(code is not None and options is not None and 200<=code<500 and code!=404 and 200<=options<500 and options!=404)
 function_ok+=int(good)
 if not good:all_ok=False
print('OVH_EDGE_FUNCTION_ROUTES_RESPONDING='+str(function_ok)+'/8')
print('OVH_HTTP_READ_ONLY=YES')
print('OVH_REALTIME_CHANNEL_DELIVERY_VALIDATED=NO')
print('OVH_FUNCTIONAL_AUTH_RLS_PUSH_EMAIL_VALIDATED=NO')
print('OVH_ROUTE_SMOKE='+('PASS_ROUTES_ONLY' if all_ok else 'FAIL'))
sys.exit(0 if all_ok else 1)
PY
