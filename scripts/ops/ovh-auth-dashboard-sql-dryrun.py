#!/usr/bin/env python3
"""Test migration and sample owner RPC outputs inside a single ROLLED BACK transaction."""
from pathlib import Path
import subprocess
import sys
p=Path("/home/ubuntu/neis-backups/admin-auth-v1-20261011/schema.sql")
if not p.is_file():
    raise SystemExit("AUTH_RPC_DRY_RUN=STAGING_MISSING")
migration=p.read_text().strip()
if not migration.lower().endswith("commit;"):
    raise SystemExit("AUTH_RPC_DRY_RUN=UNEXPECTED_MIGRATION")
script=migration[:-len("commit;")]+"""
set local role authenticated;
select set_config('request.jwt.claim.sub','25b556a3-ec6f-49e7-ac6c-1b09720e3bfd',true);
select case when (public.main_admin_auth_overview()->>'total')::int>0 then 'OVERVIEW_PASS' else 'OVERVIEW_FAIL' end;
select case when (public.main_admin_auth_users('','all','newest',20,0)->>'total')::int>0 then 'LIST_PASS' else 'LIST_FAIL' end;
select case when public.main_admin_auth_user_detail('25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid) ? 'profile' then 'DETAIL_PASS' else 'DETAIL_FAIL' end;
rollback;
"""
cmd=["sudo","-n","/usr/bin/docker","compose"]
for name in ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml"):
    cmd+=["-f",name]
cmd+=["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres","-Atq"]
r=subprocess.run(cmd,input=script,text=True,capture_output=True,cwd="/home/ubuntu/neis-supabase",timeout=65)
if r.returncode or not all(token in r.stdout for token in ("OVERVIEW_PASS","LIST_PASS","DETAIL_PASS")):
    print("AUTH_RPC_DRY_RUN=FAILED_WITH_ROLLBACK",file=sys.stderr)
    raise SystemExit(1)
print("AUTH_RPC_DRY_RUN=PASS_TRANSACTION_ROLLED_BACK")
print("AUTH_RPC_DRY_RUN=NO_USER_RECORDS_LOGGED")
