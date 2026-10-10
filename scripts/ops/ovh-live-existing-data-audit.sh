#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only existing destination table counts against already restored isolated Cloud snapshot.
# Reports only table names and aggregate counts, never records.
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
import json,re,subprocess,sys
docker=['sudo','-n','/usr/bin/docker']
stage='neis-restore-test'
p=subprocess.run([*docker,'inspect','-f','{{.HostConfig.NetworkMode}}',stage],capture_output=True,text=True)
if p.returncode or p.stdout.strip()!='none':
 print('PREMERGE_AUDIT=BLOCKED_STAGE_ISOLATION');sys.exit(1)
live=[*docker,'compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','exec','-T','db','psql','-X','-U','postgres','-d','postgres','-AtF','|','-c']
source=[*docker,'exec',stage,'psql','-X','-U','supabase_admin','-d','neis_cli_stage_20261010_v2','-AtF','|','-c']
sql="""select table_schema||'.'||table_name from information_schema.tables
 where table_schema in ('auth','storage','public','realtime') and table_type='BASE TABLE'
 order by table_schema,table_name"""
def run(cmd,statement):
 p=subprocess.run([*cmd,statement],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=45)
 if p.returncode:raise RuntimeError('count query')
 return p.stdout.strip()
try:
 ls=set(run(live,sql).splitlines())
 src=set(run(source,sql).splitlines())
 names=sorted(ls|src)
 if not names:raise ValueError('empty catalog')
 nonempty=[]
 for name in names:
  if not re.fullmatch(r'[a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*',name):
   raise ValueError('unsafe identifier')
  live_count=run(live,'select count(*) from '+name) if name in ls else 'NOT_PRESENT'
  src_count=run(source,'select count(*) from '+name) if name in src else 'NOT_PRESENT'
  if live_count!='NOT_PRESENT' and not live_count.isdigit():raise ValueError('count')
  if src_count!='NOT_PRESENT' and not src_count.isdigit():raise ValueError('count')
  if live_count not in ('NOT_PRESENT','0'):
   nonempty.append((name,live_count,src_count))
 print('OVH_LIVE_APP_TABLES='+str(len(ls)))
 print('OVH_SOURCE_APP_TABLES='+str(len(src)))
 print('OVH_LIVE_NONEMPTY_TABLES='+str(len(nonempty)))
 for name,live_n,cloud_n in nonempty[:65]:
  print('OVH_EXISTING_NONEMPTY='+name+' LIVE='+live_n+' CLOUD_STAGE='+cloud_n)
 print('OVH_SOURCE_SNAPSHOT=DISCONNECTED')
 print('PRODUCTION_DB_AND_CLOUD=UNCHANGED')
 print('PREMERGE_AUDIT=PASS_READ_ONLY')
except Exception:
 print('PREMERGE_AUDIT=BLOCKED_QUERY_OR_CATALOG')
 sys.exit(1)
PY
