#!/usr/bin/env bash
# Roll back only the auth direct-route overlay, retaining all existing services.
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
overlay=docker-compose.auth-public-direct.yml
stage=/home/ubuntu/neis-backups/ovh-public-gotrue-direct-20261010
test -s "$stage/original.Caddyfile"
test -f docker-compose.frontend-public.yml
if [[ ! -f "$overlay" ]];then
 echo 'DIRECT_AUTH_ROLLBACK=OVERLAY_ABSENT'
 exit 0
fi
grep -q 'ovh-public-gotrue-direct-20261010/public-auth.Caddyfile' "$overlay"
rm -f "$overlay"
sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.frontend-public.yml config --quiet
sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.frontend-public.yml up -d --no-deps caddy >/dev/null
echo 'DIRECT_AUTH_ROLLBACK=SUCCESS'
