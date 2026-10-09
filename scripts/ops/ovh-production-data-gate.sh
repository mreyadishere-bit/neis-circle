#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only: compare disconnected historical stage with live OVH; no secret or row data.
python3 - <<'PY'
import subprocess,sys
def q(container,db,sql):
 p=subprocess.run(['sudo','-n','/usr/bin/docker','exec',container,'psql','-X','-U','supabase_admin' if container=='neis-restore-test' else 'postgres','-d',db,'-Atqc',sql],capture_output=True,text=True)
 if p.returncode or not p.stdout.strip().isdigit():raise RuntimeError('database inventory unavailable')
 return int(p.stdout.strip())
stage='neis-restore-test'
p=subprocess.run(['sudo','-n','/usr/bin/docker','inspect','-f','{{.HostConfig.NetworkMode}}',stage],capture_output=True,text=True)
if p.returncode or p.stdout.strip()!='none':
 print('DATA_GATE=BLOCKED_STAGE_NOT_ISOLATED');sys.exit(1)
tables={'USERS':'auth.users','STORAGE':'storage.objects','DM':'public.messages','CIRCLE_MESSAGES':'public.circle_messages','NOTIFICATIONS':'public.notifications','POSTS':'public.posts'}
try:
 for k,t in tables.items():
  print('STAGE_'+k+'='+str(q(stage,'neis_restore_full_stage','select count(*) from '+t)))
except Exception:
 print('DATA_GATE=BLOCKED_STAGE_QUERY')
 sys.exit(1)
print('STAGE_SOURCE=HISTORICAL_NOT_CUTOVER_READY')
print('LIVE_SUPABASE_CLOUD_SYNC=NOT_VERIFIED')
print('DATA_GATE=BLOCKED_PENDING_FRESH_VERIFIED_SNAPSHOT')
sys.exit(1)
PY
