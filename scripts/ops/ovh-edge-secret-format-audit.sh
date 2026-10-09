#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only validation; prints names + outcomes only. No secret values.
python3 - <<'PY'
import json,re,subprocess,sys
from urllib.parse import urlsplit
names={
'BREVO_API_KEY','EMAIL_WORKER_SECRET','FIREBASE_SERVICE_ACCOUNT_JSON',
'LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEKIT_URL',
'NOTIFICATION_FROM_EMAIL','NOTIFICATION_FROM_NAME','SITE_URL',
'SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEYS','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_URL'
}
p=subprocess.run(['sudo','-n','/usr/bin/docker','inspect','supabase-edge-functions','--format','{{json .Config.Env}}'],capture_output=True,text=True)
if p.returncode:
 print('EDGE_SECRET_VALIDATION=BLOCKED_CONTAINER_UNAVAILABLE')
 sys.exit(1)
try:
 entries=json.loads(p.stdout)
 env=dict(s.split('=',1) for s in entries if '=' in s)
except Exception:
 print('EDGE_SECRET_VALIDATION=BLOCKED_ENV_PARSE')
 sys.exit(1)
def valid_url(v,schemes):
 try:
  u=urlsplit(v)
  return u.scheme in schemes and bool(u.hostname) and not u.username and not u.password
 except ValueError:return False
def check(name,v):
 if not v or v.strip()!=v or v.lower() in ('placeholder','changeme','undefined','null','todo'):
  return False
 if name=='FIREBASE_SERVICE_ACCOUNT_JSON':
  try:
   j=json.loads(v)
   return isinstance(j,dict) and j.get('type')=='service_account' and bool(j.get('client_email')) and bool(j.get('private_key')) and bool(j.get('project_id'))
  except (ValueError,TypeError):return False
 if name in ('SUPABASE_URL','SITE_URL'):return valid_url(v,{'https'})
 if name=='LIVEKIT_URL':return valid_url(v,{'https','wss'})
 if name=='NOTIFICATION_FROM_EMAIL':return bool(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',v))
 if name=='SUPABASE_PUBLISHABLE_KEYS':
  # Can be a list or map of keys; validate non-empty without displaying contents.
  try:return bool(json.loads(v))
  except (ValueError,TypeError):return len(v)>=12
 return len(v)>=8
status={}
for name in sorted(names):
 v=env.get(name)
 status[name]='MISSING' if v is None else ('VALID_FORMAT' if check(name,v) else 'INVALID_FORMAT')
 print('EDGE_ENV_'+name+'='+status[name])
print('EDGE_ENV_FORMAT_VALID='+str(sum(s=='VALID_FORMAT' for s in status.values())))
print('EDGE_ENV_MISSING='+str(sum(s=='MISSING' for s in status.values())))
print('EDGE_ENV_INVALID_FORMAT='+str(sum(s=='INVALID_FORMAT' for s in status.values())))
print('EDGE_ENV_SECRET_VALUES_LOGGED=NO')
# Diagnostic only. Missing integrations block deployment but do not make audit itself fail.
PY
