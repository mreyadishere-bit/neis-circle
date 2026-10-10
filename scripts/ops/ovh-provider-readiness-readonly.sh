#!/usr/bin/env bash
set -Eeuo pipefail
# No email/push/LiveKit token is sent or created. Prints only fixed status labels.
python3 - <<'PY'
import json,subprocess,sys,urllib.request,urllib.error,urllib.parse,socket,ssl,re
p=subprocess.run(['sudo','-n','/usr/bin/docker','inspect','--format','{{json .Config.Env}}','supabase-edge-functions'],capture_output=True,text=True,timeout=20)
if p.returncode:print('PROVIDER_AUDIT=BLOCKED_EDGE_INSPECT');sys.exit(1)
try:
 env=dict(x.split('=',1) for x in json.loads(p.stdout) if '=' in x)
 key=env['BREVO_API_KEY']
 address=env['NOTIFICATION_FROM_EMAIL'].strip().lower()
 worker=env['EMAIL_WORKER_SECRET']
 firebase=json.loads(env['FIREBASE_SERVICE_ACCOUNT_JSON'])
 livekit=urllib.parse.urlsplit(env['LIVEKIT_URL'])
 site=urllib.parse.urlsplit(env['SITE_URL'])
 assert key and len(worker)>=32
 assert re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',address)
 assert firebase.get('type')=='service_account' and firebase.get('project_id') and firebase.get('private_key','').startswith('-----BEGIN PRIVATE KEY-----')
 assert firebase.get('client_email') and firebase.get('private_key','').strip().endswith('-----END PRIVATE KEY-----')
 assert livekit.scheme in ('https','wss') and livekit.hostname
 assert site.scheme=='https' and site.hostname=='neiscircle.site'
except Exception:
 print('PROVIDER_AUDIT=BLOCKED_ENV_VALUES_OR_FORMAT');sys.exit(1)
print('FIREBASE_SERVICE_ACCOUNT=VALID_JSON_AND_KEY_SHAPE')
print('EMAIL_WORKER_SECRET=STRONG_LENGTH_PRESENT')
print('SITE_URL=EXPECTED_ORIGIN')
def get(url):
 request=urllib.request.Request(url,headers={'api-key':key,'accept':'application/json','user-agent':'NEIS-OVH-Readiness/1.0'},method='GET')
 try:
  with urllib.request.urlopen(request,timeout=17) as response:
   data=response.read(512*1024)
   return response.status,json.loads(data)
 except urllib.error.HTTPError as err:return err.code,None
 except Exception:return None,None
account_status,account=get('https://api.brevo.com/v3/account')
print('BREVO_ACCOUNT_HTTP='+str(account_status if account_status is not None else 'NETWORK_ERROR'))
if account_status!=200 or not isinstance(account,dict):
 print('PROVIDER_AUDIT=BLOCKED_BREVO_KEY');sys.exit(1)
sender_status,senders=get('https://api.brevo.com/v3/senders?limit=100&offset=0')
print('BREVO_SENDERS_HTTP='+str(sender_status if sender_status is not None else 'NETWORK_ERROR'))
if sender_status!=200 or not isinstance(senders,dict):
 print('PROVIDER_AUDIT=BLOCKED_SENDER_VERIFICATION');sys.exit(1)
items=senders.get('senders') or []
matched=[x for x in items if isinstance(x,dict) and str(x.get('email','')).lower()==address]
count=senders.get('count')
if not matched and isinstance(count,int) and count>len(items):
 print('BREVO_SENDER=UNVERIFIED_NOT_ALL_PAGES');sys.exit(1)
if not matched or not matched[0].get('active'):
 print('BREVO_SENDER=MISSING_OR_INACTIVE');sys.exit(1)
print('BREVO_SENDER=ACTIVE_MATCH')
try:
 with socket.create_connection((livekit.hostname,livekit.port or 443),timeout=12) as sock:
  with ssl.create_default_context().wrap_socket(sock,server_hostname=livekit.hostname) as tls:
   if not tls.version():raise ValueError('tls')
 print('LIVEKIT_HTTPS_TLS=VERIFIED_CONNECTIVITY')
except Exception:
 print('LIVEKIT_HTTPS_TLS=UNREACHABLE_OR_INVALID_CERT');sys.exit(1)
print('PROVIDER_AUDIT=PASS_READ_ONLY')
print('PROVIDER_MESSAGES_SENT=0')
print('PROVIDER_SECRET_VALUES_LOGGED=NO')
PY
