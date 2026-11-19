#!/usr/bin/env python3
"""Revert only a currently-active search portrait release."""
from pathlib import Path
import os,re,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
STAGE=Path('/home/ubuntu/neis-backups/search-portraits-20261119')
COMPOSE=['sudo','-n','/usr/bin/docker','compose']+[x for file in
 ('docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
  'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml')
 for x in ('-f',file)]
try:
 rev=os.environ.get('GITHUB_SHA','')[:12]
 assert re.fullmatch('[0-9a-f]{12}',rev),'Invalid release revision'
 current=RELEASES/('search-portraits-'+rev)
 backup=STAGE/('previous-release-'+rev+'.txt')
 if not backup.is_file():
  print('SEARCH_PORTRAIT_ROLLBACK=NOT_NEEDED');sys.exit(0)
 old=Path(backup.read_text().strip())
 assert old.parent==RELEASES and old.is_dir(),'Previous release invalid'
 overlay=OVERLAY.read_text()
 if str(current) not in overlay:
  print('SEARCH_PORTRAIT_ROLLBACK=NOT_ACTIVE');sys.exit(0)
 assert overlay.count(str(current))==1,'Ambiguous release configuration'
 OVERLAY.write_text(overlay.replace(str(current),str(old),1))
 proc=subprocess.run(COMPOSE+['up','-d','--no-deps','caddy'],
  cwd=ROOT,text=True,capture_output=True,timeout=180)
 if proc.returncode:raise RuntimeError(proc.stderr[-210:])
 print('SEARCH_PORTRAIT_ROLLBACK=COMPLETE')
except Exception as error:
 print('SEARCH_PORTRAIT_ROLLBACK=FAILED_'+str(error)[:180],file=sys.stderr)
 sys.exit(1)
