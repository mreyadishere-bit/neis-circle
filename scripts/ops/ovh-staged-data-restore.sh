#!/usr/bin/env bash
# Import a local snapshot exclusively into disconnected test PostgreSQL.
set -Eeuo pipefail
C=neis-restore-test
D=neis_restore_full_stage
SNAP=/home/ubuntu/neis-backups/cloud-20261009T130848Z/data.sql
dock() { sudo -n /usr/bin/docker "$@"; }
test -r "$SNAP"
test "$(dock inspect -f '{{.HostConfig.NetworkMode}}' "$C")" = none
test "$(dock inspect -f '{{.Config.Image}}' "$C")" = supabase/postgres:17.6.1.136
test "$(dock exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('auth','storage','public','private') AND table_type='BASE TABLE'")" -ge 90
for table in auth.users auth.identities storage.objects public.profiles; do
  test "$(dock exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT count(*) FROM $table")" = 0
done
# Abort before importing if any COPY target from source backup is absent.
FILTERED="$(mktemp)"
chmod 600 "$FILTERED"
trap 'rm -f "$FILTERED"' EXIT
SNAPSHOT="$SNAP" FILTERED="$FILTERED" python3 - <<'PY'
import os,re,subprocess,sys
from pathlib import Path
targets=[]
for line in Path(os.environ['SNAPSHOT']).open():
    if line.startswith('COPY '):
        m=re.match(r'^COPY "([A-Za-z_][A-Za-z_0-9]*)"\."([A-Za-z_][A-Za-z_0-9]*)" ',line)
        if not m: raise SystemExit('BLOCKED: unexpected COPY target syntax')
        targets.append(m.group(1)+'.'+m.group(2))
print('SOURCE_COPY_TARGET_COUNT='+str(len(targets)))
if len(targets) < 90: raise SystemExit('BLOCKED: too few COPY targets')
query='SELECT to_regclass(x) IS NOT NULL FROM unnest(ARRAY['+','.join("'"+t+"'" for t in targets)+']) x'
p=subprocess.run(['sudo','-n','/usr/bin/docker','exec','neis-restore-test','psql','-X','-U','supabase_admin','-d','neis_restore_full_stage','-Atqc',query],capture_output=True,text=True)
if p.returncode: raise SystemExit('BLOCKED: inventory query failed')
flags=p.stdout.strip().splitlines()
if len(flags)!=len(targets): raise SystemExit('BLOCKED: invalid inventory response')
missing=[t for t,v in zip(targets,flags) if v!='t']
print('MISSING_COPY_TARGET_COUNT='+str(len(missing)))
for t in missing: print('MISSING_COPY_TABLE='+t)
allow={'auth.mfa_recovery_code_sets','auth.mfa_recovery_codes','auth.scim_tokens','auth.scim_users'}
if set(missing)!=allow:
    raise SystemExit('BLOCKED: missing tables differ from four expected empty Auth tables')
# Preserve every byte of supported COPY blocks; skip only independently-verified
# empty blocks from obsolete source Auth features unsupported in destination.
lines=Path(os.environ['SNAPSHOT']).read_text().splitlines(keepends=True)
output=[]
skip_count=0
i=0
while i<len(lines):
    line=lines[i]
    m=re.match(r'^COPY "([A-Za-z_][A-Za-z_0-9]*)"\."([A-Za-z_][A-Za-z_0-9]*)" ',line)
    name=(m.group(1)+'.'+m.group(2)) if m else None
    if name in allow:
        if i+1>=len(lines) or lines[i+1].strip()!=r'\.':
            raise SystemExit('BLOCKED: unsupported Auth COPY has rows or unexpected format: '+name)
        output.append('-- intentionally omitted empty Auth COPY block: '+name+'\n')
        skip_count+=1
        i+=2
        continue
    output.append(line)
    i+=1
if skip_count!=4: raise SystemExit('BLOCKED: expected four empty Auth COPY blocks')
Path(os.environ['FILTERED']).write_text(''.join(output))
print('EMPTY_AUTH_COPY_BLOCKS_SKIPPED='+str(skip_count))
PY
log="$(mktemp)"
chmod 600 "$log"
trap 'rm -f "$log" "$FILTERED"' EXIT
if dock exec -i "$C" psql -X -U supabase_admin -d "$D" -v ON_ERROR_STOP=1 --single-transaction -f - < "$FILTERED" > "$log" 2>&1; then
  echo 'STAGED_DATA_RESTORE=PASSED'
  for table in auth.users auth.identities storage.objects public.profiles; do
    dock exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT '$table='||count(*) FROM $table" </dev/null
  done
else
  echo 'STAGED_DATA_RESTORE=FAILED_ROLLED_BACK'
  python3 - "$log" <<'PY'
import re,sys
from pathlib import Path
s=Path(sys.argv[1]).read_text(errors="replace")
m=re.search(r'psql:<stdin>:(\d+):\s*ERROR:\s*([^\n]+)',s)
if m:
    print('ERROR_LINE='+m.group(1))
    print('ERROR_CLASS='+('foreign_key' if 'foreign key' in m.group(2) else 'permission' if 'permission' in m.group(2) else 'other'))
    x=re.sub(r"'(?:''|[^'])*'",'[value]',m.group(2))
    x=re.sub(r'"[^"]*"','[identifier]',x)
    print('ERROR_SUMMARY='+x[:170])
    found=re.search(r'column "([A-Za-z_][A-Za-z_0-9]*)" of relation "([A-Za-z_][A-Za-z_0-9]*)" does not exist',m.group(2))
    if found:
        print('MISSING_COLUMN='+found.group(1))
        print('MISSING_COLUMN_TABLE='+found.group(2))
PY
  exit 1
fi
