#!/usr/bin/env python3
"""Roll back only the active JPEG social preview release."""
from pathlib import Path
import os,re,subprocess,sys
ROOT=Path("/home/ubuntu/neis-supabase")
STAGE=Path("/home/ubuntu/neis-backups/whatsapp-jpeg-20261119")
RELEASES=Path("/home/ubuntu/neis-frontend/releases")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
DOCKER=["sudo","-n","/usr/bin/docker"]
COMPOSE=DOCKER+["compose"]+[p for n in
 ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml",
  "docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml")
 for p in ("-f",n)]
try:
 sha=os.getenv("GITHUB_SHA","")[:12]
 assert re.fullmatch("[0-9a-f]{12}",sha),"Bad revision"
 release=RELEASES/("whatsapp-jpeg-share-"+sha)
 previous=STAGE/("previous-release-"+sha+".txt")
 if not previous.exists():
  print("WHATSAPP_JPEG_ROLLBACK=NO_DEPLOYMENT");sys.exit(0)
 original=Path(previous.read_text().strip())
 assert original.is_dir() and original.parent==RELEASES
 overlay=OVERLAY.read_text()
 if str(release) not in overlay:
  print("WHATSAPP_JPEG_ROLLBACK=NOT_ACTIVE");sys.exit(0)
 assert overlay.count(str(release))==1
 OVERLAY.write_text(overlay.replace(str(release),str(original),1))
 proc=subprocess.run(COMPOSE+["up","-d","--no-deps","caddy"],cwd=ROOT,
                     capture_output=True,text=True,timeout=180)
 if proc.returncode:raise RuntimeError(proc.stderr[-180:])
 print("WHATSAPP_JPEG_ROLLBACK=COMPLETE")
except Exception as e:
 print("WHATSAPP_JPEG_ROLLBACK=FAILED_"+str(e)[:190],file=sys.stderr)
 sys.exit(1)
