#!/usr/bin/env bash
set -Eeuo pipefail
python3 - <<'PY'
import urllib.request
u='https://neiscircle.site/?neis_diag=20261010'
try:
 with urllib.request.urlopen(urllib.request.Request(u,headers={'Cache-Control':'no-cache','User-Agent':'NEIS-OVH-Diagnosis'}),timeout=15) as r:
  s=r.read(750000).decode('utf-8','replace')
  print('MAIN_HTTP='+str(r.status))
  print('MAIN_MAINTENANCE='+str('We\'ll be back soon' in s))
  print('MAIN_APP_SCRIPT='+str('scripts/01-core.js' in s))
  print('MAIN_BYTES='+str(len(s)))
except Exception as e:print('MAIN_HTTP=ERROR_'+type(e).__name__)
PY
