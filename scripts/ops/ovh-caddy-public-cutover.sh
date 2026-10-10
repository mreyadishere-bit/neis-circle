#!/usr/bin/env bash
set -Eeuo pipefail
docker=(sudo -n /usr/bin/docker)
cd /home/ubuntu/neis-supabase
release=/home/ubuntu/neis-frontend/releases/95ea3dc328fe9a156d0aae36347dcf4a084af1ad
test -s "$release/index.html"
id="$("${docker[@]}" compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml ps -q caddy)"
test -n "$id"
config="$("${docker[@]}" inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$id")"
test -n "$config"
test -f "$config/Caddyfile"
export CADDY_CONFIG="$config/Caddyfile"
python3 - <<'PY'
from pathlib import Path
import os
p=Path(os.environ['CADDY_CONFIG'])
c=p.read_text()
if 'neiscircle.site, www.neiscircle.site {' in c:
 print('CADDY_ROUTE=ALREADY_PRESENT')
else:
 if 'reverse_proxy' not in c or not c.lstrip().startswith('{'):
  raise SystemExit('CADDY_ROUTE=BLOCKED_UNEXPECTED_EXISTING_SITE')
 backup=p.parent/'Caddyfile.neis-before-public-cutover.bak'
 if not backup.exists():backup.write_text(c)
 block='\n# NEIS Circle frontend\nneiscircle.site, www.neiscircle.site {\n  root * /srv/neis-circle\n  try_files {path} /index.html\n  file_server\n  encode zstd gzip\n}\n'
 p.write_text(c.rstrip()+'\n'+block)
 print('CADDY_ROUTE=ADDED')
PY
if ! "${docker[@]}" exec "$id" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
 echo 'CADDY_VALIDATE=FAILED'
 exit 1
fi
echo 'CADDY_VALIDATE=PASS'
cat > docker-compose.frontend-public.yml <<'YAML'
services:
  caddy:
    volumes:
      - /home/ubuntu/neis-frontend/releases/95ea3dc328fe9a156d0aae36347dcf4a084af1ad:/srv/neis-circle:ro
YAML
files=(-f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.frontend-public.yml)
"${docker[@]}" compose "${files[@]}" config --quiet
"${docker[@]}" compose "${files[@]}" up -d --no-deps caddy >/dev/null
echo 'CADDY_FRONTEND=DEPLOYED'
