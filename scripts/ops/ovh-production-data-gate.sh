#!/usr/bin/env bash
set -Eeuo pipefail
# Inventory two disconnected OVH databases (historical and newer fresh restore).
# This is NOT a production cutover approval. No credentials or user records printed.
python3 - <<'PY'
import subprocess,sys
cmd=['sudo','-n','/usr/bin/docker']
stage='neis-restore-test'
checks={
 'USERS':'auth.users',
 'PROFILES':'public.profiles',
 'POSTS':'public.posts',
 'CIRCLES':'public.circles',
 'DM':'public.messages',
 'CIRCLE_MESSAGES':'public.circle_messages',
 'NOTIFICATIONS':'public.notifications',
 'STORAGE':'storage.objects',
}
def docker(*args):
 p=subprocess.run([*cmd,*args],capture_output=True,text=True,timeout=25)
 if p.returncode:raise RuntimeError('isolated inventory query unavailable')
 return p.stdout.strip()
try:
 if docker('inspect','-f','{{.HostConfig.NetworkMode}}',stage)!='none':
  print('DATA_GATE=BLOCKED_STAGE_NOT_ISOLATED');sys.exit(1)
 if docker('inspect','-f','{{.State.Running}}',stage)!='true':
  print('DATA_GATE=BLOCKED_STAGE_NOT_RUNNING');sys.exit(1)
 for prefix,db in [
   ('HISTORICAL','neis_restore_full_stage'),
   ('FRESH','neis_fresh_pgcron_retry_37988124956'),
 ]:
  for label,table in checks.items():
   count=docker('exec',stage,'psql','-X','-U','supabase_admin','-d',db,'-Atqc','select count(*) from '+table)
   if not count.isdigit():raise RuntimeError('invalid count')
   print(prefix+'_'+label+'='+count)
except Exception:
 print('DATA_GATE=BLOCKED_STAGE_QUERY')
 sys.exit(1)
print('FRESH_RESTORE=DISCONNECTED_ARCHIVE_ONLY')
print('LIVE_SUPABASE_CLOUD_SYNC=NOT_VERIFIED')
print('PRODUCTION_TARGET_DB_RESTORE=NOT_VERIFIED')
print('DATA_GATE=BLOCKED_PENDING_FINAL_SYNCHRONIZATION_AND_TESTS')
sys.exit(1)
PY
