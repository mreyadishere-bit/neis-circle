#!/usr/bin/env python3
"""OVH owner-only Auth Studio v4 frontend deployment, no database mutations."""
from pathlib import Path
import json,subprocess,shutil,sys

ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/auth-studio-v4-20261011")
DEST=Path("/home/ubuntu/neis-frontend/releases/ovh-auth-studio-20261011-v4")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[part for f in (
  "docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
  "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml"
) for part in ("-f",f)]
OLD="scripts/main-admin-auth-studio-v3.js?authstudio=20261011v3"
NEW="scripts/main-admin-auth-studio-v4.js?authstudio=20261011v4"
phase="preflight"

def call(args,stdin=None,timeout=95,check=True):
    r=subprocess.run(args,cwd=ROOT,text=True,input=stdin,capture_output=True,timeout=timeout)
    if check and r.returncode:raise RuntimeError("COMMAND_FAILED")
    return r

def ensure(ok,message):
    if not ok:raise RuntimeError(message)

def db(q,check=True):
    return call(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
                        "-U","postgres","-d","postgres","-Atq"],
                stdin=q,timeout=35,check=check)

def run():
    global phase
    ensure(OVERLAY.is_file() and (STAGE/"ui.js").is_file(),"STAGING_MISSING")
    ui=(STAGE/"ui.js").read_text()
    for word in (
        "['profile','Profile']","selectAllMatching","selectedRows",
        "getEveryMatching","getSelectedAccounts","naStudioPageSize",
        "data-st-action","main_admin_auth_user_detail","isOwner()"
    ):ensure(word in ui,"UI_FEATURE_MISSING")
    ensure("--st-bg:var(--card)" in ui,"SITE_THEME_MISSING")
    call(["node","--check",str(STAGE/"ui.js")],timeout=14)
    call(COMPOSE+["config","--quiet"],timeout=35)
    inspect=json.loads(call(DOCKER+["inspect","supabase-caddy"],timeout=22).stdout)[0]
    mounted=[m.get("Source") for m in inspect.get("Mounts",[])
        if m.get("Type")=="bind" and m.get("Destination")=="/srv/neis-circle"]
    ensure(len(mounted)==1,"FRONTEND_BIND_MISSING")
    source=Path(mounted[0])
    ensure(source.is_dir() and str(source).startswith("/home/ubuntu/neis-frontend/releases/"),
           "UNKNOWN_RELEASE")
    index=(source/"index.html").read_text()
    ensure(index.count(OLD)==1 and "main-admin-roles-v1.js" in index and
        "server-usage-admin-v1.js" in index,"CURRENT_AUTH_STUDIO_NOT_V3")
    original=OVERLAY.read_text()
    ensure(original.count(str(source))==1,"OVERLAY_NOT_EXPECTED")
    ensure(not DEST.exists() and not Path(str(DEST)+".building").exists(),"TARGET_ALREADY_EXISTS")
    old_files=sum(x.is_file() for x in source.rglob("*"))
    ensure(old_files>100,"MISSING_FRONTEND_FILES")
    # Confirm privilege restrictions for BOTH user list and details endpoints.
    signature="public.main_admin_auth_users(text,text,text,integer,integer,text,text)"
    detail_signature="public.main_admin_auth_user_detail(uuid)"
    perms=db("""select case when
       to_regprocedure('"""+signature+"""') is not null
       and not has_function_privilege('anon','"""+signature+"""','EXECUTE')
       and not has_function_privilege('anon','"""+detail_signature+"""','EXECUTE')
       then 'LOCKED' else 'UNSAFE' end;""").stdout.strip()
    ensure(perms=="LOCKED","RPC_ACCESS_NOT_LOCKED")
    denied=db("""begin;
      set local role authenticated;
      select set_config('request.jwt.claim.role','authenticated',true);
      select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
      select public.main_admin_auth_users('','all','created_desc',10,0,'all','all');
      rollback;""",check=False)
    ensure(denied.returncode!=0,"NON_OWNER_NOT_DENIED")
    owner=db("""begin;
      set local role authenticated;
      select set_config('request.jwt.claim.role','authenticated',true);
      select set_config('request.jwt.claim.sub','25b556a3-ec6f-49e7-ac6c-1b09720e3bfd',true);
      select case when (public.main_admin_auth_users('','all','created_desc',50,0,'all','all')->>'total')::int>0 then 'READY' else 'EMPTY' end;
      rollback;""").stdout
    ensure("READY" in owner,"OWNER_NOT_AUTHORIZED")
    phase="copy"
    tmp=Path(str(DEST)+".building")
    shutil.copytree(source,tmp)
    shutil.copy2(STAGE/"ui.js",tmp/"scripts/main-admin-auth-studio-v4.js")
    (tmp/"index.html").write_text(index.replace(OLD,NEW))
    ensure(sum(x.is_file() for x in tmp.rglob("*"))==old_files+1,"COPY_FILES_MISMATCH")
    tmp.rename(DEST)
    (STAGE/"frontend-overlay.before-v4.yml").write_text(original)
    phase="activate"
    changed=False
    try:
        OVERLAY.write_text(original.replace(str(source),str(DEST)))
        changed=True
        call(COMPOSE+["config","--quiet"],timeout=35)
        call(COMPOSE+["up","-d","--no-deps","caddy"],timeout=100)
        cid=call(COMPOSE+["ps","-q","caddy"],timeout=25).stdout.strip()
        ensure(bool(cid),"CADDY_DOWN")
        html=call(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"],timeout=25).stdout
        script=call(DOCKER+["exec",cid,"cat",
               "/srv/neis-circle/scripts/main-admin-auth-studio-v4.js"],timeout=25).stdout
        ensure(NEW in html and OLD not in html and
               "server-usage-admin-v1.js" in html and
               "main-admin-roles-v1.js" in html and
               "selectAllMatching" in script and "getEveryMatching" in script and
               "['profile','Profile']" in script,"LIVE_RELEASE_NOT_VERIFIED")
        conf=call(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"],timeout=25).stdout
        for route in ("reverse_proxy rest:3000","reverse_proxy auth:9999","basic_auth"):
            ensure(route in conf,"CADDY_ROUTES_CHANGED")
    except Exception:
        if changed:
            OVERLAY.write_text(original)
            call(COMPOSE+["up","-d","--no-deps","caddy"],timeout=90,check=False)
            print("AUTH_STUDIO_V4_ROLLBACK=FRONTEND_RESTORED")
        raise
    print("AUTH_STUDIO_V4_DEPLOY=SUCCESS")
    print("AUTH_STUDIO_V4_PROFILE_COLUMN=LIVE")
    print("AUTH_STUDIO_V4_SELECT_ALL=ALL_MATCHING_PAGES")
    print("AUTH_STUDIO_V4_OWNER_ONLY=DB_VERIFIED")
    print("AUTH_STUDIO_V4_SITE_THEME=PRESERVED")
    print("AUTH_STUDIO_V4_AUTH_DATABASE_MUTATIONS=NONE")
    print("AUTH_STUDIO_V4_GOOGLE_SIGNIN_UNCHANGED=YES")

if __name__=="__main__":
    try:run()
    except Exception as ex:
        permitted={
          "STAGING_MISSING","UI_FEATURE_MISSING","SITE_THEME_MISSING","FRONTEND_BIND_MISSING",
          "UNKNOWN_RELEASE","CURRENT_AUTH_STUDIO_NOT_V3","OVERLAY_NOT_EXPECTED",
          "TARGET_ALREADY_EXISTS","MISSING_FRONTEND_FILES","RPC_ACCESS_NOT_LOCKED",
          "NON_OWNER_NOT_DENIED","OWNER_NOT_AUTHORIZED","COPY_FILES_MISMATCH",
          "CADDY_DOWN","LIVE_RELEASE_NOT_VERIFIED","CADDY_ROUTES_CHANGED","COMMAND_FAILED"
        }
        print("AUTH_STUDIO_V4_DEPLOY=FAILED_"+phase.upper()+"_"+
              (str(ex) if str(ex) in permitted else "UNEXPECTED"),file=sys.stderr)
        raise SystemExit(1)
