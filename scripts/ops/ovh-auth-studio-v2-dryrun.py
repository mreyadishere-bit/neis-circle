#!/usr/bin/env python3
"""Compile auth console SQL against OVH in a rollback-only transaction. No PII logged."""
from pathlib import Path
import subprocess
import sys
file=Path("/home/ubuntu/neis-backups/auth-studio-v2-20261011/schema.sql")
if not file.is_file():raise SystemExit("AUTH_STUDIO_DRYRUN=NO_STAGE")
migration=file.read_text()
end="commit;\nnotify pgrst, 'reload schema';"
if not migration.strip().endswith(end):
    raise SystemExit("AUTH_STUDIO_DRYRUN=UNKNOWN_SCHEMA_END")
prefix=migration[:migration.rfind("commit;")]
sql=prefix+"""
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','25b556a3-ec6f-49e7-ac6c-1b09720e3bfd',true);
select case when (public.main_admin_auth_users('','all','created_desc',20,0,'all','all')->>'total')::int>0
 then 'AUTH_STUDIO_DRYRUN_ALL=PASS' else 'AUTH_STUDIO_DRYRUN_ALL=FAIL' end;
select case when jsonb_array_length(
 public.main_admin_auth_users('','all','email_asc',20,0,'email','google')->'users')>0
 then 'AUTH_STUDIO_DRYRUN_GOOGLE=PASS' else 'AUTH_STUDIO_DRYRUN_GOOGLE=FAIL' end;
select case when not has_function_privilege('anon',
 'public.main_admin_auth_users(text,text,text,integer,integer,text,text)','EXECUTE')
 then 'AUTH_STUDIO_DRYRUN_ANON_DENIED=PASS' else 'AUTH_STUDIO_DRYRUN_ANON_DENIED=FAIL' end;
rollback;
"""
args=["sudo","-n","/usr/bin/docker","compose"]
for f in ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml"):
    args+=["-f",f]
args+=["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres","-Atq"]
r=subprocess.run(args,cwd="/home/ubuntu/neis-supabase",input=sql,text=True,capture_output=True,timeout=85)
if r.returncode or any(x not in r.stdout for x in (
 "AUTH_STUDIO_DRYRUN_ALL=PASS","AUTH_STUDIO_DRYRUN_GOOGLE=PASS",
 "AUTH_STUDIO_DRYRUN_ANON_DENIED=PASS")):
    print("AUTH_STUDIO_DRYRUN=FAILED_ROLLED_BACK",file=sys.stderr)
    raise SystemExit(1)
print("AUTH_STUDIO_DRYRUN=PASS_ROLLED_BACK_NO_ACCOUNT_DATA_OUTPUT")
