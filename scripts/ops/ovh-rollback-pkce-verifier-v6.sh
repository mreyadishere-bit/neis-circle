#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
overlay=docker-compose.frontend-public.yml
backup=docker-compose.frontend-public.yml.before-pkce-verifier-v6
latest=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-pkce-verifier-v6
previous=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-pkce-explicit
test -f "$overlay" && test -s "$backup"
if ! grep -Fq "$latest" "$overlay";then
 echo 'PKCE_VERIFIER_ROLLBACK=NO_LATEST_MOUNT'
 exit 0
fi
grep -Fq "$previous" "$backup"
cp -p "$backup" "$overlay"
sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f "$overlay" config --quiet
sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f "$overlay" up -d --no-deps caddy >/dev/null
echo 'PKCE_VERIFIER_ROLLBACK=SUCCESS'
