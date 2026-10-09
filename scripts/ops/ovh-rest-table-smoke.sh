#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
test -r .env
anon="$(sed -n 's/^ANON_KEY=//p' .env | tail -n 1)"
service="$(sed -n 's/^SERVICE_ROLE_KEY=//p' .env | tail -n 1)"
for keyname in anon service; do
  key="${!keyname}"
  key="${key%\"}"; key="${key#\"}"
  key="${key%\'}"; key="${key#\'}"
  test -n "$key"
  base='https://supabase.neiscircle.site/rest/v1'
  for route in 'profiles?select=id&limit=0' 'circles?select=id&limit=0'; do
    label="${route%%\?*}"
    code="$(curl --silent --show-error --output /dev/null --max-time 12 --write-out '%{http_code}' -H "apikey: $key" -H "Authorization: Bearer $key" "$base/$route")" || code=NETWORK_ERROR
    echo "REST_${label}_${keyname}_HTTP=$code"
  done
done
echo 'REST_TABLE_READ_ONLY=COMPLETE'
