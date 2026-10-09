#!/usr/bin/env bash
# Read-only snapshot parity. No raw user data leaves disconnected DB.
set -Eeuo pipefail
C=neis-restore-test
D=neis_restore_full_stage
SNAP=/home/ubuntu/neis-backups/cloud-20261009T130848Z/data.sql
DIR=/home/ubuntu/neis-backups/storage-20261009T133940Z
test "$(sudo -n /usr/bin/docker inspect -f '{{.HostConfig.NetworkMode}}' "$C")" = none
test "$(sudo -n /usr/bin/docker inspect -f '{{.Config.Image}}' "$C")" = supabase/postgres:17.6.1.136
test -r "$SNAP"
SNAP="$SNAP" python3 - <<'PY'
from pathlib import Path
import os,re,subprocess,sys
counts={}
current=None
for line in Path(os.environ['SNAP']).open():
    if line.startswith('COPY '):
        m=re.match(r'^COPY "([A-Za-z_][A-Za-z_0-9]*)"\."([A-Za-z_][A-Za-z_0-9]*)" ',line)
        if not m: raise SystemExit('BLOCKED: invalid COPY target')
        current=m.group(1)+'.'+m.group(2)
        if current in counts: raise SystemExit('BLOCKED: duplicate COPY target')
        counts[current]=0
    elif current:
        if line.strip()==r'\.': current=None
        else: counts[current]+=1
if current is not None: raise SystemExit('BLOCKED: incomplete COPY')
omitted={'auth.mfa_recovery_code_sets','auth.mfa_recovery_codes','auth.scim_tokens','auth.scim_users'}
assert len(counts)==95
assert all(counts.get(t)==0 for t in omitted)
targets=sorted(set(counts)-omitted)
query=' UNION ALL '.join("SELECT '"+t+"' AS table_name, count(*)::bigint AS total FROM "+t for t in targets)
p=subprocess.run(['sudo','-n','/usr/bin/docker','exec','neis-restore-test','psql','-X','-U','supabase_admin','-d','neis_restore_full_stage','-AtF','|','-c',query],capture_output=True,text=True)
if p.returncode: raise SystemExit('BLOCKED: data parity query unavailable')
observed={}
for line in p.stdout.splitlines():
    name,n=line.split('|',1)
    observed[name]=int(n)
bad={t:(counts[t],observed.get(t)) for t in targets if observed.get(t)!=counts[t]}
print('SOURCE_COPY_TABLES='+str(len(counts)))
print('MATCHING_STAGE_TABLES='+str(len(targets)-len(bad)))
print('MISMATCH_TABLES='+str(len(bad)))
for t,(expected,actual) in list(bad.items())[:15]: print('MISMATCH='+t+' expected='+str(expected)+' actual='+str(actual))
if bad: sys.exit(1)
for name in ['auth.users','auth.identities','public.profiles','storage.objects']:
    print(name+'='+str(observed[name]))
print('ALL_SNAPSHOT_TABLE_COUNTS_MATCH=TRUE')
PY
echo '=== Referential sanity ==='
sudo -n docker exec "$C" psql -X -U supabase_admin -d "$D" -Atqc "SELECT 'ORPHAN_AUTH_IDENTITIES='||count(*) FROM auth.identities i LEFT JOIN auth.users u ON i.user_id=u.id WHERE u.id IS NULL UNION ALL SELECT 'ORPHAN_PROFILES='||count(*) FROM public.profiles p LEFT JOIN auth.users u ON p.id=u.id WHERE u.id IS NULL" </dev/null
echo '=== Storage object backup ==='
test -d "$DIR/files"
files="$(find "$DIR/files" -type f | wc -l)"
echo "BACKED_UP_STORAGE_FILE_COUNT=$files"
test "$files" -eq 103 || exit 1
echo 'STAGED_SNAPSHOT_PARITY=PASSED'
