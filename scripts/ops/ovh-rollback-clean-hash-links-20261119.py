#!/usr/bin/env python3
"""Conditional rollback of the single clean hash sharing release + Caddy rule."""
from pathlib import Path
import json,os,re,subprocess,sys
ROOT=Path('/home/ubuntu/neis-supabase')
STAGE=Path('/home/ubuntu/neis-backups/clean-hash-links-20261119')
RELEASES=Path('/home/ubuntu/neis-frontend/releases')
OVERLAY=ROOT/'docker-compose.frontend-public.yml'
DOCKER=['sudo','-n','/usr/bin/docker']
COMPOSE=DOCKER+['compose']+[p for f in (
 'docker-compose.yml','docker-compose.security.yml','docker-compose.caddy.yml',
 'docker-compose.frontend-public.yml','docker-compose.auth-public-direct.yml')
 for p in ('-f',f)]
OLD='try_files {path} /index.html'
MARKER='# NEIS CLEAN HASH PREVIEWS (15 static social metadata endpoints)'
def run(command,timeout=120):
 p=subprocess.run(command,capture_output=True,text=True,cwd=ROOT,timeout=timeout)
 if p.returncode:raise RuntimeError('COMMAND_FAILED_'+(p.stderr or '')[-160:])
 return p.stdout
def main():
 rev=os.environ.get('GITHUB_SHA','')[:12]
 assert re.fullmatch('[0-9a-f]{12}',rev),'Invalid revision'
 dest=RELEASES/('clean-hash-links-'+rev)
 backup=STAGE/('previous-release-'+rev+'.txt')
 config_backup=STAGE/('previous-caddy-'+rev+'.txt')
 if not backup.is_file() or not config_backup.is_file():
  print('CLEAN_HASH_ROLLBACK=NO_BACKUP')
  return
 previous=Path(backup.read_text().strip())
 assert previous.parent==RELEASES and previous.is_dir(),'Unexpected previous release'
 mounts=json.loads(run(DOCKER+['inspect','supabase-caddy'],timeout=30))[0]['Mounts']
 conf=[Path(m['Source'])/'Caddyfile' for m in mounts if m.get('Destination')=='/etc/caddy']
 assert len(conf)==1,'Caddy config missing'
 old_config=config_backup.read_text()
 now=conf[0].read_text()
 overlay=OVERLAY.read_text()
 # Avoid reverting changes from a different, newer release.
 if str(dest) not in overlay:
  print('CLEAN_HASH_ROLLBACK=NOT_ACTIVE')
  return
 assert overlay.count(str(dest))==1 and now.count(MARKER)==1,'Unexpected live state'
 # Ensure the only Caddy difference is the guarded collection of share handlers.
 assert old_config.count(OLD)==1,'Original SPA rule not found'
 start=now.index(MARKER)
 end=now.find('}',start)
 assert end>start and 'handle /feed {' in now and 'handle /articles {' in now
 # The original Caddy config is stored before this deployment, and is
 # the exact prior state to restore. Refuse if the site's root has changed.
 assert 'neiscircle.site, www.neiscircle.site {' in old_config
 assert 'neiscircle.site, www.neiscircle.site {' in now
 conf[0].write_text(old_config)
 run(DOCKER+['exec','supabase-caddy','caddy','reload',
            '--config','/etc/caddy/Caddyfile'],timeout=65)
 OVERLAY.write_text(overlay.replace(str(dest),str(previous),1))
 run(COMPOSE+['up','-d','--no-deps','caddy'],timeout=175)
 print('CLEAN_HASH_ROLLBACK=SUCCESS')
if __name__=='__main__':
 try:main()
 except Exception as error:
  print('CLEAN_HASH_ROLLBACK=FAILED_'+str(error)[:200],file=sys.stderr)
  sys.exit(1)
