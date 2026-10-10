#!/usr/bin/env bash
# Restore public Auth OAuth by routing /auth/v1/* to the existing healthy GoTrue.
# Immutable Caddyfile overlay; no DB, Google credentials, REST or Studio changes.
set -Eeuo pipefail
umask 077
cd /home/ubuntu/neis-supabase
docker=(sudo -n /usr/bin/docker)
dc=(-f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.frontend-public.yml)
compose(){ "${docker[@]}" compose "${dc[@]}" "$@"; }
stage=/home/ubuntu/neis-backups/ovh-public-gotrue-direct-20261010
overlay=docker-compose.auth-public-direct.yml
old="$stage/original.Caddyfile"
new="$stage/public-auth.Caddyfile"
mkdir -p -m 700 "$stage"
test ! -e "$overlay" && test ! -e "$new"
test -s docker-compose.frontend-public.yml
compose config --quiet
if [[ -e "$old" ]];then
  "${docker[@]}" exec supabase-caddy cat /etc/caddy/Caddyfile | cmp -s - "$old" || { echo 'DIRECT_AUTH=BLOCKED_EXISTING_BACKUP_MISMATCH';exit 1; }
else
  "${docker[@]}" exec supabase-caddy cat /etc/caddy/Caddyfile > "$old"
fi
test -s "$old"
export AUTH_DIRECT_CADDY_ORIGINAL="$old" AUTH_DIRECT_CADDY_UPDATED="$new"
python3 - <<'PY'
from pathlib import Path
import os,re
old=Path(os.environ['AUTH_DIRECT_CADDY_ORIGINAL'])
new=Path(os.environ['AUTH_DIRECT_CADDY_UPDATED'])
source=old.read_text()
pattern=r'(?m)^([ \t]*)@supabase_api[ \t]+path[ \t]+([^\r\n]+)$'
matches=list(re.finditer(pattern,source))
if len(matches)!=1:raise SystemExit('DIRECT_AUTH=BLOCKED_UNEXPECTED_CADDY_API_RULE')
original_paths=matches[0].group(2).split()
if '/auth/v1/*' not in original_paths or len(original_paths)<2:
 raise SystemExit('DIRECT_AUTH=BLOCKED_PUBLIC_AUTH_PATH_MISSING')
other_paths=[value for value in original_paths if value!='/auth/v1/*']
if not all(value.startswith('/') for value in other_paths):
 raise SystemExit('DIRECT_AUTH=BLOCKED_UNEXPECTED_API_MATCHER_SYNTAX')
if source.count('reverse_proxy api-gw:8000')!=1 or source.count('basic_auth')!=1:
 raise SystemExit('DIRECT_AUTH=BLOCKED_UNEXPECTED_PROXY_OR_STUDIO_GUARD')
if 'handle_path /auth/v1/*' in source or 'reverse_proxy auth:9999' in source:
 raise SystemExit('DIRECT_AUTH=BLOCKED_RULE_ALREADY_PRESENT')
indent=matches[0].group(1)
replacement=(indent+'@supabase_api path '+' '.join(other_paths)+'\n'+
             indent+'handle_path /auth/v1/* {\n'+
             indent+'    reverse_proxy auth:9999\n'+
             indent+'}')
updated=source[:matches[0].start()]+replacement+source[matches[0].end():]
assert updated.count('basic_auth')==1
assert updated.count('reverse_proxy api-gw:8000')==1
assert updated.count('handle_path /auth/v1/*')==1
assert all(value in updated for value in other_paths)
new.write_text(updated)
new.chmod(0o600)
print('DIRECT_AUTH=CANDIDATE_STAGED_GOOGLE_PROVIDER_UNCHANGED')
PY
"${docker[@]}" cp "$new" supabase-caddy:/tmp/neis-public-auth-direct-20261010.Caddyfile
"${docker[@]}" exec supabase-caddy caddy validate --config /tmp/neis-public-auth-direct-20261010.Caddyfile >/dev/null
echo 'DIRECT_AUTH=CADDY_VALIDATE_PASS'
# Mount the Caddyfile only, preserving the existing deployed app assets and Studio.
cat > "$overlay" <<YAML
services:
  caddy:
    volumes:
      - "$new:/etc/caddy/Caddyfile:ro"
YAML
rollback(){
 rm -f "$overlay"
 compose up -d --no-deps caddy >/dev/null 2>&1 || true
 echo 'DIRECT_AUTH=ROLLED_BACK'
}
trap 'if [[ "${deployed:-0}" != 1 ]];then rollback;fi' EXIT
compose config --quiet
compose -h >/dev/null
compose up -d --no-deps caddy >/dev/null
container="$(compose ps -q caddy)"
test -n "$container"
"${docker[@]}" exec "$container" grep -q 'reverse_proxy auth:9999' /etc/caddy/Caddyfile
"${docker[@]}" exec "$container" grep -q 'basic_auth' /etc/caddy/Caddyfile
echo 'DIRECT_AUTH=PUBLIC_AUTH_ROUTE_MOUNTED'
# No user account/token used for these checks. Validate only the read-only settings.
python3 - <<'PY'
import urllib.request,urllib.error,time
url='https://supabase.neiscircle.site/auth/v1/settings'
ready=False
for attempt in range(25):
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'Origin':'https://neiscircle.site','User-Agent':'NEIS-DirectAuth-Deploy-Health'}),timeout=5) as response:
   ready=response.status==200 and 'application/json' in response.headers.get('Content-Type','')
   if ready:break
 except Exception:pass
 time.sleep(1)
print('DIRECT_AUTH=INTERNAL_PUBLIC_SETTINGS_READY' if ready else 'DIRECT_AUTH=INTERNAL_PUBLIC_SETTINGS_FAILED')
if not ready:raise SystemExit(1)
PY
deployed=1
echo 'DIRECT_AUTH=OVH_DEPLOY_SUCCESS'
echo 'DIRECT_AUTH=DATABASE_STUDIO_REST_AND_GOOGLE_SETTINGS_UNCHANGED'
