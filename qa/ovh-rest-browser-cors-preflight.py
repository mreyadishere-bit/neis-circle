#!/usr/bin/env python3
# Strictly read-only CORS preflight audit; no user data and no credentials.
import urllib.request,urllib.error
base='https://supabase.neiscircle.site'
for origin in ('https://neiscircle.site','https://www.neiscircle.site'):
 for table in ('profiles','posts'):
  path='/rest/v1/'+table+'?select=id&limit=1'
  desired=('apikey','authorization','content-type','x-client-info','x-supabase-api-version','prefer')
  h={'Origin':origin,'Access-Control-Request-Method':'GET',
     'Access-Control-Request-Headers':','.join(desired),
     'User-Agent':'NEIS-Data-Visibility-CORS-Audit'}
  req=urllib.request.Request(base+path,headers=h,method='OPTIONS')
  try:r=urllib.request.urlopen(req,timeout=13)
  except urllib.error.HTTPError as e:r=e
  except Exception:
   print('REST_PREFLIGHT_'+table.upper()+'_'+('WWW' if 'www.' in origin else 'APEX')+'_NETWORK=FAIL');continue
  with r:
   p='REST_PREFLIGHT_'+table.upper()+'_'+('WWW' if 'www.' in origin else 'APEX')
   allowed=r.headers.get('Access-Control-Allow-Headers','').lower()
   methods=r.headers.get('Access-Control-Allow-Methods','').lower()
   echo=r.headers.get('Access-Control-Allow-Origin','')
   print(p+'_HTTP='+str(r.status))
   print(p+'_ORIGIN_ALLOWED='+str(echo in (origin,'*')))
   print(p+'_GET_ALLOWED='+str('get' in methods or '*' in methods))
   for name in desired:print(p+'_HEADER_'+name.upper().replace('-','_')+'='+str(name in allowed or '*' in allowed))
print('REST_PREFLIGHT=NO_DATA_RETURNED')
