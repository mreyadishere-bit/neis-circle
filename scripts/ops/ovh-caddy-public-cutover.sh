#!/usr/bin/env bash
set -Eeuo pipefail
D=(sudo -n /usr/bin/docker)
cd /home/ubuntu/neis-supabase
# Determine actual Caddyfile bind from the running container.
id="$("${D[@]}" compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml ps -q caddy)"
test -n "$id"
config="$("${D[@]}" inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$id")"
test -n "$config"
test -f "$config/Caddyfile"
test -s /home/ubuntu/neis-frontend/releases/95ea3dc328fe9a156d0aae36347dcf4a084af1ad/index.html
# Preserve the existing API virtual host and prepare new frontend server root.
python3 - "$config/Caddyfile" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
c=p.read_text()
if 'neiscircle.site' in c and 'www.neiscircle.site' in c:
 print('CADDY_FRONTEND=ALREADY_CONFIGURED')
 raise SystemExit(0)
if 'reverse_proxy' not in c or not any(token in c for token in ('{
# Caddy serving from a read-only release root inside container.
block='\n# NEIS Circle production frontend\nneiscircle.site, www.neiscircle.site {\n  root * /srv/neis-circle\n  try_files {path} /index.html\n  file_server\n  encode zstd gzip\n}\n'
p.with_suffix('.Caddyfile-before-neis-cutover').write_text(c)
p.write_text(c.rstrip()+'\n'+block)
print('CADDY_FRONTEND=CONFIG_ADDED')
PY
# Validate new config syntax before recreating the running Caddy container.\nif ! \"\${D[@]}\" exec \"$id\" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then\n  echo 'CADDY_VALIDATE=FAILED_NO_RECREATE'\n  exit 1\nfi\necho 'CADDY_VALIDATE=PASS'\n# Mount the release as a read-only frontend directory through docker compose override.
cat > docker-compose.frontend-public.yml <<'YAML'
services:
  caddy:
    volumes:
      - /home/ubuntu/neis-frontend/releases/95ea3dc328fe9a156d0aae36347dcf4a084af1ad:/srv/neis-circle:ro
YAML
files=(-f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.frontend-public.yml)
"${D[@]}" compose "${files[@]}" config --quiet
"${D[@]}" compose "${files[@]}" up -d --no-deps caddy >/dev/null
echo 'CADDY_FRONTEND=DEPLOYED'
, '{env.')):
 raise SystemExit('CADDY=BLOCKED_EXISTING_GENERIC_API_ROUTE_UNCONFIRMED')
# Caddy serving from a read-only release root inside container.
block='\n# NEIS Circle production frontend\nneiscircle.site, www.neiscircle.site {\n  root * /srv/neis-circle\n  try_files {path} /index.html\n  file_server\n  encode zstd gzip\n}\n'
p.with_suffix('.Caddyfile-before-neis-cutover').write_text(c)
p.write_text(c.rstrip()+'\n'+block)
print('CADDY_FRONTEND=CONFIG_ADDED')
PY
# Mount the release as a read-only frontend directory through docker compose override.
cat > docker-compose.frontend-public.yml <<'YAML'
services:
  caddy:
    volumes:
      - /home/ubuntu/neis-frontend/releases/95ea3dc328fe9a156d0aae36347dcf4a084af1ad:/srv/neis-circle:ro
YAML
files=(-f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml -f docker-compose.frontend-public.yml)
"${D[@]}" compose "${files[@]}" config --quiet
"${D[@]}" compose "${files[@]}" up -d --no-deps caddy >/dev/null
echo 'CADDY_FRONTEND=DEPLOYED'
