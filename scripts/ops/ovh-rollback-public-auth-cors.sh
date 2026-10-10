#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
stage=/home/ubuntu/neis-backups/ovh-public-gotrue-direct-20261010
mounted="$stage/public-auth.Caddyfile"
baseline="$stage/public-auth.before-cors.Caddyfile"
test -s "$mounted"
if [[ ! -s "$baseline" ]];then
 echo 'AUTH_CORS_ROLLBACK=BASELINE_NOT_CREATED'
 exit 0
fi
test -f docker-compose.auth-public-direct.yml
grep -Fq "$mounted" docker-compose.auth-public-direct.yml
if cmp -s "$mounted" "$baseline";then
 echo 'AUTH_CORS_ROLLBACK=BASELINE_ALREADY_ACTIVE'
 exit 0
fi
cat "$baseline" > "$mounted"
sudo -n /usr/bin/docker exec supabase-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
echo 'AUTH_CORS_ROLLBACK=SUCCESS'
