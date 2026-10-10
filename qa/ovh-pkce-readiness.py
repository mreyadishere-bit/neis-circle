#!/usr/bin/env python3
import urllib.request,urllib.error,urllib.parse,json,os
base='https://supabase.neiscircle.site'
# No real Google account, no user creation, no valid tokens.
challenge='A'*43
params=urllib.parse.urlencode({'provider':'google','redirect_to':'https://neiscircle.site','code_challenge':challenge,'code_challenge_method':'s256'})
req=urllib.request.Request(base+'/auth/v1/authorize?'+params,headers={'Origin':'https://neiscircle.site','User-Agent':'NEIS-PKCE-Preflight'})
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):return None
opener=urllib.request.build_opener(NoRedirect())
try:r=opener.open(req,timeout=12)
except urllib.error.HTTPError as e:r=e
except Exception as e:
 print('PKCE_AUTHORIZE_NETWORK='+type(e).__name__);raise SystemExit(1)
with r:
 location=r.headers.get('Location','')
 host=urllib.parse.urlsplit(location).hostname
 print('PKCE_GOOGLE_AUTHORIZE_HTTP='+str(r.status))
 print('PKCE_GOOGLE_AUTHORIZE_REDIRECT='+('YES' if host=='accounts.google.com' else 'NO'))
 pass_authorize=r.status in (301,302,303,307,308) and host=='accounts.google.com'
body=json.dumps({'auth_code':'synthetic-invalid-auth-code','code_verifier':'B'*43}).encode()
req=urllib.request.Request(base+'/auth/v1/token?grant_type=pkce',method='POST',headers={'Content-Type':'application/json','Origin':'https://neiscircle.site','User-Agent':'NEIS-PKCE-Preflight'},data=body)
try:r=urllib.request.urlopen(req,timeout=12)
except urllib.error.HTTPError as e:r=e
except Exception as e:
 print('PKCE_EXCHANGE_NETWORK='+type(e).__name__);raise SystemExit(1)
with r:
 raw=r.read(1024)
 try:d=json.loads(raw)
 except: d={}
 code=d.get('error_code','unknown') if isinstance(d,dict) else 'unknown'
 if not isinstance(code,str) or not code.replace('_','').isalnum():code='OTHER'
 print('PKCE_EXCHANGE_INVALID_CODE_HTTP='+str(r.status))
 print('PKCE_EXCHANGE_INVALID_CODE_ERROR_CLASS='+code[:40])
 print('PKCE_EXCHANGE_CORS='+('YES' if r.headers.get('Access-Control-Allow-Origin') in ('*','https://neiscircle.site') else 'NO'))
 pass_exchange=r.status in (400,401,403,422) and r.status!=404
print('PKCE_READINESS='+('PASS' if pass_authorize and pass_exchange else 'FAIL'))
if not(pass_authorize and pass_exchange):raise SystemExit(1)
