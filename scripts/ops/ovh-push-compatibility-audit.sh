#!/usr/bin/env bash
set -Eeuo pipefail
cd /home/ubuntu/neis-supabase
python3 - <<'PY'
from pathlib import Path
import re,subprocess,sys
release=Path('/home/ubuntu/neis-frontend/releases/ovh-selfhosted-20261010-pushfix')
app=(release/'index.html').read_text()
worker=(release/'neis-pwa-sw.js').read_text()
push=(release/'scripts/pwa-install-v117.js').read_text()
match=re.search(r'VAPID_PUBLIC_KEY\s*=\s*[\x27\x22]([A-Za-z0-9_-]+)[\x27\x22]',worker)
if not match or not re.fullmatch(r'[A-Za-z0-9_-]{85,90}',match.group(1)):
 print('VAPID=BLOCKED_BAD_PUBLIC_KEY_FORMAT');sys.exit(1)
key=match.group(1)
print('VAPID_WORKER_FRONTEND_MATCH='+('YES' if key in push else 'NO'))
if key not in push:sys.exit(1)
sql="SELECT CASE WHEN EXISTS(SELECT 1 FROM public.get_web_push_vapid_keys() WHERE public_key='"+key+"') THEN 'MATCH' ELSE 'MISMATCH' END;"
cmd=['sudo','-n','/usr/bin/docker','compose','-f','docker-compose.yml','-f','docker-compose.security.yml','-f','docker-compose.caddy.yml','exec','-T','db','psql','-X','-U','postgres','-d','postgres','-Atqc',sql]
r=subprocess.run(cmd,capture_output=True,text=True,timeout=25)
if r.returncode:
 print('VAPID_DB_COMPARISON=QUERY_FAILED')
else:
 print('VAPID_DB_COMPARISON='+r.stdout.strip())
script_refs=re.findall(r'<script[^>]+src=[\x27\x22]([^\x27\x22]+)',app,re.I)
styles=re.findall(r'<link[^>]+href=[\x27\x22]([^\x27\x22]+\.css[^\x27\x22]*)',app,re.I)
js_files=list((release/'scripts').rglob('*.js'))
css_files=list((release/'styles').rglob('*.css'))
print('FRONTEND_SCRIPT_TAGS='+str(len(script_refs)))
print('FRONTEND_STYLESHEET_TAGS='+str(len(styles)))
print('FRONTEND_ALL_JS_MIB='+str(round(sum(p.stat().st_size for p in js_files)/1048576,2)))
print('FRONTEND_ALL_CSS_MIB='+str(round(sum(p.stat().st_size for p in css_files)/1048576,2)))
print('FRONTEND_PUSHFIX_ACTIVE='+str('pushfix=20261010' in app))
PY
echo '=== Disk growth categories ==='
for folder in /home/ubuntu/neis-backups /home/ubuntu/neis-frontend /home/ubuntu/neis-supabase/volumes; do
 if test -d "$folder"; then 
  bytes="$(sudo -n du -sb "$folder" 2>/dev/null | cut -f1)"
  case "$folder" in
   */neis-backups) name=BACKUP ;;
   */neis-frontend) name=FRONTEND ;;
   */volumes) name=SUPABASE_VOLUMES ;;
  esac
  if test -n "$bytes"; then echo "DISK_${name}_BYTES=$bytes"; fi
 fi
done
echo 'PUSH_DIAGNOSTIC=COMPLETE_NO_PRIVATE_VALUES'
