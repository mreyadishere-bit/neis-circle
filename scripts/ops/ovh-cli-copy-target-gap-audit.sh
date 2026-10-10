#!/usr/bin/env bash
set -Eeuo pipefail
# Only inspect COPY table targets and isolated PostgreSQL catalog.
# Never print SQL rows, user identifiers, secret values, or live DB contents.
source=/home/ubuntu/neis-backups/cloud-cli-import-38047355178
test -s "$source/data.sql"
(cd "$source" && sha256sum --status -c SHA256SUMS)
[[ "$(sudo -n /usr/bin/docker inspect -f '{{.HostConfig.NetworkMode}}' neis-restore-test)" == none ]] || { echo 'COPY_AUDIT=BLOCKED_TEST_NETWORK';exit 1; }
python3 - "$source/data.sql" <<'PY'
from pathlib import Path
import re,sys,subprocess
path=Path(sys.argv[1])
names=set()
for line in path.open(errors='replace'):
 if not line.startswith('COPY '):continue
 m=re.match(r'^COPY\s+(?:"?([A-Za-z_][A-Za-z_0-9]*)"?\.)?"?([A-Za-z_][A-Za-z_0-9]*)"?\s+\(',line)
 if not m:raise SystemExit('COPY_AUDIT=UNEXPECTED_SOURCE_SYNTAX')
 names.add((m.group(1) or 'public')+'.'+m.group(2))
if len(names)<80:raise SystemExit('COPY_AUDIT=INCOMPLETE_ARCHIVE')
db='neis_cli_stage_20261010_v2'
cmd=['sudo','-n','/usr/bin/docker','exec','neis-restore-test','psql','-X','-U','supabase_admin','-d',db,'-Atqc']
missing=[]
try:
 for name in sorted(names):
  q="select to_regclass('"+name+"') is not null"
  p=subprocess.run([*cmd,q],stdin=subprocess.DEVNULL,text=True,capture_output=True,timeout=12)
  if p.returncode or p.stdout.strip() not in ('t','f'):
   raise RuntimeError('catalog query failed')
  if p.stdout.strip()=='f':missing.append(name)
 auth=subprocess.run([*cmd,'select count(*) from auth.users'],stdin=subprocess.DEVNULL,text=True,capture_output=True,timeout=15)
 profile=subprocess.run([*cmd,'select count(*) from public.profiles'],stdin=subprocess.DEVNULL,text=True,capture_output=True,timeout=15)
 if auth.returncode or profile.returncode:raise RuntimeError('empty guard failed')
 print('COPY_AUDIT_ISOLATED_AUTH_ROWS='+auth.stdout.strip())
 print('COPY_AUDIT_ISOLATED_PROFILE_ROWS='+profile.stdout.strip())
except Exception:
 print('COPY_AUDIT=BLOCKED_CATALOG')
 sys.exit(1)
print('COPY_SOURCE_TABLES='+str(len(names)))
print('COPY_STAGE_MISSING_TABLES='+str(len(missing)))
for name in missing:
 print('COPY_MISSING_TABLE='+name)
# Report only catalog identifiers/types; never touch or print table row data.
src='neis_fresh_archive_20261010'
def columns(database):
 sql="""select n.nspname||'.'||c.relname,a.attname,
 pg_catalog.format_type(a.atttypid,a.atttypmod)
 from pg_attribute a join pg_class c on c.oid=a.attrelid
 join pg_namespace n on n.oid=c.relnamespace
 where a.attnum>0 and not a.attisdropped and c.relkind in ('r','p')
 order by n.nspname,c.relname,a.attnum"""
 call=['sudo','-n','/usr/bin/docker','exec','neis-restore-test','psql','-X','-U','supabase_admin','-d',database,'-AtF','|','-c',sql]
 out=subprocess.run(call,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=40)
 if out.returncode:raise RuntimeError('catalog unavailable')
 catalog={}
 for line in out.stdout.splitlines():
  parts=line.split('|',2)
  if len(parts)!=3:raise RuntimeError('invalid catalog metadata')
  table,col,typ=parts
  catalog[(table,col)]=typ
 return catalog
source_catalog=columns(src)
target_catalog=columns(db)
import re
copy_headers={}
for line in path.open(errors='replace'):
 if not line.startswith('COPY '):continue
 m=re.match(r'^COPY\s+(?:"?([A-Za-z_][A-Za-z_0-9]*)"?\.)?"?([A-Za-z_][A-Za-z_0-9]*)"?\s+\(([^)]*)\)\s+FROM stdin;',line)
 if not m:raise SystemExit('COPY_AUDIT=UNEXPECTED_COLUMN_LIST_SYNTAX')
 table=(m.group(1) or 'public')+'.'+m.group(2)
 names=[x.strip().strip('"') for x in m.group(3).split(',')]
 if not all(re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*',x) for x in names):
  raise SystemExit('COPY_AUDIT=UNEXPECTED_COLUMN_IDENTIFIER')
 copy_headers[table]=names
missing_columns=[]
type_mismatches=[]
for table,fields in copy_headers.items():
 if table in missing:continue
 for field in fields:
  key=(table,field)
  if key not in target_catalog:
   missing_columns.append(key)
  elif key in source_catalog and target_catalog[key]!=source_catalog[key]:
   type_mismatches.append(key)
print('COPY_STAGE_MISSING_COLUMNS='+str(len(missing_columns)))
print('COPY_STAGE_TYPE_DIFFERENCES='+str(len(type_mismatches)))
for table,col in missing_columns[:50]:
 typ=source_catalog.get((table,col),'UNKNOWN')
 typ=typ if re.fullmatch(r'[A-Za-z_0-9 .,()\[\]]{1,110}',typ) else 'COMPLEX_TYPE'
 print('COPY_MISSING_COLUMN='+table+'.'+col+' SOURCE_TYPE='+typ)
for table,col in type_mismatches[:50]:
 print('COPY_TYPE_DIFFERENCE='+table+'.'+col)
print('COPY_COLUMN_CATALOG_AUDIT=COMPLETE_READ_ONLY')
print('COPY_AUDIT=READ_ONLY_COMPLETE')
print('CLOUD_AND_LIVE_DB=UNCHANGED')
PY
