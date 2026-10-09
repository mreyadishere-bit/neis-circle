#!/usr/bin/env bash
# Read-only OVH runtime readiness inventory. NEVER print secret contents.
set -Eeuo pipefail
ROOT=/home/ubuntu/neis-supabase
cd "$ROOT"
for name in docker-compose.yml docker-compose.security.yml docker-compose.caddy.yml; do test -r "$name" || exit 1; done
test -r .env || exit 1
echo '=== Supabase Docker container health ==='
sudo -n docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml ps --format 'table {{.Name}}\t{{.Status}}' </dev/null
echo '=== Required credential variable names (values are NEVER shown) ==='
python3 - <<'PY'
from pathlib import Path
import re
keys=set()
for line in Path('.env').open():
    m=re.match(r'^([A-Z][A-Z0-9_]*)=',line)
    if m: keys.add(m.group(1))
required=['POSTGRES_PASSWORD','JWT_SECRET','ANON_KEY','SERVICE_ROLE_KEY','SITE_URL']
for name in required:
    print('ENV_'+name+'='+('PRESENT' if name in keys else 'NOT_FOUND'))
print('ENV_NAMES_ONLY_CHECK=COMPLETE')
PY
echo '=== HTTPS health status (no credentials) ==='
for url in 'https://supabase.neiscircle.site/auth/v1/health' 'https://supabase.neiscircle.site/rest/v1/'; do
  status="$(curl --silent --show-error --output /dev/null --max-time 12 --write-out '%{http_code}' "$url")" || status='NETWORK_ERROR'
  # non-200 is not necessarily a failure: REST can demand API keys.
  case "$url" in
    *auth*) echo "AUTH_PUBLIC_HEALTH_HTTP=$status";;
    *rest*) echo "REST_PUBLIC_STATUS_HTTP=$status";;
  esac
done
echo 'RUNTIME_AUDIT=COMPLETE_NO_SERVICE_CHANGES'
