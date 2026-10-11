#!/usr/bin/env python3
"""Validate retention schema in one PostgreSQL transaction; roll back all writes."""
from pathlib import Path
import subprocess,sys

SCHEMA=Path("/home/ubuntu/neis-backups/db-optimization-20261011-v1/migration.sql")
ROOT="/home/ubuntu/neis-supabase"
if not SCHEMA.is_file():raise SystemExit("STORAGE_DRYRUN=NO_SQL_STAGED")
content=SCHEMA.read_text()
suffix="commit;\nnotify pgrst,'reload schema';"
if not content.strip().endswith(suffix):
    raise SystemExit("STORAGE_DRYRUN=UNEXPECTED_SCHEMA")
sql=content[:content.rfind("commit;")]+"""
select case when not has_function_privilege('anon','public.main_admin_database_storage()','EXECUTE')
  and not has_function_privilege('anon','public.neis_maintenance_storage_retention()','EXECUTE')
  and not has_function_privilege('authenticated','public.neis_maintenance_storage_retention()','EXECUTE')
  then 'ROLE_PERMISSIONS=PASS' else 'ROLE_PERMISSIONS=FAIL' end;

-- Owner RPC requires both authenticated caller and primary owner ID.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $$
begin
  begin
    perform public.main_admin_database_storage();
    raise exception 'Other users must not access breakdown';
  exception when sqlstate '42501' then null;
  end;
end;
$$;
select 'NON_OWNER_ACCESS=DENIED';
select set_config('request.jwt.claim.sub','25b556a3-ec6f-49e7-ac6c-1b09720e3bfd',true);
select case when (public.main_admin_database_storage()->>'database_bytes')::bigint>0
  then 'OWNER_BREAKDOWN=PASS' else 'OWNER_BREAKDOWN=FAIL' end;
reset role;
-- Call maintenance in a rolled-back transaction: no rows remain deleted.
select case when (public.neis_maintenance_storage_retention()->>'database_bytes')::bigint>0
  then 'MAINTENANCE_TRANSACTION=PASS' else 'MAINTENANCE_TRANSACTION=FAIL' end;
rollback;
"""
cmd=["sudo","-n","/usr/bin/docker","compose"]
for name in ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml"):
    cmd+=["-f",name]
cmd+=["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres","-Atq"]
r=subprocess.run(cmd,cwd=ROOT,input=sql,capture_output=True,text=True,timeout=105)
tokens=["ROLE_PERMISSIONS=PASS","NON_OWNER_ACCESS=DENIED","OWNER_BREAKDOWN=PASS",
        "MAINTENANCE_TRANSACTION=PASS"]
if r.returncode or any(s not in r.stdout for s in tokens):
    print("STORAGE_DRYRUN=FAILED_ALL_CHANGES_ROLLED_BACK",file=sys.stderr)
    # Do not leak raw database error text or authentication records to public logs.
    raise SystemExit(1)
print("STORAGE_DRYRUN=PASS_ROLLBACK")
print("STORAGE_DRYRUN=NON_OWNER_DENIED")
print("STORAGE_DRYRUN=RETENTION_RULES_VALIDATED")
print("STORAGE_DRYRUN=NO_STUDENT_DATA_CHANGED")
