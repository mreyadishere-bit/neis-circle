#!/usr/bin/env python3
"""Probe GoTrue directly inside OVH Docker network using only synthetic invalid codes."""
import json,subprocess,urllib.request,urllib.error
def ip_for(container):
 try:
  p=subprocess.run(['sudo','-n','/usr/bin/docker','inspect',container],capture_output=True,text=True,timeout=12)
  if p.returncode:return ''
  networks=json.loads(p.stdout)[0].get('NetworkSettings',{}).get('Networks') or {}
  for item in networks.values():
   if item.get('IPAddress'):return item['IPAddress']
 except Exception:pass
 return ''
def probe(name,endpoint,method='GET',body=None):
 hdr={'Origin':'https://neiscircle.site','Content-Type':'application/json','User-Agent':'NEIS-GoTrue-Synthetic-Health'}
 req=urllib.request.Request(endpoint,method=method,data=body,headers=hdr)
 try:r=urllib.request.urlopen(req,timeout=8)
 except urllib.error.HTTPError as e:r=e
 except Exception as e:
  print(name+'_NETWORK='+type(e).__name__)
  return
 with r:
  raw=r.read(2000).decode('utf8','replace')
  print(name+'_HTTP='+str(r.status))
  print(name+'_CORS_OK='+str(r.headers.get('Access-Control-Allow-Origin') in ('*','https://neiscircle.site')))
  print(name+'_CONTENT_TYPE='+(r.headers.get('Content-Type','').split(';')[0] or 'OTHER'))
  if r.status>=400:
   try:
    d=json.loads(raw)
    if isinstance(d,dict):
     code=str(d.get('error_code') or d.get('code') or d.get('error') or '')
     print(name+'_ERROR_CODE_CLASS='+('AUTH_CODE_INVALID' if 'code' in code or 'grant' in code else 'OTHER_JSON'))
   except Exception:print(name+'_ERROR_CODE_CLASS=NON_JSON')
for name,container,port in [('GOTRUE','supabase-auth',9999),('GATEWAY','supabase-envoy',8000)]:
 ip=ip_for(container)
 print(name+'_IP_RESOLVED='+str(bool(ip)))
 if not ip:continue
 base='http://'+ip+':'+str(port)
 path='/settings' if name=='GOTRUE' else '/auth/v1/settings'
 probe(name+'_SETTINGS',base+path)
 body=json.dumps({'auth_code':'synthetic-not-valid','code_verifier':'A'*64}).encode()
 path='/token?grant_type=pkce' if name=='GOTRUE' else '/auth/v1/token?grant_type=pkce'
 probe(name+'_INVALID_PKCE',base+path,'POST',body)
print('DIRECT_AUTH_PROBE=NO_VALID_CODES_NO_IDENTIFIERS')
