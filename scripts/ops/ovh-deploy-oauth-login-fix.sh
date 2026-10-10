#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
docker=(sudo -n /usr/bin/docker)
old=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-pushfix
new=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-authfix
stage=/home/ubuntu/neis-backups/authfix-source-20261010
overlay=docker-compose.frontend-public.yml
test -s "$old/index.html"
test -s "$old/scripts/pwa-install-v117.js"
test -s "$stage/01-core.js"
test -s "$stage/03-auth-i18n.js"
test -f "$overlay"
test -r .env
export AUTHFIX_OLD="$old" AUTHFIX_NEW="$new" AUTHFIX_STAGE="$stage"
python3 - <<'PY'
from pathlib import Path
import os,base64,json,re,shutil
old=Path(os.environ['AUTHFIX_OLD'])
new=Path(os.environ['AUTHFIX_NEW'])
stage=Path(os.environ['AUTHFIX_STAGE'])
if new.exists() or Path(str(new)+'.building').exists():
 raise SystemExit('AUTHFIX=BLOCKED_EXISTING_RELEASE')
anon=''
for line in Path('/home/ubuntu/neis-supabase/.env').read_text().splitlines():
 if line.startswith('ANON_KEY='):
  anon=line.partition('=')[2].strip().strip('"').strip("'")
try:
 p=anon.split('.')
 assert len(p)==3
 claims=json.loads(base64.urlsafe_b64decode(p[1]+'='*(-len(p[1])%4)))
 assert claims.get('role')=='anon'
except Exception:raise SystemExit('AUTHFIX=BLOCKED_INVALID_PUBLIC_KEY')
source=(stage/'01-core.js').read_text()
m=re.search(r'supabaseAnonKey\s*:\s*"([^"]+)"',source)
if not m:raise SystemExit('AUTHFIX=BLOCKED_SOURCE_CONFIG')
source=source.replace('https://ydieijgynqlckaczalju.supabase.co','https://supabase.neiscircle.site').replace(m.group(1),anon)
if 'onAuthStateChange(async' in source or '__NEISOAuthCallbackPending' not in source:
 raise SystemExit('AUTHFIX=BLOCKED_OLD_AUTH_HANDLER')
if 'https://ydieijgynqlckaczalju.supabase.co' in source:
 raise SystemExit('AUTHFIX=BLOCKED_LEGACY_BACKEND')
auth=(stage/'03-auth-i18n.js').read_text()
if 'window.__NEISOAuthCallbackPending' not in auth or 'setTimeout(()=>finish(null),6500)' not in auth:
 raise SystemExit('AUTHFIX=BLOCKED_INCOMPLETE_SESSION_RECOVERY')
old_core=(old/'scripts/01-core.js').read_text()
if 'supabase.neiscircle.site' not in old_core:raise SystemExit('AUTHFIX=BLOCKED_NOT_OVH_RELEASE')
tmp=Path(str(new)+'.building')
shutil.copytree(old,tmp)
(tmp/'scripts/01-core.js').write_text(source)
(tmp/'scripts/03-auth-i18n.js').write_text(auth)
html=(tmp/'index.html').read_text()
for path in ('scripts/01-core.js','scripts/03-auth-i18n.js'):
 if html.count(path)!=1:
  shutil.rmtree(tmp)
  raise SystemExit('AUTHFIX=BLOCKED_SCRIPT_REFERENCE')
 html=html.replace(path,path+'?authfix=20261010')
(tmp/'index.html').write_text(html)
if 'pushWithTimeout(' not in (tmp/'scripts/pwa-install-v117.js').read_text():
 shutil.rmtree(tmp)
 raise SystemExit('AUTHFIX=BLOCKED_PUSH_REGRESSION')
if sum(x.is_file() for x in old.rglob('*'))!=sum(x.is_file() for x in tmp.rglob('*')):
 shutil.rmtree(tmp)
 raise SystemExit('AUTHFIX=BLOCKED_MISSING_ASSETS')
tmp.rename(new)
print('AUTHFIX_RELEASE=BUILT_VALIDATED')
print('AUTHFIX_OAUTH_DEADLOCK=REMOVED')
print('AUTHFIX_PUBLIC_BACKEND=OVH')
PY
python3 - <<'PY'
from pathlib import Path
import os
p=Path('docker-compose.frontend-public.yml')
old=os.environ['AUTHFIX_OLD'];new=os.environ['AUTHFIX_NEW']
content=p.read_text()
if new in content:
 print('AUTHFIX_MOUNT=ALREADY_ACTIVE')
elif content.count(old)!=1:
 raise SystemExit('AUTHFIX_MOUNT=BLOCKED_UNEXPECTED_CURRENT')
else:
 backup=Path('docker-compose.frontend-public.yml.before-authfix.bak')
 if not backup.exists():backup.write_text(content)
 p.write_text(content.replace(old,new))
 print('AUTHFIX_MOUNT=SWITCHED')
PY
dc=(-f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.frontend-public.yml)
rollback(){
 cp docker-compose.frontend-public.yml.before-authfix.bak "$overlay"
 "${docker[@]}" compose "${dc[@]}" up -d --no-deps caddy >/dev/null 2>&1 || true
 echo 'AUTHFIX=ROLLED_BACK'
}
if ! "${docker[@]}" compose "${dc[@]}" config --quiet; then rollback; exit 1; fi
if ! "${docker[@]}" compose "${dc[@]}" up -d --no-deps caddy >/dev/null; then rollback; exit 1; fi
cid="$("${docker[@]}" compose "${dc[@]}" ps -q caddy)"
if [[ -z "$cid" ]] || ! "${docker[@]}" exec "$cid" grep -q 'authfix=20261010' /srv/neis-circle/index.html; then
 rollback;exit 1
fi
echo 'AUTHFIX_DEPLOY=SUCCESS'
echo 'AUTH_DATABASE=UNCHANGED'
