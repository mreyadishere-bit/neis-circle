#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
base=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-pkce-explicit
next=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-pkce-verifier-v6
stage=/home/ubuntu/neis-backups/ovh-pkce-verifier-20261010
overlay=docker-compose.frontend-public.yml
backup=docker-compose.frontend-public.yml.before-pkce-verifier-v6
test -s "$base/index.html" && test -s "$base/scripts/01-core.js"
test -s "$stage/01-core.js" && test -s "$stage/identity-v15.js"
test -f "$overlay" && test ! -e "$next" && test ! -e "$next.building"
test ! -e "$backup"
export NEIS_RELEASE_BASE="$base" NEIS_RELEASE_NEXT="$next" NEIS_STAGE="$stage"
python3 - <<'PY'
from pathlib import Path
import os,re,shutil
base=Path(os.environ['NEIS_RELEASE_BASE'])
next=Path(os.environ['NEIS_RELEASE_NEXT'])
stage=Path(os.environ['NEIS_STAGE'])
oldcore=(base/'scripts/01-core.js').read_text()
core=(stage/'01-core.js').read_text()
pat=r'supabaseAnonKey\s*:\s*"([^"]+)"'
original=re.search(pat,oldcore)
candidate=re.search(pat,core)
if not original or not candidate:raise SystemExit('VERIFIER_RELEASE=BLOCKED_PUBLIC_CONFIG')
core=core.replace(candidate.group(1),original.group(1)).replace('https://ydieijgynqlckaczalju.supabase.co','https://supabase.neiscircle.site')
if any(marker not in core for marker in ('flowType:\'pkce\'','skipBrowserRedirect:true','verifier_not_saved','verifier_missing')):
 raise SystemExit('VERIFIER_RELEASE=BLOCKED_SOURCE')
temp=Path(str(next)+'.building')
shutil.copytree(base,temp)
(temp/'scripts/01-core.js').write_text(core)
(temp/'scripts/identity-v15.js').write_text((stage/'identity-v15.js').read_text())
html=(temp/'index.html').read_text()
old1='scripts/01-core.js?auth=pkce-explicit-20261010v5'
old2='scripts/identity-v15.js?auth=pkce-explicit-20261010v5'
if html.count(old1)!=1 or html.count(old2)!=1:
 shutil.rmtree(temp)
 raise SystemExit('VERIFIER_RELEASE=BLOCKED_HTML_ASSETS')
html=html.replace(old1,'scripts/01-core.js?auth=pkce-verifier-20261010v6')
html=html.replace(old2,'scripts/identity-v15.js?auth=pkce-verifier-20261010v6')
(temp/'index.html').write_text(html)
worker=temp/'neis-pwa-sw.js'
if worker.exists():
 worker.write_text(worker.read_text().replace('neis-static-ovh-v14','neis-static-ovh-v15').replace('neis-pwa-ovh-v14','neis-pwa-ovh-v15'))
if sum(p.is_file() for p in temp.rglob('*'))!=sum(p.is_file() for p in base.rglob('*')):
 shutil.rmtree(temp)
 raise SystemExit('VERIFIER_RELEASE=BLOCKED_FILE_COUNT')
temp.rename(next)
print('VERIFIER_RELEASE=BUILT')
PY
cp -p "$overlay" "$backup"
python3 - <<'PY'
from pathlib import Path
import os
p=Path('docker-compose.frontend-public.yml')
old=os.environ['NEIS_RELEASE_BASE']
new=os.environ['NEIS_RELEASE_NEXT']
content=p.read_text()
if content.count(old)!=1:raise SystemExit('VERIFIER_RELEASE=BLOCKED_MOUNT')
p.write_text(content.replace(old,new))
PY
dc=(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f "$overlay")
rollback(){
 cp -p "$backup" "$overlay"
 "${dc[@]}" up -d --no-deps caddy >/dev/null 2>&1 || true
 echo 'VERIFIER_RELEASE=ROLLED_BACK'
}
if ! "${dc[@]}" config --quiet;then rollback;exit 1;fi
if ! "${dc[@]}" up -d --no-deps caddy >/dev/null;then rollback;exit 1;fi
cid=$("${dc[@]}" ps -q caddy)
if [[ -z "$cid" ]] || ! sudo -n /usr/bin/docker exec "$cid" grep -q 'pkce-verifier-20261010v6' /srv/neis-circle/index.html;then
 rollback;exit 1
fi
echo 'VERIFIER_RELEASE=SUCCESS'
echo 'GOOGLE_PROVIDER_AND_DATABASE=UNCHANGED'
