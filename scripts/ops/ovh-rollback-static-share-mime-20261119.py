#!/usr/bin/env python3
"""Restore original Caddy config if share MIME update fails external checks."""
from pathlib import Path
import json,subprocess,sys
DOCKER=['sudo','-n','/usr/bin/docker']
BACKUP=Path('/home/ubuntu/neis-backups/section-sharing-files-20261119/Caddyfile-before-static-share-mime.backup')
MARKER='@neisShareHTML path /articles /study /circles /opportunities /gallery /timetable'
HEADER='header @neisShareHTML Content-Type "text/html; charset=utf-8"'
try:
 mounts=json.loads(subprocess.run(DOCKER+['inspect','supabase-caddy'],capture_output=True,text=True,timeout=25,check=True).stdout)[0]['Mounts']
 conf=[Path(m['Source'])/'Caddyfile' for m in mounts if m.get('Destination')=='/etc/caddy']
 if len(conf)!=1 or not BACKUP.is_file():
  print('SHARE_MIME_ROLLBACK=NOT_NEEDED');sys.exit(0)
 current=conf[0].read_text()
 if MARKER not in current:
  print('SHARE_MIME_ROLLBACK=NOT_ACTIVE');sys.exit(0)
 old=BACKUP.read_text()
 insertion='  '+MARKER+'\n  '+HEADER+'\n'
 assert insertion in current and current.replace(insertion,'',1)==old,'Config changed since deployment'
 conf[0].write_text(old)
 p=subprocess.run(DOCKER+['exec','supabase-caddy','caddy','reload','--config','/etc/caddy/Caddyfile'],capture_output=True,text=True,timeout=55)
 if p.returncode:raise RuntimeError('Caddy reload failed')
 print('SHARE_MIME_ROLLBACK=COMPLETE')
except Exception as e:
 print('SHARE_MIME_ROLLBACK=FAILED_'+str(e)[:180],file=sys.stderr)
 sys.exit(1)
