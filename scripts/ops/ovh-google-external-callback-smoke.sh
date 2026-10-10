#!/usr/bin/env bash
set -Eeuo pipefail
python3 - <<'PY'
import urllib.request,urllib.error,urllib.parse,sys
origin='https://supabase.neiscircle.site'
expected=origin+'/auth/v1/callback'
class NoFollow(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):return None
opener=urllib.request.build_opener(NoFollow())
req=urllib.request.Request(origin+'/auth/v1/authorize?'+urllib.parse.urlencode({'provider':'google','redirect_to':'https://neiscircle.site/'}),headers={'User-Agent':'NEIS-GoogleOAuth-Callback-Audit/1.0'})
try:
 try:
  response=opener.open(req,timeout=18)
  http=response.status;location=response.headers.get('Location','')
 except urllib.error.HTTPError as e:
  http=e.code;location=e.headers.get('Location','')
 url=urllib.parse.urlsplit(location)
 query=urllib.parse.parse_qs(url.query)
 uri=query.get('redirect_uri',[''])[0]
 good=(http in (301,302,303,307,308) and url.hostname=='accounts.google.com' and uri==expected and bool(query.get('client_id')))
 print('GOOGLE_AUTHORIZE_GOOGLE_HOST='+('PASS' if good else 'FAIL'))
 print('GOOGLE_CALLBACK_URI_MATCH='+('YES' if uri==expected else 'NO'))
 if not good:sys.exit(1)
 # Google itself validates the registered OAuth callback URL prior to account login.
 request=urllib.request.Request(location,headers={'User-Agent':'Mozilla/5.0 (compatible; NEIS-OAuth-Probe/1.0)'})
 try:
  with urllib.request.urlopen(request,timeout=22) as g:
   code=g.status;body=g.read(300000).decode('utf-8','replace')
 except urllib.error.HTTPError as e:
  code=e.code;body=e.read(300000).decode('utf-8','replace')
 problem=any(x in body.lower() for x in ('redirect_uri_mismatch','error 400: redirect_uri_mismatch','invalid_client'))
 print('GOOGLE_LOGIN_ENTRY_HTTP='+str(code))
 print('GOOGLE_OAUTH_REGISTERED_CALLBACK='+('REJECTED' if problem else 'NO_MISMATCH_DETECTED'))
 print('GOOGLE_USER_LOGIN_COMPLETED=NO')
 print('GOOGLE_CREDENTIALS_LOGGED=NO')
 if problem:sys.exit(1)
 print('GOOGLE_CALLBACK_PROBE=PASS_PRELOGIN')
except Exception:
 print('GOOGLE_CALLBACK_PROBE=INCONCLUSIVE_NETWORK')
 sys.exit(1)
PY
