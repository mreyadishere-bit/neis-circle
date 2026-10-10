#!/usr/bin/env bash
set -Eeuo pipefail
python3 - <<'PY'
import json,subprocess,pathlib
d=['sudo','-n','/usr/bin/docker']
p=subprocess.run([*d,'inspect','supabase-caddy'],capture_output=True,text=True)
if p.returncode:
 p=subprocess.run([*d,'compose','-f','/home/ubuntu/neis-supabase/docker-compose.yml','-f','/home/ubuntu/neis-supabase/docker-compose.security.yml','-f','/home/ubuntu/neis-supabase/docker-compose.caddy.yml','ps','-q','caddy'],capture_output=True,text=True)
 if p.returncode or not p.stdout.strip():raise SystemExit('CADDY_INSPECT=NO_ID')
 p=subprocess.run([*d,'inspect',p.stdout.strip()],capture_output=True,text=True)
if p.returncode:raise SystemExit('CADDY_INSPECT=FAILED')
j=json.loads(p.stdout)[0]
for m in j['Mounts']:
 dst=m['Destination'];src=m['Source']
 if 'caddy' in dst.lower() or dst.lower().endswith('caddyfile') or 'config' in dst.lower():
  q=pathlib.Path(src)
  print('MOUNT_DEST='+dst)
  print('MOUNT_SOURCE_TYPE='+('BIND' if m.get('Type')=='bind' else 'VOLUME'))
  if m.get('Type')=='bind' and q.is_file():
   txt=q.read_text(errors='replace')
   for k in ('neiscircle.site','www.neiscircle.site','supabase.neiscircle.site','reverse_proxy','file_server'):
    print('MOUNT_HAS_'+k.replace('.','_')+'='+str(k in txt))
print('CADDY_NETWORKS='+','.join(sorted(j['NetworkSettings']['Networks'])))
f=pathlib.Path('/home/ubuntu/neis-frontend/releases')
print('FRONTEND_RELEASE_COUNT='+str(sum(p.is_dir() for p in f.iterdir())) if f.is_dir() else 'FRONTEND_RELEASE_COUNT=0')
PY
