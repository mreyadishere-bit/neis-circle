#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
import subprocess
docker=['sudo','-n','/usr/bin/docker','compose']
for f in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml'):docker+=['-f',f]
def q(user,sql):
 cmd=[*docker,'exec','-T','db','psql','-X','-U',user,'-d','postgres','-Atqc',sql]
 p=subprocess.run(cmd,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=25)
 if p.returncode:return 'UNAVAILABLE'
 return p.stdout.strip()
roles=('postgres','supabase_admin','supabase_auth_admin')
for r in roles:
 opts=q('postgres',"select rolsuper::int||','||rolcreaterole::int||','||rolcreatedb::int from pg_roles where rolname='"+r+"'")
 print('OVH_ROLE_'+r.upper()+'_SUPER_CREATE_ROLE_DB='+opts)
 print('OVH_ROLE_'+r.upper()+'_CAN_CREATE_AUTH='+q('postgres',"select has_schema_privilege('"+r+"','auth','CREATE')"))
 print('OVH_ROLE_'+r.upper()+'_CAN_CREATE_PUBLIC='+q('postgres',"select has_schema_privilege('"+r+"','public','CREATE')"))
for r in roles:
 print('OVH_SQL_'+r.upper()+'_LOGIN='+('YES' if q(r,'select 1')=='1' else 'NO'))
for relation in ('auth.users','auth.one_time_tokens','storage.objects','auth.schema_migrations'):
 print('OVH_OWNER_'+relation.upper().replace('.','_')+'='+q('postgres',"select pg_get_userbyid(relowner) from pg_class where oid='"+relation+"'::regclass"))
print('OVH_ROLE_AUDIT=READ_ONLY_COMPLETE')
PY
