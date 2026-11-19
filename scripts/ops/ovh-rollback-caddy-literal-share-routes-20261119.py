#!/usr/bin/env python3
"""Restore exact previous Caddyfile after unsuccessful clean share route checks."""
from pathlib import Path
import json,subprocess,sys
DOCKER=['sudo','-n','/usr/bin/docker']
BACKUP=Path('/home/ubuntu/neis-backups/section-sharing-html-20261119/Caddyfile-before-literal-share-routes.backup')
try:
 m=json.loads(subprocess.run(DOCKER+['inspect','supabase-caddy'],capture_output=True,text=True,check=True,timeout=30).stdout)[0]['Mounts']
 conf=[Path(x['Source'])/'Caddyfile' for x in m if x.get('Destination')=='/etc/caddy']
 if len(conf)!=1 or not BACKUP.exists():
  print('LITERAL_SHARE_ROLLBACK=NOT_NEEDED');sys.exit(0)
 current=conf[0].read_text()
 if 'handle /articles {' not in current:
  print('LITERAL_SHARE_ROLLBACK=NOT_ACTIVE');sys.exit(0)
 old=BACKUP.read_text()
 assert 'neiscircle.site, www.neiscircle.site' in old and old.count('try_files {path} /index.html')==1
 conf[0].write_text(old)
 cmd=DOCKER+['exec','supabase-caddy','caddy','reload','--config','/etc/caddy/Caddyfile']
 p=subprocess.run(cmd,capture_output=True,text=True,timeout=60)
 if p.returncode:raise RuntimeError('Failed restoring original Caddy configuration')
 print('LITERAL_SHARE_ROLLBACK=COMPLETE')
except Exception as e:
 print('LITERAL_SHARE_ROLLBACK=FAILED_'+str(e)[:180],file=sys.stderr)
 sys.exit(1)
