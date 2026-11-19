#!/usr/bin/env python3
"""Rollback only the active section-sharing-files release after failed public test."""
from pathlib import Path
import os,re,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
STAGE=Path('/home/ubuntu/neis-backups/section-sharing-files-20261119')
COMPOSE=['sudo','-n','/usr/bin/docker','compose']+[x for f in (
'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml') for x in ('-f',f)]
try:
 sha=os.environ.get('GITHUB_SHA','')[:12]
 assert re.fullmatch('[0-9a-f]{12}',sha)
 target=RELEASES/('section-sharing-files-'+sha)
 backup=STAGE/'previous-release-path.txt'
 if not backup.exists():
  print('STATIC_SHARE_ROLLBACK=NOT_NEEDED');sys.exit(0)
 old=Path(backup.read_text().strip())
 assert old.is_dir() and old.parent==RELEASES
 curr=OVERLAY.read_text()
 if str(target) not in curr:
  print('STATIC_SHARE_ROLLBACK=NOT_ACTIVE');sys.exit(0)
 assert curr.count(str(target))==1
 OVERLAY.write_text(curr.replace(str(target),str(old),1))
 r=subprocess.run(COMPOSE+['up','-d','--no-deps','caddy'],cwd=ROOT,capture_output=True,text=True,timeout=165)
 if r.returncode:raise RuntimeError('Caddy restart failed')
 print('STATIC_SHARE_ROLLBACK=COMPLETE')
except Exception as e:
 print('STATIC_SHARE_ROLLBACK=FAILED_'+str(e)[:160],file=sys.stderr)
 sys.exit(1)
