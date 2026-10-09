#!/usr/bin/env bash
# HTTP-only API verification; no data or credentials are logged.
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
test -r .env
key="$(sed -n 's/^ANON_KEY=//p' .env | tail -n 1)"
test -n "$key"
key="${key%\"}"
key="${key#\"}"
key="${key%\'}"
key="${key#\'}"
test -n "$key"
base='https://supabase.neiscircle.site'
check() {
  local name="$1" path="$2"
  local status
  status="$(curl -sS --output /dev/null --write-out '%{http_code}' --max-time 12 --header "apikey: $key" --header "Authorization: Bearer $key" "$base$path")" || status="NETWORK_ERROR"
  echo "${name}_WITH_ANON_KEY_HTTP=$status"
}
check AUTH_HEALTH '/auth/v1/health'
check AUTH_SETTINGS '/auth/v1/settings'
check REST_SCHEMA '/rest/v1/'
check STORAGE_BUCKETS '/storage/v1/bucket'
echo 'AUTHENTICATED_READ_ONLY_API_AUDIT=COMPLETE'
