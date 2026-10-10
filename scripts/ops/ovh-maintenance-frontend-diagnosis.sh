#!/usr/bin/env bash
set -Eeuo pipefail
python3 - <<'PY'
from pathlib import Path
import subprocess
r=Path('/home/ubuntu/neis-frontend/releases/95ea3dc328fe9a156d0aae36347dcf4a084af1ad')
for name in ('index.html','scripts/01-core.js','manifest.webmanifest'):
 p=r/name
 print('RELEASE_'+name.replace('/','_').replace('.','_')+'='+('PRESENT' if p.exists() else 'MISSING'))
 if p.is_file():
  b=p.read_text(errors='replace')
  print('RELEASE_'+name.replace('/','_').replace('.','_')+'_MAINTENANCE='+str('We\'ll be back soon' in b or 'temporarily unavailable' in b))
print('RELEASE_TOTAL_FILES='+str(sum(1 for x in r.rglob('*') if x.is_file())))
p=Path('/home/ubuntu/neis-supabase/volumes/caddy')
print('CADDY_VOLUME_DIR='+str(p.exists()))
d=subprocess.run(['sudo','-n','/usr/bin/docker','exec','supabase-caddy','sh','-c','test -f /srv/neis-circle/index.html && grep -q "We.ll be back soon" /srv/neis-circle/index.html'],capture_output=True)
print('CADDY_MOUNT_IS_MAINTENANCE='+('YES' if d.returncode==0 else 'NO_OR_NOT_FOUND'))
PY
