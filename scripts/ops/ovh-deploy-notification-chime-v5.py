#!/usr/bin/env python3
"""Release notification assets without touching Auth, REST or user data."""
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/notification-chime-v5-20261011")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
NEW=Path("/home/ubuntu/neis-frontend/releases/ovh-notification-chime-v5-20261011-v1")
BACKUP=STAGE/"frontend-public.original.yml"
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]
for file in ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml","docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml"):
 COMPOSE+=["-f",file]

def run(cmd,timeout=50,check=True):
 p=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
 if check and p.returncode!=0:raise RuntimeError("NOTIFICATION_DEPLOY=COMMAND_FAILED")
 return p.stdout

def check(cond,label):
 if not cond:raise RuntimeError("NOTIFICATION_DEPLOY=BLOCKED_"+label)

def rollback():
 if BACKUP.is_file():
  shutil.copyfile(BACKUP,OVERLAY)
  run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=65,check=False)
  print("NOTIFICATION_DEPLOY=ROLLED_BACK")

def main():
 check(OVERLAY.is_file() and (ROOT/"docker-compose.auth-public-direct.yml").is_file(),"COMPOSE")
 check(not BACKUP.exists() and not NEW.exists(),"ALREADY_ATTEMPTED")
 check(all((STAGE/p).is_file() for p in ("notifications-v174.js","pwa-install-v117.js","neis-pwa-sw.js")),"STAGE_FILES")
 run(COMPOSE+["config","--quiet"])
 meta=json.loads(run(DOCKER+["inspect","supabase-caddy"]))[0]
 mounts=[v for v in meta.get("Mounts",[]) if v.get("Destination")=="/srv/neis-circle" and v.get("Type")=="bind"]
 check(len(mounts)==1,"SOURCE_MOUNT")
 source=Path(mounts[0]["Source"])
 check(str(source).startswith("/home/ubuntu/neis-frontend/releases/") and source.is_dir(),"SOURCE_RELEASE")
 existing=OVERLAY.read_text()
 check(existing.count(str(source))==1,"OVERLAY_MISMATCH")
 tmp=Path(str(NEW)+".building")
 check(not tmp.exists(),"TEMP_EXISTS")
 old_count=sum(x.is_file() for x in source.rglob("*"))
 check(old_count>100,"SOURCE_FILES")
 sound=(STAGE/"notifications-v174.js").read_text()
 pwa=(STAGE/"pwa-install-v117.js").read_text()
 worker=(STAGE/"neis-pwa-sw.js").read_text()
 check(all(x in sound for x in ("baselineLoaded","chimeOnce(row)","playSound(test=false)","const latestUnread=fresh.find","badgeKnownIds","testIncomingAlert","lastChimeResult")),"SOUND_CONTENT")
 check(all(x in pwa for x in ("data-test-notification-sound","/neis-pwa-sw.js?v=13")),"PWA_CONTENT")
 check(all(x in worker for x in ("neis-pwa-ovh-v13","https://supabase.neiscircle.site/functions/v1/refresh-web-push-subscription")),"SW_CONTENT")
 keypattern=r"VAPID_PUBLIC_KEY\s*=\s*[\x22\x27]([A-Za-z0-9_-]{85,90})"
 a=re.search(keypattern,pwa)
 b=re.search(keypattern,worker)
 check(a is not None and b is not None and a.group(1)==b.group(1),"VAPID_KEY_PARITY")
 shutil.copytree(source,tmp)
 for out,payload in (("scripts/social/notifications-v174.js",sound),("scripts/pwa-install-v117.js",pwa),("neis-pwa-sw.js",worker)):
  (tmp/out).write_text(payload)
 html=(tmp/"index.html").read_text()
 for path in ("scripts/social/notifications-v174.js","scripts/pwa-install-v117.js"):
  pattern=r"("+re.escape(path)+r"[^\"'\s<>]*)"
  matches=list(re.finditer(pattern,html))
  check(len(matches)==1,"SCRIPT_REFERENCE")
  m=matches[0]
  html=html[:m.start()]+m.group(1)+"&sound=v5-20261011"+html[m.end():]
 (tmp/"index.html").write_text(html)
 check(sum(x.is_file() for x in tmp.rglob("*"))==old_count,"FILE_COUNT")
 tmp.rename(NEW)
 BACKUP.write_text(existing)
 OVERLAY.write_text(existing.replace(str(source),str(NEW)))
 try:
  run(COMPOSE+["config","--quiet"])
  run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=70)
  cid=run(COMPOSE+["ps","-q","caddy"]).strip()
  check(bool(cid),"CADDY_NOT_RUNNING")
  for filename,word in (
    ("/srv/neis-circle/index.html","&sound=v5-20261011"),
    ("/srv/neis-circle/neis-pwa-sw.js","https://supabase.neiscircle.site/functions/v1/refresh-web-push-subscription"),
    ("/etc/caddy/Caddyfile","reverse_proxy rest:3000"),
    ("/etc/caddy/Caddyfile","reverse_proxy auth:9999"),
    ("/etc/caddy/Caddyfile","basic_auth"),
  ):
   check(word in run(DOCKER+["exec",cid,"cat",filename]),"LIVE_CHECK")
 except Exception:
  rollback()
  raise
 print("NOTIFICATION_DEPLOY=SUCCESS_FRONTEND_ONLY")
 print("NOTIFICATION_DEPLOY=GOOGLE_REST_STUDIO_PRESERVED")
 print("NOTIFICATION_DEPLOY=NO_DATABASE_CHANGES")

if __name__=="__main__":
 try:main()
 except Exception as e:
  print(str(e) if str(e).startswith("NOTIFICATION_DEPLOY=") else "NOTIFICATION_DEPLOY=UNEXPECTED_ERROR")
  raise SystemExit(1)
