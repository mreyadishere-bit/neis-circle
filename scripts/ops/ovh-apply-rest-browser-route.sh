#!/usr/bin/env bash
# Fix browser-only 401 on public REST without modifying any Supabase data.
set -Eeuo pipefail
set +x
umask 077
cd /home/ubuntu/neis-supabase
stage=/home/ubuntu/neis-backups/ovh-public-gotrue-direct-20261010
mounted="$stage/public-auth.Caddyfile"
backup="$stage/public-auth.before-rest-direct-20261011.Caddyfile"
candidate="$stage/public-auth.rest-direct-20261011.Caddyfile"
test -s "$mounted" && test -f docker-compose.auth-public-direct.yml
grep -Fq "$mounted" docker-compose.auth-public-direct.yml
test ! -e "$backup" && test ! -e "$candidate"
# Restrict the change to the exact running Caddyfile; do not recreate services or containers.
sudo -n /usr/bin/docker exec supabase-caddy grep -q 'handle_path /auth/v1/\*' /etc/caddy/Caddyfile
rest_probe="$(sudo -n /usr/bin/docker exec supabase-caddy wget -S -O /dev/null -T 7 http://rest:3000/ 2>&1 || true)"
if [[ "$rest_probe" != *"HTTP/"* ]];then
 echo 'DIRECT_REST=BLOCKED_UPSTREAM_UNREACHABLE'
 exit 1
fi
echo 'DIRECT_REST=PRIVATE_UPSTREAM_HTTP_REACHABLE'
export NEIS_REST_CADDY_SOURCE="$mounted" NEIS_REST_CADDY_TARGET="$candidate"
python3 - <<'PY'
from pathlib import Path
import os,re
src=Path(os.environ['NEIS_REST_CADDY_SOURCE']).read_text()
if src.count('basic_auth')!=1 or src.count('reverse_proxy auth:9999')!=1 or src.count('reverse_proxy api-gw:8000')!=1 or src.count('handle_path /auth/v1/*')!=1:
 raise SystemExit('DIRECT_REST=BLOCKED_UNEXPECTED_EXISTING_PROTECTION')
if 'neis_rest_preflight' in src or 'reverse_proxy rest:3000' in src:
 raise SystemExit('DIRECT_REST=BLOCKED_ALREADY_PRESENT')
pattern=r'(?m)^([ \t]*)@supabase_api[ \t]+path[ \t]+([^\r\n]+)$'
items=list(re.finditer(pattern,src))
if len(items)!=1:raise SystemExit('DIRECT_REST=BLOCKED_MATCHER_COUNT')
match=items[0]
paths=match.group(2).split()
if paths.count('/rest/v1/*')!=1:raise SystemExit('DIRECT_REST=BLOCKED_REST_MATCHER_ABSENT')
others=[p for p in paths if p!='/rest/v1/*']
if not others or any(not p.startswith('/') for p in others):
 raise SystemExit('DIRECT_REST=BLOCKED_UNEXPECTED_OTHER_ROUTES')
indent=match.group(1);nest=indent+'    ';inner=nest+'    '
origin_pattern=r'^https://(www\.)?neiscircle\.site$'
preflight=(indent+'handle_path /rest/v1/* {\n'
 +nest+'@neis_rest_origin header_regexp Origin '+origin_pattern+'\n'
 +nest+'@neis_rest_preflight {\n'
 +inner+'method OPTIONS\n'
 +inner+'header_regexp Origin '+origin_pattern+'\n'
 +nest+'}\n'
 +nest+'header @neis_rest_origin Access-Control-Allow-Origin "{http.request.header.Origin}"\n'
 +nest+'header @neis_rest_origin Access-Control-Allow-Methods "GET, POST, PATCH, PUT, DELETE, OPTIONS"\n'
 +nest+'header @neis_rest_origin Access-Control-Allow-Headers "apikey, authorization, content-type, x-client-info, x-supabase-api-version, prefer, accept, accept-profile, content-profile, range"\n'
 +nest+'header @neis_rest_origin Access-Control-Expose-Headers "Content-Range, Range-Unit"\n'
 +nest+'header @neis_rest_origin Vary "Origin"\n'
 +nest+'handle @neis_rest_preflight {\n'
 +inner+'respond "" 204\n'
 +nest+'}\n'
 +nest+'reverse_proxy rest:3000\n'
 +indent+'}')
replacement=indent+'@supabase_api path '+' '.join(others)+'\n'+preflight
updated=src[:match.start()]+replacement+src[match.end():]
for check in ('basic_auth','reverse_proxy auth:9999','reverse_proxy api-gw:8000','handle_path /auth/v1/*'):
 if updated.count(check)!=src.count(check):raise SystemExit('DIRECT_REST=BLOCKED_UNRELATED_ROUTE_CHANGED')
if updated.count('reverse_proxy rest:3000')!=1 or updated.count('neis_rest_preflight')!=2:
 raise SystemExit('DIRECT_REST=BLOCKED_EXPECTED_ROUTE_MISSING')
path=Path(os.environ['NEIS_REST_CADDY_TARGET'])
path.write_text(updated)
path.chmod(0o600)
print('DIRECT_REST=CANDIDATE_STAGED_PROTECTED_ROUTES_PRESERVED')
PY
sudo -n /usr/bin/docker cp "$candidate" supabase-caddy:/tmp/neis-rest-direct-candidate-20261011.Caddyfile
sudo -n /usr/bin/docker exec supabase-caddy caddy validate --config /tmp/neis-rest-direct-candidate-20261011.Caddyfile >/dev/null
echo 'DIRECT_REST=CADDY_VALIDATE_PASS'
cp -p "$mounted" "$backup"
deployed=0
rollback(){
 cat "$backup" > "$mounted"
 sudo -n /usr/bin/docker exec supabase-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
 echo 'DIRECT_REST=ROLLED_BACK'
}
trap 'if [[ "${deployed}" != 1 ]];then rollback;fi' EXIT
# Update same inode as bind mount; do not touch Compose or data.
cat "$candidate" > "$mounted"
sudo -n /usr/bin/docker exec supabase-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
python3 - <<'PY'
import urllib.request,urllib.error,time
base='https://supabase.neiscircle.site/rest/v1/posts?select=id&limit=1'
ok=False
for i in range(15):
 h={'Origin':'https://neiscircle.site','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'apikey,authorization,x-client-info,prefer'}
 req=urllib.request.Request(base,headers=h,method='OPTIONS')
 try:r=urllib.request.urlopen(req,timeout=7)
 except urllib.error.HTTPError as e:r=e
 except Exception:
  time.sleep(1);continue
 with r:
  acao=r.headers.get('Access-Control-Allow-Origin','')
  acah=r.headers.get('Access-Control-Allow-Headers','').lower()
  ok=r.status==204 and acao=='https://neiscircle.site' and all(x in acah for x in ('apikey','authorization','x-client-info'))
  if ok:break
 time.sleep(1)
print('DIRECT_REST=SERVER_PREFLIGHT_PASS' if ok else 'DIRECT_REST=SERVER_PREFLIGHT_FAILED')
if not ok:raise SystemExit(1)
PY
deployed=1
echo 'DIRECT_REST=LIVE_DEPLOY_SUCCESS_NO_DB_CHANGES'
