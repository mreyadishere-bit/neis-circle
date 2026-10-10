#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
id="$(sudo -n /usr/bin/docker compose -f docker-compose.yml -f docker-compose.security.yml -f docker-compose.caddy.yml ps -q caddy)"
config="$(sudo -n /usr/bin/docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$id")/Caddyfile"
python3 - "$config" <<'PY'
from pathlib import Path
import sys,re
s=Path(sys.argv[1]).read_text().splitlines()
for n,line in enumerate(s,1):
 t=line.strip()
 if not t:continue
 # Only sanitised directives and structural block shape; never print values.
 label='other'
 if t.startswith(('{$','{env.')):label='ENV_SITE'
 elif t.startswith('neiscircle.site,'):label='PUBLIC_SITE'
 elif t.startswith('handle '):label='HANDLE'
 elif t.startswith('root '):label='ROOT'
 elif t.startswith('file_server'):label='FILE_SERVER'
 elif t.startswith('reverse_proxy'):label='PROXY'
 elif t.startswith('respond'):label='RESPOND'
 elif t.startswith('try_files'):label='TRY_FILES'
 elif t.startswith('redir'):label='REDIRECT'
 elif t.startswith('header'):label='HEADER'
 elif t.startswith('import'):label='IMPORT'
 elif t=='}':label='END'
 elif t.endswith('{'):label='BLOCK'
 print('CONFIG_LINE_%d=%s'%(n,label))
 print('CONFIG_LINE_%d_MAINTENANCE=%s'%(n,str(any(w in t.lower() for w in ('maintenance','temporarily unavailable','back soon')))))
PY
