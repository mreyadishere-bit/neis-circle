#!/usr/bin/env bash
set -Eeuo pipefail
# Read only: inspect routing via safe structural facts. Never print the full Caddyfile or environment.
python3 - <<'PY'
from pathlib import Path
import subprocess,re
root=Path('/home/ubuntu/neis-supabase')
for name in ('docker-compose.caddy.yml','docker-compose.yml'):
 p=root/name
 if not p.is_file():
  print('ROUTING_'+name.replace('.','_').upper()+'=MISSING')
  continue
 s=p.read_text()
 print('ROUTING_'+name.replace('.','_').upper()+'=PRESENT')
 print('CADDY_COMPOSE_SERVICE='+('YES' if re.search(r'^\s{2}caddy:',s,re.M) else 'NO'))
for d in (Path('/home/ubuntu/neis-frontend/releases'),Path('/home/ubuntu/neis-supabase/volumes')):
 print('PATH_'+('FRONTEND_RELEASES' if 'frontend' in str(d) else 'SUPABASE_VOLUMES')+'='+('PRESENT' if d.is_dir() else 'MISSING'))
p=subprocess.run(['sudo','-n','/usr/bin/docker','ps','--format','{{.Names}}'],capture_output=True,text=True)
if p.returncode:
 print('ROUTING_DOCKER=UNAVAILABLE')
else:
 names=set(p.stdout.splitlines())
 print('CADDY_CONTAINER_RUNNING='+('YES' if any('caddy' in n for n in names) else 'NO'))
 print('OTHER_WEB_PROXY_RUNNING='+('YES' if any('nginx' in n or 'traefik' in n for n in names) else 'NO'))
print('ROUTING_AUDIT=READ_ONLY_COMPLETE')
PY
