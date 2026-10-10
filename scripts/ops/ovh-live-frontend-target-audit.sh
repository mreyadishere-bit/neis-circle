#!/usr/bin/env bash
set -Eeuo pipefail
release=/home/ubuntu/neis-frontend/releases/95ea3dc328fe9a156d0aae36347dcf4a084af1ad
test -f "$release/scripts/01-core.js"
python3 - "$release" <<'PY'
from pathlib import Path
import sys
r=Path(sys.argv[1])
core=(r/'scripts/01-core.js').read_text(errors='replace')
old='ydieijgynqlckaczalju.supabase.co'
new='supabase.neiscircle.site'
print('FRONTEND_CORE_CLOUD_URL='+('YES' if old in core else 'NO'))
print('FRONTEND_CORE_OVH_URL='+('YES' if new in core else 'NO'))
for p in ('neis-pwa-sw.js','pwa-sw.js'):
 f=r/p
 if f.is_file():
  s=f.read_text(errors='replace')
  print('FRONTEND_'+p.replace('.','_').replace('-','_')+'_CLOUD_URL='+('YES' if old in s else 'NO'))
print('FRONTEND_RELEASE_APP='+('YES' if 'scripts/01-core.js' in (r/'index.html').read_text(errors='replace') else 'NO'))
PY
echo FRONTEND_AUDIT=COMPLETE_READ_ONLY
