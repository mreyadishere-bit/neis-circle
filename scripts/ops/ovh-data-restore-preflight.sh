#!/usr/bin/env bash
# Read-only preflight. Never imports user data.
set -Eeuo pipefail
C=neis-restore-test
D=neis_restore_test
DATA=/home/ubuntu/neis-backups/cloud-20261009T130848Z/data.sql
docker() { sudo -n /usr/bin/docker "$@"; }
[[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$C")" == none ]] || exit 1
[[ "$(docker inspect -f '{{.Config.Image}}' "$C")" == supabase/postgres:17.6.1.136 ]] || exit 1
test -r "$DATA"
echo '=== Isolated Supabase destination prerequisite tables ==='
missing=0
for table in auth.users auth.identities storage.objects public.profiles; do
  exists="$(docker exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT to_regclass('$table') IS NOT NULL")"
  echo "$table=$exists"
  if [[ "$exists" != t ]]; then missing=1; fi
done
# Compare every source COPY target with actual disposable database schema.
DATA_SQL="$DATA" python3 - <<'PY'
import os,re,subprocess,sys
from pathlib import Path
names=[]
for line in Path(os.environ['DATA_SQL']).open():
    if not line.startswith('COPY '):
        continue
    m=re.match(r'^COPY ("[A-Za-z_][A-Za-z_0-9]*"\."[A-Za-z_][A-Za-z_0-9]*") ',line)
    if not m: raise SystemExit('BLOCKED: unexpected COPY target format')
    names.append(m.group(1).replace('"',''))
print('SOURCE_COPY_BLOCKS='+str(len(names)))
if len(names)<90: raise SystemExit('BLOCKED: incomplete snapshot')
query="SELECT to_regclass(x) IS NOT NULL FROM unnest(ARRAY[" + ",".join("'"+n+"'" for n in names)+"]) x"
p=subprocess.run(['sudo','-n','/usr/bin/docker','exec','neis-restore-test','psql','-X','-U','supabase_admin','-d','neis_restore_test','-Atqc',query],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if p.returncode: raise SystemExit('BLOCKED: table inventory query failed')
values=p.stdout.strip().splitlines()
if len(values)!=len(names): raise SystemExit('BLOCKED: inventory result length mismatch')
missing=[name for name,value in zip(names,values) if value!='t']
print('MATCHED_COPY_TARGETS='+str(len(names)-len(missing)))
print('MISSING_COPY_TARGETS='+str(len(missing)))
for name in missing: print('MISSING_TABLE='+name)
if missing: sys.exit(1)
PY
if [[ "$missing" != 0 ]]; then
  echo 'BLOCKED: missing auth/storage scaffolding; never import incomplete data'
  exit 1
fi
echo 'READY_FOR_STAGED_IMPORT_PLANNING (no import executed)'
