#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
overlay=docker-compose.frontend-public.yml
backup=docker-compose.frontend-public.yml.before-google-pkce.bak
if [[ -s "$backup" ]] && grep -q '/ovh-selfhosted-20261010-google-pkce:' "$overlay";then
 cp "$backup" "$overlay"
 sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f "$overlay" up -d --no-deps caddy >/dev/null
 echo 'PKCE_ROLLBACK=REDEPLOYED_PREVIOUS_RELEASE'
else
 echo 'PKCE_ROLLBACK=NOT_REQUIRED'
fi
