#!/usr/bin/env python3
"""Apply additive CSS v2 to current live immutable OVH release, rollback on failure.

Does not replace any existing JavaScript, routes, authentication, PWA or data.
"""
import json,shutil,subprocess,sys
from pathlib import Path
ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/sidebar-density-20261012-v2")
TARGET=Path("/home/ubuntu/neis-frontend/releases/sidebar-density-20261012-v2")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
STYLE="styles/desktop-hover-rail-density-v2.css"
MARKER='<link rel="stylesheet" href="'+STYLE+'?sidebar=20261012v2">'
OLD_MARKER='<link rel="stylesheet" href="styles/desktop-hover-rail-v1.css?sidebar=20261012v1">'
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[p for f in (
 "docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
 "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml") for p in ("-f",f)]
phase="preflight"
def run(args,timeout=80,check=True):
 p=subprocess.run(args,text=True,capture_output=True,cwd=ROOT,timeout=timeout)
 if check and p.returncode:raise RuntimeError("COMMAND_FAILED")
 return p.stdout
def ensure(ok,msg):
 if not ok:raise RuntimeError(msg)

def deploy():
 global phase
 ensure((STAGE/"density.css").is_file() and OVERLAY.is_file(),"STAGING_UNAVAILABLE")
 css=(STAGE/"density.css").read_text()
 for k in ("@media (min-width: 1024px)","max-height: 760px","max-height: 580px",
           "--neis-rail-row: 42px","--neis-rail-row: 34px","--neis-rail-row: 29px",
           "justify-items: stretch","body .rail.neis-hover-rail"):
  ensure(k in css,"COMPACT_CSS_INVALID")
 run(COMPOSE+["config","--quiet"],timeout=40)
 mounts=[m.get("Source") for m in
   json.loads(run(DOCKER+["inspect","supabase-caddy"],timeout=22))[0].get("Mounts",[])
   if m.get("Type")=="bind" and m.get("Destination")=="/srv/neis-circle"]
 ensure(len(mounts)==1,"LIVE_RELEASE_UNKNOWN")
 source=Path(mounts[0])
 ensure(source.is_dir() and str(source).startswith("/home/ubuntu/neis-frontend/releases/"),
        "BAD_LIVE_SOURCE")
 index=(source/"index.html").read_text()
 ensure(index.count(OLD_MARKER)==1 and
        "scripts/desktop-hover-rail-v1.js?sidebar=20261012v1" in index and
        "main-admin-db-storage-v1.js" in index and
        "main-admin-auth-studio-v5.js" in index and
        index.count("</head>")==1 and MARKER not in index,
        "CURRENT_SIDEBAR_MISMATCH")
 overlay=OVERLAY.read_text()
 ensure(overlay.count(str(source))==1,"OVERLAY_MISMATCH")
 ensure(not TARGET.exists() and not Path(str(TARGET)+".building").exists(),
        "RELEASE_ALREADY_EXISTS")
 count=sum(x.is_file() for x in source.rglob("*"))
 ensure(count>100,"FRONTEND_INCOMPLETE")
 phase="copy"
 temp=Path(str(TARGET)+".building")
 shutil.copytree(source,temp)
 shutil.copy2(STAGE/"density.css",temp/STYLE)
 new_index=index.replace(OLD_MARKER,OLD_MARKER+"\n"+MARKER)
 (temp/"index.html").write_text(new_index)
 ensure(sum(x.is_file() for x in temp.rglob("*"))==count+1,"COPY_COUNT_WRONG")
 temp.rename(TARGET)
 (STAGE/"overlay-before-v2.yml").write_text(overlay)
 phase="activate"
 changed=False
 try:
  OVERLAY.write_text(overlay.replace(str(source),str(TARGET)))
  changed=True
  run(COMPOSE+["config","--quiet"],timeout=35)
  run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=120)
  cid=run(COMPOSE+["ps","-q","caddy"],timeout=25).strip()
  ensure(bool(cid),"CADDY_NOT_RUNNING")
  live_index=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"],timeout=25)
  live_css=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/"+STYLE],timeout=25)
  ensure(MARKER in live_index and OLD_MARKER in live_index and
    "max-height: 580px" in live_css and
    "scripts/desktop-hover-rail-v1.js" in live_index and
    "main-admin-db-storage-v1.js" in live_index,"LIVE_UI_FAILED")
  caddyfile=run(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"],timeout=25)
  ensure(all(k in caddyfile for k in
    ("reverse_proxy rest:3000","reverse_proxy auth:9999","basic_auth")),
    "PROXY_CHANGED")
 except Exception:
  if changed:
   OVERLAY.write_text(overlay)
   run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=100,check=False)
   print("SIDEBAR_DENSITY_FRONTEND=ROLLED_BACK")
  raise
 print("SIDEBAR_DENSITY_DEPLOY=SUCCESS")
 print("SIDEBAR_DENSITY_RELEASE=OVH_LIVE")
 print("SIDEBAR_DENSITY_13_ITEMS=COMPACT")
 print("SIDEBAR_DENSITY_SHORT_WINDOWS=ADAPTIVE")
 print("SIDEBAR_DENSITY_DESKTOP_ONLY=YES")
 print("SIDEBAR_DENSITY_RTL_LIGHT_DARK=UNCHANGED")
 print("SIDEBAR_DENSITY_PWA_AUTH_AND_DB=UNCHANGED")
if __name__=="__main__":
 try:deploy()
 except Exception as e:
  allowed={"STAGING_UNAVAILABLE","COMPACT_CSS_INVALID","LIVE_RELEASE_UNKNOWN",
           "BAD_LIVE_SOURCE","CURRENT_SIDEBAR_MISMATCH","OVERLAY_MISMATCH",
           "RELEASE_ALREADY_EXISTS","FRONTEND_INCOMPLETE","COPY_COUNT_WRONG",
           "CADDY_NOT_RUNNING","LIVE_UI_FAILED","PROXY_CHANGED","COMMAND_FAILED"}
  reason=str(e) if str(e) in allowed else "UNEXPECTED"
  print("SIDEBAR_DENSITY_DEPLOY=FAILED_"+phase.upper()+"_"+reason,file=sys.stderr)
  raise SystemExit(1)
