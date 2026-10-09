#!/usr/bin/env bash
set -Eeuo pipefail
# Launch a standalone static preview on localhost only. Does not touch existing Caddy/Supabase services.
SOURCE="/home/ubuntu/neis-frontend/releases/95ea3dc328fe9a156d0aae36347dcf4a084af1ad"
CONTAINER="neis-frontend-preview"
DOCKER=(sudo -n /usr/bin/docker)
test -s "$SOURCE/index.html"
test -s "$SOURCE/scripts/01-core.js"
if "${DOCKER[@]}" container inspect "$CONTAINER" >/dev/null 2>&1; then
  running=$("${DOCKER[@]}" inspect "$CONTAINER" --format '{{.State.Running}}')
  test "$running" = true || { echo 'PREVIEW=EXISTING_STOPPED_CHECK_MANUALLY'; exit 1; }
  echo 'PREVIEW=ALREADY_RUNNING'
else
  # Use exact image already loaded by the Supabase Caddy container, no pulls or upgrades.
  CADDY=$("${DOCKER[@]}" ps --format '{{.Names}}' | grep -E '(^|-)caddy$' | head -1)
  test -n "$CADDY" || { echo 'PREVIEW=BLOCKED_NO_EXISTING_CADDY'; exit 1; }
  IMAGE=$("${DOCKER[@]}" inspect "$CADDY" --format '{{.Config.Image}}')
  test -n "$IMAGE"
  # Existing service must remain untouched. Expose only loopback.
  "${DOCKER[@]}" run -d --name "$CONTAINER" --restart unless-stopped --network bridge \
    -p 127.0.0.1:18080:80 --mount "type=bind,source=$SOURCE,target=/usr/share/caddy,readonly" \
    "$IMAGE" >/dev/null
  echo 'PREVIEW=CREATED_LOCAL_ONLY'
fi
python3 - <<'PY'
from urllib.request import urlopen
import time,sys
for i in range(12):
 try:
  with urlopen('http://127.0.0.1:18080/',timeout=3) as r:
   data=r.read()
   if r.status==200 and b'<html' in data.lower():
    print('PREVIEW_HTTP=PASS')
    print('PUBLIC_DOMAIN=UNCHANGED')
    sys.exit(0)
 except Exception:time.sleep(1)
print('PREVIEW_HTTP=FAILED')
sys.exit(1)
PY
