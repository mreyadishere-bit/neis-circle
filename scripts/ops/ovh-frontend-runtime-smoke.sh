#!/usr/bin/env bash
set -Eeuo pipefail
# Serve the staged static release locally just during this smoke test, never exposing a public port.
python3 - <<'PY'
from pathlib import Path
import http.server,threading,urllib.request,os,sys
release=Path('/home/ubuntu/neis-frontend/releases/95ea3dc328fe9a156d0aae36347dcf4a084af1ad')
if not release.is_dir():
 print('FRONTEND_SMOKE=BLOCKED_RELEASE_MISSING');sys.exit(1)
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(release),**kwargs)
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
thread=threading.Thread(target=server.serve_forever,daemon=True)
thread.start()
try:
 for path,mime in [('/', 'text/html'),('/scripts/01-core.js','javascript'),('/manifest.webmanifest',''),('/pwa-sw.js','javascript'),('/styles/app.css','text/css')]:
  with urllib.request.urlopen('http://127.0.0.1:'+str(server.server_port)+path,timeout=7) as r:
   payload=r.read()
   success=(r.status==200 and len(payload)>30 and (not mime or mime in r.headers.get('Content-Type','')))
   print('FRONTEND_ROUTE_'+path.replace('/','_').replace('.','_').upper()+'='+('PASS' if success else 'FAIL'))
   if not success:raise RuntimeError('static route failed')
 print('FRONTEND_RUNTIME_SMOKE=PASS')
 print('FRONTEND_PUBLIC_ROUTING=UNCHANGED')
except Exception:
 print('FRONTEND_RUNTIME_SMOKE=FAIL')
 sys.exit(1)
finally:
 server.shutdown()
 server.server_close()
PY
