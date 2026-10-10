#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
stage=/home/ubuntu/neis-backups/ovh-public-gotrue-direct-20261010
mounted="$stage/public-auth.Caddyfile"
backup="$stage/public-auth.before-rest-direct-v2-20261011.Caddyfile"
test -s "$backup" && test -s "$mounted"
test -f docker-compose.auth-public-direct.yml
grep -Fq "$mounted" docker-compose.auth-public-direct.yml
if cmp -s "$backup" "$mounted";then
 echo 'DIRECT_REST_ROLLBACK=ALREADY_BASELINE'
 exit 0
fi
cat "$backup" > "$mounted"
sudo -n /usr/bin/docker exec supabase-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
echo 'DIRECT_REST_ROLLBACK=RESTORED_PRIOR_AUTH_AND_STUDIO_CONFIG'
