#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
id="$(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml ps -q caddy)"
test -n "$id"
src="$(sudo -n /usr/bin/docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$id")"
python3 - "$src/Caddyfile" <<'PY'
from pathlib import Path
import sys,re
text=Path(sys.argv[1]).read_text()
print('CADDY_LINE_COUNT='+str(len(text.splitlines())))
for i,line in enumerate(text.splitlines(),1):
 clean=line.strip()
 if not clean or clean.startswith('#'):continue
 tokens=re.split(r'\s+',clean)
 first=tokens[0]
 kind='OTHER'
 if first in ('reverse_proxy','handle','handle_path','route','respond','redir','root','file_server','tls','encode','header','import','log'):kind=first
 elif '{' in clean:kind='BLOCK'
 print('LINE_'+str(i)+'_KIND='+kind)
 if kind in ('BLOCK','import') and not any(key in clean.lower() for key in ('password','secret','token','key','auth')):
  sanitized=re.sub(r'(\{\$[^}]+\}|\{env\.[^}]+\})','[ENV]',clean)
  sanitized=re.sub(r'\b(?:https?://)?(?:[a-z0-9-]+\.)+[a-z]{2,}\b','[HOST]',sanitized,flags=re.I)
  print('LINE_'+str(i)+'_SHAPE='+sanitized[:140])
print('CONFIG_SHAPE_ONLY=PASS')
PY
