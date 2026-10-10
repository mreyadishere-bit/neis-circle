#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
docker=(sudo -n /usr/bin/docker)
old=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-oauth-singleowner
new=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-google-pkce
stage=/home/ubuntu/neis-backups/ovh-google-pkce-20261010
overlay=docker-compose.frontend-public.yml
backup=docker-compose.frontend-public.yml.before-google-pkce.bak
test -s "$old/index.html" && test -s "$old/scripts/01-core.js"
test -s "$stage/01-core.js" && test -f "$overlay" && test -r .env
export PKCE_OLD="$old" PKCE_NEW="$new" PKCE_STAGE="$stage"
python3 - <<'PY'
from pathlib import Path
import os,re,shutil,json,base64
old=Path(os.environ['PKCE_OLD'])
new=Path(os.environ['PKCE_NEW'])
stage=Path(os.environ['PKCE_STAGE'])
anon=''
for line in Path('/home/ubuntu/neis-supabase/.env').read_text().splitlines():
 if line.startswith('ANON_KEY='):anon=line.partition('=')[2].strip().strip('"').strip("'")
try:
 jwt=anon.split('.')
 assert len(jwt)==3
 payload=json.loads(base64.urlsafe_b64decode(jwt[1]+'='*(-len(jwt[1])%4)))
 assert payload.get('role')=='anon'
except Exception:raise SystemExit('PKCE_DEPLOY=BLOCKED_PUBLIC_ANON_KEY_INVALID')
source=(stage/'01-core.js').read_text()
m=re.search(r'supabaseAnonKey\s*:\s*"([^"]+)"',source)
if not m:raise SystemExit('PKCE_DEPLOY=BLOCKED_SOURCE_KEY_MISSING')
source=source.replace('https://ydieijgynqlckaczalju.supabase.co','https://supabase.neiscircle.site').replace(m.group(1),anon)
if "flowType:'pkce'" not in source or "detectSessionInUrl:!neisOAuthCallbackTokens" not in source:
 raise SystemExit('PKCE_DEPLOY=BLOCKED_PKCE_FLOW_MISSING')
if 'ydieijgynqlckaczalju.supabase.co' in source:
 raise SystemExit('PKCE_DEPLOY=BLOCKED_LEGACY_HOST')
if new.exists() or Path(str(new)+'.building').exists():
 raise SystemExit('PKCE_DEPLOY=BLOCKED_EXISTING_RELEASE')
if 'supabase.neiscircle.site' not in (old/'scripts/01-core.js').read_text():
 raise SystemExit('PKCE_DEPLOY=BLOCKED_OLD_NOT_SELFHOSTED')
t=Path(str(new)+'.building')
shutil.copytree(old,t)
(t/'scripts/01-core.js').write_text(source)
html=(t/'index.html').read_text()
existing='scripts/01-core.js?oauthsingle=20261010v3'
if html.count(existing)!=1:
 shutil.rmtree(t)
 raise SystemExit('PKCE_DEPLOY=BLOCKED_HTML_CONFIG_UNEXPECTED')
html=html.replace(existing,'scripts/01-core.js?auth=pkce-20261010v4')
(t/'index.html').write_text(html)
worker=t/'neis-pwa-sw.js'
if worker.exists():
 sw=worker.read_text().replace('neis-static-ovh-v12','neis-static-ovh-v13').replace('neis-pwa-ovh-v12','neis-pwa-ovh-v13')
 worker.write_text(sw)
if sum(p.is_file() for p in old.rglob('*'))!=sum(p.is_file() for p in t.rglob('*')):
 shutil.rmtree(t)
 raise SystemExit('PKCE_DEPLOY=BLOCKED_INCOMPLETE_RELEASE')
if 'pushWithTimeout(' not in (t/'scripts/pwa-install-v117.js').read_text():
 shutil.rmtree(t)
 raise SystemExit('PKCE_DEPLOY=BLOCKED_PUSH_FIX_MISSING')
t.rename(new)
print('PKCE_RELEASE=BUILT_VALIDATED')
PY
python3 - <<'PY'
from pathlib import Path
import os
p=Path('docker-compose.frontend-public.yml')
old=os.environ['PKCE_OLD'];new=os.environ['PKCE_NEW']
data=p.read_text()
if data.count(old)!=1:raise SystemExit('PKCE_DEPLOY=BLOCKED_CURRENT_RELEASE_MISMATCH')
b=Path('docker-compose.frontend-public.yml.before-google-pkce.bak')
if not b.exists():b.write_text(data)
p.write_text(data.replace(old,new))
print('PKCE_CADDY_MOUNT=STAGED')
PY
dc=(-f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f "$overlay")
rollback(){
 cp "$backup" "$overlay"
 "${docker[@]}" compose "${dc[@]}" up -d --no-deps caddy >/dev/null 2>&1 || true
 echo 'PKCE_DEPLOY=ROLLED_BACK'
}
if ! "${docker[@]}" compose "${dc[@]}" config --quiet;then rollback;exit 1;fi
if ! "${docker[@]}" compose "${dc[@]}" up -d --no-deps caddy >/dev/null;then rollback;exit 1;fi
id="$("${docker[@]}" compose "${dc[@]}" ps -q caddy)"
if [[ -z "$id" ]] || ! "${docker[@]}" exec "$id" grep -q 'auth=pkce-20261010v4' /srv/neis-circle/index.html;then
 rollback;exit 1
fi
echo 'PKCE_DEPLOY=SUCCESS'
echo 'PRODUCTION_AUTH_DATABASE=UNCHANGED'
echo 'GOOGLE_SIGNIN_PROVIDER=UNCHANGED'
