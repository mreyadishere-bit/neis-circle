#!/usr/bin/env python3
"""Restore the exact previous OVH frontend release if search-avatar smoke fails."""
from pathlib import Path
import os,re,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/search-portrait-v2-20261119')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
COMPOSE=['sudo','-n','/usr/bin/docker','compose']+[p for f in
 ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
  'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml')
 for p in ('-f',f)]
try:
 rev=os.environ.get('GITHUB_SHA','')[:12]
 assert re.fullmatch('[0-9a-f]{12}',rev),'Invalid revision'
 expected=RELEASES/('search-portrait-v2-'+rev)
 old=STAGE/('previous-release-'+rev+'.txt')
 if not old.exists():
  print('SEARCH_AVATAR_ROLLBACK=NO_PREVIOUS_DEPLOYMENT');sys.exit(0)
 previous=Path(old.read_text().strip())
 assert previous.parent==RELEASES and previous.is_dir()
 current=OVERLAY.read_text()
 if str(expected) not in current:
  print('SEARCH_AVATAR_ROLLBACK=NOT_ACTIVE');sys.exit(0)
 assert current.count(str(expected))==1
 OVERLAY.write_text(current.replace(str(expected),str(previous),1))
 command=subprocess.run(COMPOSE+['up','-d','--no-deps','caddy'],
                        cwd=ROOT,capture_output=True,text=True,timeout=175)
 if command.returncode:raise RuntimeError((command.stderr or '')[-250:])
 print('SEARCH_AVATAR_ROLLBACK=COMPLETE')
except Exception as e:
 print('SEARCH_AVATAR_ROLLBACK=FAILED_'+str(e)[:230],file=sys.stderr)
 sys.exit(1)
