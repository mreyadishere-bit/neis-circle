#!/usr/bin/env python3
"""Revert the section-sharing frontend release only if still active."""
import os,re,subprocess,sys
from pathlib import Path
ROOT=Path('/home/ubuntu/neis-supabase')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
STAGE=Path('/home/ubuntu/neis-backups/section-sharing-20261119')
compose=['sudo','-n','/usr/bin/docker','compose']+[v for n in (
'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml'
) for v in ('-f',n)]
rev=os.environ.get('GITHUB_SHA','')[:12]
assert re.fullmatch('[0-9a-f]{12}',rev),'Invalid deployment revision'
target=RELEASES/('section-sharing-'+rev)
backup=STAGE/'previous-release-path.txt'
if not backup.is_file():
 print('SHARE_ROLLBACK=SKIPPED_NO_PREVIOUS_RELEASE')
 sys.exit(0)
previous=Path(backup.read_text().strip())
assert previous.is_dir() and previous.parent==RELEASES,'Unsafe rollback source'
html=(previous/'index.html')
assert html.is_file() and 'scripts/user-activity-v1.js' in html.read_text(),'Previous release invalid'
current=OVERLAY.read_text()
if str(target) not in current:
 print('SHARE_ROLLBACK=NOT_ACTIVE')
 sys.exit(0)
assert current.count(str(target))==1,'Ambiguous overlay'
OVERLAY.write_text(current.replace(str(target),str(previous),1))
result=subprocess.run(compose+['up','-d','--no-deps','caddy'],cwd=ROOT,capture_output=True,text=True,timeout=160)
if result.returncode:
 OVERLAY.write_text(current)
 print('SHARE_ROLLBACK=FAILED_'+result.stderr[-170:],file=sys.stderr)
 sys.exit(1)
print('SHARE_ROLLBACK=COMPLETE')
