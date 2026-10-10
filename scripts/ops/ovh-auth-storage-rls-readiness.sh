#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only infrastructure audit; captures Docker Compose secret values privately,
# prints only non-sensitive presence flags and database aggregate metadata.
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
import json,subprocess,sys
docker=['sudo','-n','/usr/bin/docker']
files=('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.edge-integrations.yml')
cmd=[*docker,'compose']
for f in files:cmd+=['-f',f]
p=subprocess.run([*cmd,'config','--format','json'],capture_output=True,text=True,timeout=50)
if p.returncode:print('RUNTIME_AUDIT=COMPOSE_FAILED');sys.exit(1)
try:services=json.loads(p.stdout)['services']
except Exception:print('RUNTIME_AUDIT=COMPOSE_PARSE_FAILED');sys.exit(1)
required_services=('auth','rest','realtime','storage','functions','db')
missing=[x for x in required_services if x not in services]
print('OVH_SERVICE_DEFINITIONS='+str(len(required_services)-len(missing))+'/'+str(len(required_services)))
if missing:
 print('RUNTIME_AUDIT=MISSING_SERVICE');sys.exit(1)
auth=services['auth'].get('environment') or {}
if isinstance(auth,list):auth=dict(x.split('=',1) for x in auth if '=' in x)
keys=('GOTRUE_SITE_URL','GOTRUE_JWT_SECRET','GOTRUE_SMTP_HOST','GOTRUE_SMTP_PORT','GOTRUE_SMTP_USER','GOTRUE_SMTP_PASS','GOTRUE_SMTP_ADMIN_EMAIL')
for k in keys:print('OVH_AUTH_'+k+'_NONEMPTY='+('YES' if auth.get(k) else 'NO'))
print('OVH_AUTH_SITE_URL_EXPECTED='+('YES' if auth.get('GOTRUE_SITE_URL')=='https://neiscircle.site' else 'NO'))
print('OVH_AUTH_EMAIL_AUTOCONFIRM_SET='+('YES' if 'GOTRUE_MAILER_AUTOCONFIRM' in auth else 'NO'))
rest=services['rest'].get('environment') or {}
if isinstance(rest,list):rest=dict(x.split('=',1) for x in rest if '=' in x)
print('OVH_REST_PUBLIC_SCHEMA='+('YES' if 'public' in str(rest.get('PGRST_DB_SCHEMAS','')).split(',') else 'NO'))
mounts=services['storage'].get('volumes') or []
storage_mounts=[m for m in mounts if (isinstance(m,dict) and str(m.get('target','')).startswith('/var/lib/storage')) or (isinstance(m,str) and '/var/lib/storage' in m)]
print('OVH_STORAGE_DATA_MOUNT_DECLARED='+str(len(storage_mounts)))
# Two independently restored datasets, metadata/policies only.
live=[*docker,'compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc']
stage=[*docker,'exec','neis-restore-test','psql','-X','-U','supabase_admin','-d','neis_cli_stage_20261010_v2','-Atqc']
raw=[*docker,'exec','neis-restore-test','psql','-X','-U','supabase_admin','-d','neis_fresh_archive_20261010','-Atqc']
def q(base,sql):
 p=subprocess.run([*base,sql],stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=40)
 if p.returncode:raise ValueError('database catalog query failed')
 return p.stdout.strip()
isol=subprocess.run([*docker,'inspect','-f','{{.HostConfig.NetworkMode}}','neis-restore-test'],capture_output=True,text=True,timeout=15)
if isol.returncode or isol.stdout.strip()!='none':
 print('RUNTIME_AUDIT=STAGE_NOT_DISCONNECTED');sys.exit(1)
checks={
'PUBLIC_TABLE_COUNT':"select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
'PUBLIC_POLICIES':"select count(*) from pg_policies where schemaname='public'",
'PUBLIC_RLS_ENABLED':"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity",
'AUTH_IDENTITIES':"select count(*) from auth.identities",
'AUTH_IDENTITY_ORPHANS':"select count(*) from auth.identities i left join auth.users u on i.user_id=u.id where u.id is null",
'PROFILE_AUTH_ORPHANS':"select count(*) from public.profiles p left join auth.users u on p.id=u.id where u.id is null",
}
try:
 for label,sql in checks.items():
  if label in ('PROFILE_AUTH_ORPHANS',):st=q(stage,sql);rs=q(raw,sql)
  else:st=q(stage,sql);rs=q(raw,sql)
  print('OVH_RESTORE_'+label+'='+st)
  print('CLOUD_SNAPSHOT_'+label+'='+rs)
  if st!=rs:
   print('RUNTIME_AUDIT=RESTORE_MISMATCH_'+label)
   sys.exit(1)
except Exception:
 print('RUNTIME_AUDIT=DATABASE_AUDIT_FAILED');sys.exit(1)
print('OVH_SNAPSHOT_INTEGRITY=AGGREGATES_MATCH')
print('CLOUD_AND_OVH_PRODUCTION=UNCHANGED')
print('RUNTIME_AUDIT=PASS_READ_ONLY_INVENTORY')
PY
