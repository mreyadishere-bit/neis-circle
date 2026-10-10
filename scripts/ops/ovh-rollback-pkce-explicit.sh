#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
overlay=docker-compose.frontend-public.yml
backup=docker-compose.frontend-public.yml.before-pkce-explicit.bak
old=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-google-pkce
new=/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-pkce-explicit
test -s "$overlay"
if ! grep -Fq "$new" "$overlay";then
 echo 'EXPLICIT_PKCE_ROLLBACK=NO_NEW_MOUNT'
 exit 0
fi
test -s "$backup" && grep -Fq "$old" "$backup"
cp -p "$backup" "$overlay"
sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f "$overlay" config --quiet
sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f "$overlay" up -d --no-deps caddy >/dev/null
echo 'EXPLICIT_PKCE_ROLLBACK=SUCCESS'
