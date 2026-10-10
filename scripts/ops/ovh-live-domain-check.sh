#!/usr/bin/env bash
set -Eeuo pipefail
python3 - <<'PY'
import subprocess,urllib.request,urllib.error,socket
for host in ('neiscircle.site','www.neiscircle.site','supabase.neiscircle.site'):
 try:
  ips=sorted({i[4][0] for i in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)})
  print('DNS_'+host+'='+','.join(ips))
 except Exception:print('DNS_'+host+'=FAILED')
 for scheme in ('https',):
  try:
   req=urllib.request.Request(f'{scheme}://{host}/',headers={'User-Agent':'NEIS-cutover-check'})
   with urllib.request.urlopen(req,timeout=12) as r:print('HTTP_'+host+'='+str(r.status));print('REDIRECT_'+host+'='+r.geturl().split('/')[2])
  except urllib.error.HTTPError as e:print('HTTP_'+host+'='+str(e.code))
  except Exception as e:print('HTTP_'+host+'=NETWORK_ERROR_'+type(e).__name__)
PY
