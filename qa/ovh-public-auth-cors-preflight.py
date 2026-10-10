#!/usr/bin/env python3
"""Status-only external CORS preflight probe for public Auth after direct proxy."""
import urllib.request,urllib.error
base='https://supabase.neiscircle.site'
for origin in ('https://neiscircle.site','https://www.neiscircle.site'):
 for label,path,method,req_headers in (
  ('TOKEN_POST','/auth/v1/token?grant_type=pkce','POST','apikey,authorization,content-type,x-client-info,x-supabase-api-version'),
  ('SETTINGS_GET','/auth/v1/settings','GET','apikey,authorization,x-client-info'),
  ('AUTHORIZE_GET','/auth/v1/authorize','GET','apikey,authorization'),
 ):
  hdr={
   'Origin':origin,
   'Access-Control-Request-Method':method,
   'Access-Control-Request-Headers':req_headers,
   'User-Agent':'NEIS-CORS-ReadOnlyProbe'
  }
  req=urllib.request.Request(base+path,headers=hdr,method='OPTIONS')
  try:res=urllib.request.urlopen(req,timeout=14)
  except urllib.error.HTTPError as e:res=e
  except Exception:
   print('PREFLIGHT_'+origin.split('//')[1].replace('.','_').upper()+'_'+label+'_NETWORK=FAILED')
   continue
  with res:
   prefix='PREFLIGHT_'+origin.split('//')[1].replace('.','_').upper()+'_'+label
   allow_origin=res.headers.get('Access-Control-Allow-Origin','')
   allow_methods=res.headers.get('Access-Control-Allow-Methods','').lower()
   allow_headers=res.headers.get('Access-Control-Allow-Headers','').lower()
   print(prefix+'_HTTP='+str(res.status))
   print(prefix+'_ORIGIN_ALLOWED='+str(allow_origin in ('*',origin)))
   print(prefix+'_METHOD_ALLOWED='+str(method.lower() in allow_methods or '*' in allow_methods))
   print(prefix+'_HEADERS_ALLOWED='+str(all(h.strip().lower() in allow_headers or '*' in allow_headers for h in req_headers.split(','))))
   print(prefix+'_ACAH_PRESENT='+str(bool(allow_headers)))
   print(prefix+'_ACAM_PRESENT='+str(bool(allow_methods)))
print('PREFLIGHT_PROBE=NO_USER_DATA')
