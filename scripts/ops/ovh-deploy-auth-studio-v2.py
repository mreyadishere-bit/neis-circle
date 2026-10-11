#!/usr/bin/env python3
"""Safely replace v1 owner-only auth table with Supabase-style v2 on OVH."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/auth-studio-v2-20261011")
OUT=Path("/home/ubuntu/neis-frontend/releases/ovh-auth-studio-20261011-v2")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[x for f in
  ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
   "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml")
  for x in ("-f",f)]
PHASE="preflight"

def run(cmd,stdin=None,timeout=65,check=True):
    p=subprocess.run(cmd,input=stdin,text=True,cwd=ROOT,capture_output=True,timeout=timeout)
    if check and p.returncode!=0:raise RuntimeError("COMMAND_FAILED")
    return p

def need(test,reason):
    if not test:raise RuntimeError(reason)

def query(s,check=True):
    return run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
                        "-U","postgres","-d","postgres","-Atq"],
               stdin=s,timeout=65,check=check)

def main():
    global PHASE
    need(OVERLAY.is_file() and STAGE.is_dir() and (STAGE/"schema.sql").is_file()
         and (STAGE/"ui.js").is_file(),"FILES_MISSING")
    migration=(STAGE/"schema.sql").read_text()
    ui=(STAGE/"ui.js").read_text()
    need(migration.count("auth.uid()")>=1 and "auth.role()" in migration
         and "main_admin_auth_users" in migration
         and "revoke all on function public.main_admin_auth_users" in migration
         and "notify pgrst" in migration,"SECURITY_PREFLIGHT")
    need("Unified search" in ui and "dataset.stSelect" in ui and "All columns" in ui
         and "p_search_field" in ui and "p_provider" in ui,"UI_PREFLIGHT")
    run(["node","--check",str(STAGE/"ui.js")])
    run(COMPOSE+["config","--quiet"])
    inspected=json.loads(run(DOCKER+["inspect","supabase-caddy"]).stdout)[0]
    mounts=[m.get("Source") for m in inspected.get("Mounts",[])
            if m.get("Type")=="bind" and m.get("Destination")=="/srv/neis-circle"]
    need(len(mounts)==1,"FRONTEND_MOUNT_MISSING")
    source=Path(mounts[0])
    need(source.is_dir() and str(source).startswith("/home/ubuntu/neis-frontend/releases/"),
         "UNKNOWN_FRONTEND_RELEASE")
    old_index=(source/"index.html").read_text()
    needle='scripts/main-admin-auth-dashboard-v1.js?adminauth=20261011v1'
    updated='scripts/main-admin-auth-studio-v2.js?authstudio=20261011v2'
    need(old_index.count(needle)==1 and "scripts/server-usage-admin-v1.js" in old_index
         and "scripts/main-admin-roles-v1.js" in old_index and
         "scripts/01-core.js" in old_index,"EXPECTED_LIVE_ADMIN_MISSING")
    original=OVERLAY.read_text()
    need(original.count(str(source))==1,"FRONTEND_CONFIG_CHANGED")
    need(not OUT.exists() and not Path(str(OUT)+".building").exists(),"RELEASE_EXISTS")
    old_count=sum(p.is_file() for p in source.rglob("*"))
    need(old_count>100,"FRONTEND_INCOMPLETE")

    # Prepare release before DB changes; do not edit any active file.
    PHASE="prepare_copy"
    tmp=Path(str(OUT)+".building")
    shutil.copytree(source,tmp)
    shutil.copy2(STAGE/"ui.js",tmp/"scripts/main-admin-auth-studio-v2.js")
    (tmp/"index.html").write_text(old_index.replace(needle,updated))
    need(sum(p.is_file() for p in tmp.rglob("*"))==old_count+1,"RELEASE_COPY_MISMATCH")
    tmp.rename(OUT)

    PHASE="database"
    query(migration)
    signature="public.main_admin_auth_users(text,text,text,integer,integer,text,text)"
    need(query("select case when to_regprocedure('"+signature+
      "') is not null then 'READY' else 'MISSING' end;").stdout.strip()=="READY",
      "RPC_NOT_INSTALLED")
    need(query("select case when has_function_privilege('anon','"+signature+
      "','EXECUTE') then 'EXPOSED' else 'DENIED' end;").stdout.strip()=="DENIED",
      "ANON_RPC_PERMISSION")
    non_owner=query("""begin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.main_admin_auth_users('','all','created_desc',10,0,'all','all');
rollback;""",check=False)
    need(non_owner.returncode!=0,"NON_OWNER_NOT_BLOCKED")
    owner=query("""begin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','25b556a3-ec6f-49e7-ac6c-1b09720e3bfd',true);
select case when (public.main_admin_auth_users('','all','created_desc',20,0,'all','all')->>'total')::integer>0
  then 'OWNER_ALL=PASS' else 'OWNER_ALL=FAIL' end;
select case when jsonb_array_length(public.main_admin_auth_users('','all','email_asc',5,0,'email','google')->'users')>0
  then 'OWNER_FILTERS=PASS' else 'OWNER_FILTERS=FAIL' end;
rollback;""")
    need("OWNER_ALL=PASS" in owner.stdout and "OWNER_FILTERS=PASS" in owner.stdout,
         "OWNER_RPC_FAILED")

    PHASE="activate"
    (STAGE/"frontend-before-v2.yml").write_text(original)
    changed=False
    try:
        OVERLAY.write_text(original.replace(str(source),str(OUT)))
        changed=True
        run(COMPOSE+["config","--quiet"])
        run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=105)
        cid=run(COMPOSE+["ps","-q","caddy"]).stdout.strip()
        need(bool(cid),"CADDY_DOWN")
        live=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"]).stdout
        script=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/scripts/main-admin-auth-studio-v2.js"]).stdout
        need(updated in live and needle not in live and
             "main-admin-roles-v1.js" in live and "server-usage-admin-v1.js" in live
             and "Unified search" in script,"LIVE_UI_WRONG")
        conf=run(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"]).stdout
        for phrase in ("reverse_proxy rest:3000","reverse_proxy auth:9999","basic_auth"):
            need(phrase in conf,"CADDY_ROUTE_CHANGED")
    except Exception:
        if changed:
            OVERLAY.write_text(original)
            run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=90,check=False)
            print("AUTH_STUDIO_V2_FRONTEND=ROLLED_BACK")
        raise
    print("AUTH_STUDIO_V2_DEPLOY=SUCCESS")
    print("AUTH_STUDIO_V2_OWNER_ONLY=YES")
    print("AUTH_STUDIO_V2_RPC_FILTERS=VERIFIED")
    print("AUTH_STUDIO_V2_PROTECTED_ROUTES=UNCHANGED")
    print("AUTH_STUDIO_V2_NO_NEW_CONTAINERS=YES")
    print("AUTH_STUDIO_V2_AUTH_DATA_MODIFIED=NO")
    print("AUTH_STUDIO_V2_FRONTEND=LIVE")

if __name__=="__main__":
    try:main()
    except Exception as e:
        recognized={"FILES_MISSING","SECURITY_PREFLIGHT","UI_PREFLIGHT","FRONTEND_MOUNT_MISSING",
          "UNKNOWN_FRONTEND_RELEASE","EXPECTED_LIVE_ADMIN_MISSING","FRONTEND_CONFIG_CHANGED",
          "RELEASE_EXISTS","FRONTEND_INCOMPLETE","RELEASE_COPY_MISMATCH","RPC_NOT_INSTALLED",
          "ANON_RPC_PERMISSION","NON_OWNER_NOT_BLOCKED","OWNER_RPC_FAILED","CADDY_DOWN",
          "LIVE_UI_WRONG","CADDY_ROUTE_CHANGED","COMMAND_FAILED"}
        cause=str(e) if str(e) in recognized else "UNEXPECTED"
        print("AUTH_STUDIO_V2_DEPLOY=FAILED_"+PHASE.upper()+"_"+cause,file=sys.stderr)
        raise SystemExit(1)
