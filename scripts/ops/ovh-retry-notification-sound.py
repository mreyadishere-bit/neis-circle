#!/usr/bin/env python3
"""Re-activate an already verified notification asset release after guarded rollback."""
import json,subprocess,shutil
from pathlib import Path
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/notification-sound-20261011')
BACKUP=STAGE/'frontend-public.original.yml'
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
NEW=Path('/home/ubuntu/neis-frontend/releases/ovh-notification-sound-20261011-v1')
BASE=['sudo','-n','/usr/bin/docker']
CMD=BASE+['compose']
for name in ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml','docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'):
 CMD+=['-f',name]
def run(cmd):
 result=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=95)
 if result.returncode:raise RuntimeError('NOTIFICATION_REDEPLOY=COMMAND_FAILED')
 return result.stdout

try:
 if not NEW.is_dir() or not BACKUP.is_file() or not OVERLAY.is_file():
  raise RuntimeError('NOTIFICATION_REDEPLOY=BLOCKED_RELEASE_NOT_STAGED')
 if OVERLAY.read_text()!=BACKUP.read_text():
  raise RuntimeError('NOTIFICATION_REDEPLOY=BLOCKED_CONFIG_CHANGED_AFTER_ROLLBACK')
 meta=json.loads(run(BASE+['inspect','supabase-caddy']))[0]
 mounts=[x for x in meta.get('Mounts',[]) if x.get('Destination')=='/srv/neis-circle']
 if len(mounts)!=1:raise RuntimeError('NOTIFICATION_REDEPLOY=BLOCKED_FRONTEND_MOUNT')
 original=Path(mounts[0]['Source'])
 if not str(original).startswith('/home/ubuntu/neis-frontend/releases/') or BACKUP.read_text().count(str(original))!=1:
  raise RuntimeError('NOTIFICATION_REDEPLOY=BLOCKED_SOURCE_MISMATCH')
 checks=[
  (NEW/'scripts/social/notifications-v174.js','chimeOnce(row)',STAGE/'notifications-v174.js'),
  (NEW/'scripts/pwa-install-v117.js','data-test-notification-sound',STAGE/'pwa-install-v117.js'),
  (NEW/'neis-pwa-sw.js','https://supabase.neiscircle.site/functions/v1/refresh-web-push-subscription',STAGE/'neis-pwa-sw.js'),
 ]
 for file,expected,stage in checks:
  if not file.is_file() or not stage.is_file() or file.read_bytes()!=stage.read_bytes() or expected not in file.read_text():
   raise RuntimeError('NOTIFICATION_REDEPLOY=BLOCKED_ASSET_HASH_CHANGED')
 if '&sound=20261011' not in (NEW/'index.html').read_text():
  raise RuntimeError('NOTIFICATION_REDEPLOY=BLOCKED_NEW_HTML')
 OVERLAY.write_text(BACKUP.read_text().replace(str(original),str(NEW)))
 try:
  run(CMD+['config','--quiet'])
  run(CMD+['up','-d','--no-deps','caddy'])
  cid=run(CMD+['ps','-q','caddy']).strip()
  if not cid:raise RuntimeError('NOTIFICATION_REDEPLOY=NO_CADDY')
  for path,needle in [
   ('/srv/neis-circle/index.html','&sound=20261011'),
   ('/etc/caddy/Caddyfile','reverse_proxy auth:9999'),
   ('/etc/caddy/Caddyfile','reverse_proxy rest:3000'),
   ('/etc/caddy/Caddyfile','basic_auth'),
  ]:
   if needle not in run(BASE+['exec',cid,'cat',path]):
    raise RuntimeError('NOTIFICATION_REDEPLOY=ROUTE_OR_ASSET_CHECK_FAILED')
 except Exception:
  shutil.copyfile(BACKUP,OVERLAY)
  subprocess.run(CMD+['up','-d','--no-deps','caddy'],cwd=ROOT,capture_output=True,timeout=95)
  print('NOTIFICATION_REDEPLOY=ROLLED_BACK')
  raise
 print('NOTIFICATION_REDEPLOY=SUCCESS_WITH_ORIGINAL_GOOGLE_REST_STUDIO')
except Exception as e:
 print(str(e) if str(e).startswith('NOTIFICATION_REDEPLOY=') else 'NOTIFICATION_REDEPLOY=UNEXPECTED_ERROR')
 raise SystemExit(1)
