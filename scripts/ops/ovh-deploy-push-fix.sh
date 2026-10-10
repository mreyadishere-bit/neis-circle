#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
old=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-v1
new=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-pushfix
staged=/home/ubuntu/neis-backups/pwa-pushfix-20261010.js
overlay=docker-compose.frontend-public.yml
test -s "$old/index.html"
test -s "$old/scripts/pwa-install-v117.js"
test -s "$staged"
test -f "$overlay"
export ORIGINAL_FRONTEND="$old" UPDATED_FRONTEND="$new"
python3 - <<'PY'
from pathlib import Path
import os,shutil
old=Path(os.environ['ORIGINAL_FRONTEND']);new=Path(os.environ['UPDATED_FRONTEND'])
staged=Path('/home/ubuntu/neis-backups/pwa-pushfix-20261010.js')
if new.exists():raise SystemExit('PUSH_DEPLOY=BLOCKED_EXISTING_RELEASE')
code=staged.read_text()
for token in ('pushWithTimeout(','Notification.requestPermission()','lastPushHealthFailedAt','/neis-pwa-sw.js?v=12','register_web_push_subscription'):
 if token not in code:raise SystemExit('PUSH_DEPLOY=BLOCKED_INCOMPLETE_PATCH')
tmp=Path(str(new)+'.building')
if tmp.exists():raise SystemExit('PUSH_DEPLOY=BLOCKED_EXISTING_TEMP')
shutil.copytree(old,tmp)
(tmp/'scripts/pwa-install-v117.js').write_text(code)
html=(tmp/'index.html').read_text()
src='scripts/pwa-install-v117.js'
if html.count(src)!=1:
 shutil.rmtree(tmp)
 raise SystemExit('PUSH_DEPLOY=BLOCKED_SCRIPT_REFERENCE')
(tmp/'index.html').write_text(html.replace(src,src+'?pushfix=20261010'))
worker=tmp/'neis-pwa-sw.js'
sw=worker.read_text()
if 'neis-static-ovh-v11' not in sw:
 shutil.rmtree(tmp)
 raise SystemExit('PUSH_DEPLOY=BLOCKED_WORKER_VERSION')
worker.write_text(sw.replace('neis-static-ovh-v11','neis-static-ovh-v12').replace('neis-pwa-ovh-v11','neis-pwa-ovh-v12'))
if sum(f.is_file() for f in old.rglob('*'))!=sum(f.is_file() for f in tmp.rglob('*')):
 shutil.rmtree(tmp)
 raise SystemExit('PUSH_DEPLOY=BLOCKED_FILE_COUNT')
tmp.rename(new)
print('PUSH_FIX_RELEASE=BUILT')
PY
python3 - <<'PY'
from pathlib import Path
import os
p=Path('docker-compose.frontend-public.yml')
old=os.environ['ORIGINAL_FRONTEND'];new=os.environ['UPDATED_FRONTEND']
text=p.read_text()
if text.count(old)!=1:raise SystemExit('PUSH_DEPLOY=BLOCKED_MOUNT_MISMATCH')
backup=Path('docker-compose.frontend-public.yml.pre-push-fix.bak')
if not backup.exists():backup.write_text(text)
p.write_text(text.replace(old,new))
print('PUSH_CADDY_MOUNT=STAGED')
PY
dc=( -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f "$overlay" )
rollback(){
 cp docker-compose.frontend-public.yml.pre-push-fix.bak "$overlay"
 sudo -n /usr/bin/docker compose "${dc[@]}" up -d --no-deps caddy >/dev/null 2>&1 || true
 echo 'PUSH_DEPLOY=ROLLED_BACK'
}
if ! sudo -n /usr/bin/docker compose "${dc[@]}" config --quiet; then rollback; exit 1; fi
if ! sudo -n /usr/bin/docker compose "${dc[@]}" up -d --no-deps caddy >/dev/null; then rollback; exit 1; fi
id="$(sudo -n /usr/bin/docker compose "${dc[@]}" ps -q caddy)"
if [[ -z "$id" ]] || ! sudo -n /usr/bin/docker exec "$id" grep -q 'pushfix=20261010' /srv/neis-circle/index.html; then
 rollback;exit 1
fi
rm -f "$staged"
echo 'PUSH_FIX_DEPLOY=SUCCESS'
echo 'BACKEND_CONFIG=UNCHANGED'
