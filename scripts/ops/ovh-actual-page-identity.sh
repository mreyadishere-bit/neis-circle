#!/usr/bin/env bash
set -Eeuo pipefail
python3 - <<'PY'
import urllib.request,sys
legacy='ydieijgynqlckaczalju.supabase.co'
new='supabase.neiscircle.site'
passed=True
for host in ('neiscircle.site','www.neiscircle.site'):
 def get(path):
  req=urllib.request.Request('https://'+host+path,headers={'Cache-Control':'no-cache','User-Agent':'NEIS-OVH-OAuth-Recovery-Smoke'})
  with urllib.request.urlopen(req,timeout=25) as r:return r.status,r.read(1500000).decode('utf-8','replace')
 try:
  html_status,html=get('/?oauthrecover=20261010v2')
  core_status,core=get('/scripts/01-core.js?oauthrecover=20261010v2')
  auth_status,auth=get('/scripts/03-auth-i18n.js?oauthrecover=20261010v2')
  ok=(html_status==200 and core_status==200 and auth_status==200
      and "We'll be back soon" not in html and 'oauthrecover=20261010v2' in html
      and new in core and legacy not in core
      and 'neisRecoverImplicitOAuth(sb)' in core
      and '__NEISOAuthRecoveryFailed' in auth)
  print('PUBLIC_'+host+'_HTML_HTTP='+str(html_status))
  print('PUBLIC_'+host+'_CORE_HTTP='+str(core_status))
  print('PUBLIC_'+host+'_AUTH_HTTP='+str(auth_status))
  print('PUBLIC_'+host+'_OAUTH_RECOVERY='+str('neisRecoverImplicitOAuth(sb)' in core))
  print('PUBLIC_'+host+'_RESULT='+('PASS' if ok else 'FAIL'))
  passed=passed and ok
 except Exception as error:
  print('PUBLIC_'+host+'_RESULT=NETWORK_'+type(error).__name__)
  passed=False
sys.exit(0 if passed else 1)
PY
