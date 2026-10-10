#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
import base64,json,hmac,hashlib,time,uuid,urllib.request,urllib.error
from pathlib import Path
env={}
for l in Path('.env').read_text().splitlines():
 if l.startswith('JWT_SECRET=') or l.startswith('ANON_KEY='):
  k,v=l.split('=',1);env[k]=v.strip().strip('"').strip("'")
secret=env['JWT_SECRET'];anon=env['ANON_KEY']
def b64(data):return base64.urlsafe_b64encode(json.dumps(data,separators=(',',':')).encode()).decode().rstrip('=')
now=int(time.time());head=b64({'alg':'HS256','typ':'JWT'})
for with_session in (False,True):
 payload={'aud':'authenticated','role':'authenticated','sub':'00000000-0000-4000-8000-000000000001',
   'iss':'https://supabase.neiscircle.site/auth/v1','iat':now,'exp':now+300}
 if with_session:payload['session_id']=str(uuid.uuid4())
 encoded=head+'.'+b64(payload)
 sig=base64.urlsafe_b64encode(hmac.new(secret.encode(),encoded.encode(),hashlib.sha256).digest()).decode().rstrip('=')
 token=encoded+'.'+sig
 req=urllib.request.Request('https://supabase.neiscircle.site/auth/v1/user',headers={'apikey':anon,'authorization':'Bearer '+token,'User-Agent':'NEIS-JWT-Synthetic-Test'})
 try:response=urllib.request.urlopen(req,timeout=15)
 except urllib.error.HTTPError as e:response=e
 except Exception as e:
  print('JWT_'+('WITH_SESSION' if with_session else 'NO_SESSION')+'_NETWORK='+type(e).__name__);continue
 with response:
  data=response.read(1000)
  try:ob=json.loads(data)
  except Exception:ob={}
  code=ob.get('error_code','unknown') if isinstance(ob,dict) else 'unknown'
  if not isinstance(code,str) or not code.replace('_','').isalnum():code='other'
  print('JWT_'+('WITH_SESSION' if with_session else 'NO_SESSION')+'_HTTP='+str(response.status))
  print('JWT_'+('WITH_SESSION' if with_session else 'NO_SESSION')+'_ERROR_CODE='+code[:45])
print('JWT_TEST=ISOLATED_NONUSER_NO_DATA_CHANGES')
PY
sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml exec -T db psql -X -U postgres -d postgres -Atqc "
SELECT 'GOOGLE_IDENTITIES='||count(*) FROM auth.identities WHERE provider='google'
UNION ALL SELECT 'GOOGLE_IDENTITY_MISSING_USER='||count(*) FROM auth.identities i LEFT JOIN auth.users u ON u.id=i.user_id WHERE i.provider='google' AND u.id IS NULL
UNION ALL SELECT 'RECENT_SESSIONS_WITH_USER='||count(*) FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id WHERE s.created_at>now()-interval '2 hours';" </dev/null
