#!/usr/bin/env python3
"""Rollback notification-only frontend release; keep Caddy Auth/REST routes."""
from pathlib import Path
import subprocess
ROOT=Path("/home/ubuntu/neis-supabase")
OVERLAY=ROOT/"docker-compose.frontend-public.yml"
BACKUP=Path("/home/ubuntu/neis-backups/notification-chime-v5-20261011/frontend-public.original.yml")
TARGET="/home/ubuntu/neis-frontend/releases/ovh-notification-chime-v5-20261011-v1"
if not BACKUP.is_file():
 print("NOTIFICATION_ROLLBACK=NO_BACKUP")
 raise SystemExit(0)
current=OVERLAY.read_text()
if TARGET not in current:
 print("NOTIFICATION_ROLLBACK=TARGET_NOT_ACTIVE")
 raise SystemExit(0)
OVERLAY.write_text(BACKUP.read_text())
cmd=["sudo","-n","/usr/bin/docker","compose"]
for filename in ("docker-compose.yml","docker-compose.security.yml","docker-compose.caddy.yml","docker-compose.frontend-public.yml","docker-compose.auth-public-direct.yml"):
 cmd+=["-f",filename]
p=subprocess.run(cmd+["up","-d","--no-deps","caddy"],cwd=ROOT,capture_output=True,timeout=75)
if p.returncode:raise SystemExit("NOTIFICATION_ROLLBACK=FAILED")
print("NOTIFICATION_ROLLBACK=SUCCESS_PREVIOUS_ASSETS_RESTORED")
