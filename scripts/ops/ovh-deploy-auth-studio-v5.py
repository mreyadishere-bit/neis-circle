#!/usr/bin/env python3
"""Deploy OVH Auth Studio v5 atomically, owner verified, without student data changes."""
from pathlib import Path
import json,subprocess,shutil,sys
ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/auth-studio-v5-20261011")
DEST=Path("/home/ubuntu/neis-frontend/releases/ovh-auth-studio-v5-20261011")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[x for f in (
  "docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
  "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml")
  for x in ("-f",f)]
OLD="scripts/main-admin-auth-studio-v4.js?authstudio=20261011v4"
NEW="scripts/main-admin-auth-studio-v5.js?authstudio=20261011v5"
phase="preflight"

def call(cmd,stdin=None,timeout=85,check=True):
  r=subprocess.run(cmd,text=True,input=stdin,capture_output=True,cwd=ROOT,timeout=timeout)
  if check and r.returncode:raise RuntimeError("COMMAND_FAILED")
  return r

def ensure(test,message):
  if not test:raise RuntimeError(message)

def db(sql,check=True):
  return call(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
     "-U","postgres","-d","postgres","-Atq"],stdin=sql,timeout=60,check=check)

def run():
  global phase
  ensure(STAGE.is_dir() and OVERLAY.is_file() and (STAGE/"ui.js").is_file()
         and (STAGE/"migration.sql").is_file(),"REQUIRED_FILES_MISSING")
  js=(STAGE/"ui.js").read_text()
  migration=(STAGE/"migration.sql").read_text()
  for word in ("#/profile/","dataset.stModerate","main_admin_auth_set_block",
               "moderationPending","data-st-action","isOwner()",
               "--st-bg:var(--card)"):
    ensure(word in js,"UI_SECURITY_FEATURE_MISSING")
  ensure("auth.role()" in migration and "auth.uid()" in migration and
      "admin_set_account_block" in migration and
      "main_admin_auth_set_block" in migration and
      "revoke all on function public.main_admin_auth_set_block" in migration,
      "SQL_SECURITY_FEATURE_MISSING")
  call(["node","--check",str(STAGE/"ui.js")],timeout=14)
  call(COMPOSE+["config","--quiet"],timeout=35)
  obj=json.loads(call(DOCKER+["inspect","supabase-caddy"],timeout=20).stdout)[0]
  binds=[x.get("Source") for x in obj.get("Mounts",[])
       if x.get("Type")=="bind" and x.get("Destination")=="/srv/neis-circle"]
  ensure(len(binds)==1,"LIVE_BIND_NOT_FOUND")
  source=Path(binds[0])
  ensure(source.is_dir() and str(source).startswith("/home/ubuntu/neis-frontend/releases/"),
         "LIVE_RELEASE_UNEXPECTED")
  html=(source/"index.html").read_text()
  ensure(html.count(OLD)==1 and "main-admin-roles-v1.js" in html and
         "server-usage-admin-v1.js" in html,"LIVE_V4_NOT_FOUND")
  original=OVERLAY.read_text()
  ensure(original.count(str(source))==1,"OVERLAY_CHANGED")
  ensure(not DEST.exists() and not Path(str(DEST)+".building").exists(),"RELEASE_ALREADY_EXISTS")
  count=sum(x.is_file() for x in source.rglob("*"))
  ensure(count>100,"INCOMPLETE_SOURCE")
  base_sig="public.main_admin_auth_users(text,text,text,integer,integer,text,text)"
  ensure(db("select case when to_regprocedure('"+base_sig+
       "') is not null then 'OK' else 'MISSING' end;").stdout.strip()=="OK","OLD_RPC_MISSING")
  ensure(db("select case when to_regprocedure('public.admin_set_account_block(text,uuid,boolean,text)') is not null then 'OK' else 'MISSING' end;").stdout.strip()=="OK","BLOCK_MODERATION_RPC_MISSING")

  # Prepare safe immutable release before migration/activating Caddy.
  phase="release_copy"
  temp=Path(str(DEST)+".building")
  shutil.copytree(source,temp)
  shutil.copy2(STAGE/"ui.js",temp/"scripts/main-admin-auth-studio-v5.js")
  (temp/"index.html").write_text(html.replace(OLD,NEW))
  ensure(sum(x.is_file() for x in temp.rglob("*"))==count+1,"COPY_COUNT_MISMATCH")
  temp.rename(DEST)

  phase="apply_secure_rpc"
  db(migration)
  signature="public.main_admin_auth_set_block(uuid,boolean,text)"
  rights=db("select case when to_regprocedure('"+signature+
       "') is not null and not has_function_privilege('anon','"+signature+
       "','EXECUTE') then 'PROTECTED' else 'EXPOSED' end;").stdout.strip()
  ensure(rights=="PROTECTED","OWNER_RPC_EXPOSED")
  denied=db("""begin;
    set local role authenticated;
    select set_config('request.jwt.claim.role','authenticated',true);
    select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
    select public.main_admin_auth_set_block('00000000-0000-0000-0000-000000000002'::uuid,true,'test');
    rollback;""",check=False)
  ensure(denied.returncode!=0,"NON_OWNER_WRITE_NOT_DENIED")

  (STAGE/"frontend-overlay.before-v5.yml").write_text(original)
  phase="activate_release"
  changed=False
  try:
    OVERLAY.write_text(original.replace(str(source),str(DEST)))
    changed=True
    call(COMPOSE+["config","--quiet"],timeout=35)
    call(COMPOSE+["up","-d","--no-deps","caddy"],timeout=95)
    cid=call(COMPOSE+["ps","-q","caddy"],timeout=25).stdout.strip()
    ensure(bool(cid),"CADDY_NOT_RUNNING")
    live=call(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"],timeout=22).stdout
    panel=call(DOCKER+["exec",cid,"cat","/srv/neis-circle/scripts/main-admin-auth-studio-v5.js"],timeout=22).stdout
    ensure(NEW in live and OLD not in live and
         "server-usage-admin-v1.js" in live and "main-admin-roles-v1.js" in live and
         "main_admin_auth_set_block" in panel and "link.href='#/profile/'" in panel,
         "LIVE_UI_MISSING")
    caddy=call(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"],timeout=25).stdout
    ensure(all(s in caddy for s in ("reverse_proxy rest:3000","reverse_proxy auth:9999",
          "basic_auth")),"PROXY_ROUTE_CHANGED")
  except Exception:
    if changed:
      OVERLAY.write_text(original)
      call(COMPOSE+["up","-d","--no-deps","caddy"],timeout=85,check=False)
      print("AUTH_STUDIO_V5_FRONTEND_ROLLBACK=SUCCESS")
    raise
  print("AUTH_STUDIO_V5_DEPLOY=SUCCESS")
  print("AUTH_STUDIO_V5_PROFILE_LINKS=NATIVE_HASH")
  print("AUTH_STUDIO_V5_BLOCK_UNBLOCK=OWNER_ONLY_RPC")
  print("AUTH_STUDIO_V5_MODERATION_AUDIT=EXISTING_LOG")
  print("AUTH_STUDIO_V5_CADDY_ROUTES=UNCHANGED")
  print("AUTH_STUDIO_V5_STUDENT_ACCOUNT_MUTATIONS=ZERO")
  print("AUTH_STUDIO_V5_GOOGLE_OAUTH=UNCHANGED")

if __name__=="__main__":
  try:run()
  except Exception as e:
    whitelisted={"REQUIRED_FILES_MISSING","UI_SECURITY_FEATURE_MISSING",
      "SQL_SECURITY_FEATURE_MISSING","LIVE_BIND_NOT_FOUND","LIVE_RELEASE_UNEXPECTED",
      "LIVE_V4_NOT_FOUND","OVERLAY_CHANGED","RELEASE_ALREADY_EXISTS","INCOMPLETE_SOURCE",
      "OLD_RPC_MISSING","BLOCK_MODERATION_RPC_MISSING","COPY_COUNT_MISMATCH",
      "OWNER_RPC_EXPOSED","NON_OWNER_WRITE_NOT_DENIED","CADDY_NOT_RUNNING",
      "LIVE_UI_MISSING","PROXY_ROUTE_CHANGED","COMMAND_FAILED"}
    label=str(e) if str(e) in whitelisted else "UNEXPECTED"
    print("AUTH_STUDIO_V5_DEPLOY=FAILED_"+phase.upper()+"_"+label,file=sys.stderr)
    raise SystemExit(1)
