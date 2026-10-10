#!/usr/bin/env bash
set -Eeuo pipefail
python3 - <<'PY'
import urllib.request,urllib.error,sys
old='ydieijgynqlckaczalju.supabase.co'
new='supabase.neiscircle.site'
passed=True
for host in ['neiscircle.site','www.neiscircle.site']:
 def get(path):
  req=urllib.request.Request('https://'+host+path,headers={'Cache-Control':'no-cache','User-Agent':'NEIS-OVH-External-Cutover-Smoke'})
  with urllib.request.urlopen(req,timeout=25) as r:return r.status,r.read(1200000).decode('utf-8','replace')
 try:
  a_status,a=get('/?ovh_cutover=20261010v2')
  c_status,c=get('/scripts/01-core.js?ovh_cutover=20261010v2')
  ok=a_status==200 and c_status==200 and "We'll be back soon" not in a and 'scripts/01-core.js' in a and new in c and old not in c
  print('PUBLIC_'+host+'_HTML_HTTP='+str(a_status))
  print('PUBLIC_'+host+'_JS_HTTP='+str(c_status))
  print('PUBLIC_'+host+'_HTML_IS_MAINTENANCE='+str("We'll be back soon" in a))
  print('PUBLIC_'+host+'_JS_USES_OVH='+str(new in c))
  print('PUBLIC_'+host+'_JS_USES_OLD_CLOUD='+str(old in c))
  print('PUBLIC_'+host+'_RESULT='+('PASS' if ok else 'FAIL'))
  passed=passed and ok
 except Exception as e:
  print('PUBLIC_'+host+'_RESULT=NETWORK_'+type(e).__name__)
  passed=False
sys.exit(0 if passed else 1)
PY
