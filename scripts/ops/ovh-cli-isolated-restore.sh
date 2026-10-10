#!/usr/bin/env bash
set -Eeuo pipefail
# Restore SUPABASE CLI filtered schema/data on top of actual OVH bootstrap schema,
# only inside network-disconnected neis-restore-test container.
source=/home/ubuntu/neis-backups/cloud-cli-import-38047355178
backup=/home/ubuntu/neis-backups/ovh-destination-precrossover-20261010
container=neis-restore-test
database=neis_cli_stage_20261010_v1
dock() { sudo -n /usr/bin/docker "$@"; }
[[ "$(dock inspect -f '{{.HostConfig.NetworkMode}}' "$container")" == none ]] || { echo 'CLI_RESTORE=BLOCKED_NETWORK'; exit 1; }
[[ "$(dock inspect -f '{{.State.Running}}' "$container")" == true ]] || { echo 'CLI_RESTORE=BLOCKED_CONTAINER'; exit 1; }
[[ "$(dock inspect -f '{{.Config.Image}}' "$container")" == supabase/postgres:17.6.1.136 ]] || { echo 'CLI_RESTORE=BLOCKED_IMAGE'; exit 1; }
(cd "$source" && sha256sum --status -c SHA256SUMS) || { echo 'CLI_RESTORE=BLOCKED_SOURCE_HASH';exit 1; }
(cd "$backup" && sha256sum --status -c checksums.sha256) || { echo 'CLI_RESTORE=BLOCKED_TARGET_HASH';exit 1; }
space="$(df -B1 --output=avail /home/ubuntu/neis-backups | tail -1 | tr -d ' ')"
(( space > 2147483648 )) || { echo 'CLI_RESTORE=BLOCKED_SPACE';exit 1; }
temp="$(mktemp -d)"
chmod 700 "$temp"
cleanup() {
 dock exec "$container" rm -f /tmp/neis-cli-live-bootstrap.dump /tmp/neis-cli-bootstrap-filtered.list /tmp/neis-cli-cloud-schema.sql /tmp/neis-cli-cloud-data.sql >/dev/null 2>&1 || true
 rm -rf "$temp"
}
trap cleanup EXIT
exist="$(dock exec "$container" psql -X -U supabase_admin -d postgres -Atqc "select count(*) from pg_database where datname='$database'" </dev/null)"
[[ "$exist" == 0 ]] || { echo 'CLI_RESTORE=BLOCKED_DB_ALREADY_PRESENT';exit 1; }
dock cp "$backup/live.dump" "$container:/tmp/neis-cli-live-bootstrap.dump"
dock exec "$container" pg_restore --list /tmp/neis-cli-live-bootstrap.dump >"$temp/base.list" </dev/null
python3 - "$temp/base.list" "$temp/filtered.list" <<'PY'
from pathlib import Path
import re,sys
lines=Path(sys.argv[1]).read_text().splitlines(keepends=True)
out=[];skipped=0
for line in lines:
 if re.match(r'^\d+;',line) and ('EXTENSION - pg_cron' in line or 'COMMENT - EXTENSION pg_cron' in line):
  out.append(';'+line);skipped+=1
 else:out.append(line)
Path(sys.argv[2]).write_text(''.join(out))
print('CLI_BASE_EXTENSION_ENTRIES_SKIPPED='+str(skipped))
PY
dock cp "$temp/filtered.list" "$container:/tmp/neis-cli-bootstrap-filtered.list"
dock exec "$container" psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $database WITH TEMPLATE template0 OWNER supabase_admin" >/dev/null </dev/null
echo 'CLI_STAGE_DATABASE=CREATED_NETWORK_DISCONNECTED'
if ! dock exec "$container" pg_restore --schema-only --no-owner --no-acl --exit-on-error -U supabase_admin -d "$database" -L /tmp/neis-cli-bootstrap-filtered.list /tmp/neis-cli-live-bootstrap.dump >"$temp/bootstrap.log" 2>&1 </dev/null;then
 echo 'CLI_RESTORE=FAILED_BOOTSTRAP_SCHEMA'
 if grep -Eqi 'extension|pg_cron' "$temp/bootstrap.log";then echo 'CLI_RESTORE_FAILURE_CLASS=EXTENSION'
 elif grep -Eqi 'already exists' "$temp/bootstrap.log";then echo 'CLI_RESTORE_FAILURE_CLASS=ALREADY_EXISTS'
 elif grep -Eqi 'does not exist' "$temp/bootstrap.log";then echo 'CLI_RESTORE_FAILURE_CLASS=DEPENDENCY'
 else echo 'CLI_RESTORE_FAILURE_CLASS=OTHER';fi
 exit 1
fi
echo 'CLI_STAGE_BOOTSTRAP_SCHEMA=IMPORTED'
dock cp "$source/schema.sql" "$container:/tmp/neis-cli-cloud-schema.sql"
if ! dock exec "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 --single-transaction -f /tmp/neis-cli-cloud-schema.sql >"$temp/schema.log" 2>&1 </dev/null;then
 echo 'CLI_RESTORE=FAILED_CLOUD_SCHEMA'
 if grep -Eqi 'already exists' "$temp/schema.log";then echo 'CLI_RESTORE_FAILURE_CLASS=ALREADY_EXISTS'
 elif grep -Eqi 'does not exist' "$temp/schema.log";then echo 'CLI_RESTORE_FAILURE_CLASS=DEPENDENCY'
 elif grep -Eqi 'permission denied|must be owner' "$temp/schema.log";then echo 'CLI_RESTORE_FAILURE_CLASS=PERMISSION'
 elif grep -Eqi 'pg_cron|extension' "$temp/schema.log";then echo 'CLI_RESTORE_FAILURE_CLASS=EXTENSION'
 else echo 'CLI_RESTORE_FAILURE_CLASS=OTHER';fi
 exit 1
fi
echo 'CLI_STAGE_CLOUD_SCHEMA=IMPORTED_TRANSACTIONALLY'
dock cp "$source/data.sql" "$container:/tmp/neis-cli-cloud-data.sql"
if ! dock exec "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 --single-transaction -c "SET session_replication_role = replica" -f /tmp/neis-cli-cloud-data.sql >"$temp/data.log" 2>&1 </dev/null;then
 echo 'CLI_RESTORE=FAILED_CLOUD_DATA'
 if grep -Eqi 'does not exist' "$temp/data.log";then echo 'CLI_RESTORE_FAILURE_CLASS=MISSING_RELATION'
 elif grep -Eqi 'duplicate key|unique constraint' "$temp/data.log";then echo 'CLI_RESTORE_FAILURE_CLASS=DUPLICATES'
 elif grep -Eqi 'foreign key' "$temp/data.log";then echo 'CLI_RESTORE_FAILURE_CLASS=FOREIGN_KEY'
 elif grep -Eqi 'permission denied|must be owner' "$temp/data.log";then echo 'CLI_RESTORE_FAILURE_CLASS=PERMISSION'
 else echo 'CLI_RESTORE_FAILURE_CLASS=OTHER';fi
 exit 1
fi
python3 - "$source/data.sql" "$container" "$database" <<'PY'
import re,subprocess,sys
path,container,db=sys.argv[1:]
counts={}
current=None
with open(path,errors='replace') as file:
 for line in file:
  if line.startswith('COPY '):
   match=re.match(r'^COPY\s+(?:"?([A-Za-z_][A-Za-z_0-9]*)"?\.)?"?([A-Za-z_][A-Za-z_0-9]*)"?\s+\(',line)
   if not match:raise SystemExit('CLI_RESTORE=BLOCKED_COPY_FORMAT')
   current=(match.group(1) or 'public')+'.'+match.group(2)
   if current in counts:raise SystemExit('CLI_RESTORE=BLOCKED_DUPLICATE_COPY')
   counts[current]=0
  elif current is not None:
   if line.rstrip('\r\n')==r'\.':current=None
   else:counts[current]+=1
if current is not None or len(counts)<80:raise SystemExit('CLI_RESTORE=BLOCKED_INCOMPLETE_SOURCE_DATA')
query=' UNION ALL '.join("SELECT '"+table+"' k,count(*) n FROM "+table for table in sorted(counts))
p=subprocess.run(['sudo','-n','/usr/bin/docker','exec',container,'psql','-X','-U','supabase_admin','-d',db,'-AtF','|','-c',query],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=50)
if p.returncode:raise SystemExit('CLI_RESTORE=BLOCKED_COUNT_QUERY')
observed=dict((a,int(b)) for a,b in (line.split('|',1) for line in p.stdout.splitlines()))
mismatch={x for x in counts if counts[x]!=observed.get(x)}
print('CLI_RESTORE_TABLES_VERIFIED='+str(len(counts)-len(mismatch))+'/'+str(len(counts)))
print('CLI_RESTORE_COUNT_MISMATCHES='+str(len(mismatch)))
for k in ('auth.users','public.profiles','public.posts','public.messages','public.circle_messages','public.notifications','storage.objects'):
 print('CLI_STAGE_'+k.upper().replace('.','_')+'='+str(observed.get(k,'MISSING')))
if mismatch:raise SystemExit('CLI_RESTORE=FAILED_DATA_PARITY')
print('CLI_RESTORE=PASS_ISOLATED_ONLY')
print('OVH_PRODUCTION_DATABASE=UNCHANGED')
print('CLOUD_PRIMARY=UNCHANGED')
PY
