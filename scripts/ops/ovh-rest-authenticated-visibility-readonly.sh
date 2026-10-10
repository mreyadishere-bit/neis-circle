#!/usr/bin/env bash
# Read-only verification of RLS with a synthetic (non-user) authenticated JWT.
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
import base64,json,hmac,hashlib,time,urllib.request,urllib.error
from pathlib import Path
env={}
for line in Path('.env').read_text().splitlines():
 if line.startswith(('JWT_SECRET=','ANON_KEY=')):
  k,_,v=line.partition('=')
  env[k]=v.strip().strip('"').strip("'")
secret=env.get('JWT_SECRET','')
anon=env.get('ANON_KEY','')
if len(secret)<24 or not anon:
 raise SystemExit('AUTHENTICATED_VISIBILITY=BLOCKED_SECRET_UNAVAILABLE')
def enc(x):
 return base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).decode().rstrip('=')
now=int(time.time())
hdr=enc({'alg':'HS256','typ':'JWT'})
payload=enc({'aud':'authenticated','role':'authenticated','sub':'00000000-0000-4000-8000-000000000000','iat':now,'exp':now+180,'iss':'supabase','app_metadata':{},'user_metadata':{}})
content=hdr+'.'+payload
sig=base64.urlsafe_b64encode(hmac.new(secret.encode(),content.encode(),hashlib.sha256).digest()).decode().rstrip('=')
token=content+'.'+sig
base='https://supabase.neiscircle.site/rest/v1'
for table in ('profiles','posts','articles','circles'):
 url=base+'/'+table+'?select=id&limit=1'
 req=urllib.request.Request(url,headers={
  'apikey':anon,'Authorization':'Bearer '+token,'Prefer':'count=exact',
  'Range':'0-0','Origin':'https://neiscircle.site','User-Agent':'NEIS-Synthetic-RLS-ReadOnly'
 })
 try:r=urllib.request.urlopen(req,timeout=15)
 except urllib.error.HTTPError as e:r=e
 except Exception:
  print('AUTH_REST_'+table.upper()+'_NETWORK=FAILED')
  continue
 with r:
  count=(r.headers.get('Content-Range') or '').split('/')[-1]
  print('AUTH_REST_'+table.upper()+'_HTTP='+str(r.status))
  print('AUTH_REST_'+table.upper()+'_VISIBLE_COUNT='+(count if count.isdigit() else 'UNKNOWN'))
print('AUTHENTICATED_VISIBILITY=SYNTHETIC_NO_USER_ACCOUNT_NO_DATA_PRINTED')
PY
sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml exec -T db psql -X -U postgres -d postgres -Atqc "
SELECT 'AUTH_USERS_WITHOUT_PROFILE='||count(*) FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE p.id IS NULL
UNION ALL SELECT 'GOOGLE_IDENTITIES='||count(*) FROM auth.identities WHERE provider='google'
UNION ALL SELECT 'CURRENT_PROFILE_SELECT_POLICY='||string_agg(md5(coalesce(qual,'')||':'||roles::text),',' ORDER BY policyname)
  FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND cmd='SELECT'
UNION ALL SELECT 'CURRENT_POSTS_SELECT_POLICY='||string_agg(md5(coalesce(qual,'')||':'||roles::text),',' ORDER BY policyname)
  FROM pg_policies WHERE schemaname='public' AND tablename='posts' AND cmd IN ('SELECT','ALL');
" </dev/null
