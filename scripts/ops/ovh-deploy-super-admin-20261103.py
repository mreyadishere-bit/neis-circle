#!/usr/bin/env python3
"""Safely install Super Admin RPCs and UI on the existing OVH-mounted frontend."""
import json, shutil, subprocess, sys
from pathlib import Path

ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/super-admin-20261103")
RELEASE_ROOT=Path("/home/ubuntu/neis-frontend/releases")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[arg for name in (
 "docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
 "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml"
) for arg in ("-f",name)]

def run(command,stdin=None,timeout=90,check=True):
 r=subprocess.run(command,cwd=ROOT,input=stdin,text=True,capture_output=True,timeout=timeout)
 if check and r.returncode: raise RuntimeError("COMMAND_FAILED")
 return r

def db(query,check=True):
 return run(COMPOSE+["exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1",
 "-U","postgres","-d","postgres","-Atq"],stdin=query,check=check)

def require(x,why):
 if not x: raise RuntimeError(why)

def main():
 require(STAGE.is_dir() and OVERLAY.is_file(),"STAGING_MISSING")
 source_sql=(STAGE/"schema.sql").read_text()
 source_js=(STAGE/"ui.js").read_text()
 require("neis_admin_delete_account" in source_sql and "neis_admin_set_super" in source_sql and
         "25b556a3-ec6f-49e7-ac6c-1b09720e3bfd" in source_sql,"UNEXPECTED_SCHEMA")
 require("neis_admin_delete_account" in source_js and "Protected account" in source_js,"UNEXPECTED_UI")
 run(["node","--check",str(STAGE/"ui.js")])
 run(COMPOSE+["config","--quiet"])
 caddy=json.loads(run(DOCKER+["inspect","supabase-caddy"]).stdout)[0]
 mounts=[x["Source"] for x in caddy["Mounts"]
         if x.get("Type")=="bind" and x.get("Destination")=="/srv/neis-circle"]
 require(len(mounts)==1,"FRONTEND_MOUNT_NOT_FOUND")
 previous=Path(mounts[0])
 require(previous.is_dir() and previous.parent==RELEASE_ROOT,"UNEXPECTED_LIVE_RELEASE")
 original=OVERLAY.read_text()
 require(original.count(str(previous))==1,"MOUNT_MISMATCH")
 live_index=(previous/"index.html").read_text()
 require("main-admin-roles-v1.js" in live_index and "</body>" in live_index,"ADMIN_UI_NOT_FOUND")
 dest=RELEASE_ROOT/"ovh-super-admin-20261103-v1"
 # Avoid replacing a release that could contain newer work.
 require(not dest.exists() and not Path(str(dest)+".building").exists(),"RELEASE_EXISTS")
 temp=Path(str(dest)+".building")
 shutil.copytree(previous,temp)
 shutil.copy2(STAGE/"ui.js",temp/"scripts/super-admin-management-v1.js")
 if "scripts/super-admin-management-v1.js" not in live_index:
  live_index=live_index.replace("</body>",
   '<script defer src="scripts/super-admin-management-v1.js?v=20261103"></script>\n</body>')
 (temp/"index.html").write_text(live_index)
 temp.rename(dest)
 # A failed migration leaves the old UI active. No deletion is performed during deploy.
 db(source_sql,check=True)
 tests=db("""begin;
 set local role authenticated;
 select case when public.neis_admin_is_super() then 'FAIL' else 'ANON_DENY_PASS' end;
 select set_config('request.jwt.claim.sub','25b556a3-ec6f-49e7-ac6c-1b09720e3bfd',true);
 select case when public.neis_admin_is_owner() and public.neis_admin_is_super()
  then 'FOUNDER_PASS' else 'FAIL' end;
 rollback;""").stdout
 require("ANON_DENY_PASS" in tests and "FOUNDER_PASS" in tests,"AUTH_CHECK_FAILED")
 backup=STAGE/"frontend-public.before-super-admin.yml"
 backup.write_text(original)
 changed=False
 try:
  OVERLAY.write_text(original.replace(str(previous),str(dest)));changed=True
  run(COMPOSE+["config","--quiet"])
  run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=120)
  cid=run(COMPOSE+["ps","-q","caddy"]).stdout.strip()
  require(bool(cid),"CADDY_DOWN")
  live=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"]).stdout
  require("scripts/super-admin-management-v1.js" in live,"UI_NOT_ACTIVE")
 except Exception:
  if changed:
   OVERLAY.write_text(original)
   run(COMPOSE+["up","-d","--no-deps","caddy"],check=False,timeout=120)
  raise
 print("SUPER_ADMIN_DEPLOY=SUCCESS")
 print("FOUNDER_ACCOUNT_PROTECTED=YES")
 print("DELETE_RPC_REQUIRES_EXACT_CONFIRMATION=YES")

if __name__=="__main__":
 try: main()
 except Exception as exc:
  print("SUPER_ADMIN_DEPLOY=FAILED_"+str(exc)[:60],file=sys.stderr)
  raise SystemExit(1)
