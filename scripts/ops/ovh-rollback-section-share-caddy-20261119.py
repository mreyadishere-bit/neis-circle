#!/usr/bin/env python3
"""Restore the exact previous Caddy site config after failed public share checks."""
from pathlib import Path
import json,subprocess,sys
DOCKER=['sudo','-n','/usr/bin/docker']
backup=Path('/home/ubuntu/neis-backups/section-sharing-20261119/Caddyfile-before-section-sharing.backup')
def call(args):
 r=subprocess.run(args,text=True,capture_output=True,timeout=60)
 if r.returncode:raise RuntimeError((r.stderr or 'Caddy reload failed')[-180:])
 return r.stdout
try:
 mounts=json.loads(call(DOCKER+['inspect','supabase-caddy']))[0].get('Mounts',[])
 path=[Path(x['Source'])/'Caddyfile' for x in mounts if x.get('Destination')=='/etc/caddy']
 if len(path)!=1 or not backup.is_file():raise RuntimeError('Backup unavailable')
 current=path[0].read_text()
 expected='try_files {path} {path}/index.html /index.html'
 if expected not in current:
  print('SHARE_CADDY_ROLLBACK=NOT_ACTIVE')
  sys.exit(0)
 old=backup.read_text()
 if old.count('try_files {path} /index.html')!=1 or old.replace('try_files {path} /index.html',expected,1)!=current:
  raise RuntimeError('Unexpected Caddy changes: abort unsafe rollback')
 path[0].write_text(old)
 call(DOCKER+['exec','supabase-caddy','caddy','reload','--config','/etc/caddy/Caddyfile'])
 print('SHARE_CADDY_ROLLBACK=COMPLETE')
except Exception as e:
 print('SHARE_CADDY_ROLLBACK=FAILED_'+str(e)[:160],file=sys.stderr)
 sys.exit(1)
