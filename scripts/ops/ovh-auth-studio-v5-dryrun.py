#!/usr/bin/env python3
"""Dry-run owner-only Auth block API on OVH; ALWAYS ROLLBACK. No accounts touched."""
from pathlib import Path
import subprocess,sys
p=Path("/home/ubuntu/neis-backups/auth-studio-v5-20261011/migration.sql")
if not p.is_file():raise SystemExit("AUTH_V5_DRYRUN=FILE_MISSING")
s=p.read_text()
if "commit;" not in s or "notify pgrst" not in s:
    raise SystemExit("AUTH_V5_DRYRUN=UNEXPECTED_SCHEMA")
body=s[:s.rfind("commit;")]
body+="""
-- Non-owner test: authentication required even with an authenticated role.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $test$
begin
  begin
    perform public.main_admin_auth_set_block('00000000-0000-0000-0000-000000000002'::uuid,true,'test');
    raise exception 'Non-owner incorrectly granted permission';
  exception when sqlstate '42501' then null;
  end;
end;$test$;
select 'NON_OWNER_DENIED';
-- Authorized owner can access API, but unknown ID cannot be changed.
select set_config('request.jwt.claim.sub','25b556a3-ec6f-49e7-ac6c-1b09720e3bfd',true);
do $test$
begin
  begin
    perform public.main_admin_auth_set_block('25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid,true,'test');
    raise exception 'Owner self-block incorrectly allowed';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.main_admin_auth_set_block('00000000-0000-0000-0000-000000000002'::uuid,true,'test');
    raise exception 'Unknown account incorrectly allowed';
  exception when sqlstate 'P0002' then null;
  end;
end;$test$;
select 'SELF_BLOCK_DENIED';
select 'UNKNOWN_ACCOUNT_DENIED';
rollback;
"""
args=["sudo","-n","/usr/bin/docker","compose"]
for f in ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml"):
    args+=["-f",f]
args+=["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres","-Atq"]
r=subprocess.run(args,cwd="/home/ubuntu/neis-supabase",input=body,
                 text=True,capture_output=True,timeout=85)
needed=("NON_OWNER_DENIED","SELF_BLOCK_DENIED","UNKNOWN_ACCOUNT_DENIED")
if r.returncode or not all(x in r.stdout for x in needed):
    print("AUTH_V5_DRYRUN=FAIL_NO_MUTATION",file=sys.stderr);raise SystemExit(1)
print("AUTH_V5_DRYRUN=PASS_ROLLBACK")
print("AUTH_V5_OWNER_ACCESS=VERIFIED")
print("AUTH_V5_NON_OWNER_DENIED=VERIFIED")
print("AUTH_V5_SELF_BLOCK_DENIED=VERIFIED")
print("AUTH_V5_DATA_MODIFICATIONS=ZERO")
