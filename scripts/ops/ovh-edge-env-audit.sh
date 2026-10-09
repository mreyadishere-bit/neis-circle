#!/usr/bin/env bash
# Read-only checks: detect required Edge env variable names, no values or secret outputs.
set -Eeuo pipefail
BASE=/home/ubuntu/neis-backups/edge-functions-ready-20261009/supabase/functions
test -d "$BASE"
cd /home/ubuntu/neis-supabase
test -r .env
export CODE_DIR="$BASE"
python3 - <<'PY'
from pathlib import Path
import os,re
base=Path(os.environ['CODE_DIR'])
files=sorted(base.glob('*/index.ts'))
assert len(files)==8, 'Expected eight Edge functions'
names=set()
usage={}
for f in files:
    code=f.read_text()
    vars_found=set(re.findall(r'Deno\.env\.get\(\s*["\x27]([A-Z][A-Z0-9_]*)["\x27]\s*\)',code))
    usage[f.parent.name]=sorted(vars_found)
    names.update(vars_found)
configured=set()
for line in Path('.env').read_text().splitlines():
    match=re.match(r'^([A-Z][A-Z0-9_]*)=',line)
    if match: configured.add(match.group(1))
print('EDGE_FUNCTION_COUNT='+str(len(files)))
print('EDGE_ENV_VARIABLE_NAMES='+str(len(names)))
for name in sorted(names):
    print('EDGE_ENV_'+name+'='+('PRESENT_IN_COMPOSE_ENV' if name in configured else 'MISSING_FROM_COMPOSE_ENV'))
print('EDGE_ENV_NAME_AUDIT=COMPLETE')
PY
echo 'NO_ENV_VALUES_EXPOSED=TRUE'
