#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
docker=(sudo -n /usr/bin/docker)
old=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-oauth-recovery
new=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-oauth-singleowner
staged=/home/ubuntu/neis-backups/oauth-singleowner-20261010
overlay=docker-compose.frontend-public.yml
test -s "$old/index.html"
test -s "$old/scripts/01-core.js"
test -s "$staged/01-core.js"
test -s "$staged/03-auth-i18n.js"
test -r .env
test -f "$overlay"
export PREVIOUS_RELEASE="$old" NEXT_RELEASE="$new" OAUTH_STAGE="$staged"
python3 - <<'PY'
from pathlib import Path
import os,re,shutil,base64,json
old=Path(os.environ['PREVIOUS_RELEASE'])
new=Path(os.environ['NEXT_RELEASE'])
stage=Path(os.environ['OAUTH_STAGE'])
anon=''
for line in Path('/home/ubuntu/neis-supabase/.env').read_text().splitlines():
 if line.startswith('ANON_KEY='):
  anon=line.partition('=')[2].strip().strip('"').strip("'")
try:
 jwt=anon.split('.')
 assert len(jwt)==3
 data=json.loads(base64.urlsafe_b64decode(jwt[1]+'='*(-len(jwt[1])%4)))
 assert data.get('role')=='anon'
except Exception:raise SystemExit('OAUTH_RECOVERY=BLOCKED_PUBLIC_CONFIG')
core=(stage/'01-core.js').read_text()
old_token=re.search(r'supabaseAnonKey\s*:\s*"([^"]+)"',core)
if not old_token:raise SystemExit('OAUTH_RECOVERY=BLOCKED_MISSING_CONFIG')
core=core.replace('https://ydieijgynqlckaczalju.supabase.co','https://supabase.neiscircle.site').replace(old_token.group(1),anon)
if 'const neisOAuthCallbackTokens=' not in core or 'await neisRecoverImplicitOAuth(sb)' not in core or 'detectSessionInUrl:!neisOAuthCallbackTokens' not in core:
 raise SystemExit('OAUTH_RECOVERY=BLOCKED_MISSING_FALLBACK')
if 'ydieijgynqlckaczalju.supabase.co' in core or old_token.group(1) in core:
 raise SystemExit('OAUTH_RECOVERY=BLOCKED_LEGACY_BACKEND')
auth=(stage/'03-auth-i18n.js').read_text()
if '__NEISOAuthRecoveryFailed' not in auth or 'setTimeout(()=>finish(null),6500)' not in auth:
 raise SystemExit('OAUTH_RECOVERY=BLOCKED_MISSING_UI_RECOVERY')
if new.exists() or Path(str(new)+'.building').exists():
 raise SystemExit('OAUTH_RECOVERY=BLOCKED_TARGET_EXISTS')
if 'https://supabase.neiscircle.site' not in (old/'scripts/01-core.js').read_text():
 raise SystemExit('OAUTH_RECOVERY=BLOCKED_OLD_RELEASE_NOT_OVH')
temp=Path(str(new)+'.building')
shutil.copytree(old,temp)
(temp/'scripts/01-core.js').write_text(core)
(temp/'scripts/03-auth-i18n.js').write_text(auth)
html=(temp/'index.html').read_text()
for path in ('scripts/01-core.js','scripts/03-auth-i18n.js'):
 old_src=path+'?oauthrecover=20261010v2'
 if html.count(old_src)!=1:
  shutil.rmtree(temp)
  raise SystemExit('OAUTH_RECOVERY=BLOCKED_HTML_SCRIPT_REFERENCE')
 html=html.replace(old_src,path+'?oauthsingle=20261010v3')
(temp/'index.html').write_text(html)
if 'pushWithTimeout(' not in (temp/'scripts/pwa-install-v117.js').read_text():
 shutil.rmtree(temp)
 raise SystemExit('OAUTH_RECOVERY=BLOCKED_PUSH_REGRESSION')
if sum(f.is_file() for f in old.rglob('*'))!=sum(f.is_file() for f in temp.rglob('*')):
 shutil.rmtree(temp)
 raise SystemExit('OAUTH_RECOVERY=BLOCKED_ASSET_COUNT')
temp.rename(new)
print('OAUTH_RECOVERY_RELEASE=BUILT')
PY
python3 - <<'PY'
from pathlib import Path
import os
p=Path('docker-compose.frontend-public.yml')
old=os.environ['PREVIOUS_RELEASE'];new=os.environ['NEXT_RELEASE']
body=p.read_text()
if body.count(old)!=1:raise SystemExit('OAUTH_RECOVERY=BLOCKED_CURRENT_MOUNT')
backup=Path('docker-compose.frontend-public.yml.before-oauth-singleowner.bak')
if not backup.exists():backup.write_text(body)
p.write_text(body.replace(old,new))
print('OAUTH_RECOVERY_MOUNT=STAGED')
PY
dc=(-f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.frontend-public.yml)
rollback(){
 cp docker-compose.frontend-public.yml.before-oauth-singleowner.bak "$overlay"
 "${docker[@]}" compose "${dc[@]}" up -d --no-deps caddy >/dev/null 2>&1 || true
 echo 'OAUTH_RECOVERY=ROLLED_BACK'
}
if ! "${docker[@]}" compose "${dc[@]}" config --quiet; then rollback; exit 1; fi
if ! "${docker[@]}" compose "${dc[@]}" up -d --no-deps caddy >/dev/null; then rollback; exit 1; fi
id="$("${docker[@]}" compose "${dc[@]}" ps -q caddy)"
if [[ -z "$id" ]] || ! "${docker[@]}" exec "$id" grep -q 'oauthsingle=20261010v3' /srv/neis-circle/index.html; then
 rollback;exit 1
fi
echo 'OAUTH_RECOVERY_DEPLOY=SUCCESS'
echo 'AUTH_DATABASE=UNCHANGED'
echo 'PUBLIC_AUTH_CONFIG=OVH'
