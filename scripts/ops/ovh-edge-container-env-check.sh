#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
export SOURCE_DIR=/home/ubuntu/neis-backups/edge-functions-ready-20261009/supabase/functions
test -d "$SOURCE_DIR"
python3 - <<'PY'
from pathlib import Path
import os,re,subprocess
files=sorted(Path(os.environ['SOURCE_DIR']).glob('*/index.ts'))
if len(files)!=8: raise SystemExit('BLOCKED: expected 8 Edge Functions')
needed=set()
for f in files:
    needed.update(re.findall(r'Deno\.env\.get\(\s*["\x27]([A-Z][A-Z0-9_]*)["\x27]\s*\)',f.read_text()))
p=subprocess.run(['sudo','-n','/usr/bin/docker','inspect','supabase-edge-functions','--format','{{range .Config.Env}}{{println .}}{{end}}'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
if p.returncode: raise SystemExit('BLOCKED: Edge container inspection failed')
present=set()
for line in p.stdout.splitlines():
    m=re.match(r'^([A-Z][A-Z0-9_]*)=',line)
    if m: present.add(m.group(1))
for name in sorted(needed):
    print('RUNNING_EDGE_ENV_'+name+'='+('PRESENT' if name in present else 'MISSING'))
print('RUNNING_EDGE_ENV_REQUIRED_TOTAL='+str(len(needed)))
print('RUNNING_EDGE_ENV_PRESENT_TOTAL='+str(len(needed&present)))
print('READ_ONLY_CONTAINER_VARIABLE_NAMES=VERIFIED')
PY
