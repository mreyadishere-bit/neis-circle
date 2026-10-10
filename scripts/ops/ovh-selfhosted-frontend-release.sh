#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
old=/home/ubuntu/neis-frontend/releases/95ea3dc328fe9a156d0aae36347dcf4a084af1ad
new=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-v1
overlay=/home/ubuntu/neis-supabase/docker-compose.frontend-public.yml
test -s "$old/index.html"
test -s "$old/scripts/01-core.js"
test -s "$old/neis-pwa-sw.js"
test -f "$overlay"
test -f .env
export SOURCE_RELEASE="$old" TARGET_RELEASE="$new" FRONTEND_OVERLAY="$overlay"
python3 - <<'PY'
import os,shutil,re,sys,base64,json
from pathlib import Path
source=Path(os.environ['SOURCE_RELEASE'])
target=Path(os.environ['TARGET_RELEASE'])
overlay=Path(os.environ['FRONTEND_OVERLAY'])
cloud="https://ydieijgynqlckaczalju.supabase.co"
selfhost="https://supabase.neiscircle.site"
anon=""
for line in Path('/home/ubuntu/neis-supabase/.env').read_text().splitlines():
 if line.startswith('ANON_KEY='):
  anon=line.partition('=')[2].strip().strip('"').strip("'")
try:
 parts=anon.split('.')
 assert len(parts)==3
 payload=json.loads(base64.urlsafe_b64decode(parts[1]+'='*(-len(parts[1])%4)))
 assert payload.get('role')=='anon'
except Exception:
 raise SystemExit('FRONTEND_SWITCH=BLOCKED_INVALID_OVH_PUBLIC_KEY')
core=(source/'scripts/01-core.js').read_text()
match=re.search(r'supabaseAnonKey\s*:\s*"([^"]+)"',core)
if not match or cloud not in core:raise SystemExit('FRONTEND_SWITCH=BLOCKED_SOURCE_CONFIG_CHANGED')
old_key=match.group(1)
if old_key==anon:raise SystemExit('FRONTEND_SWITCH=BLOCKED_IDENTICAL_PUBLIC_KEY')
old_files=sum(x.is_file() for x in source.rglob('*'))
if old_files<100:raise SystemExit('FRONTEND_SWITCH=BLOCKED_INCOMPLETE_SOURCE')
existing=overlay.read_text()
if str(target) in existing:
 print('FRONTEND_RELEASE=ALREADY_SELECTED')
 sys.exit(0)
if str(source) not in existing:raise SystemExit('FRONTEND_SWITCH=BLOCKED_UNEXPECTED_MOUNT')
if target.exists():raise SystemExit('FRONTEND_SWITCH=BLOCKED_EXISTING_TARGET')
tmp=target.with_name(target.name+'.building')
if tmp.exists():raise SystemExit('FRONTEND_SWITCH=BLOCKED_PREEXISTING_BUILD')
shutil.copytree(source,tmp)
text_ext={'.html','.js','.json','.css','.webmanifest','.xml','.txt'}
hosts=0
keys=0
for file in tmp.rglob('*'):
 if not file.is_file() or file.suffix.lower() not in text_ext:continue
 try:content=file.read_text(encoding='utf-8')
 except UnicodeError:continue
 updated=content.replace(cloud,selfhost).replace(old_key,anon)
 hosts+=content.count(cloud);keys+=content.count(old_key)
 if file.name=='neis-pwa-sw.js':
  updated=updated.replace('neis-static-v10','neis-static-ovh-v11').replace('neis-pwa-v10','neis-pwa-ovh-v11')
 if file.name=='pwa-sw.js':updated=updated.replace('neis-pwa-v5','neis-pwa-ovh-v6')
 if updated!=content:file.write_text(updated,encoding='utf-8')
if hosts<2 or keys<1:
 shutil.rmtree(tmp)
 raise SystemExit('FRONTEND_SWITCH=BLOCKED_REPLACEMENT_COUNTS')
new_core=(tmp/'scripts/01-core.js').read_text()
if cloud in new_core or old_key in new_core or selfhost not in new_core or anon not in new_core:
 shutil.rmtree(tmp)
 raise SystemExit('FRONTEND_SWITCH=BLOCKED_CONFIG_PARITY')
if "We'll be back soon" in (tmp/'index.html').read_text() or 'scripts/01-core.js' not in (tmp/'index.html').read_text():
 shutil.rmtree(tmp)
 raise SystemExit('FRONTEND_SWITCH=BLOCKED_MAINTENANCE_SHELL')
if sum(x.is_file() for x in tmp.rglob('*'))!=old_files:
 shutil.rmtree(tmp)
 raise SystemExit('FRONTEND_SWITCH=BLOCKED_FILE_COUNT')
tmp.rename(target)
print('FRONTEND_APP_FILES='+str(old_files))
print('FRONTEND_CLOUD_URL_REPLACEMENTS='+str(hosts))
print('FRONTEND_PUBLIC_ANON_REPLACEMENTS='+str(keys))
print('FRONTEND_RELEASE=BUILT_VALIDATED')
PY
python3 - <<'PY'
from pathlib import Path
import os
p=Path(os.environ['FRONTEND_OVERLAY'])
old=os.environ['SOURCE_RELEASE']
new=os.environ['TARGET_RELEASE']
content=p.read_text()
if new in content:
 print('FRONTEND_CADDY_MOUNT=ALREADY_NEW')
elif content.count(old)==1:
 backup=p.with_name(p.name+'.before-ovh-backend-cutover')
 if not backup.exists():backup.write_text(content)
 p.write_text(content.replace(old,new))
 print('FRONTEND_CADDY_MOUNT=SWITCHED')
else:raise SystemExit('FRONTEND_CADDY_MOUNT=BLOCKED_UNEXPECTED_STATE')
PY
if ! sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.frontend-public.yml config --quiet; then
 cp docker-compose.frontend-public.yml.before-ovh-backend-cutover "$overlay"
 echo 'FRONTEND_CADDY_MOUNT=ROLLED_BACK_INVALID_CONFIG'
 exit 1
fi
if ! sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.frontend-public.yml up -d --no-deps caddy >/dev/null; then
 cp docker-compose.frontend-public.yml.before-ovh-backend-cutover "$overlay"
 sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.frontend-public.yml up -d --no-deps caddy >/dev/null || true
 echo 'FRONTEND_CADDY_MOUNT=ROLLED_BACK_DEPLOY_FAILED'
 exit 1
fi
cid="$(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.frontend-public.yml ps -q caddy)"
test -n "$cid"
if ! sudo -n /usr/bin/docker exec "$cid" sh -c "test -s /srv/neis-circle/scripts/01-core.js && grep -q 'https://supabase.neiscircle.site' /srv/neis-circle/scripts/01-core.js"; then
 cp docker-compose.frontend-public.yml.before-ovh-backend-cutover "$overlay"
 sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.frontend-public.yml up -d --no-deps caddy >/dev/null || true
 echo 'FRONTEND_SWITCH=ROLLED_BACK_MOUNT_CHECK'
 exit 1
fi
echo 'FRONTEND_SWITCH=OVH_BACKEND_ACTIVE'
echo 'CADDY_FRONTEND=RELOADED'
echo 'PRODUCTION_DATABASE=UNCHANGED'
