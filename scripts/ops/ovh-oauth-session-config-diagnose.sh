#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
import os,json,base64,hmac,hashlib,subprocess
from pathlib import Path
env={}
for line in Path('.env').read_text().splitlines():
 if '=' not in line or line.lstrip().startswith('#'):continue
 k,v=line.split('=',1)
 env[k]=v.strip().strip('"').strip("'")
def get_runtime(name):
 p=subprocess.run(['sudo','-n','/usr/bin/docker','inspect','--format','{{json .Config.Env}}',name],capture_output=True,text=True)
 if p.returncode: return {}
 try:return dict(v.split('=',1) for v in json.loads(p.stdout) if '=' in v)
 except Exception:return {}
a=get_runtime('supabase-auth')
rest=get_runtime('supabase-rest')
gateway=get_runtime('supabase-envoy')
print('AUTH_CONTAINER='+('RUNNING' if a else 'MISSING'))
for k in ('GOTRUE_JWT_SECRET','GOTRUE_JWT_AUD','GOTRUE_SITE_URL','GOTRUE_API_EXTERNAL_URL','GOTRUE_DB_DATABASE_URL','GOTRUE_EXTERNAL_GOOGLE_ENABLED'):
 print('AUTH_'+k+'_PRESENT='+str(bool(a.get(k))))
secret=env.get('JWT_SECRET','')
print('ENV_JWT_SECRET_PRESENT='+str(bool(secret)))
print('AUTH_JWT_SECRET_MATCH_ENV='+str(bool(secret) and secret==a.get('GOTRUE_JWT_SECRET')))
print('REST_JWT_SECRET_MATCH_ENV='+str(bool(secret) and secret==rest.get('PGRST_JWT_SECRET')))
print('JWT_SECRET_LENGTH_VALID='+str(len(secret)>=32))
anon=env.get('ANON_KEY','')
try:
 head,payload,signature=anon.split('.')
 expected=base64.urlsafe_b64encode(hmac.new(secret.encode(),(head+'.'+payload).encode(),hashlib.sha256).digest()).decode().rstrip('=')
 meta=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
 print('ANON_HMAC_VALID='+str(hmac.compare_digest(signature,expected)))
 print('ANON_CLAIM_ROLE='+('anon' if meta.get('role')=='anon' else 'OTHER'))
except Exception:print('ANON_HMAC_VALID=UNKNOWN')
print('AUTH_GOOGLE_ENABLED='+str(a.get('GOTRUE_EXTERNAL_GOOGLE_ENABLED','').lower()=='true'))
print('AUTH_SITE_URL_MATCH='+str(a.get('GOTRUE_SITE_URL','').rstrip('/')=='https://neiscircle.site'))
print('AUTH_EXTERNAL_URL_MATCH='+str(a.get('GOTRUE_API_EXTERNAL_URL','').rstrip('/')=='https://supabase.neiscircle.site'))
print('AUTH_GOOGLE_ONLY=CONFIG_AUDIT')
PY
sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml exec -T db psql -X -U postgres -d postgres -Atqc "SELECT 'AUTH_SESSION_COUNT='||count(*) FROM auth.sessions UNION ALL SELECT 'AUTH_REFRESH_TOKEN_COUNT='||count(*) FROM auth.refresh_tokens UNION ALL SELECT 'AUTH_SESSIONS_LAST_HOUR='||count(*) FROM auth.sessions WHERE created_at>now()-interval '1 hour';" </dev/null
echo 'AUTH_DIAGNOSTIC=READ_ONLY_NO_SECRETS'
