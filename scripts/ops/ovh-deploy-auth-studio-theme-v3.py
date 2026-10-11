#!/usr/bin/env python3
"""Theme-only OVH auth console update using current live release (no SQL writes)."""
from pathlib import Path
import json,subprocess,shutil,sys
ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/auth-studio-theme-v3-20261011")
DEST=Path("/home/ubuntu/neis-frontend/releases/ovh-auth-studio-theme-20261011-v3")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[q for f in (
 "docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
 "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml")
 for q in ("-f",f)]
OLD="scripts/main-admin-auth-studio-v2.js?authstudio=20261011v2"
NEW="scripts/main-admin-auth-studio-v3.js?authstudio=20261011v3"
phase="preflight"

def run(cmd,timeout=100,stdin=None,check=True):
  result=subprocess.run(cmd,text=True,capture_output=True,input=stdin,cwd=ROOT,timeout=timeout)
  if check and result.returncode:
    raise RuntimeError("COMMAND_FAILED")
  return result
def require(condition,code):
  if not condition:raise RuntimeError(code)
def db(sql,check=True):
  return run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
       "-U","postgres","-d","postgres","-Atq"],stdin=sql,timeout=30,check=check)
def main():
  global phase
  require(STAGE.is_dir() and (STAGE/"ui.js").is_file() and OVERLAY.is_file(),"NO_STAGING")
  ui=(STAGE/"ui.js").read_text()
  require("--st-bg:var(--card)" in ui and "--st-fg:var(--ink)" in ui
      and "--st-secondary:var(--muted)" in ui and
      "main_admin_auth_users" in ui and "isOwner()" in ui
      and "Unified search" in ui,"UI_GUARD_FAILED")
  run(["node","--check",str(STAGE/"ui.js")],timeout=15)
  run(COMPOSE+["config","--quiet"],timeout=40)
  obj=json.loads(run(DOCKER+["inspect","supabase-caddy"],timeout=18).stdout)[0]
  bindings=[x.get("Source") for x in obj.get("Mounts",[])
      if x.get("Type")=="bind" and x.get("Destination")=="/srv/neis-circle"]
  require(len(bindings)==1,"MISSING_LIVE_BIND")
  current=Path(bindings[0])
  require(current.is_dir() and str(current).startswith("/home/ubuntu/neis-frontend/releases/"),
          "UNEXPECTED_RELEASE")
  index=(current/"index.html").read_text()
  require(index.count(OLD)==1 and "scripts/server-usage-admin-v1.js" in index
      and "scripts/main-admin-roles-v1.js" in index,"EXPECTED_CURRENT_UI_ABSENT")
  old_overlay=OVERLAY.read_text()
  require(old_overlay.count(str(current))==1,"OVERLAY_DRIFT")
  require(not DEST.exists() and not Path(str(DEST)+".building").exists(),"RELEASE_EXISTS")
  require(sum(x.is_file() for x in current.rglob("*"))>100,"SOURCE_FILES_MISSING")
  # The old Auth RPC protection remains intact; no migrations required.
  signature="public.main_admin_auth_users(text,text,text,integer,integer,text,text)"
  privileges=db("select case when to_regprocedure('"+signature+
    "') is not null and not has_function_privilege('anon','"+signature+
    "','EXECUTE') then 'SAFE' else 'UNSAFE' end;").stdout.strip()
  require(privileges=="SAFE","RPC_ACCESS_UNSAFE")
  denied=db("""begin;
  set local role authenticated;
  select set_config('request.jwt.claim.role','authenticated',true);
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
  select public.main_admin_auth_users('','all','created_desc',5,0,'all','all');
  rollback;""",check=False)
  require(denied.returncode!=0,"NON_OWNER_ACCESS_NOT_DENIED")
  phase="copy"
  tmp=Path(str(DEST)+".building")
  shutil.copytree(current,tmp)
  shutil.copy2(STAGE/"ui.js",tmp/"scripts/main-admin-auth-studio-v3.js")
  (tmp/"index.html").write_text(index.replace(OLD,NEW))
  prior=sum(x.is_file() for x in current.rglob("*"))
  after=sum(x.is_file() for x in tmp.rglob("*"))
  require(after==prior+1,"RELEASE_COPY_UNEXPECTED")
  tmp.rename(DEST)
  phase="activate"
  (STAGE/"frontend-overlay.before-theme-v3.yml").write_text(old_overlay)
  changed=False
  try:
    OVERLAY.write_text(old_overlay.replace(str(current),str(DEST)))
    changed=True
    run(COMPOSE+["config","--quiet"],timeout=40)
    run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=100)
    cid=run(COMPOSE+["ps","-q","caddy"],timeout=22).stdout.strip()
    require(bool(cid),"CADDY_NOT_RUNNING")
    html=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"],timeout=22).stdout
    css=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/scripts/main-admin-auth-studio-v3.js"],timeout=22).stdout
    require(NEW in html and OLD not in html
      and "main-admin-roles-v1.js" in html
      and "server-usage-admin-v1.js" in html
      and "--st-bg:var(--card)" in css
      and "--st-fg:var(--ink)" in css,"LIVE_THEME_NOT_VISIBLE")
    caddy=run(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"],timeout=22).stdout
    for route in ("reverse_proxy rest:3000","reverse_proxy auth:9999","basic_auth"):
      require(route in caddy,"GATEWAY_ROUTES_CHANGED")
  except Exception:
    if changed:
      OVERLAY.write_text(old_overlay)
      run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=95,check=False)
      print("AUTH_THEME_V3=FRONTEND_ROLLED_BACK")
    raise
  print("AUTH_THEME_V3=SUCCESS")
  print("AUTH_THEME_V3_MAIN_ADMIN_ONLY=DATABASE_GUARD_VERIFIED")
  print("AUTH_THEME_V3_LIGHT_DARK=AUTOMATIC_NEIS_CSS_VARIABLES")
  print("AUTH_THEME_V3_LIVE_FRONTEND=VERIFIED")
  print("AUTH_THEME_V3_AUTH_CONFIG=UNCHANGED")
  print("AUTH_THEME_V3_DB_WRITES=NONE")
if __name__=="__main__":
  try:main()
  except Exception as ex:
    whitelisted={"NO_STAGING","UI_GUARD_FAILED","MISSING_LIVE_BIND","UNEXPECTED_RELEASE",
      "EXPECTED_CURRENT_UI_ABSENT","OVERLAY_DRIFT","RELEASE_EXISTS","SOURCE_FILES_MISSING",
      "RPC_ACCESS_UNSAFE","NON_OWNER_ACCESS_NOT_DENIED","RELEASE_COPY_UNEXPECTED",
      "CADDY_NOT_RUNNING","LIVE_THEME_NOT_VISIBLE","GATEWAY_ROUTES_CHANGED","COMMAND_FAILED"}
    print("AUTH_THEME_V3=FAILED_"+phase.upper()+"_"+(str(ex) if str(ex) in whitelisted else "UNEXPECTED"),
      file=sys.stderr)
    raise SystemExit(1)
