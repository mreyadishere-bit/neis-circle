#!/usr/bin/env python3
"""Safe public endpoint probe: no records, real users, write requests or key output."""
import re,urllib.request,urllib.error
base='https://supabase.neiscircle.site'
def call(path,key='',method='GET'):
 hdr={'Origin':'https://neiscircle.site','User-Agent':'NEIS-PublicServices-Probe/1'}
 if key:
  hdr['apikey']=key
  hdr['Authorization']='Bearer '+key
 req=urllib.request.Request(base+path,headers=hdr,method=method)
 try:r=urllib.request.urlopen(req,timeout=16)
 except urllib.error.HTTPError as e:r=e
 except Exception:return 0,'NETWORK_ERROR',False
 with r:
  content=(r.headers.get('Content-Type') or 'none').split(';')[0]
  return r.status,content,r.headers.get('Access-Control-Allow-Origin') in ('*','https://neiscircle.site')
try:
 req=urllib.request.Request('https://neiscircle.site/scripts/01-core.js?health-check=20261010',headers={'Cache-Control':'no-cache'})
 with urllib.request.urlopen(req,timeout=15) as x:src=x.read(150000).decode('utf8','replace')
 match=re.search(r'supabaseAnonKey\s*:\s*"([^"]+)"',src)
 key=match.group(1) if match else ''
except Exception:key=''
if not key:raise SystemExit('SERVICES=PUBLIC_KEY_MISSING')
for name,path in (
 ('AUTH_SETTINGS','/auth/v1/settings'),
 ('REST_PROFILES_ZERO_ROWS','/rest/v1/profiles?select=id&limit=0'),
 ('REST_ROOT','/rest/v1/'),
 ('STORAGE_BUCKET_LIST','/storage/v1/bucket'),
 ('FUNCTIONS_UNKNOWN','/functions/v1/neis-unknown-synthetic-function'),
):
 status,ctype,cors=call(path,key)
 print('SERVICE_'+name+'_HTTP='+str(status))
 print('SERVICE_'+name+'_RESPONSE='+ctype.replace('/','_').upper())
 print('SERVICE_'+name+'_CORS='+str(cors))
print('PUBLIC_SERVICES=STATUS_ONLY_NO_USER_CONTENT')
