#!/usr/bin/env bash
set -Eeuo pipefail
BASE=https://supabase.neiscircle.site
for item in 'AUTH_HEALTH /auth/v1/health' 'AUTH_SETTINGS /auth/v1/settings' 'REST_ROOT /rest/v1/' 'STORAGE_STATUS /storage/v1/bucket'; do
  label="${item%% *}"
  path="${item#* }"
  code="$(curl --silent --show-error --output /dev/null --max-time 15 --write-out '%{http_code}' "$BASE$path")" || code=NETWORK_ERROR
  echo "${label}_NO_KEY_HTTP=$code"
done
echo 'OVH_PUBLIC_ROUTES_READ_ONLY=COMPLETE'
