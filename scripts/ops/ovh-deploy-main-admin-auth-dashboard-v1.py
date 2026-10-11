#!/usr/bin/env python3
"""Non-destructive NEIS Circle OVH Admin Auth dashboard deploy.

Adds owner-guarded read-only SQL RPCs and appends one JS file to a copy of
the currently mounted live frontend. No new daemon, public port, secret, or Cloud dependency.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/admin-auth-v1-20261011")
DEST=Path("/home/ubuntu/neis-frontend/releases/ovh-admin-auth-users-20261011-v1")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[y for n in
   ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
    "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml")
   for y in ("-f",n)]
phase="preflight"

def run(cmd,stdin=None,timeout=75,check=True):
    v=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,input=stdin,timeout=timeout)
    if check and v.returncode:
        raise RuntimeError("COMMAND_FAILED")
    return v

def require(condition,what):
    if not condition:
        raise RuntimeError(what)

def sql(command,check=True):
    return run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
                        "-U","postgres","-d","postgres","-Atq"],stdin=command,check=check,timeout=55)

def main():
    global phase
    require(STAGE.is_dir() and OVERLAY.is_file(),"MISSING_PRECONDITION")
    for f in ("schema.sql","ui.js"):
        require((STAGE/f).is_file(),"MISSING_PRECONDITION")
    source_sql=(STAGE/"schema.sql").read_text()
    ui=(STAGE/"ui.js").read_text()
    require("main_admin_auth_users" in source_sql and
            "main_admin_auth_user_detail" in source_sql and
            "auth.uid()" in source_sql and
            "25b556a3-ec6f-49e7-ac6c-1b09720e3bfd" in source_sql and
            "revoke all on function public.main_admin_auth_users" in source_sql,
            "UNEXPECTED_SCHEMA")
    require("Authentication &amp; Users" in ui and
            "main_admin_auth_users" in ui and
            "main_admin_auth_user_detail" in ui and
            "ADMIN_ID" in ui,"UNEXPECTED_UI")
    run(["node","--check",str(STAGE/"ui.js")])
    run(COMPOSE+["config","--quiet"])
    caddy=json.loads(run(DOCKER+["inspect","supabase-caddy"]).stdout)[0]
    matches=[m["Source"] for m in caddy.get("Mounts",[])
             if m.get("Type")=="bind" and m.get("Destination")=="/srv/neis-circle"]
    require(len(matches)==1,"NO_FRONTEND_BIND")
    source=Path(matches[0])
    require(source.is_dir() and str(source).startswith("/home/ubuntu/neis-frontend/releases/"),"SOURCE_INVALID")
    original=OVERLAY.read_text()
    require(original.count(str(source))==1,"ORIGINAL_MOUNT_MISMATCH")
    live_index=(source/"index.html").read_text()
    require(live_index.count("</body>")==1 and
            "scripts/main-admin-roles-v1.js" in live_index and
            "scripts/server-usage-admin-v1.js" in live_index and
            "scripts/01-core.js" in live_index,
            "EXPECTED_ADMIN_APP_MISSING")
    require("main-admin-auth-dashboard-v1.js" not in live_index,"DUPLICATE_SCRIPT")
    require(not DEST.exists() and not Path(str(DEST)+".building").exists(),"DEST_EXISTS")
    files_before=sum(p.is_file() for p in source.rglob("*"))
    require(files_before>100,"RELEASE_INCOMPLETE")
    # Stage an immutable copy BEFORE any changes to active runtime.
    phase="stage_release"
    temp=Path(str(DEST)+".building")
    shutil.copytree(source,temp)
    shutil.copy2(STAGE/"ui.js",temp/"scripts/main-admin-auth-dashboard-v1.js")
    updated_index=live_index.replace("</body>",
       '<script defer src="scripts/main-admin-auth-dashboard-v1.js?adminauth=20261011v1"></script>\n</body>')
    (temp/"index.html").write_text(updated_index)
    require(sum(p.is_file() for p in temp.rglob("*"))==files_before+1,"COPY_COUNT_INCORRECT")
    temp.rename(DEST)

    phase="database"
    sql(source_sql)
    for name in ("main_admin_auth_overview","main_admin_auth_users","main_admin_auth_user_detail"):
        ok=sql("select case when to_regprocedure('public."+name+
            ("()" if name=="main_admin_auth_overview" else
             "(text,text,text,integer,integer)" if name=="main_admin_auth_users" else "(uuid)")+
            "') is not null then 'READY' else 'MISSING' end;").stdout.strip()
        require(ok=="READY","MISSING_RPC")
    deny_anon=sql("set role anon; select public.main_admin_auth_overview();",check=False)
    require(deny_anon.returncode!=0,"ANONYMOUS_NOT_DENIED")
    deny_user=sql("set role authenticated; select public.main_admin_auth_overview();",check=False)
    require(deny_user.returncode!=0,"UNAUTHENTICATED_NOT_DENIED")
    # Simulate authenticated JWT claims *only in a private postgres transaction*.
    # Never return names/emails/IDs or full JSON to deployment logs.
    checks=sql("""begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','25b556a3-ec6f-49e7-ac6c-1b09720e3bfd',true);
select case when (public.main_admin_auth_overview()->>'total')::integer > 0
  then 'OWNER_OVERVIEW_PASS' else 'FAIL' end;
select case when jsonb_array_length(public.main_admin_auth_users('', 'all','newest',10,0)->'users')>0
  then 'OWNER_LIST_PASS' else 'FAIL' end;
select case when public.main_admin_auth_user_detail('25b556a3-ec6f-49e7-ac6c-1b09720e3bfd'::uuid) ? 'providers'
  then 'OWNER_DETAIL_PASS' else 'FAIL' end;
rollback;""").stdout
    require(all(x in checks for x in ("OWNER_OVERVIEW_PASS","OWNER_LIST_PASS","OWNER_DETAIL_PASS")),
            "OWNER_RPC_VALIDATION")
    phase="activate_frontend"
    overlay_backup=STAGE/"frontend-public.before-admin-auth.yml"
    overlay_backup.write_text(original)
    changed=False
    try:
        OVERLAY.write_text(original.replace(str(source),str(DEST)))
        changed=True
        run(COMPOSE+["config","--quiet"])
        run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=100)
        cid=run(COMPOSE+["ps","-q","caddy"]).stdout.strip()
        require(bool(cid),"CADDY_DOWN")
        displayed=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"]).stdout
        added=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/scripts/main-admin-auth-dashboard-v1.js"]).stdout
        require("scripts/main-admin-auth-dashboard-v1.js?adminauth=20261011v1" in displayed and
                "main-admin-roles-v1.js" in displayed and
                "server-usage-admin-v1.js" in displayed and
                "main_admin_auth_user_detail" in added,"UI_NOT_LIVE")
        caddy_config=run(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"]).stdout
        require(all(x in caddy_config for x in ("reverse_proxy rest:3000",
                                               "reverse_proxy auth:9999",
                                               "basic_auth")),"PROXY_ROUTES_CHANGED")
    except Exception:
        if changed:
            OVERLAY.write_text(original)
            run(COMPOSE+["up","-d","--no-deps","caddy"],check=False,timeout=90)
            print("ADMIN_AUTH_DEPLOY=ROLLED_BACK_FRONTEND")
        raise

    print("ADMIN_AUTH_DEPLOY=SUCCESS")
    print("ADMIN_AUTH_ACCESS=PRIMARY_OWNER_ONLY")
    print("ADMIN_AUTH_RPCS=OVERVIEW_LIST_DETAIL")
    print("ADMIN_AUTH_VIEW=PRODUCTION_LIVE")
    print("ADMIN_AUTH_SQL_TESTS=OWNER_PASS_NON_OWNER_DENIED")
    print("ADMIN_AUTH_REMOTE_SERVICE_DEPENDENCIES=NONE")
    print("ADMIN_AUTH_DATA_MUTATIONS=NONE")
    print("ADMIN_AUTH_GOOGLE_OAUTH=UNCHANGED")
    print("ADMIN_AUTH_EXITS=NO_NEW_DAEMON_NO_PUBLIC_PORT")

if __name__=="__main__":
    try:main()
    except Exception as e:
        permitted={"MISSING_PRECONDITION","UNEXPECTED_SCHEMA","UNEXPECTED_UI",
                   "NO_FRONTEND_BIND","SOURCE_INVALID","ORIGINAL_MOUNT_MISMATCH",
                   "EXPECTED_ADMIN_APP_MISSING","DUPLICATE_SCRIPT","DEST_EXISTS",
                   "RELEASE_INCOMPLETE","COPY_COUNT_INCORRECT","MISSING_RPC",
                   "ANONYMOUS_NOT_DENIED","UNAUTHENTICATED_NOT_DENIED","OWNER_RPC_VALIDATION",
                   "CADDY_DOWN","UI_NOT_LIVE","PROXY_ROUTES_CHANGED","COMMAND_FAILED"}
        reason=str(e) if str(e) in permitted else "UNEXPECTED"
        print("ADMIN_AUTH_DEPLOY=FAILED_"+phase.upper()+"_"+reason,file=sys.stderr)
        raise SystemExit(1)
