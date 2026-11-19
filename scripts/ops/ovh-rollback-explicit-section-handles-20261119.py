#!/usr/bin/env python3
"""Restore original Caddy config after failed external share page checks."""
from pathlib import Path
import json,subprocess,sys
DOCKER=['sudo','-n','/usr/bin/docker']
BACKUP=Path('/home/ubuntu/neis-backups/section-sharing-20261119/Caddyfile-before-section-explicit-handles.backup')
try:
 mounts=json.loads(subprocess.run(DOCKER+['inspect','supabase-caddy'],capture_output=True,text=True,check=True,timeout=30).stdout)[0]['Mounts']
 conf=[Path(x['Source'])/'Caddyfile' for x in mounts if x.get('Destination')=='/etc/caddy']
 if len(conf)!=1 or not BACKUP.is_file():
  print('EXPLICIT_SHARE_ROLLBACK=SKIPPED');sys.exit(0)
 text=conf[0].read_text()
 if '@neisShareSection' not in text:
  print('EXPLICIT_SHARE_ROLLBACK=NOT_ACTIVE');sys.exit(0)
 old=BACKUP.read_text()
 if old.count('try_files {path} /index.html')!=1:
  raise RuntimeError('Invalid backup')
 conf[0].write_text(old)
 proc=subprocess.run(DOCKER+['exec','supabase-caddy','caddy','reload','--config','/etc/caddy/Caddyfile'],capture_output=True,text=True,timeout=65)
 if proc.returncode:raise RuntimeError('Caddy reload failed')
 print('EXPLICIT_SHARE_ROLLBACK=COMPLETE')
except Exception as e:
 print('EXPLICIT_SHARE_ROLLBACK=FAILED_'+str(e)[:180],file=sys.stderr)
 sys.exit(1)
