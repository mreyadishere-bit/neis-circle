#!/usr/bin/env python3
"""Atomic OVH deployment of JPEG link-preview improvements only.

Existing app, auth, CSS, database, root/home images, Caddy rules and
15 clean-path mappings are preserved without modification.
"""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys
ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/whatsapp-jpeg-20261119")
RELEASES=Path("/home/ubuntu/neis-frontend/releases")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[x for f in
 ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
  "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml")
 for x in ("-f",f)]
SLUGS=("feed","discover","study","messages","connections","saved",
       "opportunities","gallery","articles","circles","analytics",
       "timetable","notifications","settings","games")
VERSION="20261119-whatsapp-jpeg"
def check(v,msg):
 if not v:raise RuntimeError(msg)
def run(args,timeout=100):
 p=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError("COMMAND_FAILED_"+(p.stderr or "")[-210:])
 return p.stdout
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
 rev=os.getenv("GITHUB_SHA","")[:12]
 check(bool(re.fullmatch(r"[0-9a-f]{12}",rev)),"BAD_SHA")
 check(STAGE.is_dir() and RELEASES.is_dir() and OVERLAY.is_file(),"STAGE_MISSING")
 for slug in SLUGS:
  jpg=STAGE/"images"/(slug+".jpg")
  page=STAGE/"html"/(slug+".html")
  check(jpg.is_file() and jpg.read_bytes().startswith(b"\xff\xd8\xff"),"JPG_MISSING_"+slug)
  check(page.is_file(),"META_MISSING_"+slug)
  txt=page.read_text()
  check('og:image:type" content="image/jpeg"' in txt
        and "assets/share-link/"+slug+".jpg?v="+VERSION in txt
        and "window.location.replace('/#/"+slug+"');" in txt,
        "PAGE_CONTENT_UNEXPECTED_"+slug)
 run(COMPOSE+["config","--quiet"],timeout=55)
 inspect=json.loads(run(DOCKER+["inspect","supabase-caddy"],timeout=30))[0]
 mounts=inspect["Mounts"]
 frontend=[Path(m["Source"]) for m in mounts if m.get("Destination")=="/srv/neis-circle" and m.get("Type")=="bind"]
 conf=[Path(m["Source"]) for m in mounts if m.get("Destination")=="/etc/caddy/Caddyfile" and m.get("Type")=="bind"]
 check(len(frontend)==len(conf)==1,"MOUNT_UNEXPECTED")
 source=frontend[0]
 overlay=OVERLAY.read_text()
 check(source.is_dir() and source.parent==RELEASES and overlay.count(str(source))==1,"CURRENT_RELEASE_UNKNOWN")
 currentindex=(source/"index.html").read_text()
 check("scripts/hash-route-open-v1.js" in currentindex
   and "scripts/03-auth-i18n.js" in currentindex
   and "scripts/user-activity-v1.js" in currentindex
   and "assets/share/home-main.webp" in currentindex,"ORIGINAL_APP_MISSING")
 config=conf[0].read_text()
 check("NEIS CLEAN HASH PREVIEWS" in config
       and "rewrite /articles /articles.html" in config
       and "rewrite /study /study.html" in config,"ACTIVE_CLEAN_LINK_ROUTING_MISSING")
 oldcount=sum(p.is_file() for p in source.rglob("*"))
 check(oldcount>125,"SOURCE_RELEASE_INCOMPLETE")
 for slug in SLUGS:
  check((source/(slug+".html")).is_file(),"EXISTING_META_PAGE_NOT_FOUND_"+slug)
 target=RELEASES/("whatsapp-jpeg-share-"+rev)
 tmp=Path(str(target)+".building")
 check(not target.exists() and not tmp.exists(),"RELEASE_ALREADY_EXISTS")
 shutil.copytree(source,tmp)
 for slug in SLUGS:
  shutil.copy2(STAGE/"html"/(slug+".html"),tmp/(slug+".html"))
  shutil.copy2(STAGE/"images"/(slug+".jpg"),tmp/"assets/share-link"/(slug+".jpg"))
 # All previous content, including root photo and existing WebP artwork, remains unchanged.
 for rel in ("index.html","scripts/03-auth-i18n.js","scripts/hash-route-open-v1.js",
             "scripts/user-activity-v1.js","assets/share/home-main.webp",
             "assets/email-logo.png","favicon.ico","styles/ui-v14.css"):
  check(sha(source/rel)==sha(tmp/rel),"UNRELATED_FILE_CHANGED_"+rel)
 check(sum(p.is_file() for p in tmp.rglob("*"))==oldcount+len(SLUGS),"FILE_COUNT_UNEXPECTED")
 tmp.rename(target)
 previous=STAGE/("previous-release-"+rev+".txt")
 previous.write_text(str(source));previous.chmod(0o600)
 activated=False
 try:
  OVERLAY.write_text(overlay.replace(str(source),str(target),1));activated=True
  run(COMPOSE+["config","--quiet"],timeout=55)
  run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=180)
  cid=run(COMPOSE+["ps","-q","caddy"],timeout=26).strip()
  check(cid,"CADDY_DOWN")
  live_index=run(DOCKER+["exec",cid,"cat","/srv/neis-circle/index.html"],timeout=30)
  check(live_index==currentindex,"APP_INDEX_CHANGED")
  for slug in SLUGS:
   check(run(DOCKER+["exec",cid,"sha256sum",
           "/srv/neis-circle/assets/share-link/"+slug+".jpg"],
           timeout=22).split()[0]==sha(STAGE/"images"/(slug+".jpg")),
         "LIVE_JPG_HASH_INVALID_"+slug)
  active_caddy=run(DOCKER+["exec",cid,"cat","/etc/caddy/Caddyfile"],timeout=30)
  check(active_caddy==config,"CADDY_RULES_CHANGED")
 except Exception:
  if activated:
   OVERLAY.write_text(overlay)
   try:run(COMPOSE+["up","-d","--no-deps","caddy"],timeout=175)
   except Exception:print("WHATSAPP_JPEG_ROLLBACK=UNVERIFIED")
   else:print("WHATSAPP_JPEG_ROLLBACK=COMPLETE")
  raise
 print("WHATSAPP_JPEG_SHARE_DEPLOYED=YES")
 print("ORIGINAL_APP_INDEX=BYTE_IDENTICAL")
 print("ORIGINAL_MAIN_AND_HOME_IMAGES=UNCHANGED")
 print("EXISTING_CLEAN_URL_CADDY_RULES=UNCHANGED")
 print("DATABASE_AND_AUTH=UNCHANGED")
if __name__=="__main__":
 try:main()
 except Exception as e:
  print("WHATSAPP_JPEG_SHARE=FAILED_"+str(e)[:230],file=sys.stderr)
  sys.exit(1)
