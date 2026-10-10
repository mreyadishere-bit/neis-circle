#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
from pathlib import Path
import subprocess,re
for p in [Path('/home/ubuntu/neis-supabase/volumes/api/kong.yml'),Path('/home/ubuntu/neis-supabase/docker-compose.caddy.yml'),Path('/home/ubuntu/neis-supabase/volumes/caddy/Caddyfile')]:
 print('FILE_'+p.name+'='+('PRESENT' if p.is_file() else 'MISSING'))
 if p.is_file() and p.name in ('docker-compose.caddy.yml','Caddyfile'):
  s=p.read_text()
  for name in ['neiscircle.site','www.neiscircle.site','supabase.neiscircle.site','18080','443','80','reverse_proxy','file_server']:
   print('HAS_'+p.name.replace('.','_')+'_'+name.replace('.','_')+'='+str(name in s))
p=subprocess.run(['sudo','-n','/usr/bin/docker','ps','--format','{{.Names}}'],capture_output=True,text=True)
if p.returncode:raise SystemExit('DOCKER_UNAVAILABLE')
print('CONTAINERS_CADDY='+str(sum('caddy' in n for n in p.stdout.splitlines())))
p=subprocess.run(['sudo','-n','/usr/bin/docker','compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','ps','-q','caddy'],capture_output=True,text=True)
print('COMPOSE_CADDY_ID='+('PRESENT' if p.stdout.strip() else 'MISSING'))
PY
