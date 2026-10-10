#!/usr/bin/env bash
set -Eeuo pipefail
# Restore SUPABASE CLI filtered schema/data on top of actual OVH bootstrap schema,
# only inside network-disconnected neis-restore-test container.
source=/home/ubuntu/neis-backups/cloud-cli-import-38047355178
backup=/home/ubuntu/neis-backups/ovh-destination-precrossover-20261010
container=neis-restore-test
database=neis_cli_liveclone_20261010_v1
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
if [[ "$exist" == 1 ]]; then
  # Previous cloud schema import was transactional; reuse only if no data was loaded.
  empty_users="$(dock exec "$container" psql -X -U supabase_admin -d "$database" -Atqc 'select count(*) from auth.users' </dev/null)"
  empty_storage="$(dock exec "$container" psql -X -U supabase_admin -d "$database" -Atqc 'select count(*) from storage.objects' </dev/null)"
  profile_state="$(dock exec "$container" psql -X -U supabase_admin -d "$database" -Atqc "select to_regclass('public.profiles') is not null" </dev/null)"
  if [[ "$profile_state" == t ]]; then
    profile_rows="$(dock exec "$container" psql -X -U supabase_admin -d "$database" -Atqc "select count(*) from public.profiles" </dev/null)"
    [[ "$profile_rows" == 0 ]] || { echo 'CLI_RESTORE=BLOCKED_NONEMPTY_PROFILE';exit 1; }
  elif [[ "$profile_state" != f ]]; then
    echo 'CLI_RESTORE=BLOCKED_INVALID_SCHEMA_STATE';exit 1
  fi
  [[ "$empty_users" == 0 && "$empty_storage" == 0 ]] || { echo 'CLI_RESTORE=BLOCKED_NONEMPTY_STAGE';exit 1; }
  echo 'CLI_STAGE_DATABASE=REUSE_EMPTY_NETWORK_DISCONNECTED'
elif [[ "$exist" != 0 ]]; then
  echo 'CLI_RESTORE=BLOCKED_UNEXPECTED_EXISTENCE';exit 1
fi
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
if [[ "$exist" == 0 ]]; then
dock exec "$container" psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $database WITH TEMPLATE template0 OWNER supabase_admin" >/dev/null </dev/null
echo 'CLI_STAGE_DATABASE=CREATED_NETWORK_DISCONNECTED'
if ! dock exec "$container" pg_restore --no-owner --no-acl --exit-on-error -U supabase_admin -d "$database" -L /tmp/neis-cli-bootstrap-filtered.list /tmp/neis-cli-live-bootstrap.dump >"$temp/bootstrap.log" 2>&1 </dev/null;then
 echo 'CLI_RESTORE=FAILED_BOOTSTRAP_SCHEMA'
 if grep -Eqi 'extension|pg_cron' "$temp/bootstrap.log";then echo 'CLI_RESTORE_FAILURE_CLASS=EXTENSION'
 elif grep -Eqi 'already exists' "$temp/bootstrap.log";then echo 'CLI_RESTORE_FAILURE_CLASS=ALREADY_EXISTS'
 elif grep -Eqi 'does not exist' "$temp/bootstrap.log";then echo 'CLI_RESTORE_FAILURE_CLASS=DEPENDENCY'
 else echo 'CLI_RESTORE_FAILURE_CLASS=OTHER';fi
 exit 1
fi
echo 'CLI_STAGE_FULL_OVH_BOOTSTRAP=IMPORTED'
fi
# The pg_cron extension is bound to the server's designated postgres DB,
# and must not be installed again inside a disconnected test database.
# Only strip that exact CREATE EXTENSION statement; abort if the schema differs.
python3 - "$source/schema.sql" "$temp/schema-pgcron-filtered.sql" <<'PY'
from pathlib import Path
import re,sys
schema=Path(sys.argv[1]).read_text()
pattern=r'(?im)^[ \t]*CREATE EXTENSION IF NOT EXISTS "?pg_cron"? WITH SCHEMA "?[a-z_]+"?;[ \t]*$'
filtered,removed=re.subn(pattern,'-- pg_cron omitted in disconnected test',schema)
print('CLI_CLOUD_SCHEMA_PGCRON_STATEMENTS='+str(removed))
if removed!=1:raise SystemExit('CLI_RESTORE=BLOCKED_PGCRON_FILTER_MISMATCH')
Path(sys.argv[2]).write_text(filtered)
PY
dock cp "$temp/schema-pgcron-filtered.sql" "$container:/tmp/neis-cli-cloud-schema.sql"
if [[ "$exist" == 0 || "${profile_state:-f}" == f ]];then
if ! dock exec "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose --single-transaction -f /tmp/neis-cli-cloud-schema.sql >"$temp/schema.log" 2>&1 </dev/null;then
 echo 'CLI_RESTORE=FAILED_CLOUD_SCHEMA'
 python3 - "$temp/schema.log" "$source/schema.sql" <<'PY'
from pathlib import Path
import re,sys
log=Path(sys.argv[1]).read_text(errors='replace')
schema=Path(sys.argv[2]).read_text(errors='replace')
codes=re.findall(r'ERROR:\s*([0-9A-Z]{5}):',log)
print('CLI_SCHEMA_ERROR_SQLSTATE='+str(codes[0] if codes else 'UNAVAILABLE'))
last=next((x for x in log.splitlines() if 'ERROR:' in x), '')
k='UNKNOWN'
if 'pg_cron' in last:k='PG_CRON'
elif 'extension' in last.lower():k='EXTENSION'
elif 'already exists' in last:k='DUPLICATE'
elif 'does not exist' in last:k='DEPENDENCY'
elif 'permission denied' in last:k='PERMISSION'
print('CLI_SCHEMA_ERROR_KIND='+k)
print('CLI_SCHEMA_REFERENCES_PG_CRON='+str('pg_cron' in schema).upper())
print('CLI_SCHEMA_DIAGNOSTIC_PRIVATE=YES')
PY
 exit 1
fi
echo 'CLI_STAGE_CLOUD_SCHEMA=IMPORTED_TRANSACTIONALLY'
else
 echo 'CLI_STAGE_CLOUD_SCHEMA=REUSED_COMPLETE_EMPTY_STAGE'
fi
# The Cloud/Auth version mismatch was audited across all 95 COPY targets:
# exactly one missing column, auth.one_time_tokens.expires_at (timestamptz).
# Add it only to the disposable, disconnected test DB.
source_col="$(dock exec "$container" psql -X -U supabase_admin -d neis_fresh_archive_20261010 -AtF '|' -c \
"select pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,(d.oid is not null) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='auth' and c.relname='one_time_tokens' and a.attname='expires_at' and a.attnum>0 and not a.attisdropped" </dev/null)"
[[ "$source_col" == "timestamp with time zone|t|f" || "$source_col" == "timestamp with time zone|f|f" ]] || { echo 'CLI_RESTORE=BLOCKED_SOURCE_COLUMN_DEFINITION';exit 1; }
target_col="$(dock exec "$container" psql -X -U supabase_admin -d "$database" -Atqc \
"select count(*) from information_schema.columns where table_schema='auth' and table_name='one_time_tokens' and column_name='expires_at'" </dev/null)"
if [[ "$target_col" == 0 ]];then
  if ! dock exec "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -c \
    "ALTER TABLE auth.one_time_tokens ADD COLUMN expires_at timestamp with time zone" >/dev/null 2>&1 </dev/null;then
    echo 'CLI_RESTORE=FAILED_ISOLATED_AUTH_COLUMN_ADD';exit 1
  fi
  if [[ "$source_col" == "timestamp with time zone|t|f" ]];then
    if ! dock exec "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -c \
      "ALTER TABLE auth.one_time_tokens ALTER COLUMN expires_at SET NOT NULL" >/dev/null 2>&1 </dev/null;then
      echo 'CLI_RESTORE=FAILED_ISOLATED_AUTH_COLUMN_NULLABILITY';exit 1
    fi
  fi
elif [[ "$target_col" != 1 ]];then
  echo 'CLI_RESTORE=BLOCKED_INVALID_AUTH_COLUMN_STATE';exit 1
fi
echo 'CLI_STAGE_AUTH_ONE_TIME_TOKENS_EXPIRES_AT=COMPATIBLE'
# In this disposable clone ONLY, replace existing OVH test identity/session rows
# to simulate Cloud cutover. Keep Auth/Realtime/Storage migration metadata.
python3 - "$container" "$database" <<'PY'
import subprocess,sys
container,db=sys.argv[1:]
cmd=['sudo','-n','/usr/bin/docker','exec',container,'psql','-X','-U','supabase_admin','-d',db,'-Atqc']
baseline={
 'auth.audit_log_entries':3,
 'auth.flow_state':2,
 'auth.identities':1,
 'auth.mfa_amr_claims':3,
 'auth.refresh_tokens':3,
 'auth.sessions':3,
 'auth.users':1,
 'auth.schema_migrations':77,
 'realtime.schema_migrations':82,
 'storage.migrations':70,
}
def query(sql):
 p=subprocess.run([*cmd,sql],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=30)
 return p.stdout.strip() if p.returncode==0 else None
for table,count in baseline.items():
 actual=query('select count(*) from '+table)
 if actual!=str(count):
  print('CLONE_RESTORE=BLOCKED_BASELINE_COUNT_'+table.replace('.','_'))
  sys.exit(1)
print('CLONE_BASELINE=VERIFIED_PRECUTOVER_BACKUP_ONLY')
PY
if ! dock exec "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 --single-transaction -c \
  "TRUNCATE TABLE auth.audit_log_entries, auth.flow_state, auth.identities, auth.mfa_amr_claims, auth.refresh_tokens, auth.sessions, auth.users RESTART IDENTITY CASCADE" >"$temp/purge.log" 2>&1 </dev/null;then
  echo 'CLONE_RESTORE=FAILED_TEST_AUTH_RESET';exit 1
fi
python3 - "$container" "$database" <<'PY'
import subprocess,sys
container,db=sys.argv[1:]
base=['sudo','-n','/usr/bin/docker','exec',container,'psql','-X','-U','supabase_admin','-d',db,'-Atqc']
checks={
 'auth.users':0,'auth.identities':0,'auth.sessions':0,'auth.refresh_tokens':0,
 'auth.flow_state':0,'auth.mfa_amr_claims':0,'auth.audit_log_entries':0,
 'auth.schema_migrations':77,'realtime.schema_migrations':82,'storage.migrations':70,
}
for table,expected in checks.items():
 p=subprocess.run([*base,'select count(*) from '+table],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=30)
 if p.returncode or p.stdout.strip()!=str(expected):
  print('CLONE_RESTORE=FAILED_RESET_PARITY_'+table.replace('.','_'))
  sys.exit(1)
print('CLONE_TEST_IDENTITIES=RESET_WITH_MIGRATIONS_PRESERVED')
PY
# Cloud Auth has four newer platform-only tables that this OVH Auth
# bootstrap does not include. Skip their COPY blocks *only if empty*.
# SHA-verified source remains unchanged; produce a disposable test copy.
python3 - "$source/data.sql" "$temp/data-compatible.sql" <<'PY'
from pathlib import Path
import re,sys
src=Path(sys.argv[1]);dst=Path(sys.argv[2])
omit={'auth.mfa_recovery_code_sets','auth.mfa_recovery_codes','auth.scim_tokens','auth.scim_users'}
seen=set()
active=None;skipping=False;rows=0;total_removed=0
with src.open(encoding='utf-8') as source, dst.open('w',encoding='utf-8',newline='') as output:
 for line in source:
  if active is None and line.startswith('COPY '):
   match=re.match(r'^COPY\s+(?:"?([A-Za-z_][A-Za-z_0-9]*)"?\.)?"?([A-Za-z_][A-Za-z_0-9]*)"?\s+\(',line)
   if not match:raise SystemExit('CLI_RESTORE=BLOCKED_COPY_SYNTAX')
   active=(match.group(1) or 'public')+'.'+match.group(2)
   skipping=active in omit
   if skipping:
    if active in seen:raise SystemExit('CLI_RESTORE=BLOCKED_DUPLICATE_NEW_AUTH_COPY')
    seen.add(active);rows=0
   else:output.write(line)
   continue
  if active is not None:
   if line.rstrip('\r\n')==r'\.':
    if skipping:
     if rows:raise SystemExit('CLI_RESTORE=BLOCKED_NONEMPTY_NEW_AUTH_TABLE')
     total_removed+=1
    else:output.write(line)
    active=None;skipping=False
   elif skipping:rows+=1
   else:output.write(line)
  else:output.write(line)
if active is not None or seen!=omit or total_removed!=4:
 raise SystemExit('CLI_RESTORE=BLOCKED_INCOMPLETE_NEW_AUTH_FILTER')
print('CLI_NEW_AUTH_EMPTY_COPY_BLOCKS_SKIPPED=4')
print('CLI_SOURCE_SQL_UNMODIFIED=YES')
PY
dock cp "$temp/data-compatible.sql" "$container:/tmp/neis-cli-cloud-data.sql"
if ! dock exec "$container" psql -X -U supabase_admin -d "$database" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose --single-transaction -c "SET session_replication_role = replica" -f /tmp/neis-cli-cloud-data.sql >"$temp/data.log" 2>&1 </dev/null;then
 echo 'CLI_RESTORE=FAILED_CLOUD_DATA'
 python3 - "$temp/data.log" <<'PY'
from pathlib import Path
import re,sys
data=Path(sys.argv[1]).read_text(errors='replace')
codes=re.findall(r'ERROR:\s*([0-9A-Z]{5}):',data)
print('CLI_DATA_SQLSTATE='+str(codes[0] if codes else 'UNAVAILABLE'))
# PostgreSQL catalog identifier only, never log data or SQL statements.
m=re.search(r'(?i)(?:relation|sequence) "(?P<name>[a-z_][a-z_0-9]*(?:\.[a-z_][a-z_0-9]*)?)" does not exist',data)
print('CLI_DATA_MISSING_OBJECT='+(m.group('name') if m else 'UNAVAILABLE'))
print('CLI_PRIVATE_DATA_LOG_DISCLOSED=NO')
PY
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
omit={'auth.mfa_recovery_code_sets','auth.mfa_recovery_codes','auth.scim_tokens','auth.scim_users'}
if not omit.issubset(counts) or any(counts[t]!=0 for t in omit):
 raise SystemExit('CLI_RESTORE=BLOCKED_NEW_AUTH_COPY_NONEMPTY_OR_MISSING')
for t in omit:counts.pop(t)
print('CLI_RESTORE_EMPTY_AUTH_TABLES_OMITTED=4')
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
print('CLI_RESTORE=PASS_ISOLATED_LIVE_CLONE_ONLY')
print('OVH_PRODUCTION_DATABASE=UNCHANGED')
print('CLOUD_PRIMARY=UNCHANGED')
PY
