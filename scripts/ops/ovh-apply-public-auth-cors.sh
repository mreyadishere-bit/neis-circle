#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
cd /home/ubuntu/neis-supabase
stage=/home/ubuntu/neis-backups/ovh-public-gotrue-direct-20261010
mounted="$stage/public-auth.Caddyfile"
baseline="$stage/public-auth.before-cors-v3.Caddyfile"
candidate="$stage/public-auth.with-cors-v3.Caddyfile"
test -s "$mounted" && test -s "$stage/original.Caddyfile"
test -f docker-compose.auth-public-direct.yml
grep -Fq "$mounted" docker-compose.auth-public-direct.yml
test ! -e "$baseline" && test ! -e "$candidate"
export CORS_CADDY_MOUNTED="$mounted" CORS_CADDY_CANDIDATE="$candidate"
python3 - <<'PY'
from pathlib import Path
import os,re
current=Path(os.environ['CORS_CADDY_MOUNTED'])
candidate=Path(os.environ['CORS_CADDY_CANDIDATE'])
src=current.read_text()
if src.count('handle_path /auth/v1/*')!=1 or src.count('reverse_proxy auth:9999')!=1 or src.count('basic_auth')!=1:
 raise SystemExit('AUTH_CORS=BLOCKED_UNEXPECTED_CADDY_ROUTES')
if 'neis_auth_preflight' in src:raise SystemExit('AUTH_CORS=BLOCKED_ALREADY_CONFIGURED')
pattern=r'(?m)^([ \t]*)handle_path[ \t]+/auth/v1/\*[ \t]*\{[ \t]*\n[ \t]*reverse_proxy[ \t]+auth:9999[ \t]*\n[ \t]*\}'
matches=list(re.finditer(pattern,src))
if len(matches)!=1:raise SystemExit('AUTH_CORS=BLOCKED_PUBLIC_AUTH_BLOCK_MISMATCH')
match=matches[0]
indent=match.group(1)
nest=indent+'    '
deeper=nest+'    '
route=(indent+'handle_path /auth/v1/* {\n'
  +nest+'@neis_auth_preflight {\n'
  +deeper+'method OPTIONS\n'
  +deeper+'header_regexp Origin ^https://(www\\.)?neiscircle\\.site$\n'
  +nest+'}\n'
  +nest+'handle @neis_auth_preflight {\n'
  +deeper+'header Access-Control-Allow-Origin "{http.request.header.Origin}"\n'
  +deeper+'header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS"\n'
  +deeper+'header Access-Control-Allow-Headers "apikey, authorization, content-type, x-client-info, x-supabase-api-version, accept"\n'
  +deeper+'header Access-Control-Max-Age "3600"\n'
  +deeper+'header Vary "Origin"\n'
  +deeper+'respond "" 204\n'
  +nest+'}\n'
  +nest+'reverse_proxy auth:9999\n'
  +indent+'}')
result=src[:match.start()]+route+src[match.end():]
if result.count('reverse_proxy api-gw:8000')!=src.count('reverse_proxy api-gw:8000') or result.count('basic_auth')!=1:
 raise SystemExit('AUTH_CORS=BLOCKED_UNRELATED_ROUTES_CHANGED')
candidate.write_text(result)
candidate.chmod(0o600)
print('AUTH_CORS=CANDIDATE_BUILT_EXISTING_ROUTES_PRESERVED')
PY
sudo -n /usr/bin/docker cp "$candidate" supabase-caddy:/tmp/neis-auth-cors-candidate-v3-20261011.Caddyfile
sudo -n /usr/bin/docker exec supabase-caddy caddy validate --config /tmp/neis-auth-cors-candidate-v3-20261011.Caddyfile >/dev/null
echo 'AUTH_CORS=CADDY_VALIDATED'
cp -p "$mounted" "$baseline"
deployed=0
rollback(){
 cat "$baseline" > "$mounted"
 sudo -n /usr/bin/docker exec supabase-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
 echo 'AUTH_CORS=ROLLED_BACK'
}
trap 'if [[ "$deployed" != 1 ]]; then rollback; fi' EXIT
cat "$candidate" > "$mounted"
sudo -n /usr/bin/docker exec supabase-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
python3 - <<'PY'
import urllib.request,urllib.error,time
base='https://supabase.neiscircle.site/auth/v1/token?grant_type=pkce'
ok=False
for attempt in range(18):
 headers={
  'Origin':'https://neiscircle.site',
  'Access-Control-Request-Method':'POST',
  'Access-Control-Request-Headers':'apikey,authorization,content-type,x-client-info,x-supabase-api-version'
 }
 req=urllib.request.Request(base,headers=headers,method='OPTIONS')
 try:response=urllib.request.urlopen(req,timeout=6)
 except urllib.error.HTTPError as e:response=e
 except Exception:time.sleep(1);continue
 with response:
  acao=response.headers.get('Access-Control-Allow-Origin','')
  acam=response.headers.get('Access-Control-Allow-Methods','').lower()
  acah=response.headers.get('Access-Control-Allow-Headers','').lower()
  ok=response.status==204 and acao=='https://neiscircle.site' and 'post' in acam and all(h in acah for h in ('apikey','authorization','content-type','x-client-info','x-supabase-api-version'))
  if ok:break
 time.sleep(1)
print('AUTH_CORS=INTERNAL_PREFLIGHT_PASS' if ok else 'AUTH_CORS=INTERNAL_PREFLIGHT_FAILED')
if not ok:raise SystemExit(1)
PY
deployed=1
echo 'AUTH_CORS=OVH_SUCCESS'
echo 'AUTH_CORS=NO_STUDIO_REST_DATABASE_OR_GOOGLE_CONFIG_CHANGES'
